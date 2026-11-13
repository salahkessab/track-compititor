"use client";
import { useEffect, useState } from 'react';

const button = 'rounded-xl border border-gray-200 bg-purple-600 px-3 py-2 text-sm text-white disabled:opacity-40 ui-secondary';
type RequestFn = <T = any>(route: string, method?: string, data?: unknown) => Promise<T>;
export function RecipeInternalLinks({ itemId, target, request, disabled, onChanged, onBusy }: { itemId: string; target: string; request: RequestFn; disabled: boolean; onChanged: () => void; onBusy: (busy: boolean) => void }) {
  const [state, setState] = useState<any>(null), [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(false), [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setState(null); setSelected([]); setPreview(false); setError(''); setNotice('');
    if (target) request(`items/${itemId}/internal-links?connectionId=${encodeURIComponent(target)}`).then(s => { if (active) { setState(s); setSelected(s.selected); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [itemId, target, request]);
  async function run(action: 'sync' | 'suggest' | 'apply') {
    setBusy(true); onBusy(true); setError(''); setNotice('');
    try {
      if (action === 'sync') {
        const c = await request(`wordpress/${target}/articles-sync`, 'POST', {});
        setNotice(`${c.count} published articles synced. Request suggestions to use the updated catalogue.`);
        setState(await request(`items/${itemId}/internal-links?connectionId=${encodeURIComponent(target)}`)); setSelected([]); setPreview(false); onChanged();
      } else {
        const s = await request(`items/${itemId}/internal-links`, 'POST', { action, connectionId: target, contentVersion: state?.contentVersion, selected });
        setState(s); setSelected(s.selected); onChanged(); setVersion(v => v + 1);
        if (action === 'apply') { setPreview(true); setNotice('Selected links applied. Review the article below before preparing your WordPress post.'); }
        else setNotice(s.suggestions.length ? 'Choose the links you want, then Apply selected.' : 'No sufficiently related articles found. No links were added.');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Internal links could not be updated.'); }
    finally { setBusy(false); onBusy(false); }
  }
  if (!target) return null;
  return <section className="space-y-3 border-t border-gray-200 pt-3" aria-label="Internal links">
    <div className="flex flex-wrap items-center gap-2"><button className={button} disabled={disabled || busy} onClick={() => void run('suggest')}>Suggest internal links</button><button className={button} disabled={disabled || busy} onClick={() => void run('sync')}>Sync articles</button><span className="text-xs text-gray-600">{busy ? 'Working…' : 'No AI calls or generation cost'}</span></div>
    {state?.syncedAt && <p className="text-xs text-gray-600">{state.count} published articles · Synced {new Date(state.syncedAt).toLocaleString()}</p>}
    {state?.stale && <p className="text-sm text-amber-700">The article, website or catalogue changed. Request fresh suggestions.</p>}
    {!!state?.suggestions?.length && <div className="space-y-2">{state.suggestions.map((s: any) => <label key={s.id} className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm"><input type="checkbox" disabled={disabled || busy} checked={selected.includes(s.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))} /><span className="min-w-0 space-y-1"><strong className="block">{s.title}</strong><a className="block break-all text-blue-700 underline" href={s.url} target="_blank" rel="noreferrer">{s.url}</a><span className="block text-gray-600">{s.reason}</span><span className="block">{s.sentence}</span><span className="block text-xs text-gray-600">{s.paragraph ? 'Link in this existing paragraph' : 'Added under Related recipes at the end'}</span></span></label>)}<button className={button} disabled={disabled || busy} onClick={() => void run('apply')}>Apply selected ({selected.length})</button></div>}
    {state?.applied && !preview && <button className={button} onClick={() => setPreview(true)}>Preview article with links</button>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}{error && <p role="alert" className="text-sm text-red-700">{error} <a className="underline" href="/api/recipe-wordpress-plugin">Download updated plugin</a></p>}
    {preview && <div className="space-y-2"><button className={button} onClick={() => setPreview(false)}>Close link preview</button><iframe key={version} title="Article with approved internal links" sandbox="" className="h-[65vh] w-full rounded-xl bg-white" src={`/api/recipe-intelligence/items/${itemId}/internal-link-preview?connectionId=${encodeURIComponent(target)}&v=${version}`} /></div>}
  </section>;
}
