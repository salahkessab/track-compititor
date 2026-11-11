"use client";
import { IntelligenceContent } from "./IntelligenceContent";

import { useCallback, useEffect, useRef, useState } from "react";

type Source = { id: number; url: string; kind: string; status: string; error: string | null; last_success_at: string | null };
type Site = { id: string; name: string; url: string; status: "active" | "paused"; urls: number; sources: Source[]; last_scan_at: string | null; last_success_at: string | null; baseline_completed_at: string | null };
type Run = { id: string; site_id: string; site_name: string; status: string; total: number; processed: number; errors: number; remaining: number; message: string | null; created_at: string; coverage: string };
type Snapshot = { sites: Site[]; runs: Run[]; worker: { online: boolean; heartbeat_at: string | null }; settings: { root: string; timezone: string }; contentSettings?: unknown; reports?: unknown[]; batches?: unknown[]; providerConfigured?: boolean };
type History = { total: number; rows: { id: number; canonical_url: string; title: string; first_seen_at: string; origin: string; sources: string; evidence: string }[] };
type Event = { id: number; at: string; level: string; message: string; url: string | null };
const button = "rounded-xl border border-[#424a60] bg-[#202537] px-3 py-2 text-sm text-[#e9e4df] disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} !border-[#d1a478] !bg-[#d1a478] !text-[#16130f] font-medium`;
const input = "w-full rounded-xl border border-[#424a60] bg-[#101421] px-3 py-2 text-sm text-[#e9e4df]";
const running = (status: string) => ["running", "queued"].includes(status);
const label = (value: string) => value.replace(/_/g, " ");

