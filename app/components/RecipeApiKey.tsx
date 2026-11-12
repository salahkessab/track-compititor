"use client";
import { useState } from "react";

const button = "rounded-xl border border-gray-200 bg-purple-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40 ui-secondary";
type Connection = { configured: boolean; source: string; savedAt?: string | null };
export function RecipeApiKey({ connection, request, refresh }: { connection?: Connection; request: <T = any>(route: string, method?: string, data?: unknown) => Promise<T>; refresh: () => Promise<unknown> }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const act = async (operation: () => Promise<any>, success: string) => {
    setBusy(true); setMessage(""); setError("");
    try { const result = await operation(); setMessage(result.message || success); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update the OpenAI connection."); }
    finally { setKey(""); setBusy(false); }
  };
  return <section className="studio-panel space-y-4 rounded-2xl border p-5" aria-labelledby="openai-connection-title">
    <h2 id="openai-connection-title" className="text-lg">OpenAI API key</h2>
    <p className="text-sm text-gray-600">Connect OpenAI to generate your recipe articles and images. Your key is encrypted in this workspace and is never included in articles or downloads.</p>
    <p className={`text-sm ${connection?.configured ? "text-green-700" : "text-amber-700"}`}>{connection?.source === "saved" ? "Key saved. You can test the connection or replace it below." : connection?.configured ? "Using the key configured in the server environment. A key saved here takes priority for Recipe Intelligence." : "No API key connected yet."}</p>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); const value = key; void act(() => request("provider-key", "POST", { apiKey: value }), "OpenAI key saved."); }}>
      <label className="block text-sm" htmlFor="openai-api-key">{connection?.configured ? "New OpenAI API key (replace current key)" : "Your OpenAI API key"}</label>
      <input id="openai-api-key" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-…" disabled={busy} required maxLength={503} aria-describedby="openai-key-help" />
      <p id="openai-key-help" className="text-xs text-gray-600">Saving checks the key with OpenAI. No article or image is generated, and no restart is needed. Your project key needs Models read access for this check.</p>
      <div className="flex flex-wrap gap-2">
        <button className={`${button} !border-blue-600 !bg-blue-600 !text-white font-medium`} type="submit" disabled={busy || !key.trim()}>{busy ? "Checking…" : "Save and test key"}</button>
        <button className={button} type="button" disabled={busy || !connection?.configured} onClick={() => void act(() => request("provider-key/test", "POST", {}), "OpenAI connection verified.")}>Test saved connection (no charge)</button>
      </div>
    </form>
    {connection?.source === "saved" && <details><summary className="cursor-pointer text-sm text-gray-600">Remove saved key</summary><p className="my-3 text-sm text-gray-600">Future requests will use the server environment key if one exists. Otherwise generation stops until you add a key again. Saved articles and images are kept.</p><button type="button" className={button} disabled={busy} onClick={() => void act(() => request("provider-key", "DELETE", {}), "Saved key removed.")}>Remove saved OpenAI key</button></details>}
    {message && <p role="status" className="text-sm text-green-700">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
