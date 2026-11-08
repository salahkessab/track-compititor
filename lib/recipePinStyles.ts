export const RECIPE_PIN_STYLES = [
  {
    value: "vintage_notebook",
    label: "Vintage Notebook Post",
    plannerBrief: "Facebook-first vintage notebook post, bigger food image, short title, nostalgic page feel, only 3 to 5 short ingredients, no long instructions.",
  },
  {
    value: "bold_hero",
    label: "Bold Hero Food Post",
    plannerBrief: "Facebook-first bold food post, one dominant close-up hero image, short clear title band, almost no extra text, rich texture, cozy warmth.",
  },
  {
    value: "clean_editorial",
    label: "Clean Editorial Post",
    plannerBrief: "Facebook-first clean editorial food post, premium minimal layout, large food photo, large readable title, almost no secondary text.",
  },
  {
    value: "rustic_farmhouse",
    label: "Rustic Farmhouse Post",
    plannerBrief: "Facebook-first rustic farmhouse post, warm wood, family-kitchen comfort, big food image, simple title, optional tiny family favorite subtitle.",
  },
  {
    value: "step_by_step_mini",
    label: "Step-by-Step Mini Post",
    plannerBrief: "Facebook-first step mini post, big food image, very small clean 3-step strip only: Prep, Cook, Serve, no tiny text, no clutter.",
  },
  {
    value: "ingredient_spotlight",
    label: "Ingredient Spotlight Post",
    plannerBrief: "Facebook-first ingredient spotlight post, dominant food image with only 3 to 5 short ingredient callouts, fast to read on mobile.",
  },
  {
    value: "scoop_serve",
    label: "Scoop / Serve Shot",
    plannerBrief: "Facebook-first action food post, spoon lift, cheese pull, sauce pour, steam, scoop, or serving motion, large title, very little text.",
  },
  {
    value: "hero_recipe_card_combo",
    label: "Hero + Recipe Card Combo",
    plannerBrief: "Facebook-first hero plus mini recipe card post, big food image dominates and a small recipe card area carries only 3 to 5 short ingredients.",
  },
  {
    value: "story_card_facebook_post",
    label: "Story Card Facebook Post",
    plannerBrief: "Facebook-first story card recipe post, large homemade food photo with a small hanging or pinned recipe card overlay, practical and shareable, with the caption carrying most recipe detail.",
  },
] as const;

export type RecipePinStyle = (typeof RECIPE_PIN_STYLES)[number]["value"];

export const DEFAULT_RECIPE_PIN_STYLE: RecipePinStyle = "bold_hero";

export function recipePinStyleLabel(style: RecipePinStyle): string {
  return RECIPE_PIN_STYLES.find((option) => option.value === style)?.label ?? "Bold Hero Food Post";
}

export function recipePinStylePlannerBrief(style: RecipePinStyle): string {
  return RECIPE_PIN_STYLES.find((option) => option.value === style)?.plannerBrief ?? RECIPE_PIN_STYLES[1].plannerBrief;
}
