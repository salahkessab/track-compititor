export type LayerBox = { x: number; y: number; width: number; height: number };

/** Fit the whole source photo into its canvas area without cropping or stretching it. */
export function fitPhotoLayer(area: LayerBox, width: number, height: number): LayerBox {
  if (![width, height, area.width, area.height].every(value => Number.isFinite(value) && value > 0)) throw new Error("Invalid photo or canvas dimensions.");
  const scale = Math.min(area.width / width, area.height / height);
  const fittedWidth = Math.max(1, Math.min(area.width, Math.round(width * scale)));
  const fittedHeight = Math.max(1, Math.min(area.height, Math.round(height * scale)));
  return { x: Math.round(area.x + (area.width - fittedWidth) / 2), y: Math.round(area.y + (area.height - fittedHeight) / 2), width: fittedWidth, height: fittedHeight };
}
