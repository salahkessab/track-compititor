import { DEFAULT_IMAGE_SETTINGS, type OpenAIImageSettings } from "./openaiImageSettings";

export const RECIPE_IMAGE_TO_IMAGE_MODEL = "gpt-image-2.6-sunburst";
export const RECIPE_IMAGE_TO_IMAGE_SETTINGS: OpenAIImageSettings = {
  ...DEFAULT_IMAGE_SETTINGS, output_format: "webp", complexity: "default",
};
export const MAX_EXTRA_INSTRUCTIONS = 4000;
// Leave room for JSON and settings under the deployment's request-body limit.
export const MAX_FOOD_REFERENCE_LENGTH = 3_000_000;
// Two encoded photos plus JSON must fit in a single serverless request.
export const MAX_TWO_IN_ONE_PHOTO_LENGTH = 1_800_000;
export const MAX_RECIPE_VARIATIONS = 10;
