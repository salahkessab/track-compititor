import OpenAI from "openai";
import { recordTextUsage, recordSearchUsage } from "./costLedger";
import type { RecipeMode } from "./recipeSeed";

export type RecipeTrendSummary = {
  popularTitles: string[];
  commonIngredients: string[];
  cookingStyles: string[];
  viralHooks: string[];
  trendAngle: string;
  trendSummary: string;
};

const RECIPE_MODE_LABELS: Record<RecipeMode, string> = {
  auto: "general Facebook recipe ideas",
  dessert: "desserts and sweets",
  comfort: "comfort food",
  breakfast: "breakfast recipes",
  dinner: "dinner mains",
  soup: "soups and stews",
  healthy: "healthy and fresh recipes",
  baking: "baking and bread",
  pasta: "pasta recipes",
  chicken: "chicken recipes",
  beef: "beef recipes",
  seafood: "seafood recipes",
  drink: "drink recipes",
};

function parseTrendJson(text: string): RecipeTrendSummary | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    const toList = (value: unknown, max = 5) =>
      Array.isArray(value)
        ? value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, max)
        : [];
    const trendAngle = String(obj.trendAngle ?? "").trim();
    const trendSummary = String(obj.trendSummary ?? "").trim();
    if (!trendAngle || !trendSummary) return null;
    return {
      popularTitles: toList(obj.popularTitles),
      commonIngredients: toList(obj.commonIngredients, 7),
      cookingStyles: toList(obj.cookingStyles),
      viralHooks: toList(obj.viralHooks),
      trendAngle,
      trendSummary,
    };
  } catch {
    return null;
  }
}

export async function researchRecipeTrends(args: {
  category: RecipeMode;
  customSubject?: string;
  model?: string;
}): Promise<RecipeTrendSummary | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const categoryLabel = RECIPE_MODE_LABELS[args.category] || RECIPE_MODE_LABELS.auto;
  const subject = args.customSubject?.trim();
  const focus = subject
    ? `${subject} in the context of ${categoryLabel}`
    : categoryLabel;
  const model = args.model || "gpt-5.4-mini";

  const response = await client.responses.create({
    model,
    tools: [{ type: "web_search_preview" }],
    input: `Research current popular or viral recipe ideas for ${focus}.

Extract only high-level inspiration signals for building an original Facebook recipe post.

Return STRICT JSON only:
{
  "popularTitles": ["up to 5 short generic trend titles or dish names"],
  "commonIngredients": ["up to 7 short ingredient patterns"],
  "cookingStyles": ["up to 5 short cooking-style phrases"],
  "viralHooks": ["up to 5 short hook angles"],
  "trendAngle": "one short combined angle like creamy comfort pasta",
  "trendSummary": "one short sentence summarizing the trend"
}

Rules:
- Use web research only to identify trends, not to copy recipe text.
- Do not copy full recipe instructions.
- Do not copy article intros.
- Do not mention website names in the JSON.
- Do not return source URLs.
- Keep everything generic, high-level, and originality-safe.
- Generic dish names are allowed. Exact branded or distinctive article titles are not.
- Focus on what is currently familiar, engaging, comforting, and Facebook-friendly.`,
  });

  recordTextUsage(model, response.usage, "responses");
  recordSearchUsage(model, response.output);

  return parseTrendJson(response.output_text || "");
}
