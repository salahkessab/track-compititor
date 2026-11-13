const { createHash } = require('node:crypto');

const assetUrl = bytes => '/api/image-assets/' + createHash('sha256').update(bytes).digest('hex');

// Browser tests mock the verified-asset HTTP contract. ExifTool and byte-level
// verification are exercised separately by image-metadata*.cjs.
function imageAssetFetch(fallback) {
  const assets = new Map();
  return async (url, init) => {
    if (url === '/api/image-assets' && init?.method === 'POST') {
      const blob = init.body.get('image'), bytes = Buffer.from(await blob.arrayBuffer());
      const imageUrl = assetUrl(bytes); assets.set(imageUrl, { bytes, type: blob.type || 'image/png' });
      return Response.json({ imageUrl, assetId: imageUrl.split('/').at(-1), metadata: { state: 'verified', c2pa: { present: false, action: 'not-detected' } }, variants: { png: imageUrl } });
    }
    if (assets.has(url)) {
      const asset = assets.get(url);
      return new Response(asset.bytes, { headers: { 'content-type': asset.type, 'x-image-metadata': 'verified' } });
    }
    if (String(url).startsWith('data:image/')) {
      return new Response(Buffer.from(String(url).split(',')[1], 'base64'), { headers: { 'content-type': String(url).slice(5).split(';')[0] } });
    }
    return fallback(url, init);
  };
}
module.exports = { imageAssetFetch, assetUrl };
