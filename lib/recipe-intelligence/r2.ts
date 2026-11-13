import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { IntelligenceStore } from "./database";
import { atomicWrite, digest } from "./artifacts";
import { storagePath } from "./paths";

// Server/worker only. Never import this module from a client component.
export const R2_MAX_BYTES = 128 * 1024 * 1024;
type Config = { endpoint: string; bucket: string; prefix: string; accessKeyId: string; secretAccessKey: string };
type ObjectInfo = { size: number; sha256: string };
export interface ObjectTransport {
  head(key: string): Promise<ObjectInfo | null>;
  put(key: string, bytes: Buffer, type: string, sha: string): Promise<void>;
  get(key: string, maximum: number): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
const mime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", json: "application/json", html: "text/html", md: "text/markdown", txt: "text/plain", zip: "application/zip" };
const folders = ["articles", "images", "reports", "research/references", "research/browser", "research/requests", "research/api-receipts", "exports/wordpress-receipts", "verified-images"];
const objectMime = (relative: string) => mime[relative.split('.').pop()!.toLowerCase()] || (/^verified-images\/(?:outputs\/[a-f0-9]{64}|private\/[a-f0-9]{64}\/(?:original|input|candidate\.(?:png|jpeg|webp)|(?:original|input)\.image))$/.test(relative) ? 'application/octet-stream' : '');
export function r2Config(env: NodeJS.ProcessEnv = process.env): Config | null {
  if (env.R2_ENABLED !== "1") return null;
  if (!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID || "")) throw new Error("Set R2_ACCOUNT_ID to your Cloudflare account ID.");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET_NAME || "")) throw new Error("Set R2_BUCKET_NAME to your private bucket name.");
  if (!/^[a-f0-9]{32}$/i.test(env.R2_ACCESS_KEY_ID || "") || !/^[a-f0-9]{64}$/i.test(env.R2_SECRET_ACCESS_KEY || "")) throw new Error("Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in the server environment.");
  const prefix = env.R2_PREFIX || "track-competitor";
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix) || prefix.length > 160) throw new Error("R2_PREFIX must contain simple folder names without dots or leading slashes.");
  // No arbitrary endpoints: credentials can only be sent to Cloudflare R2.
  const base = `https://${env.R2_ACCOUNT_ID!.toLowerCase()}.r2.cloudflarestorage.com`;
  const endpoint = env.R2_ENDPOINT || base;
  if (![base, base.replace(".r2.", ".eu.r2."), base.replace(".r2.", ".us.r2."), base.replace(".r2.", ".fedramp.r2.")].includes(endpoint)) throw new Error("R2_ENDPOINT must be this account's HTTPS R2 S3 endpoint, without a bucket path.");
  return { endpoint, bucket: env.R2_BUCKET_NAME!, prefix, accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! };
}
export class R2Transport implements ObjectTransport {
  private client: S3Client;
  constructor(private config: Config) {
    this.client = new S3Client({ endpoint: config.endpoint, region: "auto", forcePathStyle: true, maxAttempts: 1,
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  }
  private send(command: any) { return this.client.send(command, { abortSignal: AbortSignal.timeout(30_000) }) as Promise<any>; }
  async head(key: string) {
    try { const r = await this.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key })); return { size: r.ContentLength, sha256: r.Metadata?.sha256 || "" }; }
    catch (e: any) { if (e?.$metadata?.httpStatusCode === 404) return null; throw e; }
  }
  async put(key: string, bytes: Buffer, type: string, sha: string) {
    await this.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentLength: bytes.length,
      ContentType: type, Metadata: { sha256: sha }, CacheControl: "private, max-age=31536000, immutable" }));
  }
  async get(key: string, maximum: number) {
    const r = await this.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!r.Body || !Number.isSafeInteger(r.ContentLength) || r.ContentLength > maximum) { r.Body?.destroy(); throw new Error("R2 object exceeds the expected size."); }
    const chunks: Buffer[] = []; let size = 0;
    try { for await (const chunk of r.Body) { size += chunk.length; if (size > maximum) throw new Error("R2 object exceeds the expected size."); chunks.push(Buffer.from(chunk)); } }
    finally { r.Body.destroy(); }
    return Buffer.concat(chunks);
  }
  async remove(key: string) { await this.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key })); }
}
const normal = (relative: string) => relative.replaceAll("\\", "/");
function allowed(relative: string) {
  return !relative.split("/").some(p => !p || p === "." || p === ".." || /[\x00-\x1f:]/.test(p))
    && folders.some(p => relative.startsWith(p + "/")) && !!objectMime(relative);
}
function safeError(e: any) {
  const status = Number(e?.$metadata?.httpStatusCode);
  if (status === 401 || status === 403) return "R2 denied access. Check the bucket-scoped Object Read & Write credentials.";
  return "Cloud sync could not finish. Local files are retained; the worker will retry. Check connection and R2 settings.";
}
export class ObjectStorage {
  private config: Config | null = null;
  private transport?: ObjectTransport;
  private destination = "";
  private prefix = "";
  private configurationError: string | null = null;
  private scanning = false;
  private nextScan = 0;
  private running = false;
  constructor(public store: IntelligenceStore, env = process.env, transport?: ObjectTransport) {
    try { this.config = r2Config(env); } catch (e) { this.configurationError = (e as Error).message; }
    if (!this.config) return;
    store.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('r2_workspace_id',?)").run(randomUUID());
    const workspace = (store.db.prepare("SELECT value FROM settings WHERE key='r2_workspace_id'").get() as any).value;
    if (!/^[a-f0-9-]{36}$/.test(workspace)) throw new Error("Invalid cloud workspace identity.");
    this.prefix = `${this.config.prefix}/${workspace}`;
    this.destination = digest(JSON.stringify([this.config.endpoint, this.config.bucket, this.prefix]));
    this.transport = transport || new R2Transport(this.config);
  }
  status() {
    if (!this.config) return { enabled: false, configured: false, error: this.configurationError, mode: "local", synced: 0, pending: 0, failed: 0, bytes: 0 };
    const rows = this.store.db.prepare("SELECT state,count(*) n,coalesce(sum(size_bytes),0) bytes FROM r2_objects WHERE destination=? GROUP BY state").all(this.destination) as any[];
    return { enabled: true, configured: true, mode: "private-r2-with-local-copy", bucket: this.config.bucket,
      synced: rows.find(r => r.state === "synced")?.n || 0,
      pending: rows.filter(r => ["pending", "uploading", "delete_pending"].includes(r.state)).reduce((s, r) => s + r.n, 0),
      failed: rows.find(r => r.state === "failed")?.n || 0, bytes: rows.find(r => r.state === "synced")?.bytes || 0,
      error: (this.store.db.prepare("SELECT error FROM r2_objects WHERE destination=? AND error IS NOT NULL AND state<>'deleted' ORDER BY updated_at DESC LIMIT 1").get(this.destination) as any)?.error || this.configurationError };
  }
  requestSync() {
    if (!this.config) throw new Error(this.configurationError || "Configure R2 in the server environment, then restart the local app.");
    this.store.db.prepare("UPDATE r2_objects SET next_attempt=0 WHERE destination=? AND state IN ('failed','delete_pending')").run(this.destination);
    this.store.db.prepare("INSERT INTO settings(key,value) VALUES('r2_sync_requested','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
    this.nextScan = 0;
    return { queued: true };
  }
  private deleted(relative: string) {
    return (this.store.db.prepare("SELECT relative_path FROM r2_deleted_paths").all() as any[]).some(r => relative === r.relative_path || relative.startsWith(r.relative_path + "/"));
  }
  private filePath(relative: string) {
    if (!allowed(relative)) throw new Error("Unsupported cloud object path.");
    const target = storagePath(this.store.root, relative);
    let cursor = this.store.root;
    for (const p of relative.split("/")) { cursor = path.join(cursor, p); if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error("Linked files are not uploaded to cloud storage."); }
    return target;
  }
  async discover() {
    if (!this.config || this.scanning) return;
    this.scanning = true; let count = 0;
    const visit = async (relative: string): Promise<void> => {
      const target = storagePath(this.store.root, relative);
      if (!fs.existsSync(target) || this.deleted(relative)) return;
      const info = fs.lstatSync(target); if (info.isSymbolicLink()) return;
      if (info.isDirectory()) { for (const name of fs.readdirSync(target)) await visit(`${relative}/${name}`); return; }
      if (!info.isFile() || !allowed(relative) || info.size > R2_MAX_BYTES || ++count > 50_000) return;
      const last = this.store.db.prepare("SELECT sha256,size_bytes,mtime_ms FROM r2_objects WHERE destination=? AND relative_path=? AND is_current=1 AND state<>'deleted'").get(this.destination, relative) as any;
      if (last?.size_bytes === info.size && last?.mtime_ms === info.mtimeMs) return;
      const bytes = fs.readFileSync(this.filePath(relative));
      if (bytes.length > R2_MAX_BYTES) return;
      const hash = digest(bytes), key = `${this.prefix}/${relative}/${hash}`;
      this.store.db.transaction(() => {
        this.store.db.prepare("UPDATE r2_objects SET is_current=0 WHERE destination=? AND relative_path=?").run(this.destination, relative);
        this.store.db.prepare(`INSERT INTO r2_objects(destination,relative_path,sha256,object_key,size_bytes,media_type,mtime_ms,is_current,state,updated_at)
          VALUES(?,?,?,?,?,?,?,1,'pending',?) ON CONFLICT(destination,relative_path,sha256) DO UPDATE SET is_current=1,mtime_ms=excluded.mtime_ms,
          state=CASE WHEN r2_objects.state='superseded' THEN 'pending' ELSE r2_objects.state END`)
          .run(this.destination, relative, hash, key, bytes.length, objectMime(relative), info.mtimeMs, new Date().toISOString());
      }).immediate();
      await yieldLoop();
    };
    try { for (const dir of folders) await visit(dir); this.configurationError = null; }
    finally { this.scanning = false; }
  }
  async tick() {
    if (!this.transport || this.running) return;
    this.running = true;
    try {
      const requested = this.store.db.prepare("DELETE FROM settings WHERE key='r2_sync_requested'").run().changes;
      if (requested || Date.now() > this.nextScan) { await this.discover(); this.nextScan = Date.now() + 30_000; }
      const row = this.store.db.prepare(`SELECT * FROM r2_objects WHERE destination=? AND next_attempt<=? AND
        (state IN ('pending','failed','delete_pending') OR state='uploading' AND updated_at<?) ORDER BY state='delete_pending' DESC,id LIMIT 1`)
        .get(this.destination, Date.now(), new Date(Date.now() - 120_000).toISOString()) as any;
      if (!row) return;
      try {
        if (row.object_key !== `${this.prefix}/${row.relative_path}/${row.sha256}` || !/^[a-f0-9]{64}$/.test(row.sha256)
          || !Number.isSafeInteger(row.size_bytes) || row.size_bytes < 0 || row.size_bytes > R2_MAX_BYTES) throw new Error("Invalid saved cloud object metadata.");
        if (row.state === "delete_pending") {
          await this.transport.remove(row.object_key);
          this.store.db.prepare("UPDATE r2_objects SET state='deleted',error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), row.id); return;
        }
        if (this.deleted(row.relative_path)) { this.store.db.prepare("UPDATE r2_objects SET state='delete_pending',is_current=0 WHERE id=?").run(row.id); return; }
        const file = this.filePath(row.relative_path);
        this.store.db.prepare("UPDATE r2_objects SET state='uploading',updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
        // Reconcile before reading the cache: a prior PUT may have succeeded
        // even if its response and the local file were subsequently lost.
        const found = await this.transport.head(row.object_key);
        if (found && (found.sha256 !== row.sha256 || found.size !== row.size_bytes)) throw new Error("Cloud checksum mismatch.");
        if (!found) {
          if (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== row.sha256) {
            if (row.is_current) throw new Error("The local file needed for cloud sync is missing or changed.");
            this.store.db.prepare("UPDATE r2_objects SET state='superseded',error=NULL WHERE id=?").run(row.id); return;
          }
          const bytes = fs.readFileSync(file);
          if (bytes.length !== row.size_bytes || digest(bytes) !== row.sha256) throw new Error("File changed during cloud upload.");
          await this.transport.put(row.object_key, bytes, row.media_type, row.sha256);
          const confirmed = await this.transport.head(row.object_key);
          if (!confirmed || confirmed.sha256 !== row.sha256 || confirmed.size !== row.size_bytes) throw new Error("Cloud upload was not confirmed.");
        }
        // A deletion may have been requested while the upload was in flight.
        this.store.db.prepare("UPDATE r2_objects SET state=CASE WHEN state='delete_pending' THEN state ELSE 'synced' END,error=NULL,attempts=0,updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
      } catch (e) {
        const delay = Math.min(300_000, 5000 * 2 ** Math.min(row.attempts, 6));
        this.store.db.prepare("UPDATE r2_objects SET state=CASE WHEN state='delete_pending' THEN state ELSE 'failed' END,attempts=attempts+1,next_attempt=?,error=?,updated_at=? WHERE id=?")
          .run(Date.now() + delay, safeError(e), new Date().toISOString(), row.id);
      }
    } catch { this.configurationError = "Cloud file discovery could not finish. Local processing is still available."; this.nextScan = Date.now() + 30_000; }
    finally { this.running = false; }
  }
  async ensure(relativeInput: string, expectedHash?: string) {
    const relative = normal(relativeInput), file = this.filePath(relative);
    if (fs.existsSync(file)) return;
    if (!this.transport || this.deleted(relative)) throw new Error("The local file is missing and no available cloud copy can restore it.");
    const row = this.store.db.prepare(`SELECT * FROM r2_objects WHERE destination=? AND relative_path=? AND state='synced' AND ${expectedHash ? "sha256=?" : "is_current=1"} ORDER BY id DESC LIMIT 1`)
      .get(...[this.destination, relative, ...(expectedHash ? [expectedHash] : [])]) as any;
    if (!row || row.size_bytes > R2_MAX_BYTES || row.object_key !== `${this.prefix}/${relative}/${row.sha256}`) throw new Error("A verified cloud copy is not available for this file.");
    try {
      const bytes = await this.transport.get(row.object_key, row.size_bytes);
      if (bytes.length !== row.size_bytes || digest(bytes) !== row.sha256) throw new Error("Cloud file checksum mismatch.");
      if (this.deleted(relative)) throw new Error("Recipe deletion is in progress.");
      // Never overwrite a newer file saved while the remote read was running.
      if (!fs.existsSync(this.filePath(relative))) atomicWrite(this.store.root, relative, bytes);
    } catch { throw new Error("The cloud copy could not be restored safely. Retry when R2 is available; no generation request was made."); }
  }
  async ensureItem(id: string) {
    const rows = this.store.db.prepare("SELECT relative_path,sha256 FROM artifacts WHERE item_id=?").all(id) as any[];
    for (const row of rows) await this.ensure(row.relative_path, row.sha256);
  }
  async ensureStage(itemId: string) {
    if (!this.transport) return;
    await this.ensureItem(itemId);
    const refs = this.store.db.prepare("SELECT r.relative_path,r.sha256 FROM content_photos p JOIN reference_photos r ON r.id=p.reference_id WHERE p.item_id=? AND r.relative_path IS NOT NULL").all(itemId) as any[];
    for (const r of refs) await this.ensure(r.relative_path, r.sha256);
    const receipts = this.store.db.prepare("SELECT response_path relative_path FROM api_calls WHERE stage_id IN (SELECT id FROM content_stages WHERE item_id=?) AND response_path IS NOT NULL UNION SELECT request_path relative_path FROM content_stages WHERE item_id=? AND request_path IS NOT NULL").all(itemId, itemId) as any[];
    for (const r of receipts) await this.ensure(r.relative_path);
  }
}
const instances = new WeakMap<IntelligenceStore, ObjectStorage>();
export function objectStorage(store: IntelligenceStore) { let value = instances.get(store); if (!value) { value = new ObjectStorage(store); instances.set(store, value); } return value; }
export function removeCloudPaths(store: IntelligenceStore, paths: string[]) {
  for (const input of paths) {
    const relative = normal(input);
    if (!folders.some(p => relative === p || relative.startsWith(p + "/")) || relative.split("/").some(p => p === ".." || p === ".")) throw new Error("Invalid cloud deletion path.");
    store.db.prepare("INSERT OR IGNORE INTO r2_deleted_paths(relative_path) VALUES(?)").run(relative);
    // substr avoids treating '%' or '_' in a filename as wildcard characters.
    store.db.prepare("UPDATE r2_objects SET state='delete_pending',is_current=0,next_attempt=0 WHERE state<>'deleted' AND (relative_path=? OR substr(relative_path,1,?)=?)")
      .run(relative, relative.length + 1, relative + "/");
  }
}
