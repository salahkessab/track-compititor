// Shared API capabilities; keep validation identical in the UI and server.
export const OPENAI_IMAGE_MODEL_IDS = [
  "gpt-image-1.5", "gpt-image-2", "gpt-image-2-2026-04-21",
  "gpt-image-2.5-flare", "gpt-image-2.5-flare-2026-09-08", "gpt-image-2.5-sunburst",
  "gpt-image-2.6-sunburst",
] as const;
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-2.5-sunburst";
export const IMAGE_SIZES = ["auto", "1024x1024", "1024x1536", "1536x1024"] as const;
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
export type OpenAIImageSettings = {
  size: typeof IMAGE_SIZES[number];
  quality: typeof IMAGE_QUALITIES[number];
  output_format: "png" | "jpeg" | "webp";
  background: "auto" | "opaque" | "transparent";
  moderation: "auto" | "low";
  partial_images: number;
  complexity?: "default" | "low" | "medium" | "high";
};
export const DEFAULT_IMAGE_SETTINGS: OpenAIImageSettings = {
  size: "1024x1536", quality: "high", output_format: "png",
  background: "opaque", moderation: "auto", partial_images: 0,
};
export function isOpenAIImageModel(model: string): boolean {
  return (OPENAI_IMAGE_MODEL_IDS as readonly string[]).includes(model);
}
export function imageQualitiesFor(model: string) {
  return model.startsWith("gpt-image-2.5-") ? IMAGE_QUALITIES : IMAGE_QUALITIES.slice(0, 4);
}
export function supportsImageComplexity(model: string): boolean {
  return model === "gpt-image-2.6-sunburst";
}
export function validateImageSettings(model: string, value: unknown): OpenAIImageSettings {
  if (!isOpenAIImageModel(model)) throw new Error("Unsupported OpenAI image model");
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("Invalid image settings");
  }
  const s = { ...DEFAULT_IMAGE_SETTINGS, ...(value as Partial<OpenAIImageSettings>) };
  if (!IMAGE_SIZES.includes(s.size)) throw new Error("Unsupported image size");
  if (!imageQualitiesFor(model).includes(s.quality)) throw new Error("This image model does not support the selected quality");
  if (!["png", "jpeg", "webp"].includes(s.output_format)) throw new Error("Unsupported output format");
  if (!["auto", "opaque", "transparent"].includes(s.background)) throw new Error("Unsupported background");
  if (!["auto", "low"].includes(s.moderation)) throw new Error("Unsupported moderation setting");
  if (!Number.isInteger(s.partial_images) || s.partial_images < 0 || s.partial_images > 3) throw new Error("Partial images must be 0 to 3");
  if (s.complexity !== undefined && !["default", "low", "medium", "high"].includes(s.complexity)) throw new Error("Unsupported image complexity");
  if (s.complexity && s.complexity !== "default" && !supportsImageComplexity(model)) throw new Error("This image model does not support complexity");
  if (s.background === "transparent" && s.output_format === "jpeg") throw new Error("Transparent backgrounds require PNG or WebP");
  return { size: s.size, quality: s.quality, output_format: s.output_format,
    background: s.background, moderation: s.moderation, partial_images: s.partial_images,
    ...(s.complexity !== undefined ? { complexity: s.complexity } : {}) };
}
