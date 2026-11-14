"use client";
import { useEffect, useRef, useState } from 'react';
import { StorageMeter } from './StorageMeter';
import type { DiskStorage } from '../../lib/recipe-intelligence/diskStorage';
type Summary = { total: number; recipes: number; decor: number; active: number; archived: number };
type Preview = Summary & { revision: string; fileCount: number; bytes: number };
async function request(route = '', method = 'GET', body?: unknown) {
  const response = await fetch(`/api/recipe-intelligence/article-storage${route}`, { method, credentials: 'same-origin', cache: 'no-store',
    ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json', 'X-Recipe-Intelligence': '1' }, body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not update article storage.'); return data;
}
const button = 'rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed';
export function ArticleStorage({ readOnly = false, compact = false }: { readOnly?: boolean; compact?: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [storage, setStorage] = useState<DiskStorage | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const openButton = useRef<HTMLButtonElement>(null), cancelButton = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let mounted = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try { const value = await request(); if (mounted && Number.isInteger(value.total)) { setSummary(value); setStorage(value.storage || { status: 'unavailable' }); } }
      catch { if (mounted) setStorage({ status: 'unavailable' }); /* Keep the last article count while reconnecting. */ }
      finally { loading = false; }
    };
    void load(); const timer = setInterval(() => void load(), 5000); window.addEventListener('article-library-cleared', load);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener('article-library-cleared', load); };
  }, []);
  useEffect(() => { if (preview) cancelButton.current?.focus(); }, [!!preview]);
  const close = () => { if (!busy) { setPreview(null); setConfirmed(false); openButton.current?.focus(); } };
  async function review() {
    setBusy(true); setError(''); setNotice(''); setConfirmed(false);
    try { const value = await request('/preview'); setPreview(value); setSummary(value); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function clear() {
    if (!confirmed || !preview || busy) return;
    setBusy(true); setError('');
    try {
      const result = await request('', 'DELETE', { confirmed: true, revision: preview.revision });
      setSummary(result); setPreview(null); setConfirmed(false);
      setNotice('All workspace articles and their images were deleted. Your app and settings are ready for a fresh start.');
      window.dispatchEvent(new Event('article-library-cleared')); openButton.current?.focus();
    } catch (e) { setError((e as Error).message); setConfirmed(false); setPreview(null); }
    finally { setBusy(false); }
  }
  if (compact) return storage?.status === 'available' && storage.usedPercent >= 80 ? <aside role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">Storage is {Math.floor(storage.usedPercent)}% full. <a className="underline" href="/?tab=recipe-intelligence&view=settings">Manage storage in Settings</a></aside> : null;
  return <section aria-label="Article storage" className="rounded-2xl border border-gray-200 bg-white p-5 text-gray-900 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-4"><div>
      <h2 className="text-lg font-semibold">Stored articles <span className="ml-2 rounded-lg bg-blue-50 px-3 py-1 text-blue-700" aria-live="polite">{summary?.total ?? '…'}</span></h2>
      <p className="mt-2 text-sm text-gray-600">{summary ? `${summary.recipes} recipes · ${summary.decor} decor · ${summary.active} active · ${summary.archived} archived` : 'Loading saved article count…'}</p>
      <p className="mt-1 text-xs text-gray-500">Includes drafts and archived articles across Recipes and Home &amp; Decor.</p>
    </div><button ref={openButton} className={`${button} border-red-300 text-red-700 hover:bg-red-50`} disabled={readOnly || busy || !summary || (summary.total === 0 && !error)} onClick={() => void review()}>{busy ? 'Working…' : error ? 'Retry deleting all articles' : 'Delete all articles'}</button></div>
    <StorageMeter storage={storage} />
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    {preview && <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/50 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="clear-articles-title" className="w-full max-w-xl rounded-2xl bg-white p-6 space-y-4 shadow-xl" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || []), first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <h2 id="clear-articles-title" className="text-xl font-semibold">Delete all {preview.total} articles and their images?</h2>
      <p>This permanently removes every recipe and decor article, including drafts and archived articles, their reference photos, generated images and old versions from this workspace.</p>
      <p className="text-sm text-gray-600">{preview.fileCount} saved files · approximately {(preview.bytes / 1_000_000).toFixed(1)} MB to remove.</p>
      <p className="rounded-xl bg-blue-50 p-3 text-sm">Your application, API keys, settings, tracked websites, search reports and existing backups are kept. Posts and media already sent to WordPress are not deleted.</p>
      <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I understand. Delete all workspace articles and their images.</span></label>
      <div className="flex flex-wrap justify-end gap-3"><button ref={cancelButton} className={`${button} border-gray-300`} disabled={busy} onClick={close}>Keep my articles</button><button className={`${button} border-red-700 bg-red-700 text-white`} disabled={!confirmed || busy} onClick={() => void clear()}>{busy ? 'Deleting…' : 'Delete all permanently'}</button></div>
    </div></div>}
  </section>;
}
