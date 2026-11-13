import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { exiftoolPath } from 'exiftool-vendored';

export const EXIFTOOL_VERSION = '13.63';
export const METADATA_POLICY = 'optional-metadata-v3-remove-c2pa';
export type ImageFormat = 'jpeg' | 'png' | 'webp';
export type MetadataReport = {
  policy: string; toolVersion: string; state: 'verified'; sourceSha256: string; sha256: string;
  format: ImageFormat; width: number; height: number; removed: string[]; verifiedAt: string;
  inspectionNotes: string[];
  c2pa: { present: boolean; detectedBefore: boolean; action: 'removed' | 'not-detected'; signatureValidity: 'not-validated'; note: string };
};
export const imageHash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);
const transient = /^(?:SourceFile$|(?:File|System|Composite|ExifTool):)/;
const protectedName = /copyright|rights|attribution|credit|licen[cs]e|usageterms|webstatement|^(?:artist|author|creator|by-line|source|title|caption-abstract|description|imagedescription)(?:-|$)/i;
const optionalName = /gps|serial|ownername|username|personinimage|contact|email|phone|address|location|latitude|longitude|^(?:make|model|lensmake|lensmodel|software|creatortool|processingsoftware|firmware|hostcomputer|documentname|usercomment|xpcomment|comment|xpauthor|datetimeoriginal|createdate|modifydate|moddate|metadatadate|creationtime|timestamp|offsettime(?:original|digitized)?|subsectime(?:original|digitized)?|prompt|negativeprompt|workflow|parameters|seed|modelname|modelhash|sampler|steps|cfg|cfgscale|samplingsteps|scheduler|denoisingstrength|aestheticscore|generationdetails|generationparameters|generator|history|historysoftwareagent)$/i;
const generationValue = /(?:negative[_ ]?prompt|prompt|workflow|parameters|model[_ ]?(?:name|hash)|sampler|cfg[_ ]?scale|seed)\s*[=:]/i;
const creditValue = /copyright|©|all rights reserved|attribution|licensed? (?:under|by)|creative commons|photo(?:graph)?(?:y)? (?:by|credit)/i;
const nameOf = (key: string) => key.split(':').at(-1)!;
const writeKey = (key: string) => key.replace(/:Copy\d+(?=:|$)/g, '');
const isProtected = (key: string) => /^(?:ICC_Profile|ICC-|ICC-header)/i.test(key) || protectedName.test(nameOf(key));
const isProvenance = (key: string) => /^(?:JUMBF|C2PA|CBOR|JSON|JPEG2000):/.test(key);
function targets(tags: Record<string, any>) {
  return Object.entries(tags).filter(([key, value]) => {
    if (transient.test(key) || isProvenance(key) || /^(?:ICC_Profile|ICC-)/i.test(key)) return false;
    const name = nameOf(key).replace(/[_ -]/g, '');
    const requested = optionalName.test(name) || /^XMP-(?:dcterms:Provenance|xmp:Manifest)(?::|$)/i.test(key) || /prompt|workflow|parameters|seed|model(?:name|hash)|sampler|samplingsteps|cfgscale|creatortool|softwareagent|DateCreated|TimeCreated|DigitalCreation|HistoryWhen/i.test(name) || (typeof value === 'string' && generationValue.test(value));
    if (requested && (isProtected(key) || creditValue.test(String(value)))) throw new Error(`Metadata conflict in ${writeKey(key)}: it may contain required attribution. Nothing was released; review this field before retrying.`);
    return requested;
  }).map(([key]) => writeKey(key));
}
function stable(tags: Record<string, any>, predicate: (key: string) => boolean) {
  return JSON.stringify(Object.entries(tags).filter(([key]) => !transient.test(key) && predicate(key)).sort(([a], [b]) => a.localeCompare(b)));
}
let version: { executable: string; promise: Promise<string> } | undefined;
export async function exiftoolExecutable() {
  const configured = process.env.EXIFTOOL_PATH;
  if (configured && !path.isAbsolute(configured)) throw new Error('EXIFTOOL_PATH must be an absolute executable path.');
  return configured || await exiftoolPath();
}
export async function runExifTool(args: string[], binary = false): Promise<Buffer> {
  const executable = await exiftoolExecutable();
  try {
    // A fixed, checked-in config enables known PNG generation tags. Never load
    // a home-directory config or interpolate filenames/metadata into a shell.
    const result = await exec(executable, ['-config', path.join(process.cwd(), 'config', 'image-metadata.config'), ...args], {
      shell: false, windowsHide: true, timeout: 45_000, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer', env: { ...process.env, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C' },
    });
    const warnings = result.stderr.toString().trim().split(/\r?\n/).filter(Boolean);
    // libvips writes the TIFF form of WebP EXIF. ExifTool supports reading and
    // editing it; retain this known diagnostic in the verification report.
    if (warnings.some(line => !/^Warning: \[minor\] Improper EXIF header(?: -|$)/.test(line))) throw new Error('ExifTool reported an unsupported field or malformed metadata.');
    if (!binary && /^(?:warning|error):/im.test(result.stdout.toString())) throw new Error('ExifTool reported a metadata error.');
    return result.stdout;
  } catch (error) {
    // CLI output may include metadata values and private paths. Never reflect it.
    throw new Error('ExifTool could not complete metadata processing. Check its pinned installation and supported fields, then Retry.', { cause: error });
  }
}
async function checkVersion() {
  const executable = await exiftoolExecutable();
  if (version?.executable !== executable) version = { executable, promise: runExifTool(['-ver']).then(b => {
    const actual = b.toString().trim();
    if (actual !== EXIFTOOL_VERSION) throw new Error(`ExifTool ${EXIFTOOL_VERSION} is required; installed version is ${/^\d+\.\d+$/.test(actual) ? actual : 'unknown'}.`);
    return actual;
  }) };
  try { return await version!.promise; } catch (e) { version = undefined; throw e; }
}
export async function checkImageProcessing() {
  if (process.env.VERCEL && !process.env.IMAGE_ASSET_ROOT) throw new Error('Image preparation requires the persistent image backend. Configure IMAGE_ASSET_ROOT on a persistent Node host. No generation was started.');
  return checkVersion();
}
async function inspect(file: string) {
  const tags = JSON.parse((await runExifTool(['-json', '-G1:4', '-a', '-u', '-n', '-api', 'RequestAll=3', file])).toString())[0];
  if (!tags || Object.entries(tags).some(([key, value]) => /:(?:Error|Warning)(?:\b|$)/i.test(key) && value !== '[minor] Improper EXIF header')) throw new Error('Metadata inspection found malformed or unsupported image data.');
  return tags as Record<string, any>;
}

