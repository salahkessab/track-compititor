import { horseSceneGuidance, isHorseWallPaintingSceneType } from "@/lib/horseSceneGuidance";
import { buildOpenAIImagePrompt, pairDirection, visualDirection, openAIPlannerSystem } from "@/lib/openaiPrompt";
import { generateOpenAIImage, type PartialImageHandler } from "@/lib/openaiImages";
import { withCostLedger, recordTextUsage, recordOpenAIImage, markCostIncomplete, costSummary } from "@/lib/costLedger";
import { isOpenAIImageModel, validateImageSettings, type OpenAIImageSettings } from "@/lib/openaiImageSettings";
import { imageModelsFor, OPENAI_MODELS } from "@/lib/config";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { fal } from "@fal-ai/client";
import { SYSTEM, HORSE_ART_SYSTEM, isHorseArtSceneType, openAIHorseReferenceSystem, userPrompt, refUserPrompt, captionOnlyUserPrompt, RECIPE_SYSTEM, RECIPE_DESIGNED_PIN_SYSTEM, recipeUserPrompt, recipeDesignedPinUserPrompt, FASHION_SYSTEM, fashionUserPrompt, fashionCaptionOnlyUserPrompt, fashionRefUserPrompt, type CaptionOpts, type Avoid, type InspirationMode, type RecipeTrendContext } from "@/lib/prompts";
import { sceneSeed, type SceneSeed, type UsedSeeds, type SceneMode } from "@/lib/sceneSeed";
import { recipeSeed, type RecipeMode } from "@/lib/recipeSeed";
import { fashionSeed, type FashionMode } from "@/lib/fashionSeed";
import { MODELS, FLUX_I2I, IMAGE, DEFAULT_IMAGE_MODEL, qualitySuffixFor, negativePromptFor, estimateCost, buildModelPrompt, FRAMING_DIRECTIVES, FRAMING_NEGATIVES, FOOD_QUALITY_SUFFIX, FOOD_NEGATIVE, FOOD_QUALITY_DESIGN, FOOD_NEGATIVE_DESIGN, FASHION_QUALITY_SUFFIX, FASHION_NEGATIVE, DEFAULT_RECIPE_DESIGNED_IMAGE_MODEL, isRecipeDesignedImageModel } from "@/lib/config";
import { DEFAULT_RECIPE_PIN_STYLE, RECIPE_PIN_STYLES, recipePinStyleLabel, recipePinStylePlannerBrief, type RecipePinStyle } from "@/lib/recipePinStyles";
import { researchRecipeTrends } from "@/lib/recipeTrendResearch";
import { foodReference, foodVariationPrompt } from "@/lib/recipeImageToImagePrompt";
import { twoInOnePrompt, twoInOneReferences } from "@/lib/recipeTwoInOnePrompt";
import { RECIPE_IMAGE_TO_IMAGE_MODEL } from "@/lib/recipeImageToImageSettings";

export const runtime = "nodejs";
export const maxDuration = 300;

fal.config({ credentials: process.env.FAL_KEY });

function horseSystemForScene(sceneType?: string): string {
  return isHorseArtSceneType(sceneType) ? HORSE_ART_SYSTEM : SYSTEM;
}

type Plan = {
  idea: string;
  prompt: string;
  description: string;
  firstComment?: string;
  title?: string;
  imageDescription?: string;
  ingredients?: string[];
  instructions?: string[];
  language?: string;
  recipeStyle?: string;
  trendSource?: string;
  trendAngle?: string;
  location?: string;
  analysis?: string;
  // Structured inspiration fields (reference flow only)
  referenceStrategy?: string;
  visualMedium?: "photograph" | "artwork";
  contentType?: string;
  viralHook?: string;
  winningElements?: string;
  whyStrong?: string;
  engagementScore?: string;
  rpmScore?: string;
  altText?: string;
  usage: { in: number; out: number } | null;
};

function normalizeStringArray(value: unknown, max = 5): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, max);
  return items.length ? items : undefined;
}

// Remove any hashtags from the caption (we never want them on the post).
function stripHashtags(text: string): string {
  return text
    .replace(/#[\p{L}\p{N}_]+/gu, "")      // drop #word tokens
    .replace(/[ \t]{2,}/g, " ")             // collapse double spaces left behind
    .replace(/[ \t]+\n/g, "\n")             // trim trailing spaces before newlines
    .replace(/\n{3,}/g, "\n\n")             // collapse extra blank lines
    .trim();
}

// Strip the two dead-giveaway AI artifacts from a caption: em/en dashes and
// curly quotes. Deterministic safety net on top of the prompt rules so the
// text reads more human and dodges AI-detection heuristics.
function humanizeText(text: string): string {
  return text
    .replace(/[“”"]/g, "")                   // remove all double quotation marks
    .replace(/[‘’]/g, "'")                  // curly single quotes/apostrophes -> straight
    .replace(/\s*[—–]\s*/g, ", ")           // em/en dash -> comma
    .replace(/(^|\n)\s*,\s*/g, "$1")        // fix a comma left at the start of a line
    .replace(/\s+,/g, ",")                   // space before comma
    .replace(/,\s*,/g, ", ")                 // doubled commas
    .replace(/,\s*([.!?])/g, "$1")           // comma right before . ! ?
    .replace(/[ \t]{2,}/g, " ")             // collapse double spaces
    .trim();
}

// Models sometimes emit raw line breaks/tabs INSIDE a JSON string value
// (valid JSON requires them escaped). This escapes control characters only
// when they appear inside a string, leaving structural whitespace untouched.
function escapeControlCharsInStrings(s: string): string {
  let out = "";
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (inStr) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      if (code < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

function removeTrailingQuestion(text: string): string {
  const cleaned = text.trim();
  if (!cleaned.endsWith("?")) return cleaned;
  const paras = cleaned.split(/\n{2,}/);
  const last = paras[paras.length - 1].trim();
  const m = last.match(/^([\s\S]*[.!?])\s+([^.!?]*\?)$/);
  if (m && m[1].trim()) {
    paras[paras.length - 1] = m[1].trim();
    return paras.join("\n\n").trim();
  }
  if (paras.length > 1) {
    paras.pop();
    return paras.join("\n\n").trim();
  }
  return cleaned.replace(/[^.!?\n]*\?\s*$/, "").trim();
}

function parseJson(text: string): Omit<Plan, "usage"> {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned;
  let obj: any;
  try {
    obj = JSON.parse(slice);
  } catch {
    // Retry after escaping raw control characters inside string values.
    obj = JSON.parse(escapeControlCharsInStrings(slice));
  }
  // Some models still nest the caption under captions.emotional — accept either.
  const rawDescription = obj.description ?? obj.captions?.emotional ?? "";
  const medium = String(obj.visualMedium ?? "").trim().toLowerCase();
  const fc = obj.firstComment ? humanizeText(stripHashtags(String(obj.firstComment).trim())) : undefined;
  return {
    idea: String(obj.idea ?? "").trim(),
    prompt: String(obj.prompt ?? "").trim(),
    description: removeTrailingQuestion(humanizeText(stripHashtags(String(rawDescription).trim()))),
    firstComment: fc || undefined,
    title: obj.title ? String(obj.title).trim() : undefined,
    imageDescription: obj.imageDescription ? String(obj.imageDescription).trim() : undefined,
    ingredients: normalizeStringArray(obj.ingredients, 8),
    instructions: normalizeStringArray(obj.instructions, 3),
    language: obj.language ? String(obj.language).trim() : undefined,
    recipeStyle: obj.recipeStyle ? String(obj.recipeStyle).trim() : undefined,
    location: obj.location ? String(obj.location).trim() : undefined,
    analysis: obj.analysis ? String(obj.analysis).trim() : undefined,
    referenceStrategy: obj.referenceStrategy ? String(obj.referenceStrategy).trim() : undefined,
    visualMedium: /^(photograph|photo|photorealistic)$/.test(medium) ? "photograph"
      : /^(artwork|art|illustration|painting)$/.test(medium) ? "artwork" : undefined,
    contentType: obj.contentType ? String(obj.contentType).trim().toLowerCase() : undefined,
    viralHook: obj.viralHook ? String(obj.viralHook).trim() : undefined,
    winningElements: obj.winningElements ? String(obj.winningElements).trim() : undefined,
    whyStrong: obj.whyStrong ? String(obj.whyStrong).trim() : undefined,
    engagementScore: obj.engagementScore ? String(obj.engagementScore).trim().toLowerCase().split(/\s/)[0] : undefined,
    rpmScore: obj.rpmScore ? String(obj.rpmScore).trim().toLowerCase().split(/\s/)[0] : undefined,
    altText: obj.altText ? String(obj.altText).trim() : undefined,
  };
}

// Detect media type from base64 data URL
function detectMediaType(dataUrl: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  if (dataUrl.startsWith("data:image/png")) return "image/png";
  if (dataUrl.startsWith("data:image/webp")) return "image/webp";
  if (dataUrl.startsWith("data:image/gif")) return "image/gif";
  return "image/jpeg";
}

function stripDataPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

function assertConfigured(needsImage = true) {
  const missing: string[] = [];
  if (needsImage && !process.env.FAL_KEY) missing.push("FAL_KEY");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (missing.length) {
    throw new Error(`Missing environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Add them to .env.local and restart the dev server.`);
  }
}

// ── NORMAL GENERATION (no references) ──────────────────────────────────────

async function planWithClaude(
  seed: SceneSeed,
  model: string,
  avoid: Avoid,
  opts: CaptionOpts = {}
): Promise<Plan> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model,
    max_tokens: 1100,
    temperature: 1,
    system: horseSystemForScene(seed.sceneType),
    messages: [{ role: "user", content: userPrompt(seed, avoid, opts) }],
  });
  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return {
    ...parseJson(text),
    usage: {
      in: res.usage?.input_tokens ?? 0,
      out: res.usage?.output_tokens ?? 0,
    },
  };
}

async function planWithOpenAI(
  seed: SceneSeed,
  model: string,
  avoid: Avoid,
  opts: CaptionOpts = {},
  system?: string
): Promise<Plan> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model,
    temperature: 1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system ?? horseSystemForScene(seed.sceneType) },
      { role: "user", content: userPrompt(seed, avoid, opts) },
    ],
  });
  recordTextUsage(model, res.usage);
  const text = res.choices[0]?.message?.content ?? "{}";
  return {
    ...parseJson(text),
    usage: {
      in: res.usage?.prompt_tokens ?? 0,
      out: res.usage?.completion_tokens ?? 0,
    },
  };
}

