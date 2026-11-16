import { getRecipeStyle, validateRecipePromptCopy, type RecipePromptCopy, type RecipeStyleId } from "./recipeDesignStylePresets";
import { validateTitle } from "./recipeDesigns";
import { requiresRecipeIngredients, isNewPhotoStyle } from "./recipeDesignIngredients";

// Vercel's request body is bounded. Keep the original image first and reserve
// room for the complete prompt and optional style references.
export const MAX_RECIPE_EDIT_REQUEST_CHARS = 4_000_000;

// The proven Farmhouse prompt stays unchanged. These short final checks keep
// the other families visually distinct without replacing their full prompts.
const DIRECT_STYLE_FINAL_CHECK: Record<string, string> = {
  black_label_vintage: "The finished graphic must read as an engraved black recipe sign, not a black strip. Keep the food photograph larger than the label; give the exact title bold cream-and-antique-gold lettering inside a shaped dark plaque with convincing ornamental keylines. Avoid the Farmhouse floral/gingham label.",
  notebook_comfort_food: "The finished graphic must read as a tactile family recipe notebook: one large mounted food photo, believable ruled paper and restrained tape or binding, with the exact title given strong, warm handwritten-and-serif hierarchy. Do not leave unused writing lines or an empty note card. Avoid a plain photo over a beige rectangle.",
  retro_diner_poster: "The finished graphic must read as an energetic mid-century diner poster: the food photo remains the hero, and the exact title is bold and mobile-readable in a purposeful ticket, menu arch, or marquee shape. Use cherry red, warm ivory and a controlled dark accent; avoid the Black Label's heavy charcoal-and-gold sign treatment and do not add prices or slogans.",
  old_cookbook_panel: "The finished graphic must read as a richly printed heirloom cookbook page: one dominant real-food photograph, a substantial old-style serif title, disciplined double rules and a few woodcut-inspired ornaments on warm aged paper. Keep margins tight and intentional. Avoid a flat beige page, tiny heading, or generic centered card.",
  modern_editorial_food: "The finished graphic must read as a contemporary food-editorial cover: one expansive real-food photograph, an unmistakably asymmetrical grid, an oversized exact title in confident display type, and a restrained color-block system. Avoid a centered photo, vintage frame or plain title plaque. Keep type off the meal and readable on a phone.",
  mediterranean_market_print: "The finished graphic must read as a sunlit Mediterranean market print: one large authentic food photograph integrated with a single arch or tile-portal idea, confident painted-market title lettering and restrained cobalt, terracotta and chalk-cream rhythm. Keep decoration outside the meal. Avoid farmhouse flowers, black signboards and a generic rectangular title card.",
  vintage_ingredients_card: "The finished graphic must have one generous food photograph and a compact vintage cream label with the exact title, INGREDIENTS: heading and every supplied ingredient line and amount. Use a clear red title, dark ingredient lettering, red heart bullets and restrained red-and-teal outlines. Never invent, omit or rewrite ingredients.",
};

export function validateRecipeEditImage(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Invalid or oversized recipe image. Choose a JPG, PNG, or static WebP file.");
  }
  return value;
}

