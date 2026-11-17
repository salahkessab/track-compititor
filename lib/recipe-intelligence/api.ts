import { articleLibrary, approveLibraryItem, archiveLibraryItem, generateLibraryItem } from "./library";
import { DecorStore } from './decor';
import { timingSafeEqual } from "node:crypto";
import { IntelligenceStore } from "./database";
import { localRoot } from "./paths";
import { ReportStore } from "./reports";
import { BatchStore } from "./batches";
import { contentSettings, saveContentSettings, validateContentSettings } from "./settings";
import { checkModels } from "./provider";
import { atomicWrite } from "./artifacts";
import { ImportStore, MAX_PHOTO_BYTES } from "./imports";
import { prepareReferenceBatch, prepareImportEstimate, reviewPhoto, skipPhoto } from "./referenceWorkflow";
import { WordPressStore } from "./wordpress";
import { InternalLinks } from './internalLinks';
import { preparationFailure } from '../imageFinalization';
import { WordPressPublisher } from "./wordpress-publish";
import { beginBrowserCapture, finishBrowserCapture, MAX_CAPTURE_BYTES } from "./browserCapture";
import { publicUrl } from "./urls";
import { deleteGeneration, previewGenerationDeletion } from "./deleteGeneration";
import { objectStorage } from "./r2";
import { intelligenceEnabled, serverAuthenticated, serverMode, serverOrigin } from "./runtime";
import { serverBackupStatus } from "./serverBackup";
import { deploymentPause } from "./deployment";
import { ProviderCredentials } from "./providerCredentials";
import { StudioStorage } from './studioStorage';
import { articleStorageSummary, previewArticleStorageDeletion, deleteAllArticles } from './articleStorage';
import { workspaceDiskStorage } from './diskStorage';

const state = globalThis as typeof globalThis & { recipeIntelligenceStores?: Map<string, Promise<IntelligenceStore>> };
const enabled = intelligenceEnabled;
function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
function equal(value: string | null, expected: string) {
  const a = Buffer.from(value || ""), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function trustedRequest(request: Request) {
  const origin = process.env.RECIPE_INTELLIGENCE_ORIGIN;
  if (!origin) return false;
  const target = new URL(origin);
  if (serverMode()) { try { if (origin !== serverOrigin()) return false; } catch { return false; } }
  else if (target.protocol !== "http:" || target.hostname !== "127.0.0.1") return false;
  if (request.headers.get("host") !== target.host) return false;
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin && suppliedOrigin !== origin) return false;
  if (!["GET", "HEAD"].includes(request.method)) {
    if (suppliedOrigin !== origin || request.headers.get("x-recipe-intelligence") !== "1") return false;
  }
  return true;
}
async function body(request: Request, maximum = 16384): Promise<Record<string, any>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Send JSON request data.");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maximum) throw new Error("Request is too large."); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new Error("Invalid JSON request data."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object.");
  return parsed;
}
async function store() {
  const root = localRoot();
  state.recipeIntelligenceStores ??= new Map();
  let value = state.recipeIntelligenceStores.get(root);
  if (!value) {
    value = IntelligenceStore.open(root).catch(error => { state.recipeIntelligenceStores!.delete(root); throw error; });
    state.recipeIntelligenceStores.set(root, value);
  }
  return value;
}