// ── REFERENCE-AWARE GENERATION (with uploaded images) ──────────────────────

async function planWithClaudeRef(
  seed: SceneSeed,
  model: string,
  avoid: Avoid,
  references: string[],
  lockScene?: boolean,
  opts: CaptionOpts = {},
  mode: InspirationMode = "balanced"
): Promise<Plan> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const imageBlocks = references.map((ref) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: detectMediaType(ref),
      data: stripDataPrefix(ref),
    },
  }));

  const res = await client.messages.create({
    model,
    max_tokens: 1300,
    temperature: 1,
    system: horseSystemForScene(seed.sceneType),
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          { type: "text", text: refUserPrompt(seed, avoid, references.length, lockScene, opts, mode) },
        ],
      },
    ],
  });

  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return {
    ...parseJson(text),
    usage: {
      in: res.usage?.input_tokens ?? 0,
      out: res.usage?.output_tokens ?? 0,
    },
  };
}

async function planWithOpenAIRef(
  seed: SceneSeed,
  model: string,
  avoid: Avoid,
  references: string[],
  lockScene?: boolean,
  opts: CaptionOpts = {},
  mode: InspirationMode = "balanced",
  system?: string,
  preserveReferenceMedium = false,
  requestedFraming?: string
): Promise<Plan> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const imageContent = references.map((ref) => ({
    type: "image_url" as const,
    image_url: { url: ref },
  }));

  const res = await client.chat.completions.create({
    model,
    temperature: 1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system ?? horseSystemForScene(seed.sceneType) },
      {
        role: "user",
        content: [
          ...imageContent,
          { type: "text", text: refUserPrompt(seed, avoid, references.length, lockScene, opts, mode, preserveReferenceMedium) +
            (preserveReferenceMedium && requestedFraming && requestedFraming !== "random"
              ? `\nThe user selected ${requestedFraming} camera framing. Honor that crop even if the reference uses a different crop.` : "") },
        ],
      },
    ],
  });
  recordTextUsage(model, res.usage);

  const text = res.choices[0]?.message?.content ?? "{}";
  return {
    ...parseJson(text),
    usage: {
      in: res.usage?.prompt_tokens ?? 0,
      out: res.usage?.completion_tokens ?? 0,
    },
  };
}

// ── VIRAL POTENTIAL ANALYSIS ────────────────────────────────────────────────

const VIRAL_PROMPT = `Analyze this horse image for Facebook engagement potential for horse lovers.

Score it on:
- Emotional bond (mare+foal, loving couple, affectionate interaction)
- Visual impact (black+white contrast, striking coat colors)
- Composition (tight portrait with bokeh, or powerful wide scene)
- Lighting (soft warm natural light that enhances emotion)
- Horse realism (correct anatomy, realistic eyes, muzzle, coat, mane and tail)
- Natural look (no AI gloss, no waxy texture, no fake plastic finish, no text/watermark/logo)
- Comment potential (would a horse lover react, feel something, or want to comment?)

Return JSON only — no prose, no markdown:
{"viralScore":"high","viralReason":"one short phrase max 12 words"}

viralScore values:
  "high"   = very likely to get reactions and comments from horse lovers
  "medium" = decent image, moderate engagement expected
  "low"    = unlikely to feel special or believable enough`;

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }> {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const ct = res.headers.get("content-type") ?? "image/jpeg";
  const mediaType: "image/jpeg" | "image/png" | "image/webp" =
    ct.includes("png") ? "image/png" : ct.includes("webp") ? "image/webp" : "image/jpeg";
  return { data: Buffer.from(buffer).toString("base64"), mediaType };
}

