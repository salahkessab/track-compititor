import { NextResponse } from 'next/server';
import { readVerifiedImage, retryImage, imageResponse } from '@/lib/verifiedImages';
import { publicImage, preparationFailure, imageRequestAllowed } from '@/lib/imageFinalization';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const file = readVerifiedImage((await context.params).id);
    return new Response(new Uint8Array(file.data), { headers: { 'Content-Type': file.mediaType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Image-Metadata': 'verified', 'X-Image-C2PA': file.c2pa.action } });
  } catch { return NextResponse.json({ error: 'Image is not verified or is unavailable. Retry preparation.' }, { status: 409 }); }
}
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!imageRequestAllowed(req)) return NextResponse.json({ error: 'Image preparation requires the app origin.' }, { status: 403 });
  try {
    const id = (await context.params).id, asset = await retryImage(id), { responseKey = 'imageUrl', ...saved } = imageResponse(id), output = publicImage(asset);
    return NextResponse.json({ ...saved, ...output, [responseKey]: output.imageUrl });
  } catch (e) { return NextResponse.json(preparationFailure(e) || { error: e instanceof Error ? e.message : 'Preparation failed.', retryable: true }, { status: 422 }); }
}
