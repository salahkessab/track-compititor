"use client";
import type { DiskStorage } from '../../lib/recipe-intelligence/diskStorage';

function size(bytes: number) {
  if (bytes === 0) return '0 GB';
  if (bytes < 1_000_000) return '< 1 MB';
  return bytes < 1_000_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function StorageMeter({ storage }: { storage: DiskStorage | null }) {
  if (!storage || storage.status !== 'available') return <div className="border-t border-gray-100 pt-4 text-sm text-gray-500" role="status">
    {storage ? 'Storage usage is temporarily unavailable. Reconnecting automatically…' : 'Checking storage space…'}
  </div>;
  const percent = Math.min(100, Math.max(0, storage.usedPercent));
  const percentLabel = percent > 0 && percent < 1 ? '< 1' : percent < 100 && percent > 99 ? '> 99' : String(Math.floor(percent));
  const tone = percent >= 95 ? 'red' : percent >= 80 ? 'amber' : 'green';
  const colors = tone === 'red' ? 'border-red-300 bg-red-50' : tone === 'amber' ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50';
  const fill = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500';
  const status = tone === 'red' ? 'Storage almost full' : tone === 'amber' ? 'Storage filling up' : 'Space available';
  return <div className="space-y-2 border-t border-gray-100 pt-4" data-storage-level={tone}>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Storage space</h3>
        <p className="mt-1 text-sm"><strong className="text-gray-900">{size(storage.freeBytes)} free</strong><span className="text-gray-600"> of {size(storage.totalBytes)}</span></p>
      </div>
      <div className="flex w-full min-w-0 items-center gap-4 sm:w-auto">
        <div role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          aria-valuetext={`${percentLabel}% used; ${size(storage.freeBytes)} free of ${size(storage.totalBytes)}`}
          className={`relative h-10 w-32 shrink-0 rounded-lg border-2 p-1 sm:w-40 ${colors}`}>
          <div className="h-full overflow-hidden rounded-sm"><div className={`h-full rounded-sm transition-[width] duration-500 motion-reduce:transition-none ${fill}`} style={{ width: `${percent}%` }} /></div>
          <span aria-hidden="true" className="absolute -right-2 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r bg-gray-400" />
        </div>
        <div className="text-right"><p className="text-sm font-semibold tabular-nums">{percentLabel}% used</p><p className="mt-1 text-xs text-gray-600">{status}</p></div>
      </div>
    </div>
    <p className="text-xs text-gray-500">{size(storage.usedBytes)} used or reserved on the workspace disk, including other files. Updates automatically.</p>
    {tone !== 'green' && <p role="status" className={`text-sm ${tone === 'red' ? 'text-red-700' : 'text-amber-800'}`}>Delete old articles and their images when you no longer need them to free up space.</p>}
  </div>;
}