function sanitizeRecipeTitle(title: string | undefined, fallback: string): string {
  const raw = (title || fallback || "Homemade Recipe").trim();
  const words = raw
    .replace(/["']/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  return words.join(" ") || "Homemade Recipe";
}

function recipeIngredients(plan: Plan): string[] {
  return (plan.ingredients && plan.ingredients.length
    ? plan.ingredients
    : ["main dish ingredient", "seasoning", "sauce", "fresh garnish"]).slice(0, 5);
}

function recipeInstructions(plan: Plan): string[] {
  return (plan.instructions && plan.instructions.length
    ? plan.instructions
    : ["Prep the main ingredients.", "Cook until hot, tender, and flavorful.", "Serve warm and enjoy."]).slice(0, 3);
}

function recipeLanguage(plan: Plan): string {
  return (plan.language || "English").trim();
}

async function recipeTrendContext(
  enabled: boolean,
  sceneMode: RecipeMode,
  customSubject: string | undefined,
  model: string
): Promise<{ trend: RecipeTrendContext | null; trendSource?: string; trendAngle?: string }> {
  if (!enabled) return { trend: null };
  try {
    const trend = await researchRecipeTrends({
      category: sceneMode,
      customSubject,
      model,
    });
    if (!trend) return { trend: null, trendSource: "Fallback" };
    return {
      trend,
      trendSource: "Researched",
      trendAngle: trend.trendAngle,
    };
  } catch (e) {
    markCostIncomplete();
    console.warn("Recipe trend research failed (non-fatal):", e);
    return { trend: null, trendSource: "Fallback" };
  }
}

function buildRecipeNotebookPrompt(plan: Plan): string {
  const title = sanitizeRecipeTitle(plan.title, plan.idea);
  const imageDescription = (plan.imageDescription || plan.idea || "a homemade plated dish").trim();
  const ingredients = recipeIngredients(plan);
  const instructions = recipeInstructions(plan);
  const language = recipeLanguage(plan);

  return [
    `A Facebook-first recipe post image for "${title}", designed to look like a real page from a 1950s spiral notebook recipe book.`,
    `The image should feel like one nostalgic notebook page photographed from above, but optimized for the Facebook feed with a bigger food image and much less text.`,
    `PAGE BACKGROUND: light cream or soft yellow aged paper, visible spiral binding on the LEFT side only, slightly worn edges, gentle aging, faint folds, subtle paper grain, and small natural stains.`,
    `TOP SECTION: a short readable recipe title placed clearly at the top, centered, using a classic 1950s serif or typewriter-style font. A tiny subtitle is allowed, such as family recipe or old kitchen favorite.`,
    `CENTER SECTION: one large dominant food photograph based on ${imageDescription}. The photo should take most of the image, lightly glued or taped into the notebook, with a very slight natural tilt allowed. Warm homemade look, slightly faded colors, natural window lighting, no modern styling.`,
    `BOTTOM SECTION: only a short ingredients block using 3 to 5 items from this list: ${ingredients.join(", ")}. No long recipe text. At most one tiny serving note inspired by: ${instructions[0] || "Serve warm and enjoy."}`,
    `TYPOGRAPHY: old typewriter or classic 1950s serif font, soft brown or dark gray ink, slight ink inconsistency, clean and readable, not decorative, not modern, all visible text clearly rendered in ${language}.`,
    `COLOR AND MOOD: warm beige paper, soft sepia tone, cozy calm nostalgic vintage kitchen notebook feeling.`,
    `STRICT RULES: food image must dominate, no long instructions, no crowded recipe card, no modern UI, no logos, no branding, no watermark, no cluttered collage, no scrapbook layering, no repeated composition.`,
  ].join(" ");
}

function buildRecipeBoldHeroPrompt(plan: Plan): string {
  const title = sanitizeRecipeTitle(plan.title, plan.idea);
  const imageDescription = (plan.imageDescription || plan.idea || "a homemade plated dish").trim();
  const language = recipeLanguage(plan);

  return [
    `A Facebook-first food post image for "${title}", designed to be bold, cozy, and instantly readable in the feed.`,
    `The layout features one large, close-up hero photograph of the dish based on ${imageDescription}, filling most of the frame and clearly dominating the design.`,
    `Present the food in a suitable vessel at a slightly overhead or three-quarter angle, showing its recognizable ingredients, natural texture, and appropriate garnish.`,
    `Make the dish look freshly prepared and appetizing, with the temperature, shine and any steam appropriate to that particular food.`,
    `Lighting is warm and professional, enhancing color contrast and richness while keeping the dish bright, inviting, and realistic.`,
    `Background elements such as cloth napkins, herbs, utensils, or textured surfaces should remain subtle and softly blurred so the food stays the clear focal point.`,
    `A short title band is placed at the bottom of the image, using a warm saturated color that complements the dish.`,
    `The recipe title "${title}" is displayed prominently in large high-contrast typography, using a strong sans-serif or slab-serif font for readability. No ingredients list unless extremely minimal.`,
    `Each generation must feel visually original. Vary the camera angle slightly, bowl or plate color and material, garnish placement, ingredient distribution, steam shape, background surface, and visual balance every time.`,
    `The final image should feel comforting, hearty, irresistible, and optimized for fast mobile viewing in the Facebook feed.`,
    `All visible text must be rendered clearly in ${language}. Emphasize realistic depth and serving details suited to the dish.`,
    `STRICT RULES: one dominant hero food image, short title band only, no crowded text, no long recipe details, bright realistic crave-worthy food styling, clear readable text, no logos, no branding, no watermark, no cluttered collage, no repeated composition.`,
  ].join(" ");
}

function buildRecipeCleanEditorialPrompt(plan: Plan): string {
  const title = sanitizeRecipeTitle(plan.title, plan.idea);
  const imageDescription = (plan.imageDescription || plan.idea || "a fresh plated dish").trim();
  const ingredients = recipeIngredients(plan);
  const instructions = recipeInstructions(plan);
  const language = recipeLanguage(plan);

  return [
    `A Facebook-first editorial-style food post for "${title}", designed with a clean modern magazine aesthetic.`,
    `The post feels premium, minimal, elegant, and easy to read, with the dish based on ${imageDescription} photographed in a bright natural refined way.`,
    `TOP: a tiny category label or subtle subtitle only if it helps, then a large elegant title "${title}" with clean spacing and strong hierarchy.`,
    `CENTER: one refined hero image of the dish, balanced composition, beautiful natural texture, soft modern props lightly blurred, no clutter.`,
    `BOTTOM: keep text extremely light. At most one small subtitle or a tiny three-ingredient teaser chosen from: ${ingredients.slice(0, 3).join(", ")}.`,
    `TYPOGRAPHY: modern serif paired with a clean sans-serif, polished and readable.`,
    `COLOR STYLE: soft ivory, beige, muted stone, pale warm tones, subtle contrast, premium but not flashy.`,
    `VARIATION RULES: vary plate shape, linen, utensils, crop, camera distance, and spacing. Some outputs should feel tighter and others more airy.`,
    `STRICT RULES: big food image, no crowded text, no ingredient block unless minimal, no heavy borders, no loud stickers, no logos, no watermark, no clutter, all visible text rendered clearly in ${language}.`,
  ].join(" ");
}

function buildRecipeRusticFarmhousePrompt(plan: Plan): string {
  const title = sanitizeRecipeTitle(plan.title, plan.idea);
  const imageDescription = (plan.imageDescription || plan.idea || "a comforting homemade dish").trim();
  const ingredients = recipeIngredients(plan);
  const instructions = recipeInstructions(plan);
  const language = recipeLanguage(plan);

  return [
    `A Facebook-first rustic farmhouse food post for "${title}".`,
    `The dish based on ${imageDescription} should feel homemade, comforting, warm, and authentic, like a cozy recipe shared from a family kitchen.`,
    `VISUAL STYLE: warm wooden surfaces, soft kitchen towel, spoon, herbs, or baking tray in the background, natural window light, hearty freshly made food.`,
    `TOP: recipe title "${title}" in a rustic serif or farmhouse-style font, with an optional tiny subtitle like Family Favorite or Weeknight Comfort.`,
    `CENTER: a large food image as the main focus, strong texture, realistic warmth, slightly overhead or three-quarter angle.`,
    `BOTTOM: minimal text only. If needed, add a very small note or a tiny three-ingredient teaser chosen from: ${ingredients.slice(0, 3).join(", ")}.`,
    `COLOR AND MOOD: warm brown, cream, muted green, soft terracotta, handmade homey family-kitchen energy.`,
    `VARIATION RULES: rotate wood tones, cloth colors, herb styling, cookware, garnish placement, and crop. Avoid repeating the same prop arrangement.`,
    `STRICT RULES: big food image, simple title, no long instructions, no branding, no watermark, no artificial poster look, no clutter overload, all visible text rendered clearly in ${language}.`,
  ].join(" ");
}

function buildRecipeStepByStepMiniPrompt(plan: Plan): string {
  const title = sanitizeRecipeTitle(plan.title, plan.idea);
  const imageDescription = (plan.imageDescription || plan.idea || "a cozy homemade dish").trim();
  const instructions = recipeInstructions(plan);
  const language = recipeLanguage(plan);

  return [
    `A Facebook-first step-by-step mini food post for "${title}".`,
    `The design should be clean and mobile-friendly, with one large dominant food image based on ${imageDescription} and only a tiny 3-step strip.`,
    `TOP OR CENTER: the food image should dominate most of the canvas and look appetizing, recognizable and appropriate to the dish.`,
    `TITLE: show "${title}" large and clear.`,
    `SMALL STEP STRIP: include only these short labels in a clean readable way: Prep, Cook, Serve. If helpful, pair them with ultra-short micro-lines inspired by: ${instructions.join(" | ")}.`,
    `STYLE: simple, modern, spacious, fast to read in the Facebook feed.`,
    `VARIATION RULES: vary strip placement, crop, serving vessel, garnish placement, and background surface, while keeping the composition uncluttered.`,
    `STRICT RULES: no long instructions, no tiny text, no infographic feel, no logos, no watermarks, all visible text rendered clearly in ${language}.`,
  ].join(" ");
}

function buildRecipeIngredientSpotlightPrompt(plan: Plan): string {
  const title = sanitizeRecipeTitle(plan.title, plan.idea);
  const imageDescription = (plan.imageDescription || plan.idea || "an ingredient-driven plated dish").trim();
  const ingredients = recipeIngredients(plan);
  const language = recipeLanguage(plan);

  return [
    `A Facebook-first ingredient spotlight food post for "${title}".`,
    `The design should feature one large dominant food image based on ${imageDescription}, with only a few short ingredient callouts that are easy to scan.`,
    `TITLE: show "${title}" clearly in large mobile-friendly type.`,
    `FOOD IMAGE: rich, appetizing, realistic, and dominant in the layout, with natural lighting and strong texture.`,
    `CALLOUTS: use only 3 to 5 short ingredient callouts chosen from this list: ${ingredients.join(", ")}. Keep each callout tiny and clean.`,
    `STYLE: simple, modern, bright, and quick to understand in the Facebook feed.`,
    `VARIATION RULES: vary callout placement, crop, hero angle, ingredient emphasis, garnish, and negative space. Avoid repeating the same layout balance.`,
    `STRICT RULES: no full recipe text, no long instructions, no clutter, no logos, no watermarks, all visible text rendered clearly in ${language}.`,
  ].join(" ");
}

function buildRecipeScoopServePrompt(plan: Plan): string {
  const title = sanitizeRecipeTitle(plan.title, plan.idea);
  const imageDescription = (plan.imageDescription || plan.idea || "a dramatic serving shot of the dish").trim();
  const language = recipeLanguage(plan);

  return [
    `A Facebook-first scoop or serve action food post for "${title}".`,
    `Capture one natural serving moment based on ${imageDescription}, such as a suitable spoon lift, pour, scoop or slice; choose an action that fits this dish.`,
    `The action shot should dominate most of the layout and look realistic, appetizing and instantly understandable in the feed.`,
    `TITLE: show "${title}" large and clean, with very little other text.`,
    `STYLE: dramatic but appetizing, mobile-friendly, fast to read, designed for comments and shares.`,
    `VARIATION RULES: vary the serving motion, utensil angle, crop, steam shape, garnish, and framing so each image feels dynamic and fresh.`,
    `STRICT RULES: no ingredient block unless absent or tiny, no long instructions, no clutter, no fake interface, no logos, no watermarks, all visible text rendered clearly in ${language}.`,
  ].join(" ");
}

function buildRecipeHeroRecipeCardComboPrompt(plan: Plan): string {
  const title = sanitizeRecipeTitle(plan.title, plan.idea);
  const imageDescription = (plan.imageDescription || plan.idea || "a hero plated dish").trim();
  const ingredients = recipeIngredients(plan);
  const language = recipeLanguage(plan);

  return [
    `A Facebook-first hero plus recipe card combo post for "${title}".`,
    `The food image based on ${imageDescription} must dominate most of the design, while a smaller clean recipe card area supports it without taking over.`,
    `TOP OR CENTER: one large appetizing hero food photo with rich texture, natural lighting, and strong mobile readability.`,
    `SMALL CARD AREA: include the title "${title}" and only 3 to 5 short ingredients chosen from this list: ${ingredients.join(", ")}.`,
    `STYLE: balanced, clean, premium, easy to understand quickly in the Facebook feed.`,
    `VARIATION RULES: vary card placement, crop, background tone, vessel styling, garnish placement, and food scale while keeping the hero image dominant.`,
    `STRICT RULES: no long instructions, no crowded infographic feel, no oversized card block, no logos, no watermarks, all visible text rendered clearly in ${language}.`,
  ].join(" ");
}

function buildRecipeStoryCardFacebookPrompt(plan: Plan): string {
  const title = sanitizeRecipeTitle(plan.title, plan.idea);
  const imageDescription = (plan.imageDescription || plan.idea || "a warm homemade comfort-food dish").trim();
  const ingredients = recipeIngredients(plan).slice(0, 8);
  const language = recipeLanguage(plan);

  return [
    `A Facebook recipe image for "${title}", designed like a viral Facebook comfort-food recipe card over a close-up food background.`,
    `The full background is a close-up photo of ${imageDescription}, with appetizing, realistic texture. The dish should look homemade and satisfying, with its appropriate temperature, shine, steam, sauce or other details only when relevant.`,
    `Use a fork, spoon, ladle, or serving utensil lifting the food near the top when it fits the dish. The lifted bite or serving action should feel mouth-watering and natural.`,
    `Keep the background food visible behind the card, but slightly blurred so the front card reads clearly on mobile while the food still feels dominant and inviting.`,
    `In the center front, place a large rounded recipe card overlay. The card should be cream or light beige, with soft rounded corners, practical homemade styling, and strong mobile readability.`,
    `The card contains: a bold uppercase recipe title "${title}", an optional small food emoji or tiny kitchen icon, a simple red or brown divider line under the title, then "You'll Need:" followed by 5 to 8 short ingredient bullets using these items: ${ingredients.join(", ")}.`,
    `An optional small crockpot, pot, spoon, or kitchen icon is allowed depending on the dish, but keep it cute, simple, and secondary. No long instructions on the card.`,
    `Design feel: simple viral Facebook recipe note, practical, homemade, rustic, shareable, not luxury editorial, not a notebook page, not a cookbook page, not a crowded infographic.`,
    `Variation rules: vary card placement, card size, card color tone, title line breaks, food close-up angle, utensil action, ingredient order, small icon type, background blur, and dish crop. Keep the same recognizable Facebook recipe-card style while avoiding repeated composition.`,
    `STRICT RULES: no logos, no branding, no watermark, no full recipe page, no long instructions on the image, no cluttered infographic layout, and all visible text must be clear and in ${language}.`,
  ].join(" ");
}

const RECIPE_PIN_RENDERERS: Record<RecipePinStyle, (plan: Plan) => string> = {
  vintage_notebook: buildRecipeNotebookPrompt,
  bold_hero: buildRecipeBoldHeroPrompt,
  clean_editorial: buildRecipeCleanEditorialPrompt,
  rustic_farmhouse: buildRecipeRusticFarmhousePrompt,
  step_by_step_mini: buildRecipeStepByStepMiniPrompt,
  ingredient_spotlight: buildRecipeIngredientSpotlightPrompt,
  scoop_serve: buildRecipeScoopServePrompt,
  hero_recipe_card_combo: buildRecipeHeroRecipeCardComboPrompt,
  story_card_facebook_post: buildRecipeStoryCardFacebookPrompt,
};

async function storeOpenAIImage(dataUrl: string): Promise<string> {
  // Optional hosting preserves posting CSV compatibility; OpenAI alone returns bytes.
  if (!process.env.FAL_KEY) return dataUrl;
  try { return await uploadDataUri(dataUrl); }
  catch { console.warn("Image hosting unavailable; returning image bytes"); return dataUrl; }
}

async function analyzeViralClaude(imageUrl: string, model: string): Promise<{ viralScore: string; viralReason: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { data, mediaType } = await fetchImageAsBase64(imageUrl);
  const res = await client.messages.create({
    model,
    max_tokens: 80,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data } },
        { type: "text", text: VIRAL_PROMPT },
      ],
    }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const obj = JSON.parse(cleaned.slice(start, end + 1));
  return {
    viralScore: String(obj.viralScore ?? "medium").trim().toLowerCase(),
    viralReason: String(obj.viralReason ?? "").trim(),
  };
}