export async function handleIntelligence(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.replace(/^\/api\/recipe-intelligence\/?/, "").split("/").filter(Boolean);
  if (!enabled()) return segments[0] === "capabilities"
    ? json({ enabled: false, phase: 5 }) : json({ error: "Open Recipe Intelligence with the Windows local launcher." }, 503);
  if (!trustedRequest(request)) return json({ error: "Workspace origin check failed." }, 403);
  if (serverMode() && !serverAuthenticated(request)) return json({ error: "Sign in to Recipe Intelligence." }, 401, { "WWW-Authenticate": 'Basic realm="Recipe Intelligence", charset="UTF-8"' });
  if (segments[0] === "capabilities" && request.method === "GET") return json({ enabled: true, phase: 5, browserCapture: 1, decorBrowserCapture: 1, captureReview: 1, browserPhotoLimit:80, photoSectionLinks:1, ...(serverMode() ? { mode: "server" } : {}) });
  const token = process.env.RECIPE_INTELLIGENCE_TOKEN!;
  // Browser cookies are shared across ports. Give each local launcher its own
  // cookie so opening a test copy cannot disconnect the main workspace.
  const cookieName = `ri_session_${new URL(process.env.RECIPE_INTELLIGENCE_ORIGIN!).port || "80"}`;
  const cookies = (request.headers.get("cookie") || "").split(";").map(part => part.trim());
  const readCookie = (name: string) => cookies.find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  // Existing sessions remain usable until the next launcher sign-in. An
  // explicitly supplied scoped cookie takes precedence, even when invalid.
  const cookie = readCookie(cookieName) ?? readCookie("ri_session") ?? "";
  if (segments[0] === "session" && request.method === "POST") {
    if (serverMode()) return json({ connected: true });
    if (!equal(request.headers.get("x-ri-key"), token)) return json({ error: "Open the local workspace from its launcher to connect." }, 401);
    return json({ connected: true }, 200, { "Set-Cookie": `${cookieName}=${token}; Path=/api/recipe-intelligence; HttpOnly; SameSite=Strict` });
  }
  if (!serverMode() && !equal(cookie, token) && !equal(request.headers.get("x-ri-key"), token)) return json({ error: "Launch Recipe Intelligence to connect this browser to local storage." }, 401);
  if (process.env.RECIPE_INTELLIGENCE_READ_ONLY === "1" && request.method !== "GET") return json({ error: "Recovery view: saved recipes and downloads are available. Generation and changes are paused while the local worker is being reviewed." }, 423);
  if (serverMode() && request.method !== "GET" && deploymentPause(localRoot())) return json({ error: "An app update is being installed. Your saved work is safe. Please try again shortly." }, 503, { "Retry-After": "30" });
  try {
    const database = await store();
    const reports = new ReportStore(database); const batches = new BatchStore(database); const imports = new ImportStore(database);
    const [area, id, child] = segments;
    if (area === 'article-storage') {
      if (!id && request.method === 'GET') return json({ ...articleStorageSummary(database), storage: await workspaceDiskStorage(database.root) });
      if (id === 'preview' && request.method === 'GET') return json(previewArticleStorageDeletion(database));
      if (!id && request.method === 'DELETE') { const data = await body(request); const result = deleteAllArticles(database, data.confirmed, data.revision); return json(result, result.deleted ? 200 : 409); }
    }
    if (area === 'studio' && serverMode()) {
      const studio = new StudioStorage(database);
      if (id === 'blob' && child && request.method === 'GET') return new Response(new Uint8Array(studio.blob(child)),{headers:{'Content-Type':'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      if (!id && request.method === 'POST') {
        const data = await body(request,85_000_000),{action,namespace,store:section,key,value}=data;
        if(action==='list')return json({entries:studio.list(namespace,section)});
        if(action==='keys')return json({keys:studio.keys(namespace,section)});
        if(action==='get')return json({value:studio.get(namespace,section,key)});
        if(action==='save')return json(studio.save(namespace,section,key,value,data.onlyIfMissing===true));
        if(action==='remove'){studio.remove(namespace,section,key);return json({removed:true});}
        if(action==='claim')return json({claimed:studio.claim(namespace,key)});
        if(action==='release'){studio.release(namespace,key);return json({released:true});}
        throw new Error('Unknown studio storage action.');
      }
    }
    if (area === 'decor') {
      const decor = new DecorStore(database);
      if (!id && request.method === 'GET') return json({ jobs: decor.list(), worker: database.snapshot().worker });
      if (!id && request.method === 'POST') { const data = await body(request, 180000); return json(decor.create(data.url, data.text), 201); }
      if (id === 'browser' && !child && request.method === 'POST') return json(decor.beginBrowser(await body(request, MAX_CAPTURE_BYTES)), 201);
      if (id && child === 'browser-finish' && request.method === 'POST') return json(decor.finishBrowser(id, await body(request)));
      if (id && !child && request.method === 'GET') return json(decor.detail(id));
      if (id && !child && request.method === 'DELETE') { const data = await body(request); if (data.confirmed !== true) throw new Error('Confirm deletion of this article and its saved photos.'); return json(decor.remove(id)); }
      if (id && child === 'selection' && request.method === 'POST') return json(decor.select(id, await body(request)));
      if (id && child === 'approve' && request.method === 'POST') return json(decor.approve(id, (await body(request)).version));
      if (id && child === 'retry-image' && request.method === 'POST') return json(await decor.retryPreparation(id, String((await body(request)).photoId)));
      if (id && child === 'image-inclusion' && request.method === 'POST') { const data = await body(request); return json(decor.setImageIncluded(id, String(data.photoId), data.included)); }
      if (id && child === 'archive' && request.method === 'POST') return json(decor.archive(id, (await body(request)).archived));
      if (id && ['upload', 'browser-photo'].includes(child) && request.method === 'POST') {
        const reader = request.body?.getReader(); if (!reader) throw new Error('Upload is empty.');
        const chunks: Uint8Array[] = []; let size = 0;
        try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 10 * 1024 * 1024) throw new Error('Photo exceeds 10 MB.'); chunks.push(part.value); } } finally { await reader.cancel().catch(() => {}); }
        const caption = decodeURIComponent(request.headers.get('x-photo-caption') || 'Uploaded reference');
        return json(child === 'browser-photo'
          ? await decor.uploadBrowser(id, Buffer.concat(chunks), decodeURIComponent(request.headers.get('x-source-url') || ''), caption)
          : await decor.upload(id, Buffer.concat(chunks), caption));
      }
      if (id && ['photo', 'output'].includes(child) && segments[3] && request.method === 'GET') return new Response(new Uint8Array(child === 'output' ? await decor.exportedFile(id, segments[3]) : decor.file(id, segments[3], false)), { headers: { 'Content-Type': child === 'output' ? 'image/webp' : 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
      if (id && ['preview', 'zip'].includes(child) && request.method === 'GET') return new Response(new Uint8Array(await decor.document(id, child === 'zip')), { headers: { 'Content-Type': child === 'zip' ? 'application/zip' : 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...(child === 'zip' ? { 'Content-Disposition': 'attachment; filename="home-decor-article.zip"' } : { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" }) } });
      return json({ error: 'Unknown Home & Decor operation.' }, 404);
    }
    const wordpress = new WordPressStore(database);
    const links = new InternalLinks(wordpress);
    const publisher = new WordPressPublisher(wordpress);
    const storage = objectStorage(database);
    const credentials = new ProviderCredentials(database);
    if (area === 'items' && id && child === 'internal-link-preview' && request.method === 'GET') {
      links.status(id, url.searchParams.get('connectionId') || '');
      await storage.ensureItem(id);
      const row = database.db.prepare("SELECT id FROM artifacts WHERE item_id=? AND name='article.html'").get(id) as any;
      const file = await batches.artifacts.download(row.id, undefined, url.searchParams.get('connectionId') || '');
      return new Response(new Uint8Array(file.data), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" } });
    }
    if (area === "snapshot" && request.method === "GET") return json({ ...database.snapshot(), readOnly: process.env.RECIPE_INTELLIGENCE_READ_ONLY === "1", runtime: serverMode() ? "server" : "local", serverBackup: serverBackupStatus(database), contentSettings: contentSettings(database), reports: reports.list(), batches: batches.list(), imports: imports.list(), providerConfigured: credentials.status().configured, providerConnection: credentials.status(), wordpress: wordpress.status(), objectStorage: storage.status() });
    if (area === "provider-key" && !id && request.method === "GET") return json(credentials.status());
    if (area === "provider-key" && !id && request.method === "POST") return json(await credentials.save((await body(request)).apiKey));
    if (area === "provider-key" && id === "test" && request.method === "POST") { await body(request); return json(await credentials.test()); }
    if (area === "provider-key" && !id && request.method === "DELETE") { await body(request); return json(credentials.remove()); }
    if (area === "storage" && request.method === "GET") return json(storage.status());
    if (area === "storage" && request.method === "POST") { await body(request); return json(storage.requestSync(), 202); }
    if (area === "items" && id && ["zip", "wordpress", "wordpress-publish", "wordpress-check"].includes(child)) await storage.ensureItem(id);
    if (area === "wordpress" && !id && request.method === "GET") return json(wordpress.status());
    if (area === "wordpress" && id === "target" && request.method === "POST") return json(wordpress.suggest((await body(request)).siteUrl));
    if (area === "wordpress" && id === "connect" && request.method === "POST") return json(await wordpress.connect(await body(request)));
    if (area === "wordpress" && id && child === "sync" && request.method === "POST") { await body(request); return json(await wordpress.sync(id)); }
    if (area === 'wordpress' && id && child === 'articles-sync' && request.method === 'POST') { await body(request); const c = await links.sync(id); return json({ count: c.posts.length, syncedAt: c.syncedAt }); }
    if (area === 'items' && id && child === 'internal-links') {
      if (request.method === 'GET') return json(links.status(id, url.searchParams.get('connectionId') || ''));
      if (request.method === 'POST') {
        await storage.ensureItem(id);
        const input = await body(request), connectionId = String(input.connectionId || '');
        if (input.action === 'destination') return json(links.destination(id, connectionId));
        if (input.action === 'suggest') return json(await links.suggest(id, connectionId));
        if (input.action === 'apply') return json(await links.apply(id, input));
        throw new Error('Unknown internal-link action.');
      }
    }
    if (area === "items" && id && child === "wordpress-publish" && request.method === "GET") { const { payload, ...review } = await publisher.prepare(id, url.searchParams.get("connectionId") || ""); return json(review); }
    if (area === "items" && id && child === "wordpress-publish" && request.method === "POST") return json(await publisher.send(id, await body(request)));
    if (area === "items" && id && child === "wordpress-check" && request.method === "POST") return json(await publisher.check(id, String((await body(request)).connectionId || "")));
    if (area === "wordpress" && id && request.method === "DELETE") { await body(request); return json(wordpress.disconnect(id)); }
    if (area === "items" && id && child === "wordpress" && request.method === "GET") return json(wordpress.plan(id, url.searchParams.get("connectionId") || ""));
    if (area === "items" && id && child === "wordpress" && request.method === "POST") return json(await wordpress.upload(id, await body(request)));
    if (area === "imports" && !id && request.method === "POST") { const data = await body(request); return json(data.text !== undefined ? imports.createFromText(data.url, data.text) : imports.create(data.url), 202); }
    if (area === "imports" && id === "browser" && !child && request.method === "POST") return json(beginBrowserCapture(imports, await body(request, MAX_CAPTURE_BYTES)), 201);
    if (area === "imports" && id && child === "browser-finish" && request.method === "POST") return json(finishBrowserCapture(imports, id, await body(request)));
    if (area === "imports" && id && child === "estimate" && request.method === "POST") { const data = await body(request); return json(prepareImportEstimate(batches, id, data.settings || {})); }
    if (area === "imports" && id && !child && request.method === "GET") return json(imports.detail(id));
    if (area === "imports" && id && child === "selection" && request.method === "POST") { const data = await body(request); return json(imports.select(id, data.photoIds)); }
    if (area === "imports" && id && child === "retry" && request.method === "POST") { await body(request); const row = imports.get(id); if (row.kind !== "url" || row.status === "running") throw new Error("This import cannot be retried now."); database.db.prepare("UPDATE reference_photos SET state='pending',error=NULL WHERE import_id=? AND state='failed'").run(id); database.db.prepare("UPDATE recipe_imports SET status='queued',error=NULL WHERE id=?").run(id); return json({ queued: true }, 202); }
    if (area === "imports" && id && ["upload", "browser-photo"].includes(child) && request.method === "POST") {
      const imported = imports.get(id);
      if (child === "browser-photo" ? imported.kind !== "browser" || imported.status !== "capturing" : !["ready", "failed"].includes(imported.status)) throw new Error("This import is not accepting photographs now.");
      const sourceUrl = child === "browser-photo" ? publicUrl(decodeURIComponent(request.headers.get("x-source-url") || "")).href : null;
      const caption = child === "browser-photo" ? decodeURIComponent(request.headers.get("x-photo-caption") || "").slice(0, 1000) : "";
      if (!/^image\/(jpeg|png|webp)$/.test(request.headers.get("content-type") || "")) throw new Error("Upload JPEG, PNG or WebP.");
      const reader = request.body?.getReader(); if (!reader) throw new Error("Upload is empty."); const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_PHOTO_BYTES) throw new Error("Photograph exceeds 10 MB."); chunks.push(value); } } finally { await reader.cancel().catch(() => {}); }
      await imports.add(id, Buffer.concat(chunks), request.headers.get("x-file-name") || "Uploaded photo", sourceUrl, caption); return json(imports.detail(id), 201);
    }
    if (area === "references" && id && request.method === "GET") { const ref = database.db.prepare("SELECT relative_path,sha256 FROM reference_photos WHERE id=? AND state='ready'").get(id) as any; if (ref?.relative_path) await storage.ensure(ref.relative_path, ref.sha256); const file = imports.read(id); return new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.mime_type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } }); }
    if (area === "batches" && id && child === "estimate" && request.method === "POST") { await body(request); return json(prepareReferenceBatch(batches, id)); }
    if (area === "items" && id && child === "photo-skip" && request.method === "POST") { const data = await body(request); await skipPhoto(batches, id, data.referenceId); return json({ skipped: true }); }
    if (area === "items" && id && child === "photo-context" && request.method === "POST") { const data = await body(request); reviewPhoto(batches, id, data.referenceId, data.analysis); return json({ queued: true }, 202); }
    if (area === "items" && id && child === "zip" && request.method === "GET") { const bytes = await batches.artifacts.zip(batches.item(id)); return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="recipe-outputs.zip"', "Cache-Control": "no-store" } }); }
    if (area === "reports" && !id && request.method === "POST") {
      const data = await body(request);
      if (!Array.isArray(data.siteIds) || data.siteIds.some((v: unknown) => typeof v !== "string")) throw new Error("Choose tracked websites.");
      return json({ jobId: reports.create({ siteIds: data.siteIds, from: data.from, to: data.to, timezone: data.timezone || database.snapshot().settings.timezone }) }, 202);
    }
    if (area === "reports" && id && request.method === "GET") {
      const page = Number(url.searchParams.get("page") || 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 100000) throw new Error("Invalid report page.");
      const report = reports.detail(id, child === "export" ? null : page);
      if (child === "export") {
        const value = JSON.stringify(report, null, 2); atomicWrite(database.root, `reports/${id}.json`, value);
        return new Response(value, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="report-${id}.json"`, "Cache-Control": "no-store" } });
      }
      return json(report);
    }
    if (area === "reports" && id && child === "action" && request.method === "POST") { const data = await body(request); reports.action(id, data.action); return json({ updated: true }); }
    if (area === "evidence" && id && request.method === "GET") {
      return json({ rows: database.db.prepare("SELECT * FROM publication_evidence WHERE recipe_id=? ORDER BY id DESC LIMIT 100").all(Number(id)) });
    }
    if (area === "content-settings" && request.method === "PATCH") return json({ settings: saveContentSettings(database, await body(request)) });
    if (area === "model-check" && request.method === "POST") return json(await checkModels(database, validateContentSettings({ ...contentSettings(database), ...await body(request) })));
    if (area === "model-check" && request.method === "GET") return json({ configured: credentials.status().configured, checks: (database.db.prepare("SELECT * FROM model_checks").all() as any[]).map(r => ({ ...JSON.parse(r.metadata_json), productionConfirmedAt: r.production_confirmed_at })) });
    if (area === "library" && request.method === "GET") return json(articleLibrary(batches, Number(url.searchParams.get("page") || 0), url.searchParams.get("search") || "", url.searchParams.get("archived") === "1"));
    if (area === "items" && id && child === "archive" && request.method === "PATCH") { const data = await body(request); return json(archiveLibraryItem(batches, id, data.archived)); }
    if (area === "items" && id && child === "generate" && request.method === "POST") { const data = await body(request); const item = batches.item(id); await checkModels(database, JSON.parse(batches.get(item.batch_id).settings_json)); return json(generateLibraryItem(batches, id, data.quoteVersion, data.confirmedHighCost === true)); }
    if (area === "items" && id && child === "approve-generation" && request.method === "POST") { const data = await body(request); const item = batches.item(id); await checkModels(database, JSON.parse(batches.get(item.batch_id).settings_json)); return json(approveLibraryItem(batches, id, data.limit, data.quoteVersion)); }
    if (area === "batches" && !id && request.method === "POST") { const data = await body(request); return json(batches.create(data.selections, data.settings || {}), 201); }
    if (area === "batches" && id && !child && request.method === "GET") return json(batches.detail(id));
    if (area === "items" && id && child === "delete-preview" && request.method === "GET") return json(previewGenerationDeletion(database, id));
    if (area === "items" && id && !child && request.method === "DELETE") { const data = await body(request); return json(deleteGeneration(database, id, data.confirmed)); }
    if (area === "batches" && id && child === "approve" && request.method === "POST") { const data = await body(request); batches.approve(id, data.limit, data.quoteVersion); return json({ approved: true }); }
    if (area === "batches" && id && child === "action" && request.method === "POST") { const data = await body(request); batches.action(id, data.action); return json({ updated: true }); }
    if (area === "items" && id && child === "approve" && request.method === "POST") { const data = await body(request); batches.approveItem(id, data.sourceUrl); return json({ approved: true }); }
    if (area === "items" && id && child === "retry" && request.method === "POST") { const data = await body(request); batches.retry(id, data.kind, data.regenerate === true, data.retryUncertain === true); return json({ queued: true }, 202); }
    if (area === "calls" && id && child === "resolve" && request.method === "POST") { const data = await body(request); batches.resolveCall(id, data.cost, data.note); return json({ resolved: true }); }
    if (area === "artifacts" && id && request.method === "GET") {
      const artifact = database.db.prepare("SELECT item_id,relative_path,sha256,name FROM artifacts WHERE id=?").get(id) as any;
      if (artifact) { if (artifact.name === "article.html") await storage.ensureItem(artifact.item_id); else await storage.ensure(artifact.relative_path, artifact.sha256); }
      const file = await batches.artifacts.download(id, url.searchParams.get("format"));
      return new Response(new Uint8Array(file.data), { headers: { "Content-Type": file.media_type, "Content-Length": String(file.data.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'", "Content-Disposition": `${url.searchParams.has("preview") ? "inline" : "attachment"}; filename="${file.name}"` } });
    }
    if (area === "history" && request.method === "GET") {
      const page = Number(url.searchParams.get("page") || 0);
      if (!Number.isSafeInteger(page) || page < 0) throw new Error("Invalid history page.");
      return json(database.history(url.searchParams.get("siteId") || "", page));
    }
    if (area === "logs" && request.method === "GET") return json({ rows: database.events(url.searchParams.get("runId") || undefined) });
    if (area === "sites" && request.method === "POST" && !id) {
      const data = await body(request);
      if (typeof data.url !== "string" || data.name !== undefined && typeof data.name !== "string") throw new Error("Enter a website name and URL.");
      return json({ site: database.addSite(data.name || "", data.url) }, 201);
    }
    if (area === "sites" && id && request.method === "PATCH") {
      const data = await body(request);
      if (!["active", "paused"].includes(data.status)) throw new Error("Choose Active or Paused.");
      database.setSiteStatus(id, data.status); return json({ updated: true });
    }
    if (area === "sites" && id && request.method === "DELETE") {
      const data = await body(request);
      if (data.confirmed !== true) throw new Error("Confirm website removal first. Saved history will be retained.");
      database.setSiteStatus(id, "archived"); return json({ archived: true });
    }
    if (area === "scans" && request.method === "POST" && !id) {
      const data = await body(request);
      const ids: string[] = data.allActive === true
        ? (database.db.prepare("SELECT id FROM tracked_sites WHERE status='active'").all() as { id: string }[]).map(site => site.id)
        : Array.isArray(data.siteIds) ? [...new Set<string>(data.siteIds)] : [];
      if (!ids.length || ids.length > 10 || ids.some(value => typeof value !== "string")) throw new Error("Select between 1 and 10 active websites.");
      for (const siteId of ids) if (database.getSite(siteId).status !== "active") throw new Error("Selected websites must be active.");
      const runIds = database.db.transaction(() => ids.map(siteId => database.createScan(siteId))).immediate();
      return json({ runIds }, 202);
    }
    if (area === "scans" && id && child === "action" && request.method === "POST") {
      const data = await body(request); database.runAction(id, data.action); return json({ updated: true });
    }
    if (area === "settings" && request.method === "PATCH") {
      const data = await body(request);
      if (typeof data.timezone !== "string" || data.timezone.length > 100) throw new Error("Enter an IANA timezone.");
      database.updateTimezone(data.timezone); return json({ updated: true });
    }
    if (area === "backup" && request.method === "POST") { await body(request); return json({ file: await database.backup() }); }
    if (area === "integrity" && request.method === "POST") { await body(request); return json({ result: database.integrity() }); }
    return json({ error: "Unknown Recipe Intelligence operation." }, 404);
  } catch (error) {
    return json(preparationFailure(error) || { error: error instanceof Error ? error.message.slice(0, 400) : "Local operation failed." }, 400);
  }
}