// Compare the compressed image payload as well as decoded samples. Metadata
// editing must not secretly re-encode even when the resulting pixels look equal.
export function imagePayload(bytes: Buffer, format: ImageFormat) {
  const parts: Buffer[] = [];
  if (format === 'png') {
    for (let at = 8; at + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(at), end = at + 12 + length;
      if (end > bytes.length) throw new Error('Invalid PNG chunk.');
      const type = bytes.toString('ascii', at + 4, at + 8);
      if (!['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME', 'caBX'].includes(type)) parts.push(bytes.subarray(at, end));
      at = end;
    }
  } else if (format === 'webp') {
    for (let at = 12; at + 8 <= bytes.length;) {
      const length = bytes.readUInt32LE(at + 4), end = at + 8 + length;
      if (end > bytes.length) throw new Error('Invalid WebP chunk.');
      const type = bytes.toString('ascii', at, at + 4);
      if (type === 'VP8X') parts.push(bytes.subarray(at + 12, end)); // canvas dimensions; metadata-presence flags may change
      else if (!['EXIF', 'XMP ', 'C2PA'].includes(type)) parts.push(bytes.subarray(at, end));
      at = end + length % 2;
    }
  } else {
    let at = 2;
    while (at < bytes.length) {
      const start = at;
      if (bytes[at++] !== 0xff) throw new Error('Invalid JPEG marker.');
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xd9) { parts.push(bytes.subarray(start, at)); break; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes.readUInt16BE(at), end = at + length;
      if (length < 2 || end > bytes.length) throw new Error('Invalid JPEG segment.');
      if ((marker < 0xe0 || marker > 0xef) && marker !== 0xfe || marker === 0xee) parts.push(bytes.subarray(start, end));
      at = end;
      if (marker === 0xda) {
        const scan = at;
        while (at < bytes.length) {
          if (bytes[at] !== 0xff) { at++; continue; }
          let next = at + 1; while (bytes[next] === 0xff) next++;
          if (bytes[next] === 0 || bytes[next] >= 0xd0 && bytes[next] <= 0xd7) { at = next + 1; continue; }
          break;
        }
        parts.push(bytes.subarray(scan, at));
      }
    }
  }
  return imageHash(Buffer.concat(parts));
}
async function appearance(bytes: Buffer) {
  const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || !meta.width || !meta.height || (meta.pages || 1) !== 1) throw new Error('Only static JPEG, PNG and WebP images are supported.');
  const decoded = await sharp(bytes, { limitInputPixels: 40_000_000, ignoreIcc: true }).raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
  return { format: meta.format as ImageFormat, width: meta.width, height: meta.height,
    signature: JSON.stringify({ pixels: imageHash(decoded.data), info: decoded.info, format: meta.format, width: meta.width, height: meta.height, channels: meta.channels,
      space: meta.space, depth: meta.depth, hasAlpha: meta.hasAlpha, orientation: meta.orientation, density: meta.density, icc: meta.icc && imageHash(meta.icc),
      payload: imagePayload(bytes, meta.format as ImageFormat) }) };
}
export async function inspectC2pa(file: string) {
  const manifest = await runExifTool(['-b', '-JUMBF', file], true);
  const tags = JSON.parse((await runExifTool(['-j', '-G1:3:4', '-a', '-u', '-JUMBF:all', '-XMP-dcterms:Provenance', '-XMP-xmp:Manifest', file])).toString())[0] || {};
  const present = manifest.length > 0 || Object.keys(tags).some(key => /JUMBF|C2PA|CBOR|Provenance|Manifest/i.test(key));
  return { present, hash: imageHash(manifest), tags: stable(tags, () => true) };
}

