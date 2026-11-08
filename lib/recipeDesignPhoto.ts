export type LocalPhoto = { id: string; name: string; type: string; blob: Blob; sha256: string; width: number; height: number; createdAt: string };
const MAX_BYTES = 25 * 1024 * 1024;
export async function digest(data: Blob | Uint8Array | Uint8ClampedArray): Promise<string> {
  const bytes = data instanceof Blob ? await data.arrayBuffer() : new Uint8Array(data).buffer;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function identify(bytes: Uint8Array): string {
  const ascii = (start: number, n: number) => String.fromCharCode(...bytes.slice(start, start + n));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) {
    for (let i = 8; i + 12 <= bytes.length;) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + i, 4).getUint32(0);
      if (ascii(i + 4, 4) === "acTL") throw new Error("Animated PNG files are not supported.");
      if (length > bytes.length - i - 12) break;
      i += 12 + length;
    }
    return "image/png";
  }
  if (ascii(0,4) === "RIFF" && ascii(8,4) === "WEBP") {
    for (let i = 12; i + 8 <= bytes.length;) {
      const kind = ascii(i,4);
      const length = new DataView(bytes.buffer, bytes.byteOffset + i + 4, 4).getUint32(0, true);
      if (kind === "ANIM" || kind === "ANMF" || (kind === "VP8X" && (bytes[i + 8] & 2))) throw new Error("Animated WebP files are not supported.");
      if (length > bytes.length - i - 8) break;
      i += 8 + length + (length % 2);
    }
    return "image/webp";
  }
  throw new Error("Choose a valid JPG, PNG, or static WebP image.");
}
export async function prepareLocalPhoto(file: File): Promise<LocalPhoto> {
  if (!file.size || file.size > MAX_BYTES) throw new Error("Choose an image up to 25 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = identify(bytes);
  if (file.type && file.type !== type && !(file.type === "image/jpg" && type === "image/jpeg")) throw new Error("The file type does not match its contents.");
  const blob = new Blob([bytes], { type });
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch { throw new Error("This image could not be decoded. Choose another file."); }
  const { width, height } = bitmap; bitmap.close();
  if (!width || !height || width * height > 40_000_000) throw new Error("Image dimensions exceed the 40-megapixel limit.");
  return { id: crypto.randomUUID(), name: file.name, type, blob, sha256: await digest(blob), width, height, createdAt: new Date().toISOString() };
}
export async function analysisThumbnail(photo: LocalPhoto): Promise<string> {
  const bitmap = await createImageBitmap(photo.blob, { imageOrientation: "from-image" });
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) { bitmap.close(); throw new Error("Image preparation is unavailable."); }
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  // Canvas strips metadata. Even four thumbnails fit in a serverless request.
  let result = canvas.toDataURL("image/jpeg", .78);
  if (result.length > 700_000) result = canvas.toDataURL("image/jpeg", .55);
  if (result.length > 900_000) throw new Error("Could not reduce the image for read-only analysis.");
  return result;
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the uploaded photo."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

/** A full-quality original when it fits, otherwise a high-quality edit input. */
export async function recipeEditImage(photo: LocalPhoto, reference = false): Promise<string> {
  if (await digest(photo.blob) !== photo.sha256) throw new Error("The uploaded photo changed. Upload it again.");
  const limit = reference ? 260_000 : 2_950_000;
  if (!reference && photo.blob.size <= 2_100_000) {
    const original = await readDataUrl(photo.blob);
    if (original.length <= limit) return original;
  }
  const bitmap = await createImageBitmap(photo.blob, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    const longest = reference ? 640 : 2048;
    let scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    let quality = reference ? .78 : .92;
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Could not prepare the photo for OpenAI.");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const encoded = canvas.toDataURL("image/jpeg", quality);
      if (encoded.length <= limit) return encoded;
      if (quality > .72) quality -= .08;
      else scale *= .8;
    }
    throw new Error("The photo is too large for one image edit request.");
  } finally { bitmap.close(); }
}
