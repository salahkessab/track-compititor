"use client";
import { useEffect, useRef, useState } from "react";

const button = "rounded-xl border border-[#424a60] bg-[#202537] px-3 py-2 text-sm text-[#e9e4df] disabled:cursor-not-allowed disabled:opacity-40";
const input = "w-full rounded-xl border border-[#424a60] bg-[#101421] px-3 py-2 text-sm text-[#e9e4df]";
type RequestFn = <T = any>(route: string, method?: string, data?: unknown) => Promise<T>;
type Connection = { id: string; siteUrl: string; username: string; displayName: string; mediaLibraryUrl: string };
type Status = { connections: Connection[]; suggestedSiteUrl?: string };

export function WordPressConnections({ status, request, refresh }: { status?: Status; request: RequestFn; refresh: () => Promise<unknown> }) {
  const [siteUrl, setSiteUrl] = useState(status?.suggestedSiteUrl || "");
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const initialized = useRef(!!status?.suggestedSiteUrl);
  useEffect(() => { if (!initialized.current && status?.suggestedSiteUrl) { setSiteUrl(status.suggestedSiteUrl); initialized.current = true; } }, [status?.suggestedSiteUrl]);
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const applicationPassword = password; setPassword("");
    try { await request("wordpress/connect", "POST", { siteUrl, username, applicationPassword }); await refresh(); setMessage("Website connected. Choose it beside your article to upload images and copy."); setSiteUrl(""); setUsername(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not connect to WordPress."); } finally { setBusy(false); }
  }
  async function disconnect(id: string) {
    setBusy(true); setError(""); setMessage("");
    try { await request(`wordpress/${id}`, "DELETE", {}); await refresh(); setMessage("Local connection removed. Previously uploaded images stay in WordPress."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect."); } finally { setBusy(false); }
  }
  return <section className="studio-panel space-y-4 rounded-2xl border p-5" aria-label="WordPress websites">
    <h2 className="text-lg">WordPress websites</h2>
    <p className="text-sm text-[#a6acbd]">Connect any of your WordPress sites. Choose a destination for each article; its finished images upload to that site's Media Library before copying.</p>
    {!!status?.connections.length && <ul className="space-y-3">{status.connections.map(c => <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#424a60] p-3"><div className="min-w-0 text-sm"><p className="break-all">{c.siteUrl}</p><p className="text-[#a6acbd]">Connected as {c.username}</p><a className="text-[#deb589] underline" href={c.mediaLibraryUrl} target="_blank" rel="noreferrer">Open Media Library</a></div><button type="button" className={button} disabled={busy} onClick={() => void disconnect(c.id)}>Disconnect</button></li>)}</ul>}
    <details open={!status?.connections.length}><summary className="cursor-pointer text-sm">{status?.connections.length ? "Connect another website or update credentials" : "Connect your WordPress website"}</summary>
      <form className="mt-4 space-y-4" onSubmit={connect} autoComplete="off">
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">WordPress website URL<input className={`${input} mt-1`} type="text" inputMode="url" required maxLength={2048} placeholder="https://your-website.com" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} disabled={busy} /></label><label className="text-sm">WordPress username<input className={`${input} mt-1`} required maxLength={100} value={username} onChange={e => setUsername(e.target.value)} disabled={busy} autoComplete="off" /></label></div>
        <label className="block text-sm">Application Password<input className={`${input} mt-1`} type="password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} autoComplete="new-password" /></label>
        <p className="text-sm text-[#a6acbd]">In WordPress, go to Users → Profile → Application Passwords. Create one named Recipe Intelligence and enter it here. It is encrypted for your Windows account and stays on this computer.</p>
        <button className={button} disabled={busy || !password || !username || !siteUrl}>{busy ? "Checking connection…" : "Connect website"}</button>
      </form>
    </details>
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}{message && <p role="status" className="text-sm text-emerald-200">{message}</p>}
  </section>;
}

export function WordPressCopy({ itemId, connections, request }: { itemId: string; connections: Connection[]; request: RequestFn }) {
  const [target, setTarget] = useState(connections.length === 1 ? connections[0].id : "");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<{ html: string; text: string; siteUrl: string; connectionId: string } | null>(null);
  const lock = useRef(false);
  useEffect(() => { if (target && !connections.some(c => c.id === target)) { setTarget(""); setPrepared(null); } }, [connections, target]);
  async function copy(value: { html: string; text: string; siteUrl: string }) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("This browser cannot copy formatted content. Use Download WordPress HTML below; the images are already hosted.");
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([value.html], { type: "text/html" }), "text/plain": new Blob([value.text], { type: "text/plain" }) })]);
    setMessage(`Copied with images hosted on ${new URL(value.siteUrl).host}. Paste into your WordPress editor.`);
  }
  async function uploadAndCopy() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setPrepared(null);
    const selectedTarget = target;
    try {
      setMessage("Checking saved images…");
      const plan = await request(`items/${itemId}/wordpress?connectionId=${encodeURIComponent(selectedTarget)}`);
      const failures: string[] = []; let done = 0;
      for (const image of plan.images) {
        if (image.state !== "ready") {
          setMessage(`Saving image ${done + 1} of ${plan.images.length} to ${new URL(plan.siteUrl).host}…`);
          try { await request(`items/${itemId}/wordpress`, "POST", { connectionId: selectedTarget, documentHash: plan.documentHash, sha256: image.sha256 }); }
          catch (e) { failures.push(`${image.alt}: ${e instanceof Error ? e.message : "Upload failed."}`); }
        }
        done++;
      }
      const finished = await request(`items/${itemId}/wordpress?connectionId=${encodeURIComponent(selectedTarget)}`);
      if (finished.documentHash !== plan.documentHash) throw new Error("The article changed during upload. Click again to copy its latest version; existing uploads will be reused.");
      if (!finished.ready || failures.length) throw new Error(failures.join(" ") || "Some images are not saved yet. Click again to resume; completed uploads will be reused.");
      setPrepared(finished); setMessage(`${finished.images.length} images saved to ${new URL(finished.siteUrl).host}.`);
      try { await copy(finished); } catch { setMessage("Images are saved. Click Copy uploaded article to finish copying, or download the WordPress HTML."); }
    } catch (e) { setMessage(""); setError(e instanceof Error ? e.message : "Could not prepare the WordPress article."); }
    finally { lock.current = false; setBusy(false); }
  }
  function download() {
    if (!prepared) return;
    const url = URL.createObjectURL(new Blob([`<!doctype html><html lang="en"><meta charset="utf-8"><body>${prepared.html}</body></html>`], { type: "text/html" }));
    const a = document.createElement("a"); a.href = url; a.download = "wordpress-article.html"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  if (!connections.length) return null;
  return <div className="space-y-3 rounded-xl border border-[#424a60] p-3" aria-label="Upload article images to WordPress">
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">WordPress destination<select className={`${input} mt-1`} value={target} disabled={busy} onChange={e => { setTarget(e.target.value); setPrepared(null); setMessage(""); setError(""); }}><option value="">Choose a website</option>{connections.map(c => <option key={c.id} value={c.id}>{c.siteUrl}</option>)}</select></label><button className={button} disabled={busy || !target} onClick={() => void uploadAndCopy()}>{busy ? "Uploading images…" : "Upload images and copy"}</button></div>
    <p className="text-xs text-[#a6acbd]">Uploads the finished images and copies the article with permanent image URLs. Existing uploads on this destination are reused.</p>
    {message && <p role="status" className="text-sm text-emerald-200">{message}</p>}{error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    {prepared && <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void copy(prepared).catch(e => setError(e.message))}>Copy uploaded article</button><button className={button} disabled={busy} onClick={download}>Download WordPress HTML</button></div>}
  </div>;
}
