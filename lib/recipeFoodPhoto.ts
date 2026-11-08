import { MAX_FOOD_REFERENCE_LENGTH } from "./recipeImageToImageSettings";

export type FoodPhoto = { name: string; dataUrl: string };

/** Prepare a local food photo for an image-edit request without cropping it. */
export async function prepareFoodPhoto(file: File, maxLength = MAX_FOOD_REFERENCE_LENGTH): Promise<FoodPhoto> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG, or WebP food photo.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose a photo smaller than 25 MB.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read this photo. Please try another file."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not open this photo. Please try another file."));
    img.src = dataUrl;
  });
  if (dataUrl.length <= maxLength && Math.max(image.width, image.height) <= 2048) return { name: file.name, dataUrl };

  let scale = Math.min(1, 2048 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare this photo.");
  // Two photos need a smaller per-image budget to fit one serverless request.
  const attempts = maxLength < MAX_FOOD_REFERENCE_LENGTH ? 6 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let prepared = canvas.toDataURL("image/jpeg", 0.92);
    if (prepared.length > maxLength) prepared = canvas.toDataURL("image/jpeg", 0.78);
    if (prepared.length <= maxLength) return { name: file.name, dataUrl: prepared };
    scale *= 0.8;
  }
  throw new Error("This photo is too large to upload. Please choose a smaller photo.");
}
