"use client";
import { useEffect, useState } from "react";
const button = "rounded-lg border border-gray-200 bg-purple-600 px-3 py-2 text-sm disabled:opacity-40 ui-secondary";
const primary = `${button} !border-blue-600 !bg-blue-600 !text-white font-medium ui-primary`;
const money = (n: number) => `$${(n || 0).toFixed(2)}`;
type Props = { snapshot: any; request: (route: string, method?: string, data?: any) => Promise<any>; refresh: () => Promise<any>; open: (row: any) => void; navigate: (view: string) => void };

export function RecipeLibrary({ snapshot, request, refresh, open, navigate }: Props) {
  const [data, setData] = useState<any>(null), [page, setPage] = useState(0), [search, setSearch] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(""), [limits, setLimits] = useState<Record<string, string>>({});
  useEffect(() => {
    let valid = true;
    void request(`library?page=${page}&search=${encodeURIComponent(search)}`).then(d => { if (valid) { setData(d); setError(""); } }).catch(e => { if (valid) setError(e.message); });
    return () => { valid = false; };
  }, [snapshot, page, search, request]);
  const generate = async (row: any) => {
    setBusy(row.id); setError("");
    try {
      await request(`items/${row.id}/approve-generation`, "POST", { limit: Number(limits[row.id] ?? row.suggestedLimit), quoteVersion: row.quoteVersion });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start generation."); }
    finally { setBusy(""); }
  };
  const status = (r: any) => r.canApprove ? 'Ready to generate' : r.state === 'completed' ? 'Ready' : r.state === 'preparing' || r.state === 'photo_selection' ? 'Review photos' : r.state === 'review' ? 'Needs your review' : r.state === 'budget_wait' ? 'Budget reached' : r.currentStage?.startsWith('photo:') ? 'Creating images' : r.currentStage?.startsWith('analysis:') ? 'Reading photos' : r.currentStage ? `Working: ${r.currentStage.replaceAll('_', ' ')}` : r.state.replaceAll('_', ' ');
  return <section className="space-y-4" aria-label="Article library">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">My articles</h2><p className="mt-1 text-sm text-gray-600">{data ? `${data.total} article${data.total === 1 ? '' : 's'}` : 'Loading your articles…'}</p></div><div className="flex flex-wrap gap-2"><button className={button} onClick={() => navigate('reports')}>Choose from a report</button><button className={primary} onClick={() => navigate('start')}>Add a recipe</button></div></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><input aria-label="Search articles" placeholder="Search articles…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm sm:max-w-xs" /><div className="flex items-center gap-3 text-sm"><button className={button} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page + 1}</span><button className={button} disabled={!data || (page + 1) * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>Next</button></div></div>
    {error && <p role="alert" className="rounded-lg border border-red-400/40 p-3 text-sm text-red-700">{error}</p>}
    {data?.rows.length === 0 && <p className="rounded-xl border border-gray-200 p-8 text-center text-gray-600">{search ? 'No articles match your search.' : 'Add a recipe URL or choose recipes from a report to get started.'}</p>}
    <div className="space-y-3">{data?.rows.map((row: any) => {
      const photos = row.photos.filter((p: any) => p.state !== 'skipped');
      const generated = row.files.filter((f: any) => f.media_type.startsWith('image/'));
      const originals = photos.slice(0, 3);
      const edited = photos.length ? photos.flatMap((p: any) => { const f = ['webp','jpg','jpeg','png'].map(ext => generated.find((f: any) => f.name === `photo-${p.referenceId}.${ext}`)).find(Boolean); return f ? [f] : []; }) : generated.filter((f: any, i: number) => generated.findIndex((other: any) => other.name.replace(/\.(webp|jpe?g|png)$/i, '') === f.name.replace(/\.(webp|jpe?g|png)$/i, '')) === i);
      const hasArticle = row.files.some((f: any) => f.name === 'article.html');
      const limit = limits[row.id] ?? String(row.suggestedLimit);
      return <article key={row.id} className="grid items-center gap-4 rounded-xl border border-gray-200/70 bg-white p-4 lg:grid-cols-[minmax(190px,1.2fr)_minmax(160px,1fr)_minmax(160px,1fr)_220px]" aria-label={`Article: ${row.title}`}>
        <div className="min-w-0 space-y-2"><h3 className="font-semibold leading-snug">{row.title}</h3><p className="text-xs text-gray-600">{new Date(row.createdAt).toLocaleDateString()}</p><p className={`text-sm ${row.state === 'completed' ? 'text-green-700' : ['failed','uncertain'].includes(row.state) ? 'text-red-700' : ['review','preparing','photo_selection','budget_wait'].includes(row.state) ? 'text-amber-700' : 'text-blue-700'}`}>{status(row)}</p><div className="flex flex-wrap gap-2"><button className={button} onClick={() => open(row)}>{hasArticle ? 'Open article' : 'Details'}</button>{hasArticle && <a className={button} href={`/api/recipe-intelligence/items/${row.id}/zip`}>Download</a>}</div></div>
        <div className="space-y-2"><p className="text-xs text-gray-600">Originals · reference only</p><div className="flex gap-2">{originals.map((p: any) => <button key={p.referenceId} onClick={() => open(row)} aria-label={`View original photo ${p.position + 1} for ${row.title}`} className="min-w-0 flex-1"><img src={`/api/recipe-intelligence/references/${p.referenceId}`} alt="Original recipe reference" className="h-20 w-full rounded-lg object-cover" loading="lazy" /></button>)}{!originals.length && <p className="text-sm text-gray-600">{row.approved ? 'Text-based images' : 'Preparing photos…'}</p>}</div>{photos.length > 3 && <button className="text-xs text-blue-700" onClick={() => open(row)}>View all {photos.length} photos</button>}</div>
        <div className="space-y-2"><p className="text-xs text-gray-600">Generated · {edited.length} ready</p><div className="flex gap-2">{edited.slice(0, 3).map((f: any) => <a key={f.id} href={`/api/recipe-intelligence/artifacts/${f.id}?preview=1`} target="_blank" rel="noreferrer" className="min-w-0 flex-1"><img src={`/api/recipe-intelligence/artifacts/${f.id}?preview=1`} alt={`Generated image for ${row.title}`} className="h-20 w-full rounded-lg object-cover" loading="lazy" /></a>)}{!edited.length && <p className="py-4 text-sm text-gray-600">{row.approved ? 'Images appear here as they finish.' : 'Ready after generation'}</p>}</div></div>
        <div className="space-y-2 lg:border-l lg:border-gray-200 lg:pl-4"><p className="text-sm text-gray-600">{row.approved ? 'Spent on this article' : 'Estimated generation cost'}</p><p className="text-xl font-semibold">{row.approved ? `$${row.actual.toFixed(4)}` : row.canApprove ? money(row.estimated) : 'Preparing…'}</p>{row.held > 0 && <p className="text-xs text-amber-700">{money(row.held)} reserved</p>}
          {row.canApprove ? <><p className="text-xs text-gray-600">Maximum {money(Number(limit))} · actual usage may vary</p><button className={`${primary} w-full`} disabled={!!busy || !Number.isFinite(Number(limit)) || Number(limit) < .01 || Number(limit) > 1000} onClick={() => void generate(row)}>{busy === row.id ? 'Starting…' : 'Approve & Generate'}</button><details className="text-xs"><summary className="cursor-pointer text-gray-600">More</summary><label className="mt-2 block">Maximum spend (USD)<input aria-label={`Maximum spend for ${row.title}`} type="number" min="0.01" max="1000" step="0.01" className="mt-1 w-full rounded border border-gray-200 bg-white p-2" value={limit} onChange={e => setLimits(old => ({ ...old, [row.id]: e.target.value }))} /></label></details></> : <button className={`${button} w-full`} onClick={() => open(row)}>{row.state === 'completed' ? 'Images & WordPress' : ['review','preparing','photo_selection','budget_wait','awaiting_item_approval'].includes(row.state) ? 'Review & continue' : 'View progress'}</button>}
        </div>
      </article>;
    })}</div>
  </section>;
}
