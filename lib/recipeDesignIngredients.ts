export const NEW_PHOTO_STYLE_IDS = ["new_photo_vintage_label","new_photo_chalkboard","new_photo_index_card","new_photo_modern_banner","new_photo_kraft_tag"] as const;
export const DEFAULT_RECIPE_STYLE_ID = "new_photo_vintage_label";
export function isNewPhotoStyle(id: string): boolean { return (NEW_PHOTO_STYLE_IDS as readonly string[]).includes(id); }
export function requiresRecipeIngredients(id: string): boolean { return id === INGREDIENT_CARD_STYLE_ID || isNewPhotoStyle(id); }
export const INGREDIENT_CARD_STYLE_ID = "vintage_ingredients_card";

/** Keep the owner's spelling and amounts, while removing blank separator lines. */
export function validateRecipeIngredients(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) throw new Error("Ingredients must be at most 2,000 characters.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error("Ingredients contain unsupported control characters.");
  const lines = value.replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("Add at least one ingredient, one per line.");
  if (lines.length > 20) throw new Error("Use up to 20 ingredient lines so the card remains readable.");
  if (lines.some(line => line.length > 160)) throw new Error("Keep each ingredient line to 160 characters or fewer.");
  return lines.join("\n");
}