export function recipeDirectPrompt(styleId: RecipeStyleId, titleValue: unknown, notesValue: unknown, copyValue?: unknown, ingredientsValue?: string, canvasSize?: string, photoInstructions: unknown = ""): string {
  if (typeof photoInstructions !== "string" || photoInstructions.length > 4000) throw new Error("Photo instructions must be text with at most 4000 characters.");
  const { title } = validateTitle(titleValue, typeof titleValue === "string" && !titleValue.trim());
  const style = getRecipeStyle(styleId);
  if (!style) throw new Error("Choose a saved Recipe Designs style.");
  if (typeof notesValue !== "string" || notesValue.length > 1000) throw new Error("Invalid extra instructions.");
  const copy = validateRecipePromptCopy(copyValue, styleId) as RecipePromptCopy | undefined;
  const isIngredientsCard = requiresRecipeIngredients(styleId);
  const wordpress = canvasSize === "1536x864";
  const rawTemplate = copy?.template || style.template;
  const template = wordpress ? rawTemplate.replaceAll("4:5", "16:9").replaceAll("1200 × 1500", "1536 × 864").replace(/\bvertical\b/gi, "landscape").replace(/\bportrait\b/gi, "landscape") : rawTemplate;
  const fullPrompt = isIngredientsCard
    ? template.replace(/\{\{(?:TITLE|STYLE_NOTES|INGREDIENTS)\}\}/g, token => token === "{{TITLE}}" ? title : token === "{{STYLE_NOTES}}" ? notesValue : ingredientsValue?.trim() || "[No ingredients supplied]")
    : template.replaceAll("{{TITLE}}", title).replaceAll("{{STYLE_NOTES}}", notesValue);
  const directPrompt = `${fullPrompt}\n\nDIRECT IMAGE EDIT INSTRUCTIONS:\nThe first attached image is the owner's original food photograph. Use it as the food source for this finished design. Any later attached images are visual style references only; do not copy their food, title, logo, or finished layout. Produce the COMPLETE finished recipe graphic in this one image, including the exact title \"${title}\"${isIngredientsCard ? " and every supplied ingredient line and amount, with the INGREDIENTS: heading" : ""}. References to a protected photo layer in the style specification mean preserve the source food visually; no later compositor will add the photo or title. Do not leave an empty photo opening, an empty label, or placeholder text. Preserve the food's appearance as faithfully as the image-edit model allows. ${wordpress ? "Compose a full-width 1536 × 864 landscape WordPress article image in 16:9. Adapt the chosen style to the wide canvas, with the food dominant and all exact text legible. Keep essential content away from the edges. Do not add portrait panels or blurred sidebars." : "Keep the complete title and essential composition inside a centered 4:5 safe area so a portrait output can be exported without cutting them off."} Do not invent ingredients, slogans, logos, watermarks, or extra copy.`;
  if (isNewPhotoStyle(styleId)) {
    const missing = `${!title.trim() ? " No title was supplied: omit the title; do not invent one." : ""}${!ingredientsValue?.trim() ? " No ingredient list was supplied: omit the ingredients heading and list; do not invent ingredients or amounts." : ""}`;
    const sized = canvasSize && canvasSize !== "auto" ? fullPrompt.replaceAll("1200 × 1500", canvasSize.replace("x", " × ")) : fullPrompt;
    return `${sized}\n\nOPTIONAL TEXT OVERRIDES:${missing}\n\nREFERENCE HANDLING:\nThe first attached image is a dish reference only. Ignore any existing labels, borders or typography in it. Create the new photograph and graphic described above. Later images are optional style inspiration only. Use only the exact supplied title and ingredient list for text.${notesValue ? `\nAdditional owner preferences: ${notesValue}` : ""}${photoInstructions.trim() ? `\nPHOTO EDIT PREFERENCES:\n${photoInstructions.trim()}\nApply these preferences only to the newly created food photograph. Preserve the selected label design, title, ingredient text, typography and frame. Never add or omit ingredients.` : ""}`;
  }
  const finishing = DIRECT_STYLE_FINAL_CHECK[styleId];
  const photoEdits = photoInstructions.trim() ? `\n\nFOOD PHOTO EDITS ONLY:\nApply these edits exclusively inside the food photograph, never to the surrounding graphic: ${photoInstructions.trim()}\nDESIGN PRESERVATION: Keep the selected ${style.name} design specification, outer layout, frame, decorative background, title placement, typography, exact recipe title and supplied ingredient-card text unchanged. A tabletop color request affects only the table pictured in the food photograph, not the design background. Background cleanup must not remove design decorations. Camera and ingredient-position edits stay within the existing photo area. Requested bold ingredient labels may appear only inside that photo and must not replace or restyle the main title or ingredient card. Never invent ingredients or quantities. These scoped photo edits override source-photo appearance preservation only for the explicitly requested changes; they cannot override the design preservation rules.` : "";
  return `${directPrompt}${finishing ? `\n\nSTYLE-SPECIFIC FINAL CHECK:\n${finishing}` : ""}${notesValue ? `\n\nAdditional owner instructions: ${notesValue}` : ""}${photoEdits}`;
}
