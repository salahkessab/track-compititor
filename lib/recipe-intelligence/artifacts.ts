import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { storagePath } from "./paths";
import { IntelligenceStore } from "./database";
import type { RecipeSnapshot } from "./article";
import type { ArticleFormat } from "./settings";
import { andText, articleDocument, validateBlog, type Article, type ArticleImage } from "./article-document";
import { createZip } from "./zip";
export type { Article } from "./article-document";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const escapeHtml = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function atomicWrite(root: string, relative: string, value: Buffer | string) {
  const target = storagePath(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
  storagePath(root, relative); // Recheck newly created ancestors for junction escapes.
  const temp = `${target}.${randomUUID()}.tmp`; const handle = fs.openSync(temp, "wx");
  try { fs.writeFileSync(handle, value); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  fs.renameSync(temp, target); return target;
}
export function validateArticle(raw: any, recipe: RecipeSnapshot, format: ArticleFormat = "compact_v1"): { article: Article; warnings: string[] } {
  const warnings: string[] = [];
  const text = (v: any, max: number) => typeof v === "string" ? v.replace(/<[^>]*>/g, "").trim().slice(0, max) : "";
  const prose = (v: any, max: number) => { const value = text(v, max).replace(/[—–]/g, ", ").replace(/\*\*/g, ""); return format === "blog_1000_1200_v1" ? andText(value) : value; };
  const list = (v: any) => Array.isArray(v) ? v.slice(0, 200).map(s => text(s, 12000)).filter(Boolean) : [];
  const article: Article = { seoTitle: prose(raw?.seoTitle, 160) || recipe.title, metaDescription: prose(raw?.metaDescription, 320), slug: text(raw?.slug, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recipe", introduction: prose(raw?.introduction, 12000), instructions: list(raw?.instructions), tips: [], storage: [], format };
  if (!article.introduction) warnings.push("Introduction is missing.");
  if (!article.metaDescription || article.metaDescription.length > 160) warnings.push("Meta description needs editorial review.");
  // The authoritative ingredients/card remain entirely outside model-authored fields.
  // A numerical change is corrected locally, preserving the supported cooking step.
  const numbers = (s: string) => (s.match(/\d+(?:[.,/]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]/g) || []).join("|");
  const facts = (s: string) => {
    const normalized = s.toLowerCase().replace(/teaspoons?/g, "tsp").replace(/tablespoons?/g, "tbsp").replace(/millilit(?:er|re)s?/g, "ml").replace(/grams?/g, "g").replace(/minutes?/g, "min").replace(/hours?/g, "hr").replace(/fahrenheit/g, "f").replace(/celsius/g, "c");
    const units = normalized.match(/\b(?:tsp|tbsp|ml|kg|g|oz|lb|cups?|liters?|litres?|min|hr)\b|°\s*[fc]\b/g) || [];
    const methodGroups = [/\b(?:simmer)\w*/g, /\b(?:boil)\w*/g, /\b(?:bak|roast)\w*/g, /\b(?:fry|fried|frying)\b/g, /\b(?:steam)\w*/g, /\b(?:sauté|saute)\w*/g, /\b(?:blend|puree|purée)\w*/g, /\b(?:grill|broil)\w*/g, /\b(?:chill|refrigerat)\w*/g];
    return { units: units.sort().join("|"), methods: methodGroups.map((pattern, index) => pattern.test(normalized) ? index : -1).filter(n => n >= 0) };
  };
  if (article.instructions.length !== recipe.instructions.length) {
    warnings.push("Instruction count differed; supported source steps were retained."); article.instructions = [...recipe.instructions];
  } else article.instructions = article.instructions.map((step, i) => {
    const expected = facts(recipe.instructions[i]), actual = facts(step);
    if (numbers(step) !== numbers(recipe.instructions[i]) || expected.units !== actual.units || expected.methods.some(m => !actual.methods.includes(m)) || actual.methods.some(m => !expected.methods.includes(m))) {
      warnings.push(`Step ${i + 1} changed a numerical fact, unit or essential method; the supported source step was retained.`); return recipe.instructions[i];
    }
    return step;
  });
  // Tips/storage require explicit support; don't accept model additions without evidence.
  article.tips = [...recipe.tips]; article.storage = [...recipe.storage];
  if (list(raw?.tips).length && !recipe.tips.length || list(raw?.storage).length && !recipe.storage.length) warnings.push("Unsupported tips or storage guidance were omitted.");
  if (article.seoTitle.length > 70) warnings.push("SEO title is longer than the suggested display length.");
  if (format === "blog_1000_1200_v1") {
    article.instructions = article.instructions.map(andText);
    article.blog = validateBlog(raw?.blog, recipe, warnings);
    const anecdote = /\b(?:my (?:family|grandmother|grandma|mother)|I (?:tested|grew up|remember|always make))\b/i;
    for (const key of ["introduction", "conclusion"] as const) {
      const value = key === "introduction" ? article.introduction : article.blog.conclusion;
      if (anecdote.test(value)) { warnings.push("An unsupported personal anecdote was omitted."); if (key === "introduction") article.introduction = ""; else article.blog.conclusion = ""; }
    }
    const focus = andText(recipe.title).toLowerCase();
    if (!article.seoTitle.toLowerCase().includes(focus)) warnings.push("The SEO title should naturally include the recipe title as the focus keyword.");
    if (!article.introduction.split(/\s+/).slice(0, 100).join(" ").toLowerCase().includes(focus)) warnings.push("Include the focus keyword naturally within the first 100 words.");
    article.wordCount = articleDocument(article, recipe).wordCount;
    if (article.wordCount < 1000 || article.wordCount > 1200) warnings.push(`Article is ${article.wordCount} words; aim for 1,000–1,200 with useful supported content, never filler.`);
  } else article.wordCount = articleDocument(article, recipe).wordCount;
  return { article, warnings: [...new Set(warnings)] };
}
export class ArtifactStore {
  constructor(public store: IntelligenceStore) {}
  directory(item: any) { return path.join("articles", item.id, `v${item.version}`); }
  put(item: any, name: string, value: Buffer | string, mediaType: string) {
    if (!/^[a-z0-9][a-z0-9.-]{0,100}$/.test(name)) throw new Error("Invalid artifact name.");
    const relative = path.join(this.directory(item), name); const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    atomicWrite(this.store.root, relative, bytes);
    this.store.db.prepare(`INSERT INTO artifacts(id,item_id,name,relative_path,sha256,size_bytes,media_type,created_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(item_id,name) DO UPDATE SET relative_path=excluded.relative_path,sha256=excluded.sha256,size_bytes=excluded.size_bytes,created_at=excluded.created_at`)
      .run(randomUUID(), item.id, name, relative, digest(bytes), bytes.length, mediaType, new Date().toISOString());
  }
  read(id: string) {
    const row = this.store.db.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as any;
    if (!row) throw new Error("Artifact not found.");
    const data = fs.readFileSync(storagePath(this.store.root, row.relative_path));
    if (digest(data) !== row.sha256) throw new Error("Saved file checksum changed. Retry the local save for this recipe.");
    return { ...row, data };
  }
  manifest(item: any) {
    const files = this.store.db.prepare("SELECT name,sha256,size_bytes,media_type FROM artifacts WHERE item_id=? AND name!='manifest.json'").all(item.id);
    const stages = this.store.db.prepare("SELECT kind,state,error,updated_at FROM content_stages WHERE item_id=?").all(item.id);
    const profiles = item.config_json ? JSON.parse(item.config_json) : null;
    const batch = this.store.db.prepare("SELECT settings_json FROM content_batches WHERE id=?").get(item.batch_id) as any;
    const references = this.store.db.prepare("SELECT reference_id,source_url,sha256,position,analysis_json FROM content_photos WHERE item_id=? ORDER BY position").all(item.id);
    this.put(item, "manifest.json", JSON.stringify({ version: item.version, itemId: item.id, settings: batch ? JSON.parse(batch.settings_json) : null, profiles, references, updatedAt: new Date().toISOString(), stages, files }, null, 2), "application/json");
  }
  forkVersion(item: any) {
    const files = this.store.db.prepare("SELECT * FROM artifacts WHERE item_id=? AND name!='manifest.json'").all(item.id) as any[];
    const next = { ...item, version: item.version + 1 };
    for (const file of files) {
      const checked = this.read(file.id);
      atomicWrite(this.store.root, path.join(this.directory(next), file.name), checked.data);
    }
    this.store.db.transaction(() => {
      this.store.db.prepare("UPDATE content_items SET version=? WHERE id=?").run(next.version, item.id);
      for (const file of files) this.store.db.prepare("UPDATE artifacts SET relative_path=? WHERE id=?").run(path.join(this.directory(next), file.name), file.id);
    }).immediate();
    this.manifest(next);
  }
  article(item: any, article: Article, recipe: RecipeSnapshot) {
    const images: ArticleImage[] = (["featured", "alternate", "pinterest"] as const).flatMap(kind => {
      const file = this.store.db.prepare("SELECT id FROM artifacts WHERE item_id=? AND name=?").get(item.id, `${kind}.jpg`) as { id: string } | undefined;
      if (!file) return [];
      return [{ kind, fileName: `${kind}.jpg`, width: kind === "pinterest" ? 1000 : 1200, height: 1500,
        dataUri: `data:image/jpeg;base64,${this.read(file.id).data.toString("base64")}` }];
    });
    for (const p of this.store.db.prepare("SELECT * FROM content_photos WHERE item_id=? AND analysis_json IS NOT NULL ORDER BY position").all(item.id) as any[]) {
      const name = `photo-${p.reference_id}.jpg`; const file = this.store.db.prepare("SELECT id FROM artifacts WHERE item_id=? AND name=?").get(item.id, name) as any;
      if (!file) continue; const analysis = JSON.parse(p.analysis_json); const dimensions = this.store.db.prepare("SELECT result_json FROM content_stages WHERE item_id=? AND kind=?").get(item.id, `photo:${p.reference_id}`) as any;
      const size = dimensions?.result_json ? JSON.parse(dimensions.result_json) : { width: 1536, height: 864 };
      try { images.push({ kind: "reference", placement: analysis.placement || "gallery", stepIndex: analysis.stepIndex, caption: analysis.visibleFood, fileName: name, width: size.width || 1536, height: size.height || 864, dataUri: `data:image/jpeg;base64,${this.read(file.id).data.toString("base64")}` }); } catch { /* One damaged image must not prevent saving the article or other images. */ }
    }
    const document = articleDocument(article, recipe, images);
    const recipeCard = { "@context": "https://schema.org", "@type": "Recipe", name: recipe.title, description: article.introduction,
      recipeIngredient: [...recipe.ingredients], recipeInstructions: article.instructions.map(text => ({ "@type": "HowToStep", text })),
      ...(recipe.yield ? { recipeYield: recipe.yield } : {}), ...(recipe.prepTime ? { prepTime: recipe.prepTime } : {}),
      ...(recipe.cookTime ? { cookTime: recipe.cookTime } : {}), ...(recipe.totalTime ? { totalTime: recipe.totalTime } : {}),
      ...(images.length ? { image: images.map(i => i.fileName) } : {}), isBasedOn: recipe.url };
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(article.seoTitle)}</title><meta name="description" content="${escapeHtml(article.metaDescription)}"></head><body><article>${document.html}</article><script type="application/ld+json">${JSON.stringify(recipeCard).replace(/</g, "\\u003c")}</script></body></html>`;
    this.put(item, "article.html", html, "text/html"); this.put(item, "article.md", document.markdown, "text/markdown"); this.put(item, "article.txt", document.text, "text/plain");
    this.put(item, "recipe.json", JSON.stringify({ authoritativeRecipe: recipe, recipeCard, draftJsonLd: true }, null, 2), "application/json");
    this.put(item, "seo.json", JSON.stringify({ title: article.seoTitle, description: article.metaDescription, slug: article.slug, wordCount: document.wordCount, articleFormat: article.format || "compact_v1" }, null, 2), "application/json");
    this.put(item, "source.json", JSON.stringify({ recipe, selectionReason: item.selection_reason }, null, 2), "application/json");
    this.put(item, "research-sources.json", item.research_json, "application/json"); this.manifest(item);
  }
  async referenceImage(item: any, photo: any, base64: string, prompt: string) {
    if (typeof base64 !== "string" || base64.length > 55_000_000 || !/^[a-zA-Z0-9+/=]+$/.test(base64)) throw new Error("Invalid edited image data.");
    const bytes = Buffer.from(base64, "base64"); const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format || "") || (metadata.pages || 1) > 1) throw new Error("Edited photo could not be decoded.");
    const name = `photo-${photo.reference_id}`;
    this.put(item, `${name}.${metadata.format === "jpeg" ? "jpeg" : metadata.format}`, bytes, `image/${metadata.format}`);
    this.put(item, `${name}.png`, metadata.format === "png" ? bytes : await sharp(bytes).png().toBuffer(), "image/png");
    this.put(item, `${name}.jpg`, await sharp(bytes).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer(), "image/jpeg");
    this.put(item, `${name}-prompt.txt`, prompt, "text/plain");
    this.store.db.prepare("UPDATE content_stages SET result_json=? WHERE item_id=? AND kind=?").run(JSON.stringify({ width: metadata.width, height: metadata.height }), item.id, `photo:${photo.reference_id}`);
    if (item.article_json) this.article(item, JSON.parse(item.article_json), JSON.parse(item.source_json));
    await this.gallery(item); this.manifest(item);
  }
  async gallery(item: any) {
    const rows = this.store.db.prepare("SELECT * FROM content_photos WHERE item_id=? ORDER BY position").all(item.id) as any[];
    const figures: string[] = [];
    for (const p of rows) { const file = this.store.db.prepare("SELECT id FROM artifacts WHERE item_id=? AND name=?").get(item.id, `photo-${p.reference_id}.jpg`) as any;
      try {
      const original = fs.readFileSync(storagePath(this.store.root, p.relative_path)); if (digest(original) !== p.sha256) throw new Error("Reference checksum changed.");
      const thumbnail = async (data: Buffer) => (await sharp(data, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()).toString("base64");
      figures.push(`<section><h2>Photograph ${p.position + 1}</h2><div class="pair"><figure><img alt="Original reference" src="data:image/jpeg;base64,${await thumbnail(original)}"><figcaption>Original reference</figcaption></figure>${file ? `<figure><img alt="Edited photograph" src="data:image/jpeg;base64,${await thumbnail(this.read(file.id).data)}"><figcaption>Edited photograph</figcaption></figure>` : "<p>Awaiting edited output</p>"}</div></section>`);
      } catch { figures.push(`<section><h2>Photograph ${p.position + 1}</h2><p>One saved file is unavailable or changed. Use the targeted repair action for this photo.</p></section>`); }
    }
    this.put(item, "gallery.html", `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Recipe photographs</title><style>body{font:16px system-ui;margin:2rem;background:#f5f1ea;color:#262626}.pair{display:flex;gap:1rem;flex-wrap:wrap}figure{margin:0;flex:1;min-width:240px}img{max-width:100%;max-height:650px;object-fit:contain}section{margin-bottom:2rem}</style><h1>Original and edited photographs</h1>${figures.join("\n")}</html>`, "text/html");
  }
  zip(item: any) {
    this.manifest(item);
    const rows = this.store.db.prepare("SELECT * FROM artifacts WHERE item_id=? ORDER BY name").all(item.id) as any[];
    if (rows.reduce((sum, f) => sum + f.size_bytes, 0) > 250 * 1024 * 1024) throw new Error("ZIP exceeds 250 MB. Download the individual files instead.");
    const files = rows.map(f => ({ name: f.name, data: this.read(f.id).data }));
    const requests = (this.store.db.prepare("SELECT kind,attempt,profile_version,request_path FROM content_stages WHERE item_id=? AND request_path IS NOT NULL").all(item.id) as any[]).map(s => { const payload = JSON.parse(fs.readFileSync(storagePath(this.store.root, s.request_path), "utf8")); return { ...s, request_path: undefined, request: JSON.parse(JSON.stringify(payload).replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[original reference bytes retained locally]")) }; });
    files.push({ name: "prompts.json", data: Buffer.from(JSON.stringify(requests, null, 2)) }); return createZip(files);
  }
  async image(item: any, name: string, base64: string, title?: string) {
    if (!/^[a-zA-Z0-9+/=]+$/.test(base64) || base64.length > 55_000_000) throw new Error("Invalid generated image data.");
    const bytes = Buffer.from(base64, "base64");
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format || "")) throw new Error("Generated image cannot be decoded.");
    const width = name === "pinterest" ? 1000 : 1200; const height = 1500;
    let output = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(width, height, { fit: "cover", position: "centre" });
    if (title) {
      const words = title.slice(0, 120).split(/\s+/); const lines: string[] = []; let line = "";
      for (const word of words) { if ((line + " " + word).length > 28) { lines.push(line); line = word; } else line = `${line} ${word}`.trim(); } if (line) lines.push(line);
      const overlay = `<svg width="1000" height="1500" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="${80 + Math.min(lines.length, 4) * 60}" fill="#fffaf0" fill-opacity="0.93"/>${lines.slice(0, 4).map((s,i)=>`<text x="500" y="${78+i*60}" text-anchor="middle" font-family="Georgia,serif" font-size="48" fill="#202020">${escapeHtml(s)}</text>`).join("")}</svg>`;
      output = output.composite([{ input: Buffer.from(overlay) }]);
    }
    const result = await output.jpeg({ quality: 94 }).toBuffer();
    const check = await sharp(result).metadata(); if (check.width !== width || check.height !== height) throw new Error("Image dimensions did not match the requested export.");
    this.put(item, `${name}.jpg`, result, "image/jpeg");
    // Refresh the standalone HTML from saved prose, without another paid writing request.
    if (item.article_json && item.source_json) this.article(item, JSON.parse(item.article_json), JSON.parse(item.source_json));
    else this.manifest(item);
  }
}
