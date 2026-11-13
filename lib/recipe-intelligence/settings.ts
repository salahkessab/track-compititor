import { DEFAULT_IMAGE_SETTINGS, validateImageSettings, type OpenAIImageSettings } from "../openaiImageSettings";
import { IntelligenceStore } from "./database";
import { writingModelProfile, type WritingModel } from "./textModels";
export type Basis = "original" | "best_complete";
export type Automation = "full" | "before_articles" | "before_images";
export type ArticleFormat = "compact_v1" | "blog_1000_1200_v1" | "master_recipe_v1";
// Optional on stored v2 batches; new preparations always snapshot all three colors.
export type PhotoPalette = { cookware: string; surface: string; utensil?: string };
export const DEFAULT_PHOTO_PALETTE: PhotoPalette = { cookware: "#607D8B", surface: "#E5D6BF", utensil: "#5C3A2E" };
export type ContentSettings = {
  basis: Basis; mode: Automation; textModel: WritingModel; imageModel: string;
  images: boolean; imageSettings: OpenAIImageSettings; pinterestTitle: boolean; correction: boolean;
  articleFormat?: ArticleFormat;
  imageWorkflow?: "reference" | "legacy";
  output?: "article_images" | "article_only" | "images_only";
  palette?: PhotoPalette;
  imageStorage?: "lossless-webp-v1";
};
export const DEFAULT_CONTENT_SETTINGS: ContentSettings = {
  basis: "original", mode: "full", textModel: "gpt-5.5", imageModel: "gpt-image-2.6-sunburst",
  images: true, imageSettings: { ...DEFAULT_IMAGE_SETTINGS, size: "1536x864", quality: "medium", background: "opaque", output_format: "png", moderation: "auto", partial_images: 0, complexity: "default" }, pinterestTitle: false, correction: true,
  articleFormat: "master_recipe_v1",
  imageWorkflow: "reference", output: "article_images", palette: DEFAULT_PHOTO_PALETTE,
};
export function validateContentSettings(input: Partial<ContentSettings>): ContentSettings {
  const value = { ...DEFAULT_CONTENT_SETTINGS, ...input };
  if (!["original", "best_complete"].includes(value.basis) || !["full", "before_articles", "before_images"].includes(value.mode)) throw new Error("Invalid recipe basis or automation mode.");
  if (!writingModelProfile(value.textModel)) throw new Error("This writing model does not have a verified pricing profile.");
  if (!["compact_v1", "blog_1000_1200_v1", "master_recipe_v1"].includes(value.articleFormat || "")) throw new Error("Choose a supported article style.");
  if (!["reference", "legacy"].includes(value.imageWorkflow || "") || !["article_images", "article_only", "images_only"].includes(value.output || "")) throw new Error("Choose a supported content workflow.");
  const inputPalette = value.palette || DEFAULT_PHOTO_PALETTE;
  const palette = { ...inputPalette, utensil: inputPalette.utensil === undefined ? DEFAULT_PHOTO_PALETTE.utensil : inputPalette.utensil };
  if (![palette.cookware, palette.surface, palette.utensil].every(c => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))) throw new Error("Choose valid cookware, surface and spoon/utensil colors.");
  for (const key of ["images", "pinterestTitle", "correction"] as const) if (typeof value[key] !== "boolean") throw new Error("Invalid content setting.");
  const imageSettings = validateImageSettings(value.imageModel, value.imageSettings);
  if (value.output === "images_only" && !value.images) throw new Error("Enable images for an images-only job.");
  if (imageSettings.partial_images !== 0) throw new Error("Batch images use one final output; partial previews remain available in the existing image tools.");
  if (imageSettings.size === "auto" || imageSettings.quality === "auto") throw new Error("Choose explicit image size and quality for a reviewable batch estimate.");
  return { basis: value.basis, mode: value.mode, textModel: value.textModel, imageModel: value.imageModel, images: value.output === "article_only" ? false : value.images, imageSettings, pinterestTitle: value.pinterestTitle, correction: value.correction, articleFormat: value.articleFormat, imageWorkflow: value.imageWorkflow, output: value.output, palette: { ...palette } };
}
export function contentSettings(store: IntelligenceStore): ContentSettings {
  const row = store.db.prepare("SELECT value FROM settings WHERE key='content_defaults'").get() as any;
  return row ? validateContentSettings(JSON.parse(row.value)) : DEFAULT_CONTENT_SETTINGS;
}
export function saveContentSettings(store: IntelligenceStore, input: Partial<ContentSettings>) {
  const value = validateContentSettings(input);
  store.db.prepare("INSERT INTO settings(key,value) VALUES('content_defaults',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
  return value;
}
