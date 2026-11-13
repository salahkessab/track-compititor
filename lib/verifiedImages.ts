import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { cleanImageMetadata, imageHash, METADATA_POLICY, inspectC2pa, checkProvenanceAttribution, runExifTool, type ImageFormat, type MetadataReport } from './imageMetadata';
export { METADATA_POLICY } from './imageMetadata';
export type VerifiedImage = MetadataReport & { id: string; mediaType: string; variants: Partial<Record<ImageFormat, string>> };
const locks = new Map<string, Promise<VerifiedImage>>();
async function fileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + 180_000;
  for (;;) {
    try { const fd = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd); break; }
    catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      try { const owner = Number(fs.readFileSync(file, 'utf8')); if (owner > 0) { try { process.kill(owner, 0); } catch (err: any) { if (err.code === 'ESRCH') { fs.unlinkSync(file); continue; } } } } catch { /* another process released it */ }
      if (Date.now() > deadline) throw new Error('Image preparation is still running. Retry shortly.');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  try { return await task(); } finally { try { fs.unlinkSync(file); } catch { /* released */ } }
}
export function imageRoot(root?: string) { return path.join(root || process.env.RECIPE_INTELLIGENCE_ROOT || process.env.IMAGE_ASSET_ROOT || path.join(os.tmpdir(), 'recipe-image-assets'), 'verified-images'); }
function write(file: string, data: Buffer | string) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.' + randomUUID() + '.tmp'; fs.writeFileSync(tmp, data, { mode: 0o600 }); fs.renameSync(tmp, file); }
function idCheck(id: string) { if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid image asset.'); return id; }
export class ImagePreparationError extends Error {
  constructor(public assetId: string, reason: string) { super('Image preparation failed: ' + reason + ' Retry preparation; no new generation is needed.'); }
}
export function verifiedImage(bytes: Buffer, root?: string): VerifiedImage {
  const sha = imageHash(bytes); let record: VerifiedImage;
  try { record = JSON.parse(fs.readFileSync(path.join(imageRoot(root), 'proofs', sha + '.json'), 'utf8')); }
  catch { throw new Error('Image metadata is not verified. Retry preparation before downloading or publishing.'); }
  if (record.state !== 'verified' || record.policy !== METADATA_POLICY || record.sha256 !== sha || record.id !== sha) throw new Error('Image verification is missing or stale. Retry preparation.');
  return record;
}
export function readVerifiedImage(id: string, root?: string) {
  idCheck(id); const data = fs.readFileSync(path.join(imageRoot(root), 'outputs', id));
  if (imageHash(data) !== id) throw new Error('Verified image checksum mismatch. Retry preparation.');
  return { ...verifiedImage(data, root), data };
}
export function verifiedVariant(bytes: Buffer, format: ImageFormat, root?: string) {
  const record = verifiedImage(bytes, root), id = record.variants[format];
  if (!id) throw new Error('The ' + format + ' output has not passed metadata verification. Retry preparation.');
  return readVerifiedImage(id, root);
}
// Inherit protected fields before cleaning. Never silently lose a profile,
// orientation during a composition or conversion. C2PA removal is explicit policy.
async function inheritMetadata(file: string, source: string, bytes: Buffer, original: Buffer) {
  if (bytes.equals(original)) return;
  await checkProvenanceAttribution(source);
  const a = await sharp(original).metadata(), b = await sharp(bytes).metadata();
  if (a.icc && !a.icc.equals(b.icc || Buffer.alloc(0))) throw new Error('Editing did not preserve the original ICC profile. Retry with a color-preserving export.');
  if ((a.orientation || 1) !== (b.orientation || 1)) throw new Error('Editing changed the orientation metadata. Retry with an orientation-preserving export.');
  const tags = JSON.parse((await runExifTool(['-j', '-G1', '-a', source])).toString())[0] || {};
  const keys = Object.keys(tags).filter(k => !/^(?:File|System|Composite|ExifTool|ICC)/.test(k) && /copyright|rights|attribution|credit|licen[cs]e|usageterms|webstatement|:(?:Artist|Author|Creator|By-line)$/i.test(k));
  if (keys.length) await runExifTool(['-overwrite_original', '-tagsFromFile', source, ...keys.map(k => '-' + k), file]);
}
export async function prepareImage(bytes: Buffer, options: { root?: string; original?: Buffer; formats?: ImageFormat[]; owner?: 'articles' | 'other' | 'shared' } = {}): Promise<VerifiedImage> {
  const formats = [...new Set(options.formats || [])].sort(), original = options.original || bytes;
  const id = imageHash(Buffer.concat([Buffer.from(METADATA_POLICY + '|' + formats.join(',') + '|' + imageHash(original)), bytes]));
  const base = imageRoot(options.root), key = base + id + '|' + (options.owner || 'other');
  if (locks.has(key)) return locks.get(key)!;
  const task = fileLock(path.join(base, 'locks', id), async () => {
    const dir = path.join(base, 'private', id), recordPath = path.join(dir, 'job.json');
    fs.mkdirSync(dir, { recursive: true });
    let owner = options.owner || 'other';
    if (fs.existsSync(recordPath)) {
      const previous = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
      if (previous.owner && previous.owner !== owner) owner = 'shared';
      if (previous.state === 'ready') {
        try { const output = readVerifiedImage(previous.output, options.root); for (const variant of Object.values(output.variants)) readVerifiedImage(variant!, options.root); if (previous.owner !== owner) write(recordPath, JSON.stringify({ ...previous, owner })); return output; }
        catch { throw new ImagePreparationError(id, 'A saved verified output is missing or changed.'); }
      }
    }
    write(path.join(dir, 'input'), bytes); write(path.join(dir, 'original'), original);
    write(recordPath, JSON.stringify({ state: 'preparing', formats, policy: METADATA_POLICY, owner }));
    try {
      const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
      if (!['png','jpeg','webp'].includes(meta.format || '') || (meta.pages || 1) !== 1) throw new Error('Only static JPEG, PNG and WebP are supported.');
      const source = path.join(dir, 'original');
      const input = path.join(dir, 'input');
      const inputProvenance = await inspectC2pa(input), sourceProvenance = bytes.equals(original) ? inputProvenance : await inspectC2pa(source);
      const provenance = { present: inputProvenance.present || sourceProvenance.present, input: inputProvenance, original: sourceProvenance };
      if (sourceProvenance.present) await checkProvenanceAttribution(source);
      write(path.join(dir, 'c2pa.json'), JSON.stringify(provenance));
      const outputs: { data: Buffer; record: VerifiedImage }[] = [];
      for (const format of [...new Set([meta.format as ImageFormat, ...formats])]) {
        // A later export may request another format. Reuse every variant that
        // already passed verification; only prepare the newly requested one.
        if (bytes.equals(original)) {
          let saved: ReturnType<typeof readVerifiedImage> | undefined;
          try {
            const known = verifiedImage(bytes, options.root), variant = known.variants[format];
            if (variant) saved = readVerifiedImage(variant, options.root);
          } catch { /* this variant has not been verified yet */ }
          if (saved) { const { data, ...record } = saved; outputs.push({ data, record }); continue; }
        }
        let candidate = bytes;
        if (format !== meta.format) {
          if (format === 'jpeg') throw new Error('A lossy JPEG conversion is not an exact-pixel output. Retain the existing JPEG or use PNG/WebP.');
          const pipeline = sharp(bytes, { limitInputPixels: 40_000_000 }).keepMetadata();
          candidate = await (format === 'png' ? pipeline.png() : pipeline.webp({ lossless: true, effort: 5 })).toBuffer();
          const samples = (b: Buffer) => sharp(b, { ignoreIcc: true }).toColourspace('srgb').ensureAlpha().raw({ depth: 'ushort' }).toBuffer();
          const converted = await sharp(candidate).metadata();
          if (meta.depth !== converted.depth || !(await samples(bytes)).equals(await samples(candidate))) throw new Error('The requested format cannot preserve every pixel and the source bit depth.');
        }
        const file = path.join(dir, 'candidate.' + format); write(file, candidate);
        await inheritMetadata(file, source, candidate, original);
        candidate = fs.readFileSync(file);
        const cleaned = await cleanImageMetadata(candidate);
        if (provenance.present) {
          cleaned.report.c2pa = { ...cleaned.report.c2pa, detectedBefore: true, action: 'removed', note: 'Original contained embedded C2PA. It is absent from this separately verified final copy. Original preserved; no SynthID or AI-label guarantee.' };
          if (!cleaned.report.removed.includes('JUMBF:all')) cleaned.report.removed.push('JUMBF:all');
        }
        outputs.push({ data: cleaned.data, record: { ...cleaned.report, id: cleaned.report.sha256, mediaType: 'image/' + format, variants: {} } });
      }
      const variants = Object.fromEntries(outputs.map(o => [o.record.format, o.record.id]));
      // All requested formats pass before any final asset becomes addressable.
      for (const output of outputs) await fileLock(path.join(base, 'locks', 'output-' + output.record.id), async () => {
        let savedVariants: VerifiedImage['variants'] = {};
        try {
          const saved = readVerifiedImage(output.record.id, options.root);
          for (const [format, variant] of Object.entries(saved.variants)) {
            try { readVerifiedImage(variant!, options.root); savedVariants[format as ImageFormat] = variant; } catch { /* stale variants cannot be advertised */ }
          }
        } catch { /* first verified output, or an explicitly retried corrupt copy */ }
        output.record.variants = { ...savedVariants, ...variants };
        write(path.join(base, 'outputs', output.record.id), output.data);
        write(path.join(base, 'proofs', output.record.id + '.json'), JSON.stringify(output.record));
      });
      write(recordPath, JSON.stringify({ state: 'ready', output: outputs[0].record.id, formats, policy: METADATA_POLICY, owner }));
      return outputs[0].record;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Verification failed.';
      write(recordPath, JSON.stringify({ state: 'failed', formats, error: reason, policy: METADATA_POLICY, owner }));
      throw new ImagePreparationError(id, reason);
    } finally {
      for (const format of ['jpeg', 'png', 'webp']) {
        try { fs.rmSync(path.join(dir, 'candidate.' + format), { force: true }); } catch { /* private scratch remains inaccessible */ }
      }
    }
  });
  locks.set(key, task); try { return await task; } finally { locks.delete(key); }
}
export async function retryImage(id: string, root?: string) {
  const dir = path.join(imageRoot(root), 'private', idCheck(id)), job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
  if (job.state === 'ready') write(path.join(dir, 'job.json'), JSON.stringify({ ...job, state: 'preparing' }));
  return prepareImage(fs.readFileSync(path.join(dir, 'input')), { root, original: fs.readFileSync(path.join(dir, 'original')), formats: job.formats, owner: job.owner });
}
export const imageAssetUrl = (id: string) => '/api/image-assets/' + idCheck(id);
export function saveImageResponse(id: string, response: unknown) { write(path.join(imageRoot(), 'private', idCheck(id), 'response.json'), JSON.stringify(response)); }
export function imageResponse(id: string) { try { return JSON.parse(fs.readFileSync(path.join(imageRoot(), 'private', idCheck(id), 'response.json'), 'utf8')); } catch { return {}; } }
