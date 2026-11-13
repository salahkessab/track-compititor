import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import sharp from "sharp";
import { IntelligenceStore } from "./database";
import { extractArticle, type RecipeSnapshot } from "./article";
import { atomicWrite, digest } from "./artifacts";
import { storagePath } from "./paths";
import { publicUrl, normalizeUrl } from "./urls";
import type { DiscoveryFetcher } from "./types";

export const MAX_PHOTOS = 80;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const now = () => new Date().toISOString();
export function preparationError(message: string): string {
  if (/HTTP (403|401)|robots/i.test(message)) return "This website blocks automatic access. Paste the recipe text below or use another recipe URL. No generation has started.";
  if (/HTTP 404/.test(message)) return "This recipe URL was not found. Check the link or paste the recipe text below.";
  return message;
}

export function recipeFromText(url: string, text: string): RecipeSnapshot {
  if (typeof text !== "string" || text.length > 12000) throw new Error("Paste a recipe of up to 12,000 characters.");
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const heading = (line: string) => line.replace(/^#+\s*/, "").replace(/:$/, "").trim();
  const ingredientsAt = lines.findIndex(line => /^(ingredients(?: list)?|what you(?:'ll| will) need)$/i.test(heading(line)));
  const methodAt = lines.findIndex((line, index) => index > ingredientsAt && /^(instructions|directions|method|steps|preparation)$/i.test(heading(line)));
  if (ingredientsAt < 1 || methodAt <= ingredientsAt + 1) throw new Error("Include the recipe title, an Ingredients heading, and an Instructions heading in the pasted text.");
  const end = lines.findIndex((line, index) => index > methodAt && /^(notes?|nutrition(?:al information)?|tips|storage|serving suggestions|faq|frequently asked questions)$/i.test(heading(line)));
  const clean = (line: string) => line.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "");
  const ingredients = lines.slice(ingredientsAt + 1, methodAt).map(clean);
  const instructions = lines.slice(methodAt + 1, end < 0 ? undefined : end).map(clean);
  if (!instructions.length || ingredients.length > 200 || instructions.length > 200) throw new Error("Include the ingredients and cooking instructions in the pasted recipe.");
  return { url: publicUrl(normalizeUrl(url)).href, title: heading(lines[0]).slice(0, 500), ingredients, instructions,
    yield: "", prepTime: "", cookTime: "", totalTime: "", description: "", imageDescription: "", tips: [], storage: [], retrievedAt: now(),
    evidenceVersion: 1, supportingEvidence: [], sourceNotes: ["Recipe text supplied by the user. The source page was not fetched."] };
}
export function discoverPhotos(html: string, pageUrl: string) {
  if (Buffer.byteLength(html) > 5_000_000) throw new Error("Article exceeds the discovery limit.");
  const $ = load(html); const candidates: { url: string; caption: string }[] = []; const title = $("h1").first().text().trim().toLowerCase();
  const add = (value: unknown, caption = "") => {
    if (typeof value !== "string" || !value.trim()) return;
    try { const url = publicUrl(new URL(value.trim(), pageUrl).href).href;
      if (!/\.(?:svg|gif)(?:\?|$)/i.test(url) && !/\b(?:logo|avatar|gravatar|tracking|banner|advertisement)\b/i.test(url)) candidates.push({ url, caption: caption.slice(0, 1000) });
    } catch { /* Unsupported or unsafe image URL. */ }
  };
  const walk = (v: any, depth = 0) => {
    if (!v || depth > 10) return;
    if (Array.isArray(v)) { v.slice(0, 200).forEach(x => walk(x, depth + 1)); return; }
    if (typeof v !== "object") return;
    const types = Array.isArray(v["@type"]) ? v["@type"] : [v["@type"]];
    if (types.includes("Recipe") || types.includes("Article") || types.includes("BlogPosting")) {
      const name = String(v.name || v.headline || "").trim().toLowerCase();
      if (title && name && !title.includes(name) && !name.includes(title)) return;
      for (const img of [v.image].flat()) add(typeof img === "string" ? img : img?.url || img?.contentUrl, v.name || v.headline || "");
      if (types.includes("Recipe")) for (const step of [v.recipeInstructions].flat()) for (const img of [step?.image].flat()) add(typeof img === "string" ? img : img?.url, step?.text || "");
    }
    if (v["@graph"]) walk(v["@graph"], depth + 1);
  };
  $("script[type='application/ld+json']").each((_i, el) => { try { walk(JSON.parse($(el).text())); } catch {} });
  const bodies = $("article .entry-content, article .post-content, .entry-content, [itemprop='articleBody'], article, main");
  const body = bodies.first();
  body.find("img").each((_i, el) => {
    const img = $(el);
    if (img.closest("aside,nav,footer,.author,.author-box,.related-posts,.related-recipes,.recommended,.advertisement,.ad-container,.ad,.adsbygoogle,[aria-label='Advertisement'],[class*='share'],[class*='social']").length) return;
    if (/\b(?:avatar|logo|author-photo|portrait|advertisement|tracking|banner|pin-button)\b/i.test([img.attr("class"), img.attr("id"), img.attr("alt")].join(" "))) return;
    const classes = img.parents().toArray().slice(0, 4).map(p => $(p).attr("class") || "").join(" ");
    if (/related|recommend|author|advert|newsletter|sidebar/i.test(classes)) return;
    const anchor = img.closest("a").attr("href");
    if (anchor) { try { const u = new URL(anchor, pageUrl); if (!/\.(jpe?g|png|webp)$/i.test(u.pathname) && normalizeUrl(u.href) !== normalizeUrl(pageUrl) && !u.hash) return; } catch { return; } }
    const w = Number(img.attr("width")), h = Number(img.attr("height")); if (w && h && (w < 160 || h < 120)) return;
    const caption = img.closest("figure").find("figcaption").text() || img.attr("alt") || "";
    const variants = [img.attr("data-srcset"), img.attr("srcset"), img.closest("picture").find("source").first().attr("srcset")].filter(Boolean).flatMap(v => v!.split(",").map(x => { const [url, size] = x.trim().split(/\s+/); return { url, size: parseInt(size) || 0 }; })).sort((a, b) => b.size - a.size);
    add(variants[0]?.url || img.attr("data-lazy-src") || img.attr("data-src") || img.attr("data-original") || img.attr("src"), caption);
  });
  const groups = new Map<string, { url: string; caption: string }>();
  const resolution = (url: string) => { const u = new URL(url); const dimensions = u.pathname.match(/-(\d{2,5})x\d{2,5}\./); return Number(dimensions?.[1] || u.searchParams.get("w") || u.searchParams.get("width") || 100000); };
  for (const c of candidates) { const u = new URL(c.url); u.pathname = u.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp)$)/i, ""); for (const k of ["w", "h", "width", "height", "resize", "fit", "quality", "q"]) u.searchParams.delete(k); const old = groups.get(u.href); if (!old || resolution(c.url) > resolution(old.url)) groups.set(u.href, c); }
  return [...groups.values()].slice(0, MAX_PHOTOS);
}