export async function checkProvenanceAttribution(file: string) {
  const tags = await inspect(file);
  // Deleting a manifest must not silently discard rights that exist only there.
  if (Object.entries(tags).some(([key, value]) => {
    if (!isProvenance(key)) return false;
    // Provider manifests use a generic output filename as the claim title.
    // This is not a work title or a credit. Keep meaningful titles protected.
    const outputFilename = nameOf(key) === 'Title' && typeof value === 'string' && /^image\.(?:png|jpe?g|webp)$/i.test(value);
    return (!outputFilename && protectedName.test(nameOf(key))) || creditValue.test(String(value));
  })) {
    throw new Error('C2PA contains possible copyright or required attribution. Preserve those rights in supported metadata before retrying; the original is unchanged.');
  }
}

export async function cleanImageMetadata(original: Buffer): Promise<{ data: Buffer; report: MetadataReport }> {
  const toolVersion = await checkVersion();
  const before = await appearance(original);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-metadata-'));
  const file = path.join(dir, 'copy.' + before.format);
  try {
    fs.writeFileSync(file, original, { mode: 0o600 });
    const beforeTags = await inspect(file), c2paBefore = await inspectC2pa(file);
    if (c2paBefore.present) await checkProvenanceAttribution(file);
    const requested = [...new Set(targets(beforeTags))];
    for (const tag of requested) if (!/^[A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z0-9_-]+)+$/.test(tag)) throw new Error('An optional field cannot be safely addressed by ExifTool. Review its metadata before retrying.');
    if (requested.length || c2paBefore.present) await runExifTool(['-overwrite_original', ...requested.map(tag => `-${tag}=`), ...(c2paBefore.present ? ['-JUMBF:all='] : []), file]);
    // Always reopen the saved file, including a no-op cleanup.
    const data = fs.readFileSync(file), afterTags = await inspect(file), c2paAfter = await inspectC2pa(file);
    const remaining = targets(afterTags);
    if (remaining.length) throw new Error(`Unsupported or remaining metadata: ${remaining.join(', ').slice(0, 200)}. No cleaned output was released.`);
    const protectedOutsideManifest = (key: string) => !isProvenance(key) && isProtected(key);
    if (stable(beforeTags, protectedOutsideManifest) !== stable(afterTags, protectedOutsideManifest)) throw new Error('Copyright, attribution or color-profile metadata changed.');
    if (c2paAfter.present) throw new Error('C2PA removal did not pass verification. The original is preserved; output was blocked.');
    if (before.signature !== (await appearance(data)).signature) throw new Error('Pixels, compressed image data, transparency, orientation, dimensions or ICC profile changed.');
    return { data, report: { policy: METADATA_POLICY, toolVersion, state: 'verified', sourceSha256: imageHash(original), sha256: imageHash(data),
      format: before.format, width: before.width, height: before.height, removed: [...requested, ...(c2paBefore.present ? ['JUMBF:all'] : [])], verifiedAt: new Date().toISOString(),
      inspectionNotes: Object.values(beforeTags).includes('[minor] Improper EXIF header') ? ['ExifTool reported a TIFF-form EXIF header. Metadata and display properties were read and verified; no pixel data was rewritten.'] : [],
      c2pa: { present: false, detectedBefore: c2paBefore.present, action: c2paBefore.present ? 'removed' : 'not-detected', signatureValidity: 'not-validated',
        note: c2paBefore.present ? 'Embedded C2PA removed from this copy and absence verified. Original preserved. This does not remove SynthID or guarantee avoidance of AI labels.' : 'No embedded C2PA detected in the verified output. This is not a SynthID removal or AI-detection test.' } } };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
