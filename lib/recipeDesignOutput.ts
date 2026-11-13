/** Keep the complete model composition visible when its native ratio is not 4:5. */
export function recipeDesignDimensions(size?: string) {
  return size === "1536x864" ? { width: 1536, height: 864 } : { width: 1200, height: 1500 };
}
export async function recipeDesignPng(source: Blob | string, size?: string): Promise<Blob> {
  // Generated images are now served through verified workspace assets. Callers
  // can pass their already-downloaded bytes instead of requiring a data URL.
  if (typeof source === "string" && !/^data:image\/(?:png|jpeg|webp);base64,/.test(source)) throw new Error("Unsupported design image source.");
  const image = typeof source === "string" ? await (await fetch(source)).blob() : source;
  if (!/^image\/(?:png|jpeg|webp)$/.test(image.type)) throw new Error("Unsupported design image format. Expected PNG, JPEG, or WebP.");
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    const dimensions = recipeDesignDimensions(size);
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not export the design PNG.");
    const cover = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const coverWidth = bitmap.width * cover, coverHeight = bitmap.height * cover;
    ctx.save(); ctx.filter = "blur(32px)";
    ctx.drawImage(bitmap, (canvas.width - coverWidth) / 2, (canvas.height - coverHeight) / 2, coverWidth, coverHeight);
    ctx.restore();
    const contain = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = Math.round(bitmap.width * contain), height = Math.round(bitmap.height * contain);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, Math.round((canvas.width - width) / 2), Math.round((canvas.height - height) / 2), width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not encode the design PNG.")), "image/png"));
  } finally { bitmap.close(); }
}