async function analyzeViralOpenAI(imageUrl: string, model: string): Promise<{ viralScore: string; viralReason: string }> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Note: do NOT use response_format: json_object with vision inputs — not supported on all models
  const res = await client.chat.completions.create({
    model,
    max_tokens: 80,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: VIRAL_PROMPT },
      ],
    }],
  });
  recordTextUsage(model, res.usage);
  const text = res.choices[0]?.message?.content ?? "{}";
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const obj = JSON.parse(cleaned.slice(start, end + 1));
  return {
    viralScore: String(obj.viralScore ?? "medium").trim().toLowerCase(),
    viralReason: String(obj.viralReason ?? "").trim(),
  };
}

async function analyzeViral(
  imageUrl: string,
  workflow: "claude" | "openai",
  model: string
): Promise<{ viralScore: string; viralReason: string } | null> {
  try {
    return workflow === "claude"
      ? await analyzeViralClaude(imageUrl, model)
      : await analyzeViralOpenAI(imageUrl, model);
  } catch (e) {
    markCostIncomplete();
    console.warn("Viral analysis failed (non-fatal):", e);
    return null;
  }
}

// Keyword-based fallback scoring — used when vision analysis fails.
// Scores based on proven viral signals already present in the prompt/idea text.
function scoreByKeywords(plan: { idea: string; prompt: string; description: string }): { viralScore: string; viralReason: string } {
  const text = `${plan.idea} ${plan.prompt} ${plan.description}`.toLowerCase();

  const highSignals = [
    "mare and foal", "mare nuzzling", "foal nursing", "foal pressing", "foal walking",
    "mare gently", "mare watching", "foal resting", "mother and foal",
    "black horse and white horse", "touching noses", "forehead to forehead",
    "heads touching", "noses touching", "noses almost touching",
    "bokeh", "135mm", "shallow depth", "portrait",
    "affectionate", "tender", "protective", "bonding", "emotional bond",
    "jet-black", "pure white", "coat contrast", "black.*white", "white.*black",
    "close-up", "intimate", "gentle", "loving",
    "realistic eyes", "accurate muzzle", "documentary-style", "natural light",
    "dust", "weathered fence", "breath", "misty", "tall grass",
  ];

  const matches = highSignals.filter((s) => {
    try { return new RegExp(s).test(text); } catch { return text.includes(s); }
  });

  if (matches.length >= 2) return { viralScore: "high", viralReason: "strong emotional bond and composition" };
  if (matches.length === 1) return { viralScore: "medium", viralReason: "good emotional content" };
  return { viralScore: "low", viralReason: "standard scene" };
}

// ── IMAGE RENDER ────────────────────────────────────────────────────────────

