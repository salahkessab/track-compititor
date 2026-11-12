import sharp from "sharp";

export const IMAGE_STORAGE_VERSION = "lossless-webp-v1";
export const IMAGE_PIXEL_LIMIT = 40_000_000;
export const GENERATED_IMAGE_NAME = /^(?:featured|alternate|pinterest|photo-[a-f0-9-]{36})\.(?:jpg|jpeg|png|webp)$/;

// This is local encoding, independent of the provider's generation settings.
// Never label a quality=100 or nearLossless encode as lossless.
export async function losslessImage(bytes: Buffer, options: { requireWebP?: boolean } = {}) {
  const input = sharp(bytes, { limitInputPixels: IMAGE_PIXEL_LIMIT });
  const meta = await input.metadata();
  if (!meta.width || !meta.height || !["png", "jpeg", "webp"].includes(meta.format || "") || (meta.pages || 1) !== 1) throw new Error("Image could not be decoded safely.");
  // Fully decode before any fallback: readable headers alone do not prove that
  // a paid response contains a valid image.
  // Compare source samples without ICC conversion/clipping, then independently
  // require the output to carry the exact same colour profile.
  const pixels = (buffer: Buffer) => sharp(buffer, { limitInputPixels: IMAGE_PIXEL_LIMIT, ignoreIcc: true }).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const before = await pixels(bytes);
  const original = (reason: string) => {
    if (options.requireWebP && meta.format !== "webp") throw new Error(`This image cannot be exported as lossless WebP. ${reason} No image was uploaded.`);
    return { data: bytes, extension: meta.format === "jpeg" ? "jpg" : meta.format!, mediaType: `image/${meta.format}`, storage: { policy: IMAGE_STORAGE_VERSION, converted: false, reason, originalBytes: bytes.length, storedBytes: bytes.length } };
  };
  // WordPress uploads require WebP even when it is larger. An existing WebP
  // is already suitable and must not undergo another encode.
  if (options.requireWebP && meta.format === "webp") return original("Existing WebP retained without re-encoding.");
  // WebP cannot retain 16-bit samples or non-RGB source colour spaces.
  if (meta.depth !== "uchar" || !["srgb", "rgb", "b-w"].includes(meta.space)) return original("Original retained to preserve bit depth or colour space.");
  try {
    const data = await input.clone().keepIccProfile().webp({ lossless: true, effort: 5 }).toBuffer();
    if (!options.requireWebP && data.length >= bytes.length) return original("Original retained because lossless WebP was not smaller.");
    const after = await pixels(data);
    const output = await sharp(data).metadata();
    if (before.info.width !== after.info.width || before.info.height !== after.info.height || before.info.channels !== after.info.channels || !before.data.equals(after.data) || !(meta.icc || Buffer.alloc(0)).equals(output.icc || Buffer.alloc(0)) || (meta.orientation || 1) !== (output.orientation || 1)) return original("Original retained because exact pixel, colour profile or orientation preservation could not be verified.");
    return { data, extension: "webp", mediaType: "image/webp", storage: { policy: IMAGE_STORAGE_VERSION, converted: true, pixelsVerified: true, originalBytes: bytes.length, storedBytes: data.length } };
  } catch (error) {
    if (options.requireWebP) throw new Error("This image could not be converted to WebP with identical pixels, colour profile and orientation. No image was uploaded.", { cause: error });
    // The provider receipt is already durable. An optional local optimisation
    // must not turn a valid paid image into a failed generation or a retry.
    return original("Original retained because lossless compression was unavailable.");
  }
}
