"use client";
import { useEffect, useRef, useState } from "react";
import { RecipeInternalLinks } from './RecipeInternalLinks';

const button = "rounded-xl border border-gray-200 bg-purple-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40 ui-secondary";
const input = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900";
type RequestFn = <T = any>(route: string, method?: string, data?: unknown) => Promise<T>;
type BridgeProfile = { recipeCard: string; recipeCardLabel: string; revision: string; ready: boolean; canPublish: boolean; settingsUrl: string };
type Connection = { id: string; siteUrl: string; username: string; displayName: string; mediaLibraryUrl: string; bridge?: BridgeProfile; authMethod?: "bridge_token" | "application_password" };
type Status = { connections: Connection[]; suggestedSiteUrl?: string };

export function WordPressConnections({ status, request, refresh }: { status?: Status; request: RequestFn; refresh: () => Promise<unknown> }) {
  const [siteUrl, setSiteUrl] = useState(status?.suggestedSiteUrl || "");
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [authMethod, setAuthMethod] = useState<"bridge_token" | "application_password">("bridge_token");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const initialized = useRef(!!status?.suggestedSiteUrl);
  useEffect(() => { if (!initialized.current && status?.suggestedSiteUrl) { setSiteUrl(status.suggestedSiteUrl); initialized.current = true; } }, [status?.suggestedSiteUrl]);
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const secret = password; setPassword("");
    const credentials = authMethod === "bridge_token" ? { authMethod, siteUrl, userSlug: username, siteToken: secret } : { authMethod, siteUrl, username, applicationPassword: secret };
    try { await request("wordpress/connect", "POST", credentials); await refresh(); setMessage("Website connected. Choose it beside your article to send a draft, publish, or copy."); setSiteUrl(""); setUsername(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not connect to WordPress."); } finally { setBusy(false); }
  }
  async function disconnect(id: string) {
    setBusy(true); setError(""); setMessage("");
    try { await request(`wordpress/${id}`, "DELETE", {}); await refresh(); setMessage("Connection removed. Previously uploaded images stay in WordPress."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect."); } finally { setBusy(false); }
  }
  async function sync(id: string) {
    setBusy(true); setError(""); setMessage("");
    try { const profile = await request<BridgeProfile>(`wordpress/${id}/sync`, "POST", {}); setMessage(profile.ready ? `Synced default recipe card: ${profile.recipeCardLabel}.` : "Choose a supported default recipe card in WordPress Settings, then sync again."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not sync website settings."); }
    finally { await refresh(); setBusy(false); }
  }
  return <section className="studio-panel space-y-4 rounded-2xl border p-5" aria-label="WordPress websites">
    <h2 className="text-lg">WordPress websites</h2>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked readOnly disabled />Clean metadata before upload</label><p className="text-xs text-gray-600">Automatic for every final image before preview, download and upload.</p>
    <p className="text-sm text-gray-600">Connect your WordPress websites and choose a destination per article. Install the bridge plugin to send drafts or publish live with the site's default recipe card.</p>
    <a className={`${button} inline-block`} href="/api/recipe-wordpress-plugin" download>Download WordPress plugin</a>
    <p className="text-sm text-gray-600">Install or update Recipe Intelligence Bridge 1.3 using WordPress → Plugins → Add New → Upload Plugin. Open Recipe Intelligence in the WordPress sidebar, create a Site Token, copy a User Slug, and choose your default recipe card.</p>
    {!!status?.connections.length && <ul className="space-y-3">{status.connections.map(c => <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 p-3"><div className="min-w-0 text-sm"><p className="break-all">{c.siteUrl}</p><p className="text-gray-600">Connected as {c.username}</p><p>Recipe card: {c.bridge?.recipeCardLabel || "Bridge not synced"}{c.bridge && !c.bridge.ready ? " — setup required" : ""}</p><div className="flex gap-3"><a className="text-blue-700 underline" href={c.mediaLibraryUrl} target="_blank" rel="noreferrer">Open Media Library</a>{c.bridge && <a className="text-blue-700 underline" href={c.bridge.settingsUrl} target="_blank" rel="noreferrer">Recipe-card settings</a>}</div></div><div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => void sync(c.id)}>Sync website settings</button><button type="button" className={button} disabled={busy} onClick={() => void disconnect(c.id)}>Disconnect</button></div></li>)}</ul>}
    <details open={!status?.connections.length}><summary className="cursor-pointer text-sm">{status?.connections.length ? "Connect another website or update credentials" : "Connect your WordPress website"}</summary>
      <form className="mt-4 space-y-4" onSubmit={connect} autoComplete="off">
        <label className="block text-sm">Connection method<select className={`${input} mt-1`} value={authMethod} disabled={busy} onChange={e => { setAuthMethod(e.target.value as typeof authMethod); setPassword(""); setUsername(""); setError(""); }}><option value="bridge_token">Site Token (recommended)</option><option value="application_password">Application Password (existing method)</option></select></label>
        <label className="block text-sm">WordPress website URL<input className={`${input} mt-1`} type="text" inputMode="url" required maxLength={2048} placeholder="https://your-website.com" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} disabled={busy} /></label>
        <label className="block text-sm">{authMethod === "bridge_token" ? "Site Token" : "Application Password"}<input className={`${input} mt-1`} type="password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} autoComplete="new-password" spellCheck={false} /></label>
        <label className="block text-sm">{authMethod === "bridge_token" ? "User Slug" : "WordPress username"}<input className={`${input} mt-1`} required maxLength={100} value={username} onChange={e => setUsername(e.target.value)} disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
        <p className="text-sm text-gray-600">{authMethod === "bridge_token" ? "Copy both fields from WordPress → Recipe Intelligence: Copy Site Token and Copy User Slug. Use a token from Recipe Intelligence Bridge; tokens from other plugins are not compatible." : "In WordPress, go to Users → Profile → Application Passwords. Enter the generated password and that user's login username, not the password's label."} Credentials are stored encrypted and never included in articles or exports.</p>
        <button className={button} disabled={busy || !password || !username || !siteUrl}>{busy ? "Checking connection…" : "Connect website"}</button>
      </form>
    </details>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{message && <p role="status" className="text-sm text-green-700">{message}</p>}
  </section>;
}

export function WordPressCopy({ itemId, connections, request, publications = [] }: { itemId: string; connections: Connection[]; request: RequestFn; publications?: { siteUrl: string; state: string; result: any; checkedAt: string }[] }) {
  const [linkBusy, setLinkBusy] = useState(false);
  const [target, setTarget] = useState(connections.length === 1 ? connections[0].id : "");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<{ html: string; text: string; siteUrl: string; connectionId: string } | null>(null);
  const [review, setReview] = useState<any>(null); const [sent, setSent] = useState<any>(null);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const lock = useRef(false);
  async function changeDestination(id: string) {
    setBusy(true); setError('');
    try {
      await request(`items/${itemId}/internal-links`, 'POST', { action: 'destination', connectionId: id });
      setTarget(id); setPrepared(null); setReview(null); setSent(null); setPublishConfirmed(false); setMessage('Destination changed. Request internal-link suggestions for this website.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change destination.'); }
    finally { setBusy(false); }
  }
  const publication = publications.find(p => p.siteUrl.replace(/\/$/, '') === connections.find(c => c.id === target)?.siteUrl.replace(/\/$/, ''));
  const publicationKey = JSON.stringify(publication || null);
  useEffect(() => {
    setSent(publication?.result || null);
    setPublishConfirmed(false);
    setMessage("");
  }, [itemId, target, publicationKey]);
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
  async function prepareSend() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setReview(null); setSent(null); setPublishConfirmed(false);
    try {
      setMessage("Checking the website's default recipe card…");
      const plan = await request(`items/${itemId}/wordpress-publish?connectionId=${encodeURIComponent(target)}`);
      if (!plan.profile.ready) throw new Error("Choose a supported default recipe card in WordPress Settings → Recipe Intelligence, then prepare again.");
      for (let i = 0; i < plan.images.length; i++) {
        const image = plan.images[i]; if (image.state === "ready") continue;
        setMessage(`Saving image ${i + 1} of ${plan.images.length} to WordPress…`);
        await request(`items/${itemId}/wordpress`, "POST", { connectionId: target, documentHash: plan.documentHash, sha256: image.sha256 });
      }
      const final = await request(`items/${itemId}/wordpress-publish?connectionId=${encodeURIComponent(target)}`);
      if (plan.documentHash !== final.documentHash || !final.ready) throw new Error("The article changed during preparation. Prepare again; saved images will be reused.");
      const existing = final.previous?.result || null;
      setReview(final); setSent(existing); setMessage(existing?.status === "publish" ? "Already published on this website. Open the saved post below." : existing?.status === "future" ? "Already scheduled on this website. Manage its schedule in WordPress." : "Ready to send. Review the destination and recipe card below.");
    } catch (e) { setMessage(""); setError(e instanceof Error ? e.message : "Could not prepare article."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function send(status: "draft" | "publish") {
    if (!review || lock.current || sent?.status === "publish" || sent?.status === "future") return; lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const saved = await request(`items/${itemId}/wordpress-publish`, "POST", { connectionId: target, reviewHash: review.reviewHash, status, confirmPublish: status === "publish" && publishConfirmed });
      setSent(saved); setMessage(saved.status === "publish" ? "Article published with hosted images and its recipe card." : "Article saved in WordPress with hosted images and its recipe card.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not confirm the send. Check saved post."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function checkSent() {
    setBusy(true); setError("");
    try { setSent(await request(`items/${itemId}/wordpress-check`, "POST", { connectionId: target })); setMessage("Saved post confirmed."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not confirm the saved post."); }
    finally { setBusy(false); }
  }
  function download() {
    if (!prepared) return;
    const url = URL.createObjectURL(new Blob([`<!doctype html><html lang="en"><meta charset="utf-8"><body>${prepared.html}</body></html>`], { type: "text/html" }));
    const a = document.createElement("a"); a.href = url; a.download = "wordpress-article.html"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  if (!connections.length) return null;
  return <div className="space-y-3 rounded-xl border border-gray-200 p-3" aria-label="Upload article images to WordPress">
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">WordPress destination<select className={`${input} mt-1`} value={target} disabled={busy || linkBusy} onChange={e => void changeDestination(e.target.value)}><option value="">Choose a website</option>{connections.map(c => <option key={c.id} value={c.id}>{c.siteUrl}</option>)}</select></label><button className={button} disabled={busy || linkBusy || !target} onClick={() => void prepareSend()}>Prepare WordPress post</button><button className={button} disabled={busy || linkBusy || !target} onClick={() => void uploadAndCopy()}>{busy ? "Working…" : "Upload images and copy"}</button></div>
    <RecipeInternalLinks itemId={itemId} target={target} request={request} disabled={busy || linkBusy} onBusy={setLinkBusy} onChanged={() => { setPrepared(null); setReview(null); setPublishConfirmed(false); }} />
    <p className="text-xs text-gray-600">Image metadata is cleaned and verified before preview, download and upload. WordPress reuses the verified WebP output. Previously unverified uploads need review.</p>
    {message && <p role="status" className="text-sm text-green-700">{message}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {review && <div className="space-y-3 rounded-xl border border-gray-200 p-3"><p className="text-sm">{review.title} → {review.siteUrl}</p><p className="text-sm">Recipe card: <strong>{review.profile.recipeCardLabel}</strong> · {review.images.length} hosted images</p><p className="text-xs text-gray-600">Uses saved recipe facts. No new AI request. Changing the default card in WordPress requires preparing again.</p><div className="flex flex-wrap gap-2">{!sent && <button className={button} disabled={busy || linkBusy} onClick={() => void send("draft")}>Save draft</button>}<button className={button} disabled={busy || linkBusy} onClick={() => void checkSent()}>Check saved post</button></div>{review.profile.canPublish && (!sent || sent.status === "draft") && <div className="space-y-2"><label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy || linkBusy} checked={publishConfirmed} onChange={e => setPublishConfirmed(e.target.checked)} />Publish this article publicly on {new URL(review.siteUrl).host} now.</label><button className={button} disabled={busy || !publishConfirmed} onClick={() => void send("publish")}>Publish live</button></div>}</div>}
    {sent && <div className="flex flex-wrap gap-3 text-sm"><span>{sent.status === "publish" ? "Published" : sent.status === "future" ? "Scheduled" : "Saved draft"} · Post {sent.postId}</span><a className="text-blue-700 underline" href={sent.editUrl} target="_blank" rel="noreferrer">Open in WordPress</a>{sent.status === "publish" && <a className="text-blue-700 underline" href={sent.postUrl} target="_blank" rel="noreferrer">View live article</a>}</div>}
    {prepared && <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || linkBusy} onClick={() => void copy(prepared).catch(e => setError(e.message))}>Copy uploaded article</button><button className={button} disabled={busy || linkBusy} onClick={download}>Download WordPress HTML</button></div>}
  </div>;
}
