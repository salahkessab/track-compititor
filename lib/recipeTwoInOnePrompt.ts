import { foodReference } from "./recipeImageToImagePrompt";
import { MAX_EXTRA_INSTRUCTIONS, MAX_TWO_IN_ONE_PHOTO_LENGTH } from "./recipeImageToImageSettings";

// The two original food photos are both references for one new image.
const TWO_IN_ONE_PROMPT = [
  "Create ONE new, realistic homemade food photograph using BOTH uploaded food photos as visual references.",
  "Bring together every clearly visible ingredient and food element from both references in one coherent, appetizing real-life scene. Make each recognizable ingredient visible, with its natural color, texture, cooking level, and realistic portion. If both photos show the same ingredient, keep it recognizable without inventing an extra dish.",
  "Arrange the combined foods naturally as one believable meal or serving, preserving the identity and appearance of the food from each reference. Do not replace an ingredient with a different food, omit a visible component, or add unrelated ingredients. The result is a single photograph, not two images side by side, a collage, a split screen, or a before-and-after comparison.",
  "Create a fresh composition with different realistic dishware, table or countertop, camera angle and surrounding details. Do not reproduce either source photograph's exact composition, branding, labels or watermark.",
  "The final image should look like an authentic casual smartphone food photo: natural light, true-to-life colors, believable texture and soft shadows. Avoid glossy advertising, artificial food styling, fake steam, oversized ingredients, plastic-looking food, text and watermarks.",
].join("\n\n");

export function twoInOnePrompt(extraInstructions: unknown): string {
  if (extraInstructions !== undefined && typeof extraInstructions !== "string") throw new Error("Extra instructions must be text.");
  const extra = (extraInstructions as string | undefined)?.trim() || "";
  if (extra.length > MAX_EXTRA_INSTRUCTIONS) throw new Error("Extra instructions must be 4000 characters or fewer.");
  return TWO_IN_ONE_PROMPT + (extra ? "\nAdditional user instructions: " + extra : "");
}

export function twoInOneReferences(references: unknown): [string, string] {
  if (!Array.isArray(references) || references.length !== 2) throw new Error("Upload exactly two food photos.");
  const checked = references.map((value) => {
    const reference = foodReference([value]);
    if (reference.length > MAX_TWO_IN_ONE_PHOTO_LENGTH) throw new Error("A food photo is too large after preparation. Choose a smaller photo.");
    return reference;
  });
  return [checked[0], checked[1]];
}
