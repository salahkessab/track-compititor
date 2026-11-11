import { load } from "cheerio";
import { ImportStore } from "./imports";
import { extractArticle } from "./article";
import { atomicWrite, digest } from "./artifacts";
import { publicUrl, normalizeUrl } from "./urls";

export const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const captureId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

// A browser capture is never put on the URL-fetch queue. Its UUID also makes
// retries safe when Chrome closes or a local request loses its response.
export function beginBrowserCapture(imports: ImportStore, input: Record<string, unknown>) {
  if (typeof input.captureId !== "string" || !captureId.test(input.captureId)) throw new Error("Invalid browser capture ID.");
  if (typeof input.url !== "string" || input.url.length > 4096) throw new Error("Provide the captured page URL.");
  const url = publicUrl(normalizeUrl(input.url)).href;
  if (typeof input.html !== "string" || !input.html.trim() || Buffer.byteLength(input.html) > 1_500_000) throw new Error("The captured article is empty or too large (1.5 MB maximum).");
  const fingerprint = digest(JSON.stringify([url, input.html]));
  const old = imports.store.db.prepare("SELECT * FROM recipe_imports WHERE id=?").get(input.captureId) as any;
  if (old) {
    if (old.kind !== "browser" || old.owner !== fingerprint) throw new Error("This capture ID already belongs to different content. Capture the page again.");
    return imports.detail(old.id);
  }
  const $ = load(input.html);
  $("script:not([type='application/ld+json']),style,noscript,iframe,object,embed,form,input,textarea,button,nav,aside,footer,[hidden],[aria-hidden='true']").remove();
  const article = extractArticle($.html(), url);
  const recipe = article.recipe ? { ...article.recipe, url, sourceNotes: [...(article.recipe.sourceNotes || []), "Captured from the page opened by the user in Chrome. The source URL was not fetched by the local app."] } : null;
  $("script").remove();
  $("p,h1,h2,h3,h4,li,div,br,figcaption,tr").append("\n");
  const text = $("article,main").first().text().trim() || $("body").text().trim();
  if (text.length < 40) throw new Error("No readable article was captured. Open the article itself in Chrome and try again.");
  const title = recipe?.title || article.title || url;
  const savedAt = new Date().toISOString();
  // Save plain text and structured facts, never executable page HTML.
  atomicWrite(imports.store.root, `research/browser/${input.captureId}.json`, JSON.stringify({ url, title, text: text.slice(0, 200000), recipe, capturedAt: savedAt }, null, 2));
  imports.store.db.prepare("INSERT INTO recipe_imports(id,kind,url,title,status,recipe_json,created_at,updated_at,owner) VALUES(?,'browser',?,?,'capturing',?,?,?,?)")
    .run(input.captureId, url, title, recipe ? JSON.stringify(recipe) : null, savedAt, savedAt, fingerprint);
  return imports.detail(input.captureId);
}

export function finishBrowserCapture(imports: ImportStore, id: string, input: Record<string, unknown>) {
  const row = imports.get(id);
  if (row.kind !== "browser" || !["capturing", "ready"].includes(row.status)) throw new Error("This is not a browser import.");
  if (row.status === "ready") return imports.detail(id);
  const missing = Number(input.missingPhotos || 0);
  if (!Number.isSafeInteger(missing) || missing < 0 || missing > 80) throw new Error("Invalid missing photo count.");
  imports.store.db.transaction(() => {
    imports.applySelectionRule(id);
    imports.store.db.prepare("UPDATE recipe_imports SET status='ready',error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
    if (missing && row.recipe_json) {
      const recipe = JSON.parse(row.recipe_json);
      recipe.sourceNotes = [...(recipe.sourceNotes || []), `${missing} source photographs could not be imported from Chrome.`];
      imports.store.db.prepare("UPDATE recipe_imports SET recipe_json=? WHERE id=?").run(JSON.stringify(recipe), id);
    }
  }).immediate();
  return imports.detail(id);
}
