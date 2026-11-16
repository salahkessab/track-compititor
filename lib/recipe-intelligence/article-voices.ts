// Writing styles for the Master recipe article (experiment). The recipe itself (ingredients, quantities, method)
// never changes between styles: only the introduction, the optional prose sections, their headings and the tone.
export type ArticleVoice = "classic" | "lean" | "story" | "quick" | "holiday" | "budget" | "beginner";

export const ARTICLE_VOICES: { id: ArticleVoice; label: string }[] = [
  { id: "classic", label: "Classic: the default Master recipe article (no fixed length)" },
  { id: "lean", label: "Lean: short introduction, recipe, tips (~500–650 words)" },
  { id: "story", label: "Story: occasion, family scene, FAQ (~1,300–1,500 words)" },
  { id: "quick", label: "Quick & Practical: straight to the point, tips and mistakes (~800–900 words)" },
  { id: "holiday", label: "Holiday / Occasion: make-ahead, hosting, serving guests (~1,300–1,500 words)" },
  { id: "budget", label: "Budget / Family: cost, kids, leftovers, meal prep (~1,300–1,500 words)" },
  { id: "beginner", label: "Step-by-step Beginner: plain words, how to know it's done (~1,450–1,650 words)" },
];

/** A style choice in the settings: one style for every article, or "auto" for a different style per article. */
export type ArticleVoiceSetting = ArticleVoice | "auto";
export const AUTO_VOICE_LABEL = "Auto: the app picks a different style for each article";
export const AUTO_VOICES: ArticleVoice[] = ["lean", "story", "quick", "holiday", "budget", "beginner"];
export const isVoiceSetting = (value: unknown): value is ArticleVoiceSetting => value === "auto" || isArticleVoice(value);

/** The style for one recipe. "auto" picks from AUTO_VOICES using the recipe's URL or title, so the same recipe keeps the
 *  same style across the article, correction and validation stages, while different recipes get different styles. */
export function voiceFor(setting: unknown, recipe: { url?: string; title?: string }): ArticleVoice | undefined {
  if (setting !== "auto") return isArticleVoice(setting) ? setting : undefined;
  const key = recipe.url || recipe.title || "";
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
  return AUTO_VOICES[hash % AUTO_VOICES.length];
}

// Word ranges in the labels are for a typical 1,300-word source; story-based styles follow the source article's length.
export const isArticleVoice = (value: unknown): value is ArticleVoice => ARTICLE_VOICES.some(v => v.id === value);

/** The chosen style, or the older environment switches when a batch was created without one. */
export function resolveVoice(value?: unknown): ArticleVoice {
  if (isArticleVoice(value)) return value;
  if (process.env.EXPERIMENT_STORY_ARTICLE === "1") return "story";
  if (process.env.EXPERIMENT_LEAN_ARTICLE === "1") return "lean";
  return "classic";
}

/** Styles rendered with the long sectioned layout (introduction, special, recipe card, tips, serving, FAQ, storage). */
export const sectionedVoice = (voice: ArticleVoice) => !["classic", "lean"].includes(voice);

export type VoiceLayout = { special: (title: string) => string; instructions: string; tips: string; serving: (title: string) => string; faqs: string; storage: string };
export const VOICE_LAYOUTS: Record<Exclude<ArticleVoice, "classic" | "lean">, VoiceLayout> = {
  story: { special: t => `What Makes This ${t} Special`, instructions: "Instructions", tips: "Tips for the Best Results", serving: t => `What to Serve With ${t}`, faqs: "Frequently Asked Questions", storage: "Storage" },
  quick: { special: () => "Why This Recipe Works", instructions: "Instructions", tips: "Tips and Mistakes to Avoid", serving: () => "Quick Serving Ideas", faqs: "Quick Answers", storage: "Storage" },
  holiday: { special: t => `Why ${t} Belongs on Your Table`, instructions: "Instructions", tips: "Make-Ahead and Hosting Tips", serving: () => "How to Serve It to Guests", faqs: "Frequently Asked Questions", storage: "Storage and Leftovers" },
  budget: { special: () => "Why It Works for Families", instructions: "Instructions", tips: "Money-Saving Tips", serving: () => "Family-Friendly Serving Ideas", faqs: "Frequently Asked Questions", storage: "Leftovers and Meal Prep" },
  beginner: { special: () => "Before You Start", instructions: "Step-by-Step Instructions", tips: "How to Know It's Done", serving: t => `What to Serve With ${t}`, faqs: "Beginner Questions", storage: "Storage" },
};

/** Length relative to the source article (story = 1). Quick & Practical is deliberately shorter. */
export const VOICE_LENGTH: Record<ArticleVoice, number> = { classic: 1, lean: 1, story: 1, quick: 0.6, holiday: 1, budget: 1, beginner: 1.1 };