// Build the fal input per model family. Different endpoints accept different
// fields, so we shape the payload to match each model and avoid schema errors.
function buildFalInput(
  imageModel: string,
  finalPrompt: string,
  negative: string,
  size: { width: number; height: number },
  aspect: string
): Record<string, any> {
  if (imageModel.includes("flux/schnell")) {
    // FLUX Schnell is a distilled model: no negative_prompt / CFG, 4 steps.
    return {
      prompt: finalPrompt,
      image_size: size,
      num_images: 1,
      num_inference_steps: 4,
      enable_safety_checker: true,
    };
  }
  if (imageModel.includes("ideogram")) {
    // Ideogram V3 — keep TURBO (cheapest), don't let it rewrite our prompt.
    return {
      prompt: finalPrompt,
      negative_prompt: negative,
      image_size: size,
      rendering_speed: "TURBO",
      expand_prompt: false,
      num_images: 1,
    };
  }
  if (imageModel.includes("qwen")) {
    return {
      prompt: finalPrompt,
      negative_prompt: negative,
      image_size: size,
      num_images: 1,
      num_inference_steps: 30,
      guidance_scale: 2.5,
      enable_safety_checker: true,
    };
  }
  if (imageModel.includes("flux-2")) {
    // FLUX.2 [pro] — zero-config text-to-image, accepts custom image_size.
    return {
      prompt: finalPrompt,
      image_size: size,
      num_images: 1,
    };
  }
  if (
    (imageModel.includes("flux-pro") && imageModel.includes("ultra")) ||
    imageModel.includes("imagen")
  ) {
    // FLUX 1.1 Pro Ultra & Imagen 4 Ultra accept only an aspect_ratio enum
    // (no arbitrary size); 4:5 isn't supported, so use the closest portrait 3:4.
    return {
      prompt: finalPrompt,
      aspect_ratio: "3:4",
      num_images: 1,
    };
  }
  // Seedream V4 / V4.5 (default) — supports both aspect_ratio and image_size.
  return {
    prompt: finalPrompt,
    negative_prompt: negative,
    aspect_ratio: aspect,
    image_size: size,
    num_images: 1,
    enable_safety_checker: true,
  };
}

async function renderImage(
  prompt: string,
  sceneType: string,
  extraNegative?: string,
  contentType: "horses" | "recipes" | "fashion" = "horses",
  design = false,
  imageModel: string = DEFAULT_IMAGE_MODEL
): Promise<string> {
  const suffix =
    contentType === "recipes"
      ? (design ? FOOD_QUALITY_DESIGN : FOOD_QUALITY_SUFFIX)
      : contentType === "fashion"
      ? FASHION_QUALITY_SUFFIX
      : qualitySuffixFor(sceneType);
  const baseNegative =
    contentType === "recipes"
      ? (design ? FOOD_NEGATIVE_DESIGN : FOOD_NEGATIVE)
      : contentType === "fashion"
      ? FASHION_NEGATIVE
      : negativePromptFor(sceneType);
  // Adapt the final prompt to the selected image model (creative idea unchanged).
  const finalPrompt = buildModelPrompt(prompt, suffix, imageModel, contentType, design, sceneType);
  const negative = extraNegative ? `${extraNegative}, ${baseNegative}` : baseNegative;
  // Design pins are taller (2:3); regular images keep the 4:5 feed format.
  const size = design ? { width: 1024, height: 1536 } : { width: IMAGE.width, height: IMAGE.height };
  const aspect = design ? "2:3" : IMAGE.aspect_ratio;
  const input = buildFalInput(imageModel, finalPrompt, negative, size, aspect);
  const result: any = await fal.subscribe(imageModel, { input });
  const url =
    result?.data?.images?.[0]?.url ||
    result?.data?.image?.url ||
    result?.images?.[0]?.url;
  if (!url) throw new Error("No image returned from fal.ai");
  return url;
}

// Upload a base64 data URI to fal storage and return a hosted URL.
async function uploadDataUri(dataUri: string): Promise<string> {
  const base64 = stripDataPrefix(dataUri);
  const mediaType = detectMediaType(dataUri);
  const buffer = Buffer.from(base64, "base64");
  const blob = new Blob([buffer], { type: mediaType });
  return await fal.storage.upload(blob);
}

// True image-to-image with Flux Dev: transforms the uploaded reference photo.
// strength: lower = stay closer to the original, higher = follow the prompt more.
async function renderFluxImg2Img(prompt: string, refDataUri: string, strength: number): Promise<string> {
  const image_url = await uploadDataUri(refDataUri);
  const input: any = {
    image_url,
    prompt,
    strength,
    num_inference_steps: 40,
    guidance_scale: 3.5,
    num_images: 1,
    enable_safety_checker: true,
  };
  const result: any = await fal.subscribe(FLUX_I2I, { input });
  const url =
    result?.data?.images?.[0]?.url ||
    result?.data?.image?.url ||
    result?.images?.[0]?.url;
  if (!url) throw new Error("No image returned from Flux img2img");
  return url;
}

// ── FASHION REFERENCE-AWARE PLANNING ────────────────────────────────────────

async function planWithClaudeRefFashion(
  seed: SceneSeed,
  model: string,
  avoid: Avoid,
  references: string[],
  opts: CaptionOpts = {},
  mode: InspirationMode = "balanced"
): Promise<Plan> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const imageBlocks = references.map((ref) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: detectMediaType(ref), data: stripDataPrefix(ref) },
  }));
  const res = await client.messages.create({
    model,
    max_tokens: 1300,
    temperature: 1,
    system: FASHION_SYSTEM,
    messages: [{
      role: "user",
      content: [
        ...imageBlocks,
        { type: "text", text: fashionRefUserPrompt(seed, avoid, references.length, opts, mode) },
      ],
    }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...parseJson(text), usage: { in: res.usage?.input_tokens ?? 0, out: res.usage?.output_tokens ?? 0 } };
}

async function planWithOpenAIRefFashion(
  seed: SceneSeed,
  model: string,
  avoid: Avoid,
  references: string[],
  opts: CaptionOpts = {},
  mode: InspirationMode = "balanced",
  system?: string
): Promise<Plan> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const imageContent = references.map((ref) => ({
    type: "image_url" as const,
    image_url: { url: ref },
  }));
  const res = await client.chat.completions.create({
    model,
    temperature: 1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system ?? FASHION_SYSTEM },
      { role: "user", content: [...imageContent, { type: "text" as const, text: fashionRefUserPrompt(seed, avoid, references.length, opts, mode) }] },
    ],
  });
  recordTextUsage(model, res.usage);
  const text = res.choices[0]?.message?.content ?? "{}";
  return { ...parseJson(text), usage: { in: res.usage?.prompt_tokens ?? 0, out: res.usage?.completion_tokens ?? 0 } };
}

// ── GENERIC TEXT PLANNER (used by recipe mode) ───────────────────────────────

async function planText(
  workflow: "claude" | "openai",
  model: string,
  system: string,
  userText: string,
  maxTokens = 1100
): Promise<Plan> {
  if (workflow === "openai") {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model,
      temperature: 1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    });
    recordTextUsage(model, res.usage);
    return {
      ...parseJson(res.choices[0]?.message?.content ?? "{}"),
      usage: { in: res.usage?.prompt_tokens ?? 0, out: res.usage?.completion_tokens ?? 0 },
    };
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 1,
    system,
    messages: [{ role: "user", content: userText }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return {
    ...parseJson(text),
    usage: { in: res.usage?.input_tokens ?? 0, out: res.usage?.output_tokens ?? 0 },
  };
}

// ── RULE-OF-THREE FIXUP ──────────────────────────────────────────────────────
// Detect an "A, B, and C" three-item list (the most stubborn AI tell) and, only
// when present, do a cheap text-only rewrite to break it into one or two items.

function hasThreeItemList(text: string): boolean {
  return /,[^,.!?\n]+,\s+(?:and|or)\s+/i.test(text);
}

async function rewriteNoThreeList(
  text: string,
  workflow: "claude" | "openai",
  model: string
): Promise<{ text: string; cost: number }> {
  const instruction =
    `Rewrite this Facebook caption so it contains NO list of three items (never "A, B, and C"). ` +
    `Use only one or two items, or split them into separate short sentences. ` +
    `Keep the same meaning, tone, emojis, line breaks, and length. Do not end with a question. ` +
    `No hashtags. Return ONLY the rewritten caption text, nothing else.\n\n${text}`;

  let out = text;
  let usage = { in: 0, out: 0 };

  if (workflow === "openai") {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model,
      temperature: 0.7,
      messages: [{ role: "user", content: instruction }],
    });
    recordTextUsage(model, res.usage);
    out = res.choices[0]?.message?.content ?? text;
    usage = { in: res.usage?.prompt_tokens ?? 0, out: res.usage?.completion_tokens ?? 0 };
  } else {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model,
      max_tokens: 500,
      temperature: 0.7,
      messages: [{ role: "user", content: instruction }],
    });
    out = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    usage = { in: res.usage?.input_tokens ?? 0, out: res.usage?.output_tokens ?? 0 };
  }

  const cleaned = humanizeText(stripHashtags(out.trim()));
  return { text: cleaned || text, cost: estimateCost(model, usage, "") };
}

