import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { IntelligenceStore } from "./database";
import { storagePath } from "./paths";
import { digest } from "./artifacts";
import { r2Config, R2Transport, type ObjectTransport } from "./r2";
import { sealDatabase } from "./serverMigration";
import { serverMode } from "./runtime";

export function serverBackupStatus(store: IntelligenceStore) {
  if (!serverMode()) return undefined;
  const saved = store.db.prepare("SELECT value FROM settings WHERE key='server_database_backup'").get() as { value: string } | undefined;
  const error = store.db.prepare("SELECT value FROM settings WHERE key='server_database_backup_error'").get() as { value: string } | undefined;
  return { savedAt: saved ? JSON.parse(saved.value).savedAt as string : null, error: error?.value || null };
}

export class ServerBackup {
  private nextAttempt = 0;
  constructor(private store: IntelligenceStore, private transport?: ObjectTransport) {}
  async tick() {
    if (!serverMode() || Date.now() < this.nextAttempt) return;
    const row = this.store.db.prepare("SELECT value FROM settings WHERE key='server_database_backup'").get() as { value: string } | undefined;
    const previous = row ? JSON.parse(row.value) : null;
    if (previous && Date.now() - Date.parse(previous.savedAt) < 24 * 60 * 60 * 1000) return;
    this.nextAttempt = Date.now() + 15 * 60 * 1000;
    const file = storagePath(this.store.root, "backups", `cloud-${randomUUID()}.sqlite`);
    try {
      const config = r2Config(); if (!config) return;
      const cloud = this.transport || new R2Transport(config);
      await this.store.db.backup(file);
      const bytes = sealDatabase(fs.readFileSync(file)), sha256 = digest(bytes);
      const key = `${config.prefix}/migrations/backup-${randomUUID()}.ribak`;
      await cloud.put(key, bytes, "application/octet-stream", sha256);
      const confirmed = await cloud.head(key);
      if (!confirmed || confirmed.sha256 !== sha256 || confirmed.size !== bytes.length) throw new Error();
      this.store.db.prepare("INSERT INTO settings(key,value) VALUES('server_database_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(JSON.stringify({ objectKey: key, sha256, bytes: bytes.length, savedAt: new Date().toISOString() }));
      this.store.db.prepare("DELETE FROM settings WHERE key='server_database_backup_error'").run();
    } catch {
      this.store.db.prepare("INSERT INTO settings(key,value) VALUES('server_database_backup_error','Encrypted cloud database backup failed. The worker will retry.') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    } finally { if (fs.existsSync(file)) fs.unlinkSync(file); }
  }
}