export class ImportStore {
  constructor(public store: IntelligenceStore) {}
  get(id: string): any { const row = this.store.db.prepare("SELECT * FROM recipe_imports WHERE id=? AND status<>'deleted'").get(id) as any; if (!row) throw new Error("Import not found. It may have been deleted."); return row; }
  detail(id: string) { const row = this.get(id); return { ...row, error: row.error ? preparationError(row.error) : null, recipe: row.recipe_json ? JSON.parse(row.recipe_json) : null, photos: this.store.db.prepare("SELECT id,source_url,name,position,caption,state,selected,width,height,mime_type,error FROM reference_photos WHERE import_id=? ORDER BY position").all(id) }; }
  list() { return this.store.db.prepare("SELECT id,title,url,kind,status,error,selection_confirmed,revision FROM recipe_imports WHERE status<>'deleted' ORDER BY created_at DESC LIMIT 100").all(); }
  create(url?: string) { const normalized = url ? publicUrl(normalizeUrl(url)).href : null; const id = randomUUID(); this.store.db.prepare("INSERT INTO recipe_imports(id,kind,url,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, normalized ? "url" : "upload", normalized, normalized || "Uploaded photographs", normalized ? "queued" : "ready", now(), now()); return this.detail(id); }
  createFromText(url: string, text: string) {
    const recipe = recipeFromText(url, text);
    return this.store.db.transaction(() => {
      const row = this.create(recipe.url);
      this.store.db.prepare("UPDATE recipe_imports SET status='ready',recipe_json=?,title=?,selection_confirmed=1,revision=1 WHERE id=?").run(JSON.stringify(recipe), recipe.title, row.id);
      return this.detail(row.id);
    }).immediate();
  }
  select(id: string, ids: string[]) {
    const row = this.get(id); if (!["ready", "failed"].includes(row.status)) throw new Error("Wait for photo preparation to finish.");
    if (!Array.isArray(ids) || ids.length > MAX_PHOTOS || ids.some(x => typeof x !== "string")) throw new Error("Invalid photograph selection.");
    const photos = this.store.db.prepare("SELECT id FROM reference_photos WHERE import_id=? AND state='ready'").all(id) as any[];
    if (ids.some(x => !photos.some(p => p.id === x))) throw new Error("Only usable photographs from this recipe can be selected.");
    this.store.db.transaction(() => { this.store.db.prepare("UPDATE reference_photos SET selected=0 WHERE import_id=?").run(id); for (const photo of new Set(ids)) this.store.db.prepare("UPDATE reference_photos SET selected=1 WHERE id=?").run(photo); this.store.db.prepare("UPDATE recipe_imports SET selection_confirmed=1,revision=revision+1,updated_at=? WHERE id=?").run(now(), id); }).immediate();
    return this.detail(id);
  }
  applySelectionRule(id: string) { const photos = this.store.db.prepare("SELECT id FROM reference_photos WHERE import_id=? AND state='ready' ORDER BY position").all(id) as any[]; this.store.db.prepare("UPDATE reference_photos SET selected=1 WHERE import_id=? AND state='ready'").run(id); this.store.db.prepare("UPDATE recipe_imports SET selection_confirmed=?,revision=revision+1 WHERE id=?").run(0, id); }
  async add(id: string, bytes: Buffer, name: string, sourceUrl: string | null = null, caption = "", existingId?: string) {
    this.get(id); if (bytes.length > MAX_PHOTO_BYTES) throw new Error("Photographs must be at most 10 MB.");
    if (!existingId && (this.store.db.prepare("SELECT count(*) n FROM reference_photos WHERE import_id=?").get(id) as any).n >= MAX_PHOTOS) throw new Error("This recipe has reached the 80-photo preparation limit.");
    const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!meta.width || !meta.height || !["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages || 1) > 1) throw new Error("Use a still JPEG, PNG or WebP photograph, up to 40 megapixels.");
    if (meta.width < 160 || meta.height < 120) throw new Error("Image is too small for recipe editing.");
    const sample = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(64, 64, { fit: 'inside' }).toColourspace('srgb').ensureAlpha().raw().toBuffer();
    let visible = false, nonBlack = false;
    for (let i = 0; i < sample.length; i += 4) { if (sample[i + 3] > 8) { visible = true; if (sample[i] > 2 || sample[i + 1] > 2 || sample[i + 2] > 2) nonBlack = true; } }
    if (!visible || !nonBlack) throw new Error('This photo is an empty or black loading placeholder. Let the original photograph load in the recipe tab, then capture it again.');
    const hash = digest(bytes); const pixels = digest(await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().raw().toBuffer());
    const duplicate = this.store.db.prepare("SELECT id FROM reference_photos WHERE import_id=? AND state='ready' AND (sha256=? OR pixel_hash=?) AND id!=?").get(id, hash, pixels, existingId || "") as any;
    if (duplicate) { if (existingId) this.store.db.prepare("UPDATE reference_photos SET state='duplicate',error='Exact duplicate of another photograph.' WHERE id=?").run(existingId); return duplicate.id; }
    const photoId = existingId || randomUUID(); const extension = meta.format === "jpeg" ? "jpg" : meta.format;
    const relative = `research/references/${id}/${photoId}.${extension}`; atomicWrite(this.store.root, relative, bytes);
    if (!existingId) this.store.db.prepare("INSERT INTO reference_photos(id,import_id,source_url,name,position,caption,state) VALUES(?,?,?,?,?,?,'pending')").run(photoId, id, sourceUrl, name.replace(/[^a-zA-Z0-9 ._-]/g, "").slice(0, 120) || "photograph", (this.store.db.prepare("SELECT count(*) n FROM reference_photos WHERE import_id=?").get(id) as any).n, caption.slice(0, 1000));
    this.store.db.prepare("UPDATE reference_photos SET state='ready',relative_path=?,sha256=?,pixel_hash=?,width=?,height=?,mime_type=?,error=NULL WHERE id=?").run(relative, hash, pixels, meta.width, meta.height, `image/${meta.format}`, photoId);
    this.applySelectionRule(id); return photoId;
  }
  read(id: string) { const row = this.store.db.prepare("SELECT * FROM reference_photos WHERE id=? AND state='ready'").get(id) as any; if (!row) throw new Error("Reference unavailable."); const bytes = fs.readFileSync(storagePath(this.store.root, row.relative_path)); if (digest(bytes) !== row.sha256) throw new Error("Reference checksum changed."); return { ...row, bytes }; }
  recover() { this.store.db.prepare("UPDATE recipe_imports SET status='queued',owner=NULL WHERE status='running'").run(); }
  claim(owner: string) { return this.store.db.transaction(() => { if (!this.store.db.prepare("SELECT 1 FROM worker_lease WHERE owner=? AND expires_at>?").get(owner, Date.now())) return null; const row = this.store.db.prepare("SELECT * FROM recipe_imports WHERE status='queued' ORDER BY created_at LIMIT 1").get() as any; if (row) this.store.db.prepare("UPDATE recipe_imports SET status='running',owner=? WHERE id=?").run(owner, row.id); return row; }).immediate(); }
  async process(id: string, fetcher: DiscoveryFetcher, signal?: AbortSignal) {
    const row = this.get(id);
    try {
      if (!row.recipe_json && !(this.store.db.prepare("SELECT 1 FROM reference_photos WHERE import_id=?").get(id))) {
        const response = await fetcher.get(row.url, { signal }); if (response.status !== 200) throw new Error(preparationError(`Source returned HTTP ${response.status}.`));
        const html = response.body.toString("utf8"); const extracted = extractArticle(html, response.url); const photos = discoverPhotos(html, response.url);
        this.store.db.transaction(() => {
          this.store.db.prepare("UPDATE recipe_imports SET recipe_json=?,title=?,url=? WHERE id=?").run(extracted.recipe ? JSON.stringify(extracted.recipe) : null, extracted.recipe?.title || row.url, response.url, id);
          photos.forEach((p, i) => this.store.db.prepare("INSERT INTO reference_photos(id,import_id,source_url,name,position,caption,state) VALUES(?,?,?,?,?,?,'pending')").run(randomUUID(), id, p.url, `Photo ${i + 1}`, i, p.caption));
        }).immediate();
      }
      for (const photo of this.store.db.prepare("SELECT * FROM reference_photos WHERE import_id=? AND state='pending' ORDER BY position").all(id) as any[]) {
        if (signal?.aborted) throw new Error("Preparation interrupted.");
        try { const response = await fetcher.get(photo.source_url, { signal }); if (response.status !== 200) throw new Error(`Image returned HTTP ${response.status}.`); await this.add(id, response.body, photo.name, photo.source_url, photo.caption, photo.id); }
        catch (e) { if (signal?.aborted) throw e; this.store.db.prepare("UPDATE reference_photos SET state='failed',error=? WHERE id=?").run(e instanceof Error ? e.message.slice(0, 300) : "Image unavailable.", photo.id); }
      }
      this.applySelectionRule(id); this.store.db.prepare("UPDATE recipe_imports SET status='ready',owner=NULL,error=NULL,updated_at=? WHERE id=?").run(now(), id);
    } catch (e) { this.store.db.prepare("UPDATE recipe_imports SET status=?,owner=NULL,error=?,updated_at=? WHERE id=?").run(signal?.aborted ? "queued" : "failed", e instanceof Error ? e.message.slice(0, 400) : "Preparation failed.", now(), id); }
  }
}
