export type PreparedImage = { imageUrl: string; assetId: string; metadata: { state: 'verified'; c2pa: { present: boolean; note: string; action?: 'removed' | 'not-detected' } }; variants: Record<string, string>; blob: Blob };
const cache = new WeakMap<Blob, Map<string, Promise<PreparedImage>>>();
const pendingRetries = new Map<string, Promise<any>>();
export async function resolveImageResponse(response: Response, data: any): Promise<any> {
  if (response.ok) return data;
  if (data.assetId && data.retryable && typeof window !== 'undefined') {
    const existing = pendingRetries.get(data.assetId);
    if (existing) return existing;
    const pending = new Promise((resolve, reject) => {
      queueMicrotask(() => window.dispatchEvent(new CustomEvent('image-preparation-failed', { detail: { ...data, resolve, reject } })));
    }).finally(() => pendingRetries.delete(data.assetId));
    pendingRetries.set(data.assetId, pending);
    return pending;
  }
  throw new Error(data.error || 'Image preparation failed.');
}
export async function prepareClientImage(source: Blob | string, formats: string[] = [], original?: Blob): Promise<PreparedImage> {
  const response = typeof source === 'string' ? await fetch(source) : null;
  if (response && !response.ok) {
    const data = await response.json().catch(() => ({ error: 'This image is unavailable. Retry preparation.' }));
    const recovered = await resolveImageResponse(response, data);
    return prepareClientImage(recovered.imageUrl, formats, original);
  }
  const blob = typeof source === 'string' ? await response!.blob() : source;
  const key = formats.slice().sort().join(',');
  if (!original && cache.get(blob)?.has(key)) return cache.get(blob)!.get(key)!;
  const task = (async () => {
    const form = new FormData(); form.set('image', blob, 'image'); form.set('formats', key); if (original) form.set('original', original, 'original');
    const result = await fetch('/api/image-assets', { method: 'POST', body: form });
    const data = await resolveImageResponse(result, await result.json());
    if (data.metadata?.state !== 'verified') throw new Error('Backend image verification is missing.');
    const output = await fetch(data.imageUrl); if (!output.ok || output.headers.get('x-image-metadata') !== 'verified') throw new Error('Verified image is unavailable. Retry preparation.');
    const ready = { ...data, blob: await output.blob() };
    cache.set(ready.blob, new Map([[key, Promise.resolve(ready)]]));
    return ready;
  })();
  if (!original) { if (!cache.has(blob)) cache.set(blob, new Map()); cache.get(blob)!.set(key, task); }
  try { return await task; } catch (e) { cache.get(blob)?.delete(key); throw e; }
}
