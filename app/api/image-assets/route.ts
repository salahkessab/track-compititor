import { NextResponse } from 'next/server';
import { prepareImage, verifiedImage, readVerifiedImage } from '@/lib/verifiedImages';
import { publicImage, preparationFailure, imageRequestAllowed } from '@/lib/imageFinalization';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(req: Request) {
  if (!imageRequestAllowed(req)) return NextResponse.json({ error: 'Image preparation requires the app origin.' }, { status: 403 });
  try {
    if (Number(req.headers.get('content-length') || 0) > 85_000_000) throw new Error('Image preparation request is too large.');
    if (!req.body) throw new Error('An image is required.');
    const reader = req.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 85_000_000) throw new Error('Image preparation request is too large.');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers.get('content-type') || '' } }).formData();
    const file = form.get('image'), original = form.get('original');
    if (!(file instanceof File) || file.size > 40_000_000 || original instanceof File && original.size > 40_000_000) throw new Error('Use an image smaller than 40 MB.');
    const formats = String(form.get('formats') || '').split(',').filter(Boolean);
    if (formats.some(f => !['png','jpeg','webp'].includes(f))) throw new Error('Unsupported export format.');
    const bytes = Buffer.from(await file.arrayBuffer());
    let asset;
    try { if (original instanceof File) throw new Error(); asset = readVerifiedImage(verifiedImage(bytes).id); for (const f of formats) { const id = asset.variants[f as keyof typeof asset.variants]; if (!id) throw new Error(); readVerifiedImage(id); } }
    catch { asset = await prepareImage(bytes, { original: original instanceof File ? Buffer.from(await original.arrayBuffer()) : undefined, formats: formats as any }); }
    return NextResponse.json(publicImage(asset));
  } catch (e) { return NextResponse.json(preparationFailure(e) || { error: e instanceof Error ? e.message : 'Image preparation failed.' }, { status: 422 }); }
}
