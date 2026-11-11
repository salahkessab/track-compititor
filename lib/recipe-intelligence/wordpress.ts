import { randomUUID } from "node:crypto";
import fs from "node:fs";
import * as cheerio from "cheerio";
import sharp from "sharp";
import { IntelligenceStore } from "./database";
import { ArtifactStore, atomicWrite, digest } from "./artifacts";
import { publicUrl } from "./urls";
import { storagePath } from "./paths";
import { windowsSecrets, type SecretProtection } from "./local-secrets";
import { mediaMultipart, wordpressRequest, wordpressSite, type WordPressTransport, type WordPressResponse } from "./wordpress-http";

export type WordPressProfile = { version: string; protocol: 1; recipeCard: string; recipeCardLabel: string; revision: string; ready: boolean; canPublish: boolean; settingsUrl: string };
type Connection = { id: string; siteUrl: string; username: string; userId: number; displayName: string; protectedPassword: string; checkedAt: string; bridge?: WordPressProfile };
type Media = { id: number; sourceUrl: string };
type Image = { sha256: string; name: string; alt: string; bytes: Buffer; source: string };
const CONNECTION_PREFIX = "wordpress_connection:";
const MAX_ARTICLE_BYTES = 80 * 1024 * 1024;
const inFlight = new Map<string, Promise<Media>>();
const now = () => new Date().toISOString();

function readJson(response: WordPressResponse): any {
  if (response.status >= 300 && response.status < 400) throw new Error("WordPress redirected the request. Reconnect with the final HTTPS website address; credentials were not forwarded.");
  if (response.status === 401 || response.status === 403) throw new Error("WordPress denied access. Check the username, Application Password and permission to upload media.");
  if (response.status < 200 || response.status >= 300) throw new Error(`WordPress returned HTTP ${response.status}. Check your website and try again.`);
  try { return JSON.parse(response.body.toString("utf8")); } catch { throw new Error("WordPress did not return a valid API response. Check the site's REST API access."); }
}
function parseMedia(value: any): Media {
  if (!Number.isSafeInteger(value?.id) || value.id <= 0 || typeof value.source_url !== "string" || !/^image\/(jpeg|png|webp|avif)$/.test(value.mime_type || "")) throw new Error("WordPress did not confirm a saved image.");
  const source = publicUrl(value.source_url);
  if (source.protocol !== "https:") throw new Error("WordPress returned an insecure image URL. Set both WordPress addresses to HTTPS, then reconnect.");
  return { id: value.id, sourceUrl: source.href };
}

