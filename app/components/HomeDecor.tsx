"use client";
import { ArticleStorage } from "./ArticleStorage";
import { WorkspaceError } from "./WorkspaceError";
import { VerifiedImage } from "./VerifiedImage";
import { sendToPinStudio } from '@/lib/pinterestDesign';
import { useEffect, useState } from 'react';

const button = 'rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed';
const primary = `${button} !bg-blue-600`;
const field = 'w-full rounded-xl border border-gray-300 bg-white p-3 text-sm text-gray-900';
const panel = 'rounded-2xl border border-gray-200 bg-white p-5 space-y-4';
async function request(path = '', method = 'GET', data?: any) {
  const response = await fetch(`/api/recipe-intelligence/${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Recipe-Intelligence': '1' }) }, ...(method === 'GET' ? {} : { body: JSON.stringify(data || {}) }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed.'); return result;
}
const money = (n: number) => `$${(n || 0).toFixed(4)}`;
export function HomeDecor({ active }: { active: boolean }) {
  const [jobs, setJobs] = useState<any[]>([]), [current, setCurrent] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [url, setUrl] = useState(''), [text, setText] = useState(''), [online, setOnline] = useState(true), [connected, setConnected] = useState(false), [archived, setArchived] = useState(false);
  const [deleting, setDeleting] = useState<any>(null);
  useEffect(() => {
    if (!active) return;
    const openCaptured = () => { const id = new URLSearchParams(window.location.search).get('decorId'); if (id && /^[a-f0-9-]{36}$/i.test(id)) setCurrent(id); };
    openCaptured(); window.addEventListener('popstate', openCaptured);
    return () => window.removeEventListener('popstate', openCaptured);
  }, [active]);
  useEffect(() => { const cleared = () => { setJobs([]); setCurrent(''); setDeleting(null); }; window.addEventListener('article-library-cleared', cleared); return () => window.removeEventListener('article-library-cleared', cleared); }, []);
  async function reload() { const data = await request('decor'); setJobs(data.jobs); setOnline(data.worker?.online !== false); setConnected(true); setConnectionError(''); }
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async () => { try {
      const location = new URL(window.location.href), fragment = new URLSearchParams(location.hash.slice(1)), key = fragment.get('ri-token');
      if (key) {
        const response = await fetch('/api/recipe-intelligence/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Recipe-Intelligence': '1', 'X-RI-Key': key }, body: '{}' });
        if (!response.ok) throw new Error('Open the workspace from its launcher to connect.');
        fragment.delete('ri-token'); location.hash = fragment.toString(); window.history.replaceState(null, '', location);
      }
      const data = await request('decor'); if (cancelled) return;
      setJobs(data.jobs); setOnline(data.worker?.online !== false); setConnected(true); setConnectionError('');
    } catch (e) { if (!cancelled) { setConnected(false); setConnectionError(e instanceof Error ? e.message : 'Could not connect.'); } } };
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active]);
  async function act(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); await reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Operation failed.'); } finally { setBusy(false); } }
  if (!active) return null;
  const job = jobs.find(j => j.id === current);
  return <div className="space-y-5 text-gray-900">

    <section className={panel}><h1 className="font-serif text-3xl">Home &amp; Decor</h1><p>Import an article, choose its original reference photos, review the cost, then create your article and images.</p><p className="text-sm text-gray-600">Using the Chrome extension? Choose <strong>Home &amp; Decor</strong> in its “Save article to” menu. <a className="text-blue-700 underline" href="/api/recipe-capture-extension" download>Download the updated extension</a> (v2.8.0 or newer), replace its files and reload it in Chrome.</p></section>
    {connected && <ArticleStorage compact />}
    {(error || connectionError) && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800"><WorkspaceError message={error || connectionError} /> {connectionError && <button className={button} onClick={() => void act(reload)}>Reconnect</button>}</div>}
    {!online && <p role="status" className="rounded-xl bg-amber-50 p-4">The local worker is offline. Open the workspace launcher to continue queued work.</p>}
    <section className={panel}><h2 className="text-xl font-semibold">Start with an article</h2><form className="space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => { const created = await request('decor', 'POST', { url, ...(text.trim() ? { text } : {}) }); setCurrent(created.id); setUrl(''); setText(''); }); }}>
      <label className="block">Article URL<input className={field} type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/living-room-ideas/" /></label>
      <details><summary className="cursor-pointer text-sm">Website blocks import? Paste the article text</summary><label className="block mt-3 text-sm">Start with its title, followed by the article. Upload the original photos after importing.<textarea className={field} rows={6} minLength={300} maxLength={40000} value={text} onChange={e => setText(e.target.value)} /></label></details>
      <button className={primary} disabled={busy || !connected}>Import article — free</button>
    </form></section>
    <section className={panel}><div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">My decor articles</h2><button className={button} onClick={() => setArchived(!archived)}>{archived ? 'Active articles' : 'Archived articles'}</button></div>
      {!jobs.filter(j => !!j.archived === archived).length && <p className="text-gray-600">No articles here yet.</p>}
      {jobs.filter(j => !!j.archived === archived).map(j => <article key={j.id} className="rounded-xl border border-gray-200 p-4 space-y-3"><div className="flex justify-between gap-4"><h3 className="font-semibold">{j.article?.title || j.source.title}</h3><span className="text-sm">{j.state.replaceAll('_', ' ')}</span></div><p className="text-sm text-gray-600">Spent: ${Number(j.actual || 0).toFixed(2)}{j.held > 0 ? ` · Reserved / unconfirmed: ${money(j.held)}` : ''}</p><div className="flex flex-wrap gap-2"><button className={primary} onClick={() => setCurrent(j.id)}>{j.state === 'review' ? 'Choose photos & estimate' : 'Open article & images'}</button><details><summary className="cursor-pointer px-3 py-2 text-sm text-gray-600">More actions</summary><div className="mt-2 flex flex-wrap gap-2">{j.article && <><a className={button} href={`/api/recipe-intelligence/decor/${j.id}/preview`} target="_blank" rel="noopener noreferrer">View article</a><a className={button} href={`/api/recipe-intelligence/decor/${j.id}/zip`}>Download article &amp; images</a></>}<button className={button} disabled={busy || ['queued','running','importing','import_queued','capturing'].includes(j.state)} onClick={() => void act(async () => { await request(`decor/${j.id}/archive`, 'POST', { archived: !j.archived }); })}>{j.archived ? 'Restore' : 'Archive'}</button><button className="rounded-xl border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-40" disabled={busy || ['queued','running','importing'].includes(j.state)} onClick={() => setDeleting(j)}>Delete</button></div></details></div></article>)}
    </section>
    {job && <section className={panel}><div className="flex justify-between"><h2 className="text-xl font-semibold">{job.source.title}</h2><button className={button} onClick={() => setCurrent('')}>Close</button></div>
      <a className="text-sm text-blue-700 underline" href={job.source.url} target="_blank" rel="noopener noreferrer">Visit original article</a>
      {job.error && <p role="alert" className="text-red-700">{job.error}</p>}
      {job.state === 'uncertain' && <p className="text-amber-800">A request was interrupted. Saved results and billing records are kept; it will not repeat automatically.</p>}
      {['import_queued','importing'].includes(job.state) && <p role="status">Reading the article and downloading reference candidates. No paid generation has started.</p>}
      {job.state === 'capturing' && <p role="status">Receiving this article and its selected photos from Chrome. Keep the extension tab open, or use Resume previous import there. No paid generation has started.</p>}
      {job.warnings?.length > 0 && <details><summary>Import notes ({job.warnings.length})</summary>{job.warnings.map((w: string, i: number) => <p key={i} className="text-sm">{w}</p>)}</details>}
      <details><summary className="cursor-pointer">Imported article text</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{job.source.text}</pre></details>
      {job.state === 'review' && <PhotoSelection key={job.id} job={job} busy={busy} act={act} />}
      {['queued','running'].includes(job.state) && <p role="status">{job.article ? 'Article saved. Creating the selected reference images…' : 'Writing the article and planning its selected images…'} You can leave this tab; the workspace worker continues.</p>}
      {job.article && <><div className="flex gap-3"><a className={primary} href={`/api/recipe-intelligence/decor/${job.id}/preview`} target="_blank" rel="noopener noreferrer">View article</a><a className={button} href={`/api/recipe-intelligence/decor/${job.id}/zip`}>Download ZIP</a></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{job.photos.filter((p: any) => p.selected).map((p: any) => <LinkedDecorPhoto key={p.id} job={job} photo={p} busy={busy} act={act} />)}</div>{job.article.notes?.length > 0 && <details><summary>Private editorial notes</summary>{job.article.notes.map((n: string, i: number) => <p key={i}>{n}</p>)}</details>}<p className="text-sm text-gray-600">Download includes the HTML article and generated images only. Import it into your editor; direct WordPress publishing for decor is not connected yet.</p></>}
    </section>}
    {deleting && <div role="dialog" aria-modal="true" aria-label="Delete decor article" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6"><div className={panel}><h2 className="text-xl">Delete {deleting.source.title}?</h2><p>This permanently removes this workspace article, reference photos and generated files. Download them first if needed.</p><div className="flex gap-3"><button className={button} onClick={() => setDeleting(null)}>Keep article</button><button className={primary} disabled={busy} onClick={() => void act(async () => { await request(`decor/${deleting.id}`, 'DELETE', { confirmed: true }); if (current === deleting.id) setCurrent(''); setDeleting(null); })}>Delete permanently</button></div></div></div>}
  </div>;
}
function LinkedDecorPhoto({ job, photo: p, busy, act }: { job: any; photo: any; busy: boolean; act: (fn: () => Promise<void>) => Promise<void> }) {
  const plan = job.article.imagePlans.find((item: any) => item.id === p.id);
  const section = plan?.sectionId ? job.article.sections.find((item: any) => item.id === plan.sectionId) : job.article.sections[plan?.section];
  const heading = section?.heading || job.article.title;
  const [verified,setVerified]=useState(false);
  const pending = ['queued','running','importing','import_queued','capturing'].includes(job.state);
  return <div className="rounded-xl border p-3 space-y-2">
    <p className="text-sm font-medium">Linked heading: {heading}</p>
    <p className="text-xs text-gray-600">{p.group} · {p.caption || 'Reference photo'}</p>
    {p.excluded ? <p className="text-sm text-gray-600">Image removed from article. Its heading and paragraphs are kept.</p> : p.outputUrl ? <VerifiedImage source={p.outputUrl} onVerified={()=>setVerified(true)} alt={plan?.alt || 'Generated decor'} className="w-full rounded-lg" /> : <p className="text-sm text-amber-800">{p.error || (p.phase === 'preparing' ? 'Preparing image…' : 'Generating image…')}</p>}
    {verified && p.outputUrl && !p.excluded && <button className={button} onClick={()=>{
      const photos=job.photos.filter((v:any)=>v.selected&&!v.excluded&&v.outputUrl).map((v:any)=>({url:v.outputUrl,label:job.article.imagePlans.find((i:any)=>i.id===v.id)?.alt||v.caption||'Article photo'}));
      const text=[heading,...(section?.paragraphs||[]),job.article.introduction,...job.article.sections.flatMap((s:any)=>[s.heading,...s.paragraphs])].join('\n\n');
      sendToPinStudio({title:job.article.title,text:text.slice(0,40000),link:'',photos,first:Math.max(0,photos.findIndex((v:any)=>v.url===p.outputUrl))});
    }}>Send to Pinterest Design</button>}
    {p.preparationId && !p.excluded && <button className={button} disabled={busy || pending} onClick={() => void act(() => request(`decor/${job.id}/retry-image`, 'POST', {photoId:p.id}))}>Retry</button>}
    <button className={p.excluded ? button : 'rounded-xl border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-40'} disabled={busy || pending} onClick={() => void act(() => request(`decor/${job.id}/image-inclusion`, 'POST', {photoId:p.id, included:!!p.excluded}))}>{p.excluded ? 'Restore image' : 'Remove from article'}</button>
    <details><summary className="text-sm">Original reference</summary><img src={p.originalUrl} alt={p.caption} className="w-full" /></details>
  </div>;
}
function PhotoSelection({ job, busy, act }: { job: any; busy: boolean; act: (fn: () => Promise<void>) => Promise<void> }) {
  const [selected, setSelected] = useState<Record<string, boolean>>(Object.fromEntries(job.photos.map((p: any) => [p.id, p.selected])));
  const [groups, setGroups] = useState<Record<string, string>>(Object.fromEntries(job.photos.map((p: any) => [p.id, p.group])));
  const [brief, setBrief] = useState(job.brief), [dirty, setDirty] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const linkedSection = (p: any) => links[p.id] ?? p.sourceSectionId ?? (job.source.sections?.length ? '' : 'auto');
  const count = job.photos.filter((p: any) => selected[p.id]).length;
  const validLinks = new Set(['article-title', ...(!job.source.sections?.length ? ['auto'] : []), ...(job.source.sections || []).map((s: any) => s.id)]);
  const missingLink = job.photos.some((p: any) => selected[p.id] && !validLinks.has(linkedSection(p)));
  return <div className="space-y-4"><h3 className="text-lg font-semibold">1. Choose original reference photos</h3><p className="text-sm">Select up to 12 photos. Unchecked images are not generated or included. Their headings and paragraphs stay in the article. Check the linked heading below each photo. Use the same room group for views of one room; use different groups for separate inspiration rooms. No photos selected means article only.</p>
    <label className="block text-sm">Upload original photos<input className={field} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; setDirty(true); void act(async () => { for (const file of files) { const response = await fetch(`/api/recipe-intelligence/decor/${job.id}/upload`, { method: 'POST', headers: { 'Content-Type': file.type, 'X-Recipe-Intelligence': '1', 'X-Photo-Caption': encodeURIComponent(file.name) }, body: file }); const result = await response.json(); if (!response.ok) throw new Error(result.error); } }); }} /></label>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{job.photos.map((p: any, i: number) => <div key={p.id} className={`rounded-xl border p-3 space-y-3 ${selected[p.id] ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}><label className="block cursor-pointer"><img className="h-44 w-full rounded-lg object-contain" src={p.originalUrl} alt={p.caption || `Original photo ${i + 1}`} /><span className="mt-3 flex items-start gap-2"><input type="checkbox" checked={!!selected[p.id]} disabled={busy} onChange={e => { setSelected({ ...selected, [p.id]: e.target.checked }); setDirty(true); }} /><span className="text-sm">{p.caption || `Photo ${i + 1}`}</span></span></label><label className="block text-xs">Linked article heading<select className={field} value={linkedSection(p)} disabled={busy} onChange={e => { setLinks({ ...links, [p.id]: e.target.value }); setDirty(true); }}><option value="" disabled>Choose the matching heading</option>{!job.source.sections?.length && <option value="auto">Match to a heading during writing</option>}<option value="article-title">Article title · {job.source.title}</option>{(job.source.sections || []).map((s: any) => <option key={s.id} value={s.id}>{s.heading}</option>)}</select></label><label className="block text-xs">Room group<input className={field} value={groups[p.id] || p.group} maxLength={40} disabled={busy} onChange={e => { setGroups({ ...groups, [p.id]: e.target.value }); setDirty(true); }} /></label></div>)}</div>
    <label className="block text-sm">Shared design direction<textarea className={field} rows={3} value={brief} maxLength={2000} disabled={busy} onChange={e => { setBrief(e.target.value); setDirty(true); }} /></label>
    <details className="text-sm"><summary className="cursor-pointer text-gray-600">Supported images</summary><p className="mt-2">Kitchen design images use local editable Blender models and are excluded from this paid image workflow.</p></details>
    <button className={primary} disabled={busy || count > 12 || missingLink} onClick={() => void act(async () => { await request(`decor/${job.id}/selection`, 'POST', { brief, photos: job.photos.filter((p: any) => selected[p.id]).map((p: any) => ({ id: p.id, group: groups[p.id] || p.group, ...(linkedSection(p) === 'auto' ? {} : { sourceSectionId: linkedSection(p) }) })) }); setDirty(false); })}>Confirm {count} photos &amp; show estimate</button>
    {job.quote && !dirty && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3"><h3 className="font-semibold">2. Review cost and generate</h3><p>Estimated: <strong>{money(job.quote.estimated)}</strong> · Approved budget: <strong>{money(job.quote.limit)}</strong></p><details className="text-sm"><summary className="cursor-pointer text-gray-600">Generation details</summary><p className="mt-2">{job.settings.textModel} · {count ? `${job.settings.imageModel} · ${count} reference edits` : 'Article only'}. Actual usage may vary. Irrelevant references identified during writing are skipped.</p></details><details className="text-xs"><summary>Estimate details</summary>{job.quote.lines.map((l: any) => <p key={l.stage}>{l.stage === 'article' ? 'Article and reference understanding' : 'Reference image'}: {money(l.estimated)} — {l.basis}</p>)}</details><button className={primary} disabled={busy} onClick={() => void act(async () => { await request(`decor/${job.id}/approve`, 'POST', { version: job.quote.version }); })}>Approve {money(job.quote.limit)} &amp; Generate</button></div>}
  </div>;
}
