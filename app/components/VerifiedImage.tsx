'use client';
import { useEffect, useRef, useState } from 'react';
import { prepareClientImage, type PreparedImage } from '@/lib/preparedImageClient';
export function MetadataBadge({ c2pa = false }: { c2pa?: boolean }) {
  return <span className="mb-2 inline-flex h-6 w-6 shrink-0 items-center justify-center self-start rounded-full border border-emerald-500/40 bg-emerald-50 text-sm font-bold text-emerald-700" title={c2pa ? 'Metadata cleanup verified. Embedded C2PA removed and absence verified. This does not remove SynthID or guarantee avoidance of AI labels.' : 'Metadata cleanup verified; no embedded C2PA detected in this output. This does not mean SynthID was removed or AI labels will be avoided.'} aria-label="Metadata cleanup verified"><span aria-hidden="true">✓</span><span className="sr-only">Metadata cleanup verified</span></span>;
}
export function VerifiedImage({ source, onVerified, action, ...props }: Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { source: string | Blob; onVerified?: () => void; action?: React.ButtonHTMLAttributes<HTMLButtonElement> }) {
  const [ready, setReady] = useState<PreparedImage | null>(null), [error, setError] = useState(''), [attempt, retry] = useState(0);
  const notify = useRef(onVerified); notify.current = onVerified;
  useEffect(() => {
    let active = true; setReady(null); setError('');
    void prepareClientImage(source).then(value => { if (active) { setReady(value); notify.current?.(); } }, e => { if (active) setError(e instanceof Error ? e.message : 'Image preparation failed.'); });
    return () => { active = false; };
  }, [source, attempt]);
  return <span className="inline-flex w-full min-w-0 flex-col">{ready ? <><MetadataBadge c2pa={ready.metadata.c2pa.action === 'removed'}/>{action ? <button {...action} type="button"><img {...props} src={ready.imageUrl}/>{action.children}</button> : <img {...props} src={ready.imageUrl}/>}</> : error ? <span role="alert" className="text-xs text-red-700">{error}<button type="button" className="ml-2 underline" onClick={e => {e.stopPropagation(); retry(n=>n+1);}}>Retry</button></span> : <span role="status" className="p-3 text-sm text-gray-500">Preparing image…</span>}</span>;
}
export function ImagePreparationNotifications() {
  const [jobs, setJobs] = useState<any[]>([]);
  useEffect(() => { const listen = (event: Event) => setJobs(j => [...j.filter(x => x.assetId !== (event as CustomEvent).detail.assetId), (event as CustomEvent).detail]); window.addEventListener('image-preparation-failed', listen); return () => window.removeEventListener('image-preparation-failed', listen); }, []);
  async function retry(job: any) {
    setJobs(j => j.map(x => x === job ? {...x, busy: true} : x));
    try {
      const response = await fetch('/api/image-assets/' + job.assetId, { method: 'POST' }), data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Preparation failed.');
      job.resolve(data); setJobs(j => j.filter(x => x.assetId !== job.assetId));
    } catch (e) { setJobs(j => j.map(x => x.assetId === job.assetId ? {...x, busy:false, error: e instanceof Error ? e.message : 'Preparation failed.'} : x)); }
  }
  return <div className="fixed bottom-4 right-4 z-[100] flex max-w-lg flex-col gap-2">{jobs.map(job => <div key={job.assetId} role="alert" className=" rounded-xl border border-red-200 bg-white p-4 shadow-xl"><p className="text-sm text-red-700">{job.error}</p><button type="button" disabled={job.busy} onClick={() => void retry(job)} className="mt-2 rounded-lg bg-purple-600 px-3 py-2 text-sm text-white disabled:opacity-50">{job.busy ? 'Preparing image…' : 'Retry'}</button></div>)}</div>;
}