async function request<T>(route: string, method = "GET", data?: unknown, key?: string): Promise<T> {
  const response = await fetch(`/api/recipe-intelligence/${route}`, {
    method, cache: "no-store", credentials: "same-origin",
    headers: { ...(method !== "GET" ? { "Content-Type": "application/json", "X-Recipe-Intelligence": "1" } : {}), ...(key ? { "X-RI-Key": key } : {}) },
    ...(method !== "GET" ? { body: JSON.stringify(data || {}) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Local request failed.");
  return payload;
}

export function RecipeIntelligence({ active = false }: { active?: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [view, setView] = useState("start");
  const [name, setName] = useState(""); const [url, setUrl] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [historySite, setHistorySite] = useState(""); const [page, setPage] = useState(0);
  const [history, setHistory] = useState<History | null>(null);
  const [events, setEvents] = useState<Event[]>([]); const [logRun, setLogRun] = useState<string | null>(null);
  const [archive, setArchive] = useState<Site | null>(null);
  const [timezone, setTimezone] = useState("Africa/Casablanca");
  const initialized = useRef(false);
  const reload = useCallback(async () => {
    const data = await request<Snapshot>("snapshot"); setSnapshot(data);
    if (!initialized.current) { setTimezone(data.settings.timezone); initialized.current = true; }
    return data;
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        await reload();
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not connect to local storage."); }
    };
    void (async () => {
      try {
        const capability = await request<{ enabled: boolean }>("capabilities");
        if (cancelled) return;
        setEnabled(capability.enabled);
        if (!capability.enabled) return;
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const key = fragment.get("ri-token");
        if (key) {
          await request("session", "POST", {}, key);
          fragment.delete("ri-token");
          window.history.replaceState(null, "", window.location.pathname + window.location.search + (fragment.size ? `#${fragment}` : ""));
        }
        await refresh();
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not connect to the local application."); }
    })();
    return () => { cancelled = true; };
  }, [active, reload]);

  // Poll only the visible workspace, including idle worker health and changes in another tab.
  useEffect(() => {
    if (!active || !snapshot) return;
    const timer = setInterval(() => { void reload().catch(e => setError(e.message)); }, 3000);
    return () => clearInterval(timer);
  }, [active, !!snapshot, reload]);

  useEffect(() => {
    if (!active) return;
    const fromUrl = () => { const current = new URLSearchParams(window.location.search).get("view"); setView(["start", "websites", "reports", "batches", "settings"].includes(current || "") ? current! : "start"); };
    fromUrl(); window.addEventListener("popstate", fromUrl); return () => window.removeEventListener("popstate", fromUrl);
  }, [active]);

  useEffect(() => {
    if (!historySite || !active || !snapshot) return;
    let valid = true;
    void request<History>(`history?siteId=${encodeURIComponent(historySite)}&page=${page}`).then(data => { if (valid) setHistory(data); }).catch(e => setError(e.message));
    return () => { valid = false; };
  }, [historySite, page, active, snapshot]);
  useEffect(() => {
    if (logRun === null || !active || !snapshot) return;
    let valid = true;
    void request<{ rows: Event[] }>(`logs${logRun ? `?runId=${encodeURIComponent(logRun)}` : ""}`).then(data => { if (valid) setEvents(data.rows); }).catch(e => setError(e.message));
    return () => { valid = false; };
  }, [logRun, active, snapshot]);

  const act = async (operation: () => Promise<unknown>, success = "") => {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); await reload(); if (success) setNotice(success); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed."); }
    finally { setBusy(false); }
  };
  const scan = (siteId?: string) => act(() => request("scans", "POST", siteId ? { siteIds: [siteId] } : { allActive: true }), "Manual discovery queued. Use a historical report to verify recipe publication dates.");
  const navigate = (id: string) => { const target = new URL(window.location.href); target.searchParams.set("view", id); window.history.pushState(null, "", target); setView(id); };
  const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: snapshot?.settings.timezone || "Africa/Casablanca" }).format(new Date(value)) : "Not scanned";
  const runCard = (run: Run) => <div key={run.id} className="border-b border-[#424a60]/60 pb-4 last:border-0">
    <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{run.site_name} · {label(run.status)}</span><span>{run.processed} processed · {run.remaining} pending · {run.errors} errors</span></div>
    {run.message && <p className="mt-2 text-xs text-[#a6acbd]">{run.message}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      {running(run.status) && <button className={button} disabled={busy} onClick={() => void act(() => request(`scans/${run.id}/action`, "POST", { action: "pause" }))}>Pause scan</button>}
      {run.status === "paused" && <button className={button} disabled={busy || !snapshot?.worker.online} onClick={() => void act(() => request(`scans/${run.id}/action`, "POST", { action: "resume" }))}>Resume scan</button>}
      {["failed", "partial"].includes(run.status) && <button className={button} disabled={busy || !snapshot?.worker.online} onClick={() => void act(() => request(`scans/${run.id}/action`, "POST", { action: "retry" }))}>Retry failed sources</button>}
      {["running", "queued", "paused"].includes(run.status) && <button className={button} disabled={busy} onClick={() => void act(() => request(`scans/${run.id}/action`, "POST", { action: "cancel" }))}>Cancel scan</button>}
      <button className={button} onClick={() => setLogRun(run.id)}>Logs</button>
    </div>
  </div>;

  return <section aria-label="Recipe Intelligence workspace" className="space-y-5">
    <div className="studio-panel rounded-[24px] border p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="studio-title text-2xl">Recipe Intelligence</h1><p className="mt-2 max-w-2xl text-sm text-[#a6acbd]">Paste a recipe URL, review the cost, and generate an article with images.</p></div>
      </div>
      {enabled && snapshot && <div className="mt-4 flex flex-wrap gap-4 text-sm text-[#a6acbd]">
        {["websites", "reports"].includes(view) && <><span>{snapshot.sites.length} / 10 websites</span><span>{snapshot.sites.reduce((sum, site) => sum + site.urls, 0).toLocaleString()} discovered URLs</span></>}
        <span className={snapshot.worker.online ? "text-emerald-300" : "text-amber-200"}>{snapshot.worker.online ? "Ready · updates automatically" : "Worker starting or offline · use the Windows launcher"}</span>
      </div>}
    </div>
    {error && <div role="alert" className="rounded-xl border border-red-400/30 bg-red-950/30 p-4 text-sm text-red-100">{error}{snapshot && <button className={`${button} ml-3`} disabled={busy} onClick={() => void act(reload)}>Reconnect</button>}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-950/20 p-4 text-sm text-emerald-100">{notice}</div>}
    {enabled === null && !error && <p className="text-sm text-[#a6acbd]">Checking local connection…</p>}
    {enabled === false && <div className="studio-panel rounded-2xl border p-6"><h2 className="text-lg">Open the local application</h2><p className="mt-2 text-sm text-[#a6acbd]">Double-click Start Recipe Intelligence on your Windows PC. The launcher lets you choose a storage folder and opens this workspace. Your hosted recipe tools remain available here.</p></div>}
    {enabled && snapshot && <>
      <nav aria-label="Recipe Intelligence navigation" className="flex flex-wrap gap-2">
        {[["start", "Use a recipe URL"], ["batches", "My articles"], ["websites", "Tracked websites"], ["reports", "Find recipes"], ["settings", "Settings"]].map(([id, title]) => <a key={id} href={`/?tab=recipe-intelligence&view=${id}`} aria-current={view === id ? "page" : undefined}
          className={`${button} ${view === id ? "!border-[#d1a478] !text-[#deb589]" : ""}`} onClick={event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); const target = new URL(window.location.href); target.searchParams.set("view", id); window.history.pushState(null, "", target); setView(id);
          }}>{title}</a>)}
      </nav>
      <IntelligenceContent view={view} snapshot={snapshot} request={request} refresh={reload} navigate={navigate} active={active} />
      {view === "websites" && <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg">Your websites</h2><p className="mt-1 text-sm text-[#a6acbd]">Scan when you want, then use Find recipes to choose a publication date. Both steps are free.</p></div><button className={primary} disabled={busy || !snapshot.worker.online || !snapshot.sites.some(site => site.status === "active")} onClick={() => void scan()}>Scan all active websites</button></div>
        <details className="rounded-xl border border-[#424a60]/70 p-4" open={!snapshot.sites.length}><summary className="cursor-pointer text-sm">Add a website · {snapshot.sites.length}/10</summary><form className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto]" onSubmit={event => { event.preventDefault(); void act(async () => { await request("sites", "POST", { name, url }); setName(""); setUrl(""); }, "Website saved. Start a manual scan when ready."); }}>
          <label className="text-sm">Name<input aria-label="Website name" className={`${input} mt-1`} maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder="Optional name" /></label>
          <label className="text-sm">Website URL<input aria-label="Website URL" className={`${input} mt-1`} type="url" required maxLength={2048} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/" /></label>
          <button className={`${button} self-end`} disabled={busy || snapshot.sites.length >= 10}>Add website</button>
        </form></details>
        {!snapshot.sites.length && <p className="text-sm text-[#a6acbd]">Add your first website above to begin.</p>}
        <div className="grid gap-4 lg:grid-cols-2">{snapshot.sites.map(site => {
          const latest = snapshot.runs.find(run => run.site_id === site.id);
          const health = latest ? latest.status === "failed" ? "Error" : latest.status === "partial" ? "Degraded" : running(latest.status) ? "Scanning" : latest.status === "completed" ? "Sources processed" : label(latest.status) : "Not scanned";
          return <article key={site.id} className="studio-panel space-y-4 rounded-2xl border p-5">
            <div className="flex justify-between gap-3"><div><h3 className="text-lg">{site.name}</h3><a className="break-all text-xs text-[#a6acbd] underline" href={site.url} target="_blank" rel="noreferrer">{site.url}</a></div><span className="text-sm capitalize text-[#deb589]">{site.status}</span></div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm"><span>{site.urls.toLocaleString()} discovered URLs</span><span>{health}</span></div>
            <p className="text-xs text-[#a6acbd]">Last scan: {date(site.last_scan_at)}</p>
            {site.status === "paused" ? <button className={button} disabled={busy} onClick={() => void act(() => request(`sites/${site.id}`, "PATCH", { status: "active" }))}>Activate website</button> : <button className={button} disabled={busy || !snapshot.worker.online || !!latest && ["queued", "running", "paused"].includes(latest.status)} onClick={() => void scan(site.id)}>Scan website</button>}
            {latest && ["failed", "partial"].includes(latest.status) && <p role="status" className="text-sm text-amber-200">{latest.message || "Some sources could not be read."} <button className={button} disabled={busy || !snapshot.worker.online} onClick={() => void act(() => request(`scans/${latest.id}/action`, "POST", { action: "retry" }))}>Retry failed sources</button></p>}
            <details><summary className="cursor-pointer text-sm text-[#a6acbd]">Website details and actions</summary><div className="mt-3 space-y-3">
            <div className="space-y-1 text-xs text-[#a6acbd]"><p>Last attempted scan: {date(site.last_scan_at)}</p><p>Last successful source scan: {date(site.last_success_at)}</p><p>Baseline: {site.baseline_completed_at ? "Available sources recorded" : latest ? "Incomplete" : "Not started"}</p></div>
            <div className="flex flex-wrap gap-2 text-xs">{["rss", "atom", "sitemap", "sitemap_index"].map(kind => {
              const available = site.sources.filter(source => source.kind === kind && source.status === "available").length;
              return <span key={kind} className={`rounded-full border px-2 py-1 ${available ? "border-emerald-500/30 text-emerald-200" : "border-[#424a60] text-[#a6acbd]"}`}>{label(kind)}: {available || "not confirmed"}</span>;
            })}</div>
            <div className="flex flex-wrap gap-2">
              {site.status === "active" && <button className={button} disabled={busy} onClick={() => void act(() => request(`sites/${site.id}`, "PATCH", { status: "paused" }))}>Pause website</button>}
              <button className={button} onClick={() => { setHistorySite(site.id); setPage(0); setHistory(null); }}>URL history</button>
              <button className={button} onClick={() => { if (latest) setLogRun(latest.id); }} disabled={!latest}>Scan logs</button>
              <button className={`${button} text-red-200`} disabled={busy} onClick={() => setArchive(site)}>Remove</button>
            </div>
            {view === "websites" && <details><summary className="cursor-pointer text-sm text-[#a6acbd]">Discovery sources ({site.sources.length})</summary><ul className="mt-2 max-h-64 space-y-2 overflow-auto text-xs">{site.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer" className="break-all underline">{source.url}</a><p className="text-[#a6acbd]">{label(source.kind)} · {label(source.status)}{source.error ? ` · ${source.error}` : ""}</p></li>)}</ul></details>}
            </div></details>
          </article>;
        })}</div>
        {snapshot.runs.some(run => ["running", "queued", "paused"].includes(run.status)) && <section className="studio-panel rounded-2xl border p-5"><h2 className="mb-3 text-lg">Scan progress</h2><div className="space-y-4">{snapshot.runs.filter(run => ["running", "queued", "paused"].includes(run.status)).map(runCard)}</div></section>}
        {!!snapshot.runs.length && <details className="rounded-xl border border-[#424a60]/70 p-4"><summary className="cursor-pointer text-sm text-[#a6acbd]">Previous scans and logs</summary><div className="mt-4 space-y-4">{snapshot.runs.filter(run => !["running", "queued", "paused"].includes(run.status)).slice(0, 20).map(runCard)}</div></details>}
      </>}
      {view === "settings" && <div className="studio-panel space-y-5 rounded-2xl border p-6">
        <div><h2 className="text-lg">Local storage</h2><p className="mt-2 break-all font-mono text-sm text-[#deb589]">{snapshot.settings.root}</p><p className="mt-2 text-sm text-[#a6acbd]">Your database, backups, and scan history live here. Choose storage during launcher setup. Changing folders opens a separate local workspace; it does not erase the previous folder.</p></div>
        <details><summary className="cursor-pointer text-sm">Storage maintenance and timezone</summary><div className="mt-4 space-y-4"><form className="max-w-md space-y-2" onSubmit={event => { event.preventDefault(); void act(() => request("settings", "PATCH", { timezone }), "Reporting timezone saved."); }}><label className="text-sm" htmlFor="ri-timezone">Reporting timezone</label><input id="ri-timezone" className={input} value={timezone} onChange={event => setTimezone(event.target.value)} /><button className={button} disabled={busy}>Save timezone</button></form>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void act(async () => { const result = await request<{ file: string }>("backup", "POST"); setNotice(`Backup saved in the backups folder: ${result.file}`); })}>Back up database</button><button className={button} disabled={busy} onClick={() => void act(async () => { const result = await request<{ result: string }>("integrity", "POST"); setNotice(`Database integrity: ${result.result}`); })}>Check database</button><button className={button} onClick={() => setLogRun("")}>All scan logs</button></div>
        </div></details><p className="text-sm text-[#a6acbd]">Discovery and reports use no AI provider. Content processing starts only after an explicit batch cost approval.</p>
      </div>}
      {historySite && <section className="studio-panel rounded-2xl border p-5" aria-label="Discovered URL history"><div className="flex justify-between gap-3"><h2 className="text-lg">URL history · {snapshot.sites.find(site => site.id === historySite)?.name}</h2><button className={button} onClick={() => setHistorySite("")}>Close history</button></div>
        <p className="my-3 text-sm text-[#a6acbd]">{history?.total.toLocaleString() ?? "Loading"} URLs. Feed dates and sitemap modification dates are source evidence. Open Find recipes for article-verified publication dates.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[#424a60]"><th className="p-2">Title / URL</th><th className="p-2">First seen</th><th className="p-2">Sources</th><th className="p-2">Origin / evidence</th></tr></thead><tbody>{history?.rows.map(row => <tr key={row.id} className="border-b border-[#424a60]/50 align-top"><td className="max-w-md p-2"><a href={row.canonical_url} target="_blank" rel="noreferrer" className="break-all text-[#deb589] underline">{row.title || row.canonical_url}</a></td><td className="whitespace-nowrap p-2 text-xs">{date(row.first_seen_at)}</td><td className="p-2 text-xs">{row.sources}</td><td className="p-2 text-xs"><span>{label(row.origin)}</span><details className="mt-1"><summary className="cursor-pointer">Unverified source evidence</summary><pre className="mt-2 max-w-sm whitespace-pre-wrap break-all text-[#a6acbd]">{JSON.stringify(JSON.parse(row.evidence || "{}"), null, 2)}</pre></details></td></tr>)}</tbody></table></div>
        <div className="mt-3 flex items-center gap-3"><button className={button} disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span className="text-sm">Page {page + 1}</span><button className={button} disabled={!history || (page + 1) * 50 >= history.total} onClick={() => setPage(value => value + 1)}>Next</button></div>
      </section>}
      {logRun !== null && <section className="studio-panel rounded-2xl border p-5" aria-label="Monitoring logs"><div className="flex justify-between"><h2 className="text-lg">Scan logs</h2><button className={button} onClick={() => setLogRun(null)}>Close logs</button></div><ul className="mt-3 max-h-96 space-y-3 overflow-auto text-sm">{events.map(event => <li key={event.id}><span className={event.level === "error" ? "text-red-200" : "text-[#a6acbd]"}>{date(event.at)} · {event.level}</span><p>{event.message}</p>{event.url && <a className="break-all text-xs text-[#deb589] underline" href={event.url} target="_blank" rel="noreferrer">{event.url}</a>}</li>)}</ul></section>}
    </>}
    {archive && <div role="dialog" aria-modal="true" aria-labelledby="ri-archive-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5"><div className="studio-panel max-w-md space-y-4 rounded-2xl border p-6"><h2 id="ri-archive-title" className="text-lg">Remove {archive.name}?</h2><p className="text-sm text-[#a6acbd]">This archives the website and cancels its pending scans. Saved URL history stays on this PC and returns if you add the website again.</p><div className="flex gap-2"><button autoFocus className={button} disabled={busy} onClick={() => setArchive(null)}>Keep website</button><button className={button} disabled={busy} onClick={() => void act(async () => { await request(`sites/${archive.id}`, "DELETE", { confirmed: true }); setArchive(null); setHistorySite(""); })}>Remove website</button></div></div></div>}
  </section>;
}
