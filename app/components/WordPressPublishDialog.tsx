"use client";
import { useRef, useState } from 'react';
import { scheduleFromLocal, validateSchedule } from '../../lib/recipe-intelligence/scheduling';

type Mode = 'draft' | 'publish' | 'future';
type Props = { items: { id: string; title: string }[]; connections: any[]; timezone: string; initialStatus?: Mode; request: (route: string, method?: string, data?: any) => Promise<any>; refresh: () => Promise<any>; close: () => void };
const button = 'rounded-lg border border-gray-200 bg-purple-600 px-3 py-2 text-sm text-white disabled:opacity-40 ui-secondary';
const input = 'rounded-lg border border-gray-300 bg-white p-2 text-sm text-gray-900';

export function WordPressPublishDialog({ items, connections, timezone, initialStatus = 'draft', request, refresh, close }: Props) {
  const [target, setTarget] = useState(connections.length === 1 ? connections[0].id : '');
  const [choices, setChoices] = useState<Record<string, { status: Mode; local: string }>>(() => Object.fromEntries(items.map(i => [i.id, { status: initialStatus, local: '' }])));
  const [reviews, setReviews] = useState<Record<string, any>>({});
  const [results, setResults] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const lock = useRef(false);
  const destination = connections.find(c => c.id === target)?.siteUrl || '';
  const ready = items.filter(i => reviews[i.id] && !results[i.id]);
  const publicAction = ready.some(i => choices[i.id].status !== 'draft');
  function change(id: string, patch: Partial<{ status: Mode; local: string }>) {
    setChoices(old => ({ ...old, [id]: { ...old[id], ...patch } })); setConfirmed(false);
  }
  function validation(id: string): string {
    const choice = choices[id], review = reviews[id];
    if (choice.status !== 'draft' && review && !review.profile.canPublish) return 'This WordPress account can save drafts only.';
    if (choice.status !== 'future') return '';
    if (review && !review.profile.scheduling) return 'Update Recipe Intelligence Bridge to 1.2 or newer on this website to schedule.';
    try { validateSchedule(scheduleFromLocal(choice.local, timezone)); return ''; } catch (e) { return (e as Error).message; }
  }
  async function prepare() {
    if (!target || lock.current) return; lock.current = true; setBusy(true); setConfirmed(false); setErrors({});
    const prepared: Record<string, any> = {};
    try {
      for (const [index, item] of items.entries()) {
        if (results[item.id]) continue;
        try {
          setProgress(`Preparing ${index + 1}/${items.length}: ${item.title}`);
          const route = `items/${item.id}/wordpress-publish?connectionId=${encodeURIComponent(target)}`;
          const plan = await request(route);
          if (!plan.profile.ready) throw new Error('Choose a supported recipe card in this website’s WordPress settings.');
          for (const [n, image] of plan.images.entries()) {
            if (image.state === 'ready') continue;
            setProgress(`${item.title}: uploading image ${n + 1}/${plan.images.length}`);
            await request(`items/${item.id}/wordpress`, 'POST', { connectionId: target, documentHash: plan.documentHash, sha256: image.sha256 });
          }
          const review = await request(route);
          if (!review.ready || review.documentHash !== plan.documentHash) throw new Error('Article changed during preparation. Prepare again to review the latest version.');
          prepared[item.id] = review;
        } catch (e) { setErrors(old => ({ ...old, [item.id]: e instanceof Error ? e.message : 'Preparation failed.' })); }
      }
      setReviews(prepared); setProgress('Preparation finished. Review each article, destination and publication time before sending.');
    } finally { lock.current = false; setBusy(false); }
  }
  async function send() {
    if (lock.current || !ready.length || publicAction && !confirmed || ready.some(i => validation(i.id))) return;
    lock.current = true; setBusy(true);
    try {
      for (const [index, item] of ready.entries()) {
        setProgress(`Sending ${index + 1}/${ready.length}: ${item.title}`);
        try {
          const choice = choices[item.id];
          const scheduledAt = choice.status === 'future' ? validateSchedule(scheduleFromLocal(choice.local, timezone)) : undefined;
          const saved = await request(`items/${item.id}/wordpress-publish`, 'POST', { connectionId: target, reviewHash: reviews[item.id].reviewHash, status: choice.status, confirmPublish: choice.status === 'publish' && confirmed, ...(scheduledAt ? { scheduledAt, confirmSchedule: confirmed } : {}) });
          setResults(old => ({ ...old, [item.id]: saved }));
          setErrors(old => { const next = { ...old }; delete next[item.id]; return next; });
        } catch (e) { setErrors(old => ({ ...old, [item.id]: e instanceof Error ? e.message : 'Send could not be confirmed. Check the saved post before retrying.' })); }
      }
      setProgress('Sending finished. Each article’s confirmed result is shown below. Failed or unconfirmed rows were not marked as published.');
      try { await refresh(); } catch { setProgress('Sends finished. Results below are retained; refresh the library when its connection returns.'); }
    } finally { lock.current = false; setBusy(false); setConfirmed(false); }
  }
  async function check(id: string) {
    if (lock.current) return; lock.current = true; setBusy(true);
    try {
      const saved = await request(`items/${id}/wordpress-check`, 'POST', { connectionId: target });
      setResults(old => ({ ...old, [id]: saved }));
      setErrors(old => { const next = { ...old }; delete next[id]; return next; });
      await refresh();
    } catch (e) { setErrors(old => ({ ...old, [id]: (e as Error).message })); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><section role="dialog" aria-modal="true" aria-label="Publish articles to WordPress" className="max-h-[90vh] w-full max-w-4xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 text-gray-900 shadow-xl">
    <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">Publish or schedule · {items.length} article{items.length === 1 ? '' : 's'}</h2><button className={button} disabled={busy} onClick={close}>Close</button></div>
    <label className="block text-sm">WordPress destination<select className={`${input} mt-1 w-full`} value={target} disabled={busy || Object.keys(results).length > 0} onChange={e => { setTarget(e.target.value); setReviews({}); setErrors({}); setConfirmed(false); setProgress(''); }}><option value="">Choose a website</option>{connections.map(c => <option value={c.id} key={c.id}>{c.siteUrl}</option>)}</select></label>
    {!connections.length && <p role="alert">Connect a WordPress website in Settings first.</p>}
    <p className="text-sm text-gray-600">Publication times use <strong>{timezone}</strong>. WordPress stores the schedule, so your computer can be off after the scheduled post is confirmed. Publishing on time depends on your website’s WP-Cron or hosting cron.</p>
    <p className="text-sm text-gray-600">Preparation uploads saved generated images. It does not create posts or generate new content. Keep this window open until every send is confirmed.</p>
    {items.map(item => {
      const choice = choices[item.id], review = reviews[item.id], saved = results[item.id], problem = validation(item.id);
      return <article key={item.id} aria-label={`Publish ${item.title}`} className="space-y-3 rounded-xl border border-gray-200 p-4"><h3 className="font-semibold">{review?.title || item.title}</h3>
        {!saved && <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Action<select aria-label={`Publication action for ${item.title}`} className={`${input} ml-2`} value={choice.status} disabled={busy} onChange={e => change(item.id, { status: e.target.value as Mode })}><option value="draft">Save draft</option><option value="publish">Publish now</option><option value="future">Schedule</option></select></label>{choice.status === 'future' && <label className="text-sm">Publication date and time<input aria-label={`Publication time for ${item.title}`} className={`${input} ml-2`} type="datetime-local" value={choice.local} disabled={busy} onChange={e => change(item.id, { local: e.target.value })} /></label>}</div>}
        {review && <p className="text-sm">{review.siteUrl} · {review.profile.recipeCardLabel} · {review.images.length} hosted images{review.previous?.result ? ` · Existing post: ${review.previous.result.status}` : ''}</p>}
        {!saved && problem && <p className="text-sm text-amber-700">{problem}</p>}
        {errors[item.id] && <div role="alert" className="text-sm text-red-700"><p>{errors[item.id]}</p><button className={`${button} mt-2`} disabled={busy || !target} onClick={() => void check(item.id)}>Check saved post</button></div>}
        {saved && <p className="text-sm text-green-700">{saved.status === 'publish' ? 'Published' : saved.status === 'future' ? 'Scheduled' : 'Saved draft'} · Post {saved.postId}{saved.scheduledAt ? ` · ${new Date(saved.scheduledAt).toLocaleString(undefined, { timeZone: timezone })} (${timezone})` : ''} · <a href={saved.editUrl} target="_blank" rel="noreferrer" className="underline">Open in WordPress</a></p>}
      </article>;
    })}
    {progress && <p role="status" className="text-sm text-blue-700">{progress}</p>}
    <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || !target || items.every(i => results[i.id])} onClick={() => void prepare()}>Prepare articles and upload images</button></div>
    {!!ready.length && <div className="space-y-3 border-t border-gray-200 pt-4">{publicAction && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I confirm the actions and individual publication times above for {destination}.</label>}<button className={`${button} !bg-blue-600 font-semibold`} disabled={busy || publicAction && !confirmed || ready.some(i => validation(i.id))} onClick={() => void send()}>Send {ready.length} ready article{ready.length === 1 ? '' : 's'}</button></div>}
  </section></div>;
}
