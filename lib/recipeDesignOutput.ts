/** Keep the complete model composition visible when its native ratio is not 4:5. */
export async function recipeDesignPng(dataUrl: string): Promise<Blob> {
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(dataUrl)) throw new Error("OpenAI returned an unsupported image format.");
  const image = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 1500;
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
