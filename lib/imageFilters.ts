export type ImageAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  grain: number;
};

export const ORIGINAL_ADJUSTMENTS: ImageAdjustments = {
  brightness: 0, contrast: 0, saturation: 0, warmth: 0, grain: 0,
};

export const IMAGE_FILTER_PRESETS = [
  { id: "original", label: "Original", icon: "○", adjustments: ORIGINAL_ADJUSTMENTS },
  { id: "pinterest", label: "Pinterest", icon: "✦", adjustments: { brightness: 3, contrast: 6, saturation: 4, warmth: 6, grain: 3 } },
  { id: "vintage", label: "Vintage", icon: "▦", adjustments: { brightness: 2, contrast: -8, saturation: -15, warmth: 12, grain: 9 } },
  { id: "warm", label: "Warm", icon: "☀", adjustments: { brightness: 2, contrast: 3, saturation: 3, warmth: 18, grain: 0 } },
  { id: "cool", label: "Cool", icon: "❄", adjustments: { brightness: 1, contrast: 4, saturation: -3, warmth: -18, grain: 0 } },
  { id: "editorial", label: "Editorial", icon: "▤", adjustments: { brightness: 3, contrast: 10, saturation: -8, warmth: 2, grain: 3 } },
  { id: "moody", label: "Moody", icon: "☾", adjustments: { brightness: -11, contrast: 13, saturation: -9, warmth: -2, grain: 4 } },
  { id: "vibrant", label: "Vibrant", icon: "✧", adjustments: { brightness: 3, contrast: 8, saturation: 17, warmth: 3, grain: 0 } },
  { id: "soft", label: "Soft", icon: "✿", adjustments: { brightness: 6, contrast: -10, saturation: -5, warmth: 5, grain: 2 } },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: string; adjustments: ImageAdjustments }>;

export type ImageFilterPreset = (typeof IMAGE_FILTER_PRESETS)[number]["id"];

/** Adjust RGB in place; alpha and fully transparent pixels are preserved. */
export function applyImageAdjustments(data: Uint8ClampedArray, width: number, settings: ImageAdjustments): void {
  const { brightness, contrast, saturation, warmth, grain } = settings;
  if (!brightness && !contrast && !saturation && !warmth && !grain) return;
  const light = 1 + brightness / 100;
  const contrastFactor = 1 + contrast / 100;
  const saturationFactor = 1 + saturation / 100;
  const temperature = warmth * 0.55;
  for (let offset = 0, pixel = 0; offset < data.length; offset += 4, pixel++) {
    if (!data[offset + 3]) continue;
    const red = (data[offset] * light - 128) * contrastFactor + 128;
    const green = (data[offset + 1] * light - 128) * contrastFactor + 128;
    const blue = (data[offset + 2] * light - 128) * contrastFactor + 128;
    const gray = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    let noise = 0;
    if (grain) {
      // Stable per-pixel noise makes the exported image match the preview.
      const x = pixel % width, y = Math.floor(pixel / width);
      let hash = Math.imul(x + 1, 0x1f123bb5) ^ Math.imul(y + 1, 0x5f356495);
      hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
      noise = (((hash >>> 16) & 255) / 255 - 0.5) * grain * 1.2;
    }
    data[offset] = gray + (red - gray) * saturationFactor + temperature + noise;
    data[offset + 1] = gray + (green - gray) * saturationFactor + noise;
    data[offset + 2] = gray + (blue - gray) * saturationFactor - temperature + noise;
  }
}
