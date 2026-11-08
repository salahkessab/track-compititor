// Recipe-only browser exports. Never upload a generated image again to compress it.
export const WEBP_TARGET_BYTES = 300 * 1024;
// Quality takes priority over the byte target; never shrink the canvas.
export const WEBP_QUALITIES = [0.92, 0.90, 0.88] as const;

export async function prepareRecipeDownload(source: Blob, format: "png" | "webp"): Promise<Blob> {
  if (format === "webp") return compressRecipeWebp(source);
  if (source.type === "image/png") return source;
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the PNG download.");
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("Could not export PNG.")), "image/png"));
  } finally { bitmap.close(); }
}

export async function encodeRecipeWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  let smallest: Blob | undefined;
  for (const quality of WEBP_QUALITIES) {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error("Could not compress the image.")), "image/webp", quality));
    // Some browsers silently return PNG for an unsupported encoder.
    if (blob.type !== "image/webp") throw new Error("This browser cannot export WebP. Please use a current Chrome, Edge, Firefox, or Safari browser.");
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= WEBP_TARGET_BYTES) break;
  }
  return smallest!;
}

export async function compressRecipeWebp(source: Blob): Promise<Blob> {
  if (source.type === "image/webp" && source.size <= WEBP_TARGET_BYTES) return source;
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the WebP download.");
    ctx.drawImage(bitmap, 0, 0);
    const compressed = await encodeRecipeWebp(canvas);
    return source.type === "image/webp" && source.size <= compressed.size ? source : compressed;
  } finally { bitmap.close(); }
}