async function fixCaption(
  text: string | undefined,
  workflow: "claude" | "openai",
  model: string
): Promise<{ text: string | undefined; cost: number }> {
  if (!text || !hasThreeItemList(text)) return { text, cost: 0 };
  try {
    return await rewriteNoThreeList(text, workflow, model);
  } catch (e) {
    markCostIncomplete();
    console.warn("Rule-of-three fixup failed (non-fatal):", e);
    return { text, cost: 0 };
  }
}

// ── CAPTION-ONLY REGENERATION (no new image) ────────────────────────────────

function isStoryCardCaption(text: string | undefined): boolean {
  return Boolean(text && text.includes("🍲 RECIPE ↓"));
}

async function regenerateCaption(
  workflow: "claude" | "openai",
  model: string,
  system: string,
  userMsg: string,
): Promise<{ description: string; firstComment?: string; cost: number }> {
  let text = "{}";
  let usage = { in: 0, out: 0 };

  if (workflow === "openai") {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model,
      temperature: 1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMsg },
      ],
    });
    recordTextUsage(model, res.usage);
    text = res.choices[0]?.message?.content ?? "{}";
    usage = { in: res.usage?.prompt_tokens ?? 0, out: res.usage?.completion_tokens ?? 0 };
  } else {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model,
      max_tokens: 700,
      temperature: 1,
      system,
      messages: [{ role: "user", content: userMsg }],
    });
    text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    usage = { in: res.usage?.input_tokens ?? 0, out: res.usage?.output_tokens ?? 0 };
  }

  const parsed = parseJson(text);
  let cost = estimateCost(model, usage, ""); // no image render
  const descFix = await fixCaption(parsed.description, workflow, model);
  const fcFix = await fixCaption(parsed.firstComment, workflow, model);
  cost += descFix.cost + fcFix.cost;
  return { description: descFix.text ?? parsed.description, firstComment: fcFix.text, cost };
}

// ── POST HANDLER ────────────────────────────────────────────────────────────

async function rewriteStoryCardCaption(
  plan: Plan,
  workflow: "claude" | "openai",
  model: string
): Promise<{ description: string; cost: number }> {
  const system = `You rewrite Facebook recipe captions into a Story Card Facebook Post format.

Return STRICT JSON only:
{
  "description": "the rewritten caption"
}

Rules:
- Do not use the short generic recipe-caption style.
- Use this exact structure:
  1. Short personal cooking note or practical observation
  2. 1 to 2 natural sentences with a cooking tip, timing note, texture note, or serving advice
  3. A blank line
  4. This exact heading on its own line: 🍲 RECIPE ↓
  5. A blank line
  6. A short ingredient block with bullet-style lines, using about 5 to 8 short ingredients when possible
  7. A blank line
  8. One short method paragraph in normal readable Facebook style
  9. Optional one-line practical tip or short closing note, or no extra line if not needed. Do not ask a question.
- Keep it warm, human, practical, casual, and natural.
- No hashtags.
- No spammy CTA wording.
- No dramatic fake storytelling.
- Avoid blog-intro tone.
- Mention key ingredients and how to cook or serve the dish.
- Keep the ingredient block and method easy to read in plain Facebook text.
- The final caption should feel like someone sharing a useful recipe note, not a polished blog post.
- Keep the heading exactly as: 🍲 RECIPE ↓`;

  const ingredients = (plan.ingredients?.length ? plan.ingredients : []).join(", ");
  const instructions = (plan.instructions?.length ? plan.instructions : []).join(" ");
  const title = plan.title || plan.idea || "the dish";
  const userMsg = `Dish title: ${title}
Dish concept: ${plan.idea}
Food scene: ${plan.imageDescription || ""}
Ingredients: ${ingredients || "Use the obvious key ingredients from the dish."}
Method notes: ${instructions || "Use a short practical cooking method paragraph."}
Current caption:
${plan.description || ""}

Rewrite it now into the required Story Card Facebook Post caption format.`;

  const res = await regenerateCaption(workflow, model, system, userMsg);
  return { description: res.description, cost: res.cost };
}

async function ensureStoryCardCaption(
  plan: Plan,
  workflow: "claude" | "openai",
  model: string
): Promise<{ text: string | undefined; cost: number }> {
  if (isStoryCardCaption(plan.description)) return { text: plan.description, cost: 0 };
  try {
    const rewritten = await rewriteStoryCardCaption(plan, workflow, model);
    return { text: rewritten.description, cost: rewritten.cost };
  } catch (e) {
    markCostIncomplete();
    console.warn("Story Card caption rewrite failed (non-fatal):", e);
    return { text: plan.description, cost: 0 };
  }
}

async function handleGenerate(req: Request, onPartial?: PartialImageHandler) {
  return withCostLedger(() => handleGenerateWithLedger(req, onPartial));
}

