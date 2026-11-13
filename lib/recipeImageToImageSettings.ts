import { DEFAULT_IMAGE_SETTINGS, type OpenAIImageSettings } from "./openaiImageSettings";

export const RECIPE_IMAGE_TO_IMAGE_MODEL = "gpt-image-2.6-sunburst";
export const RECIPE_IMAGE_TO_IMAGE_SETTINGS: OpenAIImageSettings = {
  ...DEFAULT_IMAGE_SETTINGS, size: "1024x1536", output_format: "png", complexity: "default",
};
export function recipePlatformPreset(value: OpenAIImageSettings, size: OpenAIImageSettings["size"]): OpenAIImageSettings {
  if (size === "1536x864") return { ...value, size, output_format: "webp" };
  if (size === "1024x1536" || size === "1152x1440") return { ...value, size, output_format: "png" };
  return { ...value, size };
}
export const MAX_EXTRA_INSTRUCTIONS = 4000;
// Leave room for JSON and settings under the deployment's request-body limit.
export const MAX_FOOD_REFERENCE_LENGTH = 3_000_000;
// Two encoded photos plus JSON must fit in a single serverless request.
export const MAX_TWO_IN_ONE_PHOTO_LENGTH = 1_800_000;
export const MAX_RECIPE_VARIATIONS = 10;
