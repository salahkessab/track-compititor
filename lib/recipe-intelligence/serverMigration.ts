import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { serverKey } from "./runtime";
import { prepareRoot, storagePath } from "./paths";
import { digest } from "./artifacts";
import { r2Config, R2Transport, type ObjectTransport } from "./r2";
import { serverSecrets, windowsSecrets, type SecretProtection } from "./local-secrets";
import { CURRENT_SCHEMA } from "./migrations";
import { OPENAI_CREDENTIAL_SETTING } from "./providerCredentials";

const MAGIC = Buffer.from("RI-MIGRATION-1\n");
const MAXIMUM = 128 * 1024 * 1024;
export function sealDatabase(bytes: Buffer) {
  if (bytes.length > MAXIMUM - 64) throw new Error("Database exceeds migration size limit.");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", serverKey(), iv);
  cipher.setAAD(MAGIC);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), data]);
}
export function unsealDatabase(bytes: Buffer) {
  if (bytes.length > MAXIMUM || bytes.length < MAGIC.length + 29 || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Invalid encrypted migration.");
  const offset = MAGIC.length, decipher = createDecipheriv("aes-256-gcm", serverKey(), bytes.subarray(offset, offset + 12));
  decipher.setAAD(MAGIC); decipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  try { return Buffer.concat([decipher.update(bytes.subarray(offset + 28)), decipher.final()]); }
  catch { throw new Error("Migration could not be authenticated with this server key."); }
}
function validateDatabase(db: Database.Database) {
  if (db.pragma("user_version", { simple: true }) !== CURRENT_SCHEMA || db.pragma("integrity_check", { simple: true }) !== "ok" || (db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Migration database validation failed.");
}

// Call only after stopping the local launcher. The original database is never
// rewritten; Windows credentials are re-encrypted in the disposable backup.
export async function prepareServerMigration(sourceRoot: string, destination: string, secrets: SecretProtection = windowsSecrets) {
  if (fs.existsSync(destination)) throw new Error("Choose a new migration filename.");
  const source = new Database(storagePath(sourceRoot, "database", "recipe-intelligence.sqlite"), { readonly: true, fileMustExist: true });
  const temp = `${destination}.${randomUUID()}.sqlite`;
  let backup: Database.Database | undefined;
  try {
    validateDatabase(source);
    if (source.prepare("SELECT 1 FROM worker_lease WHERE expires_at>?").get(Date.now())) throw new Error("Stop the local application before the final migration snapshot.");
    if (source.prepare("SELECT 1 FROM content_stages WHERE state='running'").get() || source.prepare("SELECT 1 FROM wordpress_exports WHERE state='sending'").get() || source.prepare("SELECT 1 FROM wordpress_media WHERE state='uploading'").get()) throw new Error("Wait for active work to settle before migrating.");
    const references = source.prepare("SELECT relative_path,sha256 FROM artifacts UNION SELECT relative_path,sha256 FROM reference_photos WHERE relative_path IS NOT NULL UNION SELECT relative_path,sha256 FROM r2_objects WHERE is_current=1 AND state<>'deleted'").all() as { relative_path: string; sha256: string }[];
    for (const row of references) {
      const file = storagePath(sourceRoot, row.relative_path);
      const hash = fs.existsSync(file) ? digest(fs.readFileSync(file)) : row.sha256;
      if (!source.prepare("SELECT 1 FROM r2_objects WHERE relative_path=? AND sha256=? AND state='synced'").get(row.relative_path.replaceAll("\\", "/"), hash)) throw new Error("Finish private cloud sync before migration. At least one current file has no verified cloud copy.");
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await source.backup(temp);
    backup = new Database(temp); backup.pragma("journal_mode = DELETE");
    // Windows path.join persisted backslashes in older rows. Linux treats those
    // as literal filename characters, so normalize only path columns in the copy.
    for (const [table, column] of [["artifacts", "relative_path"], ["reference_photos", "relative_path"], ["content_photos", "relative_path"], ["api_calls", "response_path"], ["content_stages", "request_path"], ["wordpress_media", "receipt_path"], ["wordpress_exports", "receipt_path"]]) {
      backup.prepare(`UPDATE ${table} SET ${column}=replace(${column},char(92),'/') WHERE ${column} IS NOT NULL`).run();
    }
    const rows = backup.prepare("SELECT key,value FROM settings WHERE key LIKE 'wordpress_connection:%'").all() as { key: string; value: string }[];
    for (const row of rows) {
      const connection = JSON.parse(row.value);
      connection.protectedPassword = await serverSecrets.protect(await secrets.unprotect(connection.protectedPassword));
      backup.prepare("UPDATE settings SET value=? WHERE key=?").run(JSON.stringify(connection), row.key);
    }
    const provider = backup.prepare("SELECT value FROM settings WHERE key=?").get(OPENAI_CREDENTIAL_SETTING) as { value: string } | undefined;
    if (provider) {
      const credential = JSON.parse(provider.value);
      credential.protectedKey = await serverSecrets.protect(await secrets.unprotect(credential.protectedKey));
      backup.prepare("UPDATE settings SET value=? WHERE key=?").run(JSON.stringify(credential), OPENAI_CREDENTIAL_SETTING);
    }
    backup.prepare("DELETE FROM worker_lease").run();
    backup.close(); backup = undefined;
    const encrypted = sealDatabase(fs.readFileSync(temp));
    fs.writeFileSync(destination, encrypted, { flag: "wx", mode: 0o600 });
    return { file: destination, sha256: digest(encrypted), size: encrypted.length, connections: rows.length };
  } finally { backup?.close(); source.close(); if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export async function restoreServerMigration(transport?: ObjectTransport) {
  const key = process.env.RECIPE_INTELLIGENCE_MIGRATION_KEY;
  if (!key) return;
  const config = r2Config();
  if (!config || !key.startsWith(config.prefix + "/migrations/") || !/^[a-zA-Z0-9_/-]+\.ribak$/.test(key)) throw new Error("Invalid private migration object key.");
  const expected = process.env.RECIPE_INTELLIGENCE_MIGRATION_SHA256 || "";
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("Pin the migration SHA256 before server startup.");
  const root = prepareRoot(process.env.RECIPE_INTELLIGENCE_ROOT || "");
  const destination = storagePath(root, "database", "recipe-intelligence.sqlite");
  const marker = storagePath(root, "server-migration.json");
  if (fs.existsSync(destination)) {
    // A restart must NEVER overwrite live server work with the import snapshot.
    if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, "utf8")).sha256 === expected) return;
    throw new Error("A database already exists. Refusing to overwrite server work with a migration.");
  }
  const cloud = transport || new R2Transport(config);
  const encrypted = await cloud.get(key, MAXIMUM);
  if (digest(encrypted) !== expected) throw new Error("Migration checksum mismatch.");
  const temp = storagePath(root, "database", `migration-${randomUUID()}.sqlite`);
  let db: Database.Database | undefined;
  try {
    fs.writeFileSync(temp, unsealDatabase(encrypted), { flag: "wx", mode: 0o600 });
    db = new Database(temp, { readonly: true }); validateDatabase(db);
    const connections = db.prepare("SELECT value FROM settings WHERE key LIKE 'wordpress_connection:%'").all() as { value: string }[];
    for (const row of connections) await serverSecrets.unprotect(JSON.parse(row.value).protectedPassword);
    const provider = db.prepare("SELECT value FROM settings WHERE key=?").get(OPENAI_CREDENTIAL_SETTING) as { value: string } | undefined;
    if (provider) await serverSecrets.unprotect(JSON.parse(provider.value).protectedKey);
    db.close(); db = undefined;
    // Record the exact imported snapshot before installing it. An interrupted
    // install can be retried; an installed database is never replaced.
    fs.writeFileSync(marker, JSON.stringify({ sha256: expected, restoredAt: new Date().toISOString() }), { mode: 0o600 });
    fs.renameSync(temp, destination);
  } finally { db?.close(); if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