export class WordPressStore {
  constructor(public store: IntelligenceStore, private transport: WordPressTransport = wordpressRequest, private secrets: SecretProtection = windowsSecrets) {}
  private connection(id: string): Connection {
    if (!/^[a-f0-9]{32}$/.test(id || "")) throw new Error("Choose a connected WordPress website.");
    const row = this.store.db.prepare("SELECT value FROM settings WHERE key=?").get(CONNECTION_PREFIX + id) as any;
    if (!row) throw new Error("Connect this WordPress website in Settings first.");
    return JSON.parse(row.value);
  }
  status() {
    const rows = this.store.db.prepare("SELECT value FROM settings WHERE key LIKE ? ORDER BY key").all(CONNECTION_PREFIX + "%") as { value: string }[];
    return { connections: rows.map(row => {
      const c: Connection = JSON.parse(row.value);
      return { id: c.id, siteUrl: c.siteUrl, username: c.username, displayName: c.displayName, checkedAt: c.checkedAt, bridge: c.bridge, mediaLibraryUrl: new URL("wp-admin/upload.php", c.siteUrl).href };
    }), suggestedSiteUrl: (this.store.db.prepare("SELECT value FROM settings WHERE key='wordpress_suggested_site'").get() as any)?.value || "" };
  }
  suggest(input: unknown) {
    const site = wordpressSite(input);
    this.store.db.prepare("INSERT INTO settings(key,value) VALUES('wordpress_suggested_site',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(site);
    return this.status();
  }
  async connect(input: Record<string, unknown>) {
    const siteUrl = wordpressSite(input.siteUrl);
    const username = typeof input.username === "string" ? input.username.trim() : "";
    const password = typeof input.applicationPassword === "string" ? input.applicationPassword.replace(/\s/g, "") : "";
    if (!username || username.length > 100 || /[:\x00-\x1f\x7f]/.test(username)) throw new Error("Enter your WordPress login username.");
    if (!/^[a-zA-Z0-9]{24}$/.test(password)) throw new Error("Enter the 24-character WordPress Application Password from Users → Profile, not your login password.");
    const protectedPassword = await this.secrets.protect(password);
    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    const user = readJson(await this.transport(new URL("wp-json/wp/v2/users/me?context=edit", siteUrl).href, { method: "GET", authorization }));
    if (!Number.isSafeInteger(user?.id) || user.id <= 0 || user.capabilities?.upload_files !== true) throw new Error("This WordPress account needs permission to upload media. Use an account with that permission.");
    const c: Connection = { id: digest(siteUrl).slice(0, 32), siteUrl, username, userId: user.id, displayName: String(user.name || username).slice(0, 160), protectedPassword, checkedAt: now() };
    this.store.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(CONNECTION_PREFIX + c.id, JSON.stringify(c));
    // The older media-only connection still works without the optional bridge.
    await this.sync(c.id).catch(() => {});
    return this.status();
  }
  disconnect(id: string) {
    this.connection(id);
    this.store.db.prepare("DELETE FROM settings WHERE key=?").run(CONNECTION_PREFIX + id);
    return this.status();
  }
  private async authorization(c: Connection) {
    return `Basic ${Buffer.from(`${c.username}:${await this.secrets.unprotect(c.protectedPassword)}`).toString("base64")}`;
  }
  async bridgeRequest(id: string, route: "profile" | "exports" | `exports/${string}`, payload?: unknown) {
    if (!/^(?:profile|exports(?:\/[a-f0-9]{64})?)$/.test(route)) throw new Error("Invalid WordPress bridge operation.");
    const c = this.connection(id);
    return this.transport(new URL(`wp-json/recipe-intelligence/v1/${route}`, c.siteUrl).href, {
      method: payload === undefined ? "GET" : "POST", authorization: await this.authorization(c),
      ...(payload === undefined ? {} : { contentType: "application/json", body: Buffer.from(JSON.stringify(payload)) }),
    });
  }
  async sync(id: string): Promise<WordPressProfile> {
    const c = this.connection(id);
    // Clear stale capabilities if the plugin was removed or access was revoked.
    delete c.bridge;
    this.store.db.prepare("UPDATE settings SET value=? WHERE key=?").run(JSON.stringify(c), CONNECTION_PREFIX + id);
    const response = await this.bridgeRequest(id, "profile");
    if (response.status === 404) throw new Error("Install and activate Recipe Intelligence Bridge on this website, then select its default recipe card in WordPress Settings.");
    const data = readJson(response);
    if (data.protocol !== 1 || typeof data.version !== "string" || !/^[a-f0-9]{64}$/.test(data.revision) || typeof data.recipeCard !== "string" || typeof data.recipeCardLabel !== "string") throw new Error("Update the WordPress bridge to a compatible version.");
    const bridge: WordPressProfile = { protocol: 1, version: data.version.slice(0, 30), recipeCard: data.recipeCard.slice(0, 50), recipeCardLabel: data.recipeCardLabel.slice(0, 100), revision: data.revision,
      ready: data.ready === true && ["builtin", "wprm"].includes(data.recipeCard), canPublish: data.canPublish === true,
      settingsUrl: new URL("wp-admin/options-general.php?page=recipe-intelligence", c.siteUrl).href };
    c.bridge = bridge; c.checkedAt = now();
    this.store.db.prepare("UPDATE settings SET value=? WHERE key=?").run(JSON.stringify(c), CONNECTION_PREFIX + id);
    return bridge;
  }
  private document(itemId: string) {
    if (!this.store.db.prepare("SELECT 1 FROM content_items WHERE id=? AND state NOT IN ('deleted','deleting','delete_failed')").get(itemId)) throw new Error("This recipe has been deleted or is waiting for deletion to finish.");
    const artifacts = new ArtifactStore(this.store);
    const articleRow = this.store.db.prepare("SELECT id,size_bytes FROM artifacts WHERE item_id=? AND name='article.html'").get(itemId) as any;
    if (!articleRow) throw new Error("Save the article before copying it to WordPress.");
    if (articleRow.size_bytes > MAX_ARTICLE_BYTES) throw new Error("This article is too large for clipboard export. Download its files instead.");
    const article = artifacts.read(articleRow.id);
    const $ = cheerio.load(article.data.toString("utf8")); const root = $("article").first();
    if (!root.length) throw new Error("The saved article has no copyable content.");
    root.find("script,style,iframe,object,embed,form,input,button,svg,link,meta").remove();
    // Preserve a known card boundary for replacing it with the destination's native card.
    root.find('[data-ri-recipe-card]').each((_i, e) => { const node = $(e); node.before('<!--ri-card-start-->'); node.after('<!--ri-card-end-->'); });
    const allowedTags = new Set("h1 h2 h3 h4 h5 h6 p strong b em i u ul ol li figure figcaption img br table thead tbody tr th td blockquote a".split(" "));
    root.find("*").each((_i, element) => {
      if (!("name" in element)) return;
      const node = $(element); const tag = element.name;
      if (!allowedTags.has(tag)) { node.replaceWith(node.contents()); return; }
      const attrs = element.attribs;
      for (const name of Object.keys(attrs)) if (!(tag === "img" && ["src", "alt", "width", "height"].includes(name)) && !(tag === "a" && name === "href") && !(tag === "ol" && name === "start" && /^[1-9]\d{0,3}$/.test(attrs[name]))) node.removeAttr(name);
      if (tag === "a") { try { publicUrl(node.attr("href") || ""); } catch { node.removeAttr("href"); } }
    });
    for (const name of Object.keys(root.attr() || {})) root.removeAttr(name);
    const outputs = this.store.db.prepare("SELECT id,name,sha256,size_bytes FROM artifacts WHERE item_id=? AND media_type='image/jpeg'").all(itemId) as any[];
    const approved = new Map(outputs.filter(f => /^(?:featured|alternate|pinterest|photo-[a-f0-9-]{36})\.jpg$/.test(f.name)).map(f => [f.sha256, f]));
    const images = new Map<string, Image>();
    root.find("img").each((_i, element) => {
      const node = $(element); const source = node.attr("src") || "";
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(source) || source.length > 15_000_000) throw new Error("An article image is not a saved edited JPEG. Repair saved article files before uploading.");
      const bytes = Buffer.from(source.slice(source.indexOf(",") + 1), "base64");
      const hash = digest(bytes); const output = approved.get(hash);
      if (!output || output.size_bytes > 10 * 1024 * 1024) throw new Error("Only saved generated or edited images can be uploaded to WordPress.");
      if (!images.has(hash)) {
        const checked = artifacts.read(output.id);
        images.set(hash, { sha256: hash, name: output.name, alt: (node.attr("alt") || "Recipe photograph").slice(0, 500), bytes: checked.data, source });
      }
    });
    if (images.size > 100) throw new Error("Too many images in one article.");
    return { $, root, images: [...images.values()], documentHash: article.sha256 };
  }
  private row(siteUrl: string, hash: string): any {
    return this.store.db.prepare("SELECT * FROM wordpress_media WHERE site_url=? AND sha256=?").get(siteUrl, hash);
  }
  plan(itemId: string, connectionId: string) {
    const c = this.connection(connectionId), doc = this.document(itemId);
    const images = doc.images.map(image => {
      const row = this.row(c.siteUrl, image.sha256);
      return { sha256: image.sha256, name: image.name, alt: image.alt, state: row?.state || "pending", sourceUrl: row?.state === "ready" ? row.source_url : null };
    });
    const ready = images.every(image => image.state === "ready");
    if (ready) {
      const bySource = new Map(doc.images.map(image => [image.source, this.row(c.siteUrl, image.sha256)]));
      doc.root.find("img").each((_i, element) => {
        const node = doc.$(element); const row = bySource.get(node.attr("src")!);
        const media = parseMedia({ id: row.media_id, source_url: row.source_url, mime_type: "image/jpeg" });
        node.attr("src", media.sourceUrl).attr("class", `wp-image-${media.id}`).attr("loading", "lazy");
        node.parent("figure").addClass("wp-block-image size-full");
      });
    }
    return { connectionId: c.id, siteUrl: c.siteUrl, mediaLibraryUrl: new URL("wp-admin/upload.php", c.siteUrl).href, documentHash: doc.documentHash, images, ready,
      html: ready ? doc.$.html(doc.root) : null, text: doc.root.text(), mediaIds: ready ? doc.images.map(image => this.row(c.siteUrl, image.sha256).media_id as number) : [] };
  }
  async upload(itemId: string, input: Record<string, unknown>): Promise<Media> {
    const c = this.connection(String(input.connectionId || ""));
    const doc = this.document(itemId);
    if (input.documentHash !== doc.documentHash) throw new Error("The article changed while images were uploading. Click Upload images and copy again to use the latest saved article; existing uploads will be reused.");
    const image = doc.images.find(i => i.sha256 === input.sha256);
    if (!image) throw new Error("Select an edited image from this saved article.");
    const key = `${this.store.root}|${c.siteUrl}|${image.sha256}`;
    const active = inFlight.get(key); if (active) return active;
    const pending = this.uploadImage(c, image); inFlight.set(key, pending);
    try { return await pending; } finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
  }
  private ready(c: Connection, hash: string, media: Media) {
    this.store.db.prepare("UPDATE wordpress_media SET state='ready',media_id=?,source_url=?,error=NULL,updated_at=? WHERE site_url=? AND sha256=?").run(media.id, media.sourceUrl, now(), c.siteUrl, hash);
    return media;
  }
  private async uploadImage(c: Connection, image: Image): Promise<Media> {
    const previous = this.row(c.siteUrl, image.sha256);
    if (previous?.state === "ready") return parseMedia({ id: previous.media_id, source_url: previous.source_url, mime_type: "image/jpeg" });
    // A saved successful receipt takes precedence over issuing any new upload.
    if (previous?.receipt_path) {
      try {
        const receipt = JSON.parse(fs.readFileSync(storagePath(this.store.root, previous.receipt_path), "utf8"));
        return this.ready(c, image.sha256, parseMedia(readJson({ status: receipt.status, body: Buffer.from(receipt.body) })));
      } catch { /* Reconcile by the stable slug below, never repeat an uncertain POST. */ }
    }
    if (previous?.state === "uploading" && Date.now() - Date.parse(previous.updated_at) < 150_000) throw new Error("This image is still uploading. Wait a moment, then try copying again.");
    const authorization = await this.authorization(c);
    const slug = `ri-${image.sha256}`;
    const endpoint = new URL("wp-json/wp/v2/media", c.siteUrl);
    const lookup = new URL(endpoint); lookup.search = new URLSearchParams({ slug, context: "edit", per_page: "2" }).toString();
    const found = readJson(await this.transport(lookup.href, { method: "GET", authorization }));
    if (!Array.isArray(found)) throw new Error("WordPress could not check existing image uploads.");
    const match = found.find(value => value.slug === slug);
    if (match) {
      const media = parseMedia(match);
      this.store.db.prepare("INSERT OR IGNORE INTO wordpress_media(site_url,sha256,slug,state,updated_at) VALUES(?,?,?,'uncertain',?)").run(c.siteUrl, image.sha256, slug, now());
      return this.ready(c, image.sha256, media);
    }
    if (previous && ["uploading", "uncertain"].includes(previous.state)) throw new Error("The earlier upload has an uncertain outcome. Check this website's Media Library; clicking again only checks for the saved image and will not upload a duplicate.");
    const metadata = await sharp(image.bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (metadata.format !== "jpeg" || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000 || (metadata.pages || 1) !== 1) throw new Error("The edited image could not be decoded safely.");
    const claimed = this.store.db.transaction(() => {
      const current = this.row(c.siteUrl, image.sha256);
      if (current && current.state !== "failed") return false;
      this.store.db.prepare("INSERT INTO wordpress_media(site_url,sha256,slug,state,updated_at) VALUES(?,?,?,'uploading',?) ON CONFLICT(site_url,sha256) DO UPDATE SET state='uploading',receipt_path=NULL,error=NULL,updated_at=excluded.updated_at").run(c.siteUrl, image.sha256, slug, now()); return true;
    }).immediate();
    if (!claimed) throw new Error("Another request is handling this image. Try copying again after it finishes.");
    let response: WordPressResponse | undefined;
    try {
      response = await this.transport(endpoint.href, { method: "POST", authorization, ...mediaMultipart(image.bytes, `${slug}.jpg`, { slug, title: image.alt, alt_text: image.alt }) });
      const receipt = `exports/wordpress-receipts/${c.id}/${image.sha256}-${randomUUID()}.json`;
      atomicWrite(this.store.root, receipt, JSON.stringify({ status: response.status, body: response.body.toString("utf8") }));
      this.store.db.prepare("UPDATE wordpress_media SET receipt_path=? WHERE site_url=? AND sha256=?").run(receipt, c.siteUrl, image.sha256);
      const media = parseMedia(readJson(response));
      return this.ready(c, image.sha256, media);
    } catch (error) {
      const definiteFailure = response && [400, 401, 403, 404, 413, 415, 422, 429].includes(response.status);
      const message = definiteFailure ? error instanceof Error ? error.message : "WordPress refused the upload." : "WordPress upload could not be confirmed. Its receipt is retained when available; retry checks for the saved image before any further action.";
      this.store.db.prepare("UPDATE wordpress_media SET state=?,error=?,updated_at=? WHERE site_url=? AND sha256=?").run(definiteFailure ? "failed" : "uncertain", message, now(), c.siteUrl, image.sha256);
      throw new Error(message);
    }
  }
}
