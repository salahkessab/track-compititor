import { prepareImage, imageAssetUrl, ImagePreparationError, saveImageResponse, type VerifiedImage } from './verifiedImages';

export function imageRequestAllowed(request: Request) {
  try {
    const target = new URL(process.env.RECIPE_INTELLIGENCE_ORIGIN || request.url);
    if (!process.env.RECIPE_INTELLIGENCE_ORIGIN && request.headers.get('host')) target.host = request.headers.get('host')!;
    return request.headers.get('origin') === target.origin && (!request.headers.get('host') || request.headers.get('host') === target.host);
  } catch { return false; }
}

export function publicImage(asset: VerifiedImage) {
  return { assetId: asset.id, imageUrl: imageAssetUrl(asset.id), metadata: { state: 'verified', policy: asset.policy, c2pa: asset.c2pa },
    variants: Object.fromEntries(Object.entries(asset.variants).map(([format, id]) => [format, imageAssetUrl(id!)])) };
}
export async function generatedBytes(source: string) {
  if (source.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(source);
    if (!match || match[1].length > 55_000_000) throw new Error('Invalid generated image.');
    return Buffer.from(match[1], 'base64');
  }
  const url = new URL(source);
  if (url.protocol !== 'https:' || !/(?:^|\.)(?:fal\.media|fal\.ai|fal\.run|fal\.space)$/.test(url.hostname)) throw new Error('Unexpected generated-image host.');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45000) });
  if (!response.ok || !response.body) throw new Error('Could not retrieve the generated image for preparation.');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of response.body as any) { size += chunk.length; if (size > 40 * 1024 * 1024) throw new Error('Generated image exceeds the preparation limit.'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
export async function finalizeGeneration(data: any, key: 'imageUrl' | 'image' | 'artwork' = 'imageUrl') {
  const { [key]: source, ...safe } = data;
  try {
    const asset = await prepareImage(await generatedBytes(source));
    return { ...safe, ...publicImage(asset), [key]: imageAssetUrl(asset.id) };
  } catch (error) {
    if (error instanceof ImagePreparationError) saveImageResponse(error.assetId, { ...safe, responseKey: key });
    throw error;
  }
}
export function preparationFailure(error: unknown) {
  return error instanceof ImagePreparationError ? { error: error.message, assetId: error.assetId, retryable: true, phase: 'preparing' } : null;
}