async function handleGenerateWithLedger(req: Request, onPartial?: PartialImageHandler) {
  try {
    const {
      workflow: _workflow,
      model: clientModel,
      used,
      avoid,
      references,
      sceneMode,
      customSubject,
      framing,
      captionLength,
      firstComment,
      captionOnly,
      contentType = "horses" as "horses" | "recipes" | "fashion",
      designPin = false,
      recipePinStyle = DEFAULT_RECIPE_PIN_STYLE,
      trendResearch = false,
      recipeWorkflow,
      extraInstructions,
      imgStrength,
      imageModel: requestedImageModel,
      imageSettings,
      batchIndex,
      batchOffset,
      idea: clientIdea,
      prompt: clientPrompt,
      sceneType: clientSceneType,
      tone: clientTone,
    }: {
      workflow?: "openai";
      model?: string;
      used?: UsedSeeds;
      avoid?: Avoid;
      references?: string[];
      sceneMode?: SceneMode;
      customSubject?: string;
      framing?: string;
      captionLength?: string;
      firstComment?: boolean;
      captionOnly?: boolean;
      contentType?: "horses" | "recipes" | "fashion";
      designPin?: boolean;
      recipePinStyle?: RecipePinStyle;
      trendResearch?: boolean;
      recipeWorkflow?: "generate" | "imageToImage" | "twoInOne";
      extraInstructions?: string;
      imgStrength?: number;
      imageModel?: string;
      imageSettings?: OpenAIImageSettings;
      batchIndex?: number;
      batchOffset?: number;
      idea?: string;
      prompt?: string;
      sceneType?: string;
      tone?: string;
    } = await req.json();

    const isFoodImageEdit = recipeWorkflow === "imageToImage" || recipeWorkflow === "twoInOne";
    const imageModel = requestedImageModel ?? (isFoodImageEdit ? RECIPE_IMAGE_TO_IMAGE_MODEL : DEFAULT_IMAGE_MODEL);
    if (recipeWorkflow !== undefined && !["generate", "imageToImage", "twoInOne"].includes(recipeWorkflow)) {
      return NextResponse.json({ error: "Unsupported recipe workflow." }, { status: 400 });
    }
    if (isFoodImageEdit) {
      let foodReferences: string[];
      let prompt: string;
      let settings: OpenAIImageSettings;
      try {
        if (contentType !== "recipes" || captionOnly) throw new Error("Food image editing is available for recipe photos only.");
        if (!isOpenAIImageModel(imageModel)) throw new Error("Select an OpenAI image model for food image editing.");
        foodReferences = recipeWorkflow === "twoInOne" ? twoInOneReferences(references) : [foodReference(references)];
        prompt = recipeWorkflow === "twoInOne" ? twoInOnePrompt(extraInstructions) : foodVariationPrompt(extraInstructions);
        settings = validateImageSettings(imageModel, imageSettings);
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid food photo settings." }, { status: 400 });
      }
      // Send the original food photo(s) and the selected fixed prompt straight to image edits.
      // Recipe seeds, design templates, and caption planners must not rewrite it.
      const image = await generateOpenAIImage({
        model: imageModel, prompt, settings, references: foodReferences, onPartial, signal: req.signal,
      });
      recordOpenAIImage(imageModel, settings, image);
      return NextResponse.json({
        imageUrl: await storeOpenAIImage(image.dataUrl),
        contentType: "recipes", recipeWorkflow,
        imageModel, imageSettings: settings, usedReference: true,
        ...costSummary(imageModel),
      });
    }

    const workflow = "openai" as const;
    const model = clientModel || MODELS.openai;

    if (!OPENAI_MODELS.includes(model as any)) throw new Error("Unsupported text model");
    if (!["horses", "recipes", "fashion"].includes(contentType)) throw new Error("Unsupported content type");
    const openAIImage = isOpenAIImageModel(imageModel);
    if (!captionOnly && !imageModelsFor(contentType, designPin).some((entry) => entry.value === imageModel)) {
      throw new Error("Unsupported image model for this workspace");
    }
    const settings = openAIImage ? validateImageSettings(imageModel, imageSettings) : undefined;
    assertConfigured(!captionOnly && !openAIImage);
    const inspirationMode: InspirationMode =
      typeof imgStrength === "number" && imgStrength <= 0.55 ? "close"
        : typeof imgStrength === "number" && imgStrength >= 0.85 ? "creative" : "balanced";
    const plannerSystem = (base: string) => openAIImage
      ? openAIPlannerSystem(base, settings?.background === "transparent") : base;
    let renderedPrompt: string | undefined;
    let sceneGuidance: string | undefined;
    let direction: ReturnType<typeof pairDirection> = null;
    const render = async (prompt: string, scene: string, extraNegative?: string,
      kind: "horses" | "recipes" | "fashion" = "horses", design = false, selected = imageModel, referenceStrategy?: string, referenceMedium?: "photograph" | "artwork") => {
      if (!isOpenAIImageModel(selected)) return renderImage(prompt, scene, extraNegative, kind, design, selected);
      const finalPrompt = buildOpenAIImagePrompt({ prompt, kind, scene, designed: design,
        hasReferences: kind !== "recipes" && Array.isArray(references) && references.length > 0,
        framing: kind === "horses" ? framing : undefined, direction: kind === "horses" ? direction : null,
        sceneGuidance: kind === "horses" ? sceneGuidance : undefined,
        visualDirection: visualDirection(batchIndex, batchOffset,
          !!customSubject?.trim() || (Array.isArray(references) && references.length > 0 && inspirationMode === "close")),
        referenceCount: Array.isArray(references) ? references.length : 0, referenceMode: inspirationMode,
        referenceStrategy, referenceMedium, customSubject, canvasSize: settings?.size, transparent: settings?.background === "transparent" });
      renderedPrompt = finalPrompt;
      const result = await generateOpenAIImage({ model: selected, prompt: finalPrompt, settings,
        references: kind === "recipes" ? undefined : references, onPartial, signal: req.signal });
      recordOpenAIImage(selected, settings!, result);
      return storeOpenAIImage(result.dataUrl);
    };

    const isRecipe = contentType === "recipes";
    const isFashion = contentType === "fashion";

    // Regenerate just the caption for an existing image (no new render).
    if (captionOnly) {
      const sys = isRecipe ? RECIPE_SYSTEM : isFashion ? FASHION_SYSTEM : horseSystemForScene(clientSceneType);
      const scene = { idea: clientIdea ?? "", prompt: clientPrompt ?? "", sceneType: clientSceneType, tone: clientTone };
      const opts: CaptionOpts = { captionLength, firstComment };
      const userMsg = isFashion
        ? fashionCaptionOnlyUserPrompt(scene, opts)
        : captionOnlyUserPrompt(scene, opts);
      const r = await regenerateCaption(workflow, model, sys, userMsg);
      return NextResponse.json({ description: r.description, firstComment: r.firstComment, ...costSummary() });
    }

    // ── FASHION MODE ────────────────────────────────────────────────────────
    if (isFashion) {
      const fAvoid = avoid ?? {};
      const fashionOpts: CaptionOpts = { custom: customSubject?.trim() || undefined, captionLength, firstComment };
      const fSeed = fashionSeed(used, (sceneMode as FashionMode) ?? "auto");
      const hasRefs = Array.isArray(references) && references.length > 0;

      let fPlan: Plan;
      if (hasRefs) {
        try {
          fPlan =
            workflow === "openai"
              ? await planWithOpenAIRefFashion(fSeed, model, fAvoid, references, fashionOpts, inspirationMode, plannerSystem(FASHION_SYSTEM))
              : await planWithClaudeRefFashion(fSeed, model, fAvoid, references, fashionOpts, inspirationMode);
        } catch (refErr) {
          markCostIncomplete();
          console.warn("Fashion reference analysis failed, falling back to text planner:", refErr);
          fPlan = await planText(workflow, model, plannerSystem(FASHION_SYSTEM), fashionUserPrompt(fSeed, fAvoid, fashionOpts));
        }
      } else {
        fPlan = await planText(workflow, model, plannerSystem(FASHION_SYSTEM), fashionUserPrompt(fSeed, fAvoid, fashionOpts));
      }

      if (!fPlan.prompt) throw new Error("Empty prompt from fashion planner");

      const singleRef = hasRefs && references && references.length === 1;
      let fFalModel: string = imageModel;
      const fRenderPromise: Promise<string> = singleRef && !openAIImage
        ? (async () => {
            try {
              const strength = typeof imgStrength === "number" ? imgStrength : 0.7;
              const url = await renderFluxImg2Img(fPlan.prompt, references![0], strength);
              fFalModel = FLUX_I2I;
              return url;
            } catch {
              markCostIncomplete();
              fFalModel = imageModel;
              return render(fPlan.prompt, fSeed.sceneType, undefined, "fashion", false, imageModel, fPlan.referenceStrategy);
            }
          })()
        : render(fPlan.prompt, fSeed.sceneType, undefined, "fashion", false, imageModel, fPlan.referenceStrategy);

      const [fImage, fDescFix, fFcFix] = await Promise.all([
        fRenderPromise,
        fixCaption(fPlan.description, workflow, model),
        fixCaption(fPlan.firstComment, workflow, model),
      ]);
      fPlan.description = fDescFix.text ?? fPlan.description;
      fPlan.firstComment = fFcFix.text;
      const fViral = (await analyzeViral(fImage, workflow, model)) ?? { viralScore: "medium", viralReason: "standard fashion post" };

      return NextResponse.json({
        ...fPlan,
        imageUrl: fImage,
        seed: fSeed,
        provider: workflow,
        model,
        falModel: fFalModel,
        ...costSummary(fFalModel),
        imageSettings: settings,
        renderedPrompt,
        usedReference: hasRefs,
        viralScore: fViral.viralScore,
        viralReason: fViral.viralReason,
      });
    }

    // ── RECIPE / FOOD MODE ──────────────────────────────────────────────────
    if (isRecipe) {
      const recipeOpts: CaptionOpts = { custom: customSubject?.trim() || undefined, captionLength, firstComment };
      const recipeMode = (sceneMode as RecipeMode) ?? "auto";
      const rSeed = recipeSeed(used, recipeMode);
      const selectedRecipeImageModel =
        designPin && isRecipeDesignedImageModel(imageModel)
          ? imageModel
          : DEFAULT_RECIPE_DESIGNED_IMAGE_MODEL;
      const normalizedRecipePinStyle: RecipePinStyle =
        RECIPE_PIN_STYLES.some((style) => style.value === recipePinStyle)
          ? recipePinStyle
          : DEFAULT_RECIPE_PIN_STYLE;
      const trendMeta = await recipeTrendContext(trendResearch, recipeMode, customSubject?.trim() || undefined, model);
      const recipeStyleMeta = {
        value: normalizedRecipePinStyle,
        label: recipePinStyleLabel(normalizedRecipePinStyle),
        plannerBrief: recipePinStylePlannerBrief(normalizedRecipePinStyle),
      };
      const rPlan = await planText(
        workflow,
        model,
        plannerSystem(designPin
          ? RECIPE_DESIGNED_PIN_SYSTEM
          : RECIPE_SYSTEM),
        designPin
          ? recipeDesignedPinUserPrompt(recipeStyleMeta, rSeed, avoid ?? {}, recipeOpts, trendMeta.trend ?? undefined)
          : recipeUserPrompt(rSeed, avoid ?? {}, recipeOpts, false, trendMeta.trend ?? undefined)
      );
      if (!rPlan.prompt) throw new Error("Empty prompt from planner");
      const [rImage, rDescFix, rFcFix] = await Promise.all([
        designPin
          ? render(RECIPE_PIN_RENDERERS[normalizedRecipePinStyle](rPlan), rSeed.sceneType, undefined, "recipes", true, selectedRecipeImageModel)
          : render(rPlan.prompt, rSeed.sceneType, undefined, "recipes", false, imageModel),
        normalizedRecipePinStyle === "story_card_facebook_post"
          ? ensureStoryCardCaption(rPlan, workflow, model)
          : fixCaption(rPlan.description, workflow, model),
        fixCaption(rPlan.firstComment, workflow, model),
      ]);
      rPlan.description = rDescFix.text ?? rPlan.description;
      rPlan.firstComment = rFcFix.text;
      return NextResponse.json({
        ...rPlan,
        imageUrl: rImage,
        seed: rSeed,
        recipeStyle: designPin ? recipeStyleMeta.label : undefined,
        trendSource: trendMeta.trendSource,
        trendAngle: trendMeta.trendAngle,
        provider: workflow,
        model,
        falModel: designPin ? selectedRecipeImageModel : imageModel,
        ...costSummary(designPin ? selectedRecipeImageModel : imageModel),
        imageSettings: settings,
        renderedPrompt,
        usedReference: false,
      });
    }

    const avoidPayload = avoid ?? {};
    const custom = customSubject?.trim() || undefined;
    const opts: CaptionOpts = { custom, captionLength, firstComment };
    const hasRefs = Array.isArray(references) && references.length > 0;

    // Resolve scene mode. References nudge an "auto" choice toward emotional so a
    // random western seed can't override the uploaded reference; an explicit mode wins.
    const requestedMode: SceneMode = sceneMode ?? "auto";
    // When references are uploaded, the uploaded image drives the whole scene —
    // the Scene focus dropdown is ignored. Only a typed custom subject still wins.
    const effectiveMode: SceneMode = hasRefs ? "emotional" : requestedMode;
    const seed = sceneSeed(used, effectiveMode);
    // An explicit subject takes priority over a randomly selected wall artwork.
    if (custom && isHorseWallPaintingSceneType(seed.sceneType)) seed.sceneType = "majestic single horse portrait";
    sceneGuidance = !hasRefs && !custom ? horseSceneGuidance(requestedMode, framing) : undefined;
    direction = openAIImage ? pairDirection(requestedMode, batchIndex, batchOffset, hasRefs, custom, framing) : null;
    if (direction) { seed.breed = direction.subject; seed.setting = direction.setting; seed.light = direction.light; seed.action = direction.action; }
    if (openAIImage && settings?.background === "transparent" && !hasRefs) seed.setting = "a fully transparent background without scenery";
    const horseArtScene = isHorseArtSceneType(seed.sceneType);
    const wallPaintingScene = isHorseWallPaintingSceneType(seed.sceneType);

    // Realistic horse scenes use the camera framing control. Decorative horse
    // art scenes keep their own seeded composition so batches vary more.
    const muralFraming: Record<string, string> = { eye: "Macro of the painted horse eye on the wall.", closeup: "Close view of the painted horse face on the wall.", portrait: "Portrait crop of the painted horse head and neck on the wall.", half: "Show the upper part of the mural and artist where the crop allows.", full: "Show the large horse mural and the much smaller artist for scale.", wide: "Show the large wall and giant horse mural with the artist small beside it." };
    const wallFraming: Record<string, string> = {
      eye: "CAMERA FRAMING (most important rule): Macro of the painted horse eye and nearby wall texture.",
      closeup: "CAMERA FRAMING (most important rule): Close view of the painted horse face and brushwork.",
      portrait: "CAMERA FRAMING (most important rule): Portrait crop of the painted horse head and neck on the wall.",
      half: "CAMERA FRAMING (most important rule): Show the upper part of the horse painting and wall texture.",
      full: "CAMERA FRAMING (most important rule): Show the entire horse painting and enough wall to see that it is a painting.",
      wide: "CAMERA FRAMING (most important rule): Show the horse painting and more of the surrounding wall.",
    };
    const framingDirective = !horseArtScene && framing ? (wallPaintingScene ? wallFraming[framing] : /mural/i.test(seed.sceneType) ? muralFraming[framing] : FRAMING_DIRECTIVES[framing]) : undefined;
    if (openAIImage && /mural/i.test(seed.sceneType) && ["eye", "closeup", "portrait"].includes(framing || "")) {
      seed.action = "Show a close detail of the painted horse and the wall texture; the artist may be outside the crop.";
    }
    if (openAIImage && wallPaintingScene && ["eye", "closeup", "portrait"].includes(framing || "")) {
      seed.action = "Show a close detail of the painted horse and the wall texture, respecting the selected crop.";
    }
    if (framingDirective) seed.action = `${seed.action}. ${framingDirective}`;
    if (sceneGuidance) seed.action = `${seed.action}\nSCENE FOCUS: ${sceneGuidance} Respect the chosen framing.`;

    // With references, never lock to the dropdown — let the image win. A typed
    // custom subject is the one explicit override that still holds.
    const lockScene = !!custom;

    let plan: Plan;

    if (hasRefs) {
      // Reference-aware path — fall back to normal if vision fails
      try {
        plan =
          workflow === "openai"
            ? await planWithOpenAIRef(seed, model, avoidPayload, references, lockScene, opts, inspirationMode,
              plannerSystem(openAIImage ? openAIHorseReferenceSystem() : horseSystemForScene(seed.sceneType)), openAIImage, framing)
            : await planWithClaudeRef(seed, model, avoidPayload, references, lockScene, opts, inspirationMode);
      } catch (refErr) {
        markCostIncomplete();
        console.warn("Reference analysis failed, falling back to normal generation:", refErr);
        plan =
          workflow === "openai"
            ? await planWithOpenAI(seed, model, avoidPayload, opts, plannerSystem(horseSystemForScene(seed.sceneType)))
            : await planWithClaude(seed, model, avoidPayload, opts);
      }
    } else {
      plan =
        workflow === "openai"
          ? await planWithOpenAI(seed, model, avoidPayload, opts, plannerSystem(horseSystemForScene(seed.sceneType)))
          : await planWithClaude(seed, model, avoidPayload, opts);
    }

    if (!plan.prompt) throw new Error("Empty prompt from planner");
    const framingNegative = !horseArtScene && framing ? FRAMING_NEGATIVES[framing] : undefined;

    // Rendering choice:
    // - ONE reference  -> Flux img2img faithfully transforms that single photo.
    // - 2+ references   -> Seedream text-to-image driven by the COMBINED-strategy
    //   prompt, so the result reflects the best mix of ALL references instead of
    //   being anchored to only the first uploaded photo.
    let falModelUsed: string = imageModel;
    const singleRef = hasRefs && references && references.length === 1;
    const renderImagePromise: Promise<string> = singleRef && !openAIImage
      ? (async () => {
          try {
            const strength = typeof imgStrength === "number" ? imgStrength : 0.7;
            const url = await renderFluxImg2Img(plan.prompt, references![0], strength);
            falModelUsed = FLUX_I2I;
            return url;
          } catch (e) {
            markCostIncomplete();
            console.warn("Flux img2img failed, falling back to selected model:", e);
            falModelUsed = imageModel;
            return render(plan.prompt, seed.sceneType, framingNegative, "horses", false, imageModel, plan.referenceStrategy, plan.visualMedium);
          }
        })()
      : render(plan.prompt, seed.sceneType, framingNegative, "horses", false, imageModel, plan.referenceStrategy, plan.visualMedium);

    // Render the image and fix any rule-of-three in the caption in parallel.
    const [imageUrl, descFix, fcFix] = await Promise.all([
      renderImagePromise,
      fixCaption(plan.description, workflow, model),
      fixCaption(plan.firstComment, workflow, model),
    ]);
    plan.description = descFix.text ?? plan.description;
    plan.firstComment = fcFix.text;
    // Viral potential analysis — vision-based, falls back to keyword scoring
    const viral = (await analyzeViral(imageUrl, workflow, model)) ?? scoreByKeywords(plan);

    return NextResponse.json({
      ...plan,
      imageUrl,
      seed,
      provider: workflow,
      model,
      falModel: falModelUsed,
      ...costSummary(falModelUsed),
      imageSettings: settings,
      renderedPrompt,
      usedReference: hasRefs,
      viralScore: viral.viralScore,
      viralReason: viral.viralReason,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e?.message || "Generation failed" },
      { status: 500 }
    );
  }
}

// Stream previews while the same request continues rendering and captioning.
export async function POST(req: Request) {
  if (!req.headers.get("accept")?.includes("application/x-ndjson")) return handleGenerate(req);
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); };
      try {
        const response = await handleGenerate(req, (imageUrl) => send({ type: "partial", imageUrl }));
        const data = await response.json();
        send(response.ok ? { type: "result", data } : { type: "error", error: data.error });
      } catch (error) { send({ type: "error", error: error instanceof Error ? error.message : "Generation failed" }); }
      finally { if (!cancelled) controller.close(); }
    },
    cancel() { cancelled = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
