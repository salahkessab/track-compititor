import { randomUUID } from "node:crypto";
import type { IntelligenceStore } from "./database";
import { credentialProtection, type SecretProtection } from "./local-secrets";

export const OPENAI_CREDENTIAL_SETTING = "provider_credential:openai";
type SavedKey = { protectedKey: string; revision: string; savedAt: string };

// Settings are shared by the web process and worker. Only encrypted credentials
// are persisted; status responses never return the key or its ciphertext.
export class ProviderCredentials {
  constructor(private store: IntelligenceStore, private secrets: SecretProtection = credentialProtection()) {}
  private record(): SavedKey | null {
    const row = this.store.db.prepare("SELECT value FROM settings WHERE key=?").get(OPENAI_CREDENTIAL_SETTING) as { value: string } | undefined;
    if (!row) return null;
    try { const value = JSON.parse(row.value); if (!value.protectedKey || !value.revision || !value.savedAt) throw new Error(); return value; }
    catch { throw new Error("Could not read the saved OpenAI key. Replace it in Settings."); }
  }
  status() {
    const saved = this.record();
    return { configured: !!saved || !!process.env.OPENAI_API_KEY, source: saved ? "saved" : process.env.OPENAI_API_KEY ? "environment" : "none", savedAt: saved?.savedAt || null };
  }
  revision() { return this.record()?.revision || "environment"; }
  async key(): Promise<string | undefined> {
    const saved = this.record();
    if (!saved) return process.env.OPENAI_API_KEY;
    try {
      const value = JSON.parse(await this.secrets.unprotect(saved.protectedKey));
      if (value.purpose !== "recipe-intelligence-openai" || !validKey(value.key)) throw new Error();
      return value.key;
    } catch { throw new Error("Could not unlock the saved OpenAI key. Replace it in Settings."); }
  }
  async save(input: unknown, fetchImpl: typeof fetch = fetch) {
    const key = typeof input === "string" ? input.trim() : "";
    if (!validKey(key)) throw new Error("Enter a valid OpenAI API key beginning with sk-.");
    // A rejected replacement never overwrites a working connection.
    await testKey(key, fetchImpl);
    let protectedKey: string;
    try { protectedKey = await this.secrets.protect(JSON.stringify({ purpose: "recipe-intelligence-openai", key })); }
    catch { throw new Error("Could not securely save the OpenAI key. Check the server encryption configuration."); }
    const record: SavedKey = { protectedKey, revision: randomUUID(), savedAt: new Date().toISOString() };
    this.store.db.transaction(() => {
      this.store.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(OPENAI_CREDENTIAL_SETTING, JSON.stringify(record));
      this.store.db.prepare("DELETE FROM model_checks").run();
    }).immediate();
    return { ...this.status(), message: "OpenAI key saved and connection verified. No content was generated." };
  }
  async test(fetchImpl: typeof fetch = fetch) {
    const key = await this.key();
    if (!key) throw new Error("Add your OpenAI API key in Settings first.");
    await testKey(key, fetchImpl);
    return { ...this.status(), message: "OpenAI connection verified. No content was generated." };
  }
  remove() {
    this.store.db.transaction(() => {
      this.store.db.prepare("DELETE FROM settings WHERE key=?").run(OPENAI_CREDENTIAL_SETTING);
      this.store.db.prepare("DELETE FROM model_checks").run();
    }).immediate();
    return this.status();
  }
}
function validKey(value: unknown): value is string { return typeof value === "string" && /^sk-[A-Za-z0-9_-]{20,500}$/.test(value); }
async function testKey(key: string, fetchImpl: typeof fetch) {
  let response: Response;
  try { response = await fetchImpl("https://api.openai.com/v1/models", { method: "GET", headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error("Could not securely reach OpenAI. Check your connection and try again."); }
  await response.body?.cancel().catch(() => {});
  if (response.status === 401) throw new Error("OpenAI rejected this key. Check that it is complete and has not been revoked.");
  if (response.status === 403) throw new Error("This OpenAI key cannot read models. Enable Models read access in its project permissions.");
  if (!response.ok) throw new Error(`OpenAI connection check returned HTTP ${response.status}. Try again later.`);
}
