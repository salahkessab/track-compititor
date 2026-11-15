import { MAX_EXTRA_INSTRUCTIONS, MAX_FOOD_REFERENCE_LENGTH } from "./recipeImageToImageSettings";
import { quickInstructions } from "./photoQuickInstructions";

// Server-only prompt: never pass through a planner, return it in a response, or
// import this module into the client workspace.
const FOOD_VARIATION_PROMPT = [
  "You are an expert in authentic smartphone food photography and realistic reference-based image generation.",
  "",
  "Generate a new food photograph based on the uploaded reference image.",
  "",
  "Preserve the original recipe, food identity, recognizable ingredients, realistic portions, colors, cooking level, and natural imperfections.",
  "",
  "The output must look like a genuine casual iPhone 17 Pro Max food photo taken by a real person, not a polished AI food image or commercial advertisement.",
  "",
  "Strictly preserve:",
  "- the same dish",
  "- the same ingredient proportions",
  "- the same general food appearance",
  "- the same homemade realism",
  "",
  "Mandatory changes for every generation:",
  "- always change the plate, bowl, tray, or dishware to a different realistic one",
  "- always change the table, countertop, or background surface",
  "- if a spoon or fork is visible, change its color or finish",
  "- make the result feel like a different real photo of the same food",
  "",
  "Style requirements:",
  "- ultra-realistic",
  "- natural lighting",
  "- realistic white balance",
  "- subtle smartphone sharpness",
  "- true-to-life colors",
  "- natural shadows",
  "- believable texture",
  "- no excessive gloss",
  "- no fake steam",
  "- no exaggerated food styling",
  "- no oversized ingredients",
  "- no plastic-looking surfaces",
  "- no studio-advertising look",
  "- no added text unless the user explicitly requests ingredient labels; do not add watermarks",
  "",
  "The final result must look like an authentic homemade food photograph from a phone camera roll.",
].join("\n");

const MANDATORY_MARKERS = ["Mandatory changes for every generation:", "- always change the plate", "- always change the table", "- if a spoon or fork", "- make the result feel like a different real photo"];
const PRESET_SAFE_PROMPT = FOOD_VARIATION_PROMPT.split("\n")
  .filter((line) => !MANDATORY_MARKERS.some((marker) => line.startsWith(marker)))
  .join("\n")
  .replace("Strictly preserve:", "Apply ONLY the changes listed under the user's instructions below. Everything else, including dishware, table, utensils, lighting and camera, stays as photographed unless a listed change says otherwise.\n\nStrictly preserve (except where a listed change requires otherwise):");

export function foodVariationPrompt(extraInstructions: unknown): string {
  if (extraInstructions !== undefined && typeof extraInstructions !== "string") {
    throw new Error("Extra instructions must be text.");
  }
  const extra = (extraInstructions as string | undefined)?.trim() || "";
  if (extra.length > MAX_EXTRA_INSTRUCTIONS) throw new Error("Extra instructions must be 4000 characters or fewer.");
  // Experimental: when a quick preset is active the user asked for specific edits, so the default
  // "change dishware and surface" block must not fight it. Everything not requested stays as photographed.
  const presetActive = quickInstructions.some((preset) => extra.includes(preset.text));
  const base = presetActive ? PRESET_SAFE_PROMPT : FOOD_VARIATION_PROMPT;
  return base + (extra ?"\nUser-requested edits take priority over default styling, camera, dishware and layout choices, while food identity and ingredient amounts remain protected. Preserving ingredients does not mean preserving their coordinates. When rearrangement is requested, visibly relocate the individual ingredients and their containers, not just their labels or background. Do not interpret a lighting or background-only edit as a request to rearrange.\nAdditional user instructions: " + extra : "");
}

export function foodReference(references: unknown): string {
  if (!Array.isArray(references) || references.length !== 1 || typeof references[0] !== "string") {
    throw new Error("Upload exactly one food photo.");
  }
  const reference = references[0];
  if (reference.length > MAX_FOOD_REFERENCE_LENGTH ||
      !/^data:image\/(png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(reference) ||
      reference.endsWith(",")) {
    throw new Error("Use a valid JPG, PNG, or WebP food photo under 2 MB after resizing.");
  }
  return reference;
}
