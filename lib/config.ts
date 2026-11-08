import { OPENAI_IMAGE_MODEL_IDS, DEFAULT_OPENAI_IMAGE_MODEL } from "./openaiImageSettings";
import { isHorseWallPaintingSceneType } from "./horseSceneGuidance";

// Central config — edit model names and image size here.

export const MODELS = {
  claude: "claude-haiku-4-5",
  openai: "gpt-5.4-mini",
  fal: "fal-ai/bytedance/seedream/v4/text-to-image", // Seedream V4 (text-to-image)
} as const;

export const OPENAI_IMAGE_MODELS = OPENAI_IMAGE_MODEL_IDS.map((value) => ({
  value, label: value, purpose: "OpenAI Image API", price: null,
  apiModel: value, endpoint: "generate" as const,
}));
export const RECIPE_DESIGNED_IMAGE_MODELS = OPENAI_IMAGE_MODELS;
export type RecipeDesignedImageModelValue = typeof OPENAI_IMAGE_MODEL_IDS[number];
export const DEFAULT_RECIPE_DESIGNED_IMAGE_MODEL = DEFAULT_OPENAI_IMAGE_MODEL;

// Flux Dev image-to-image — used when a reference image is uploaded so we can
// truly transform the uploaded photo (strength controls how much it changes).
export const FLUX_I2I = "fal-ai/flux/dev/image-to-image";

// Inspiration mode presets. The value is the Flux Dev img2img denoising
// strength (higher = more change away from the uploaded image), and it also
// selects how closely the text model follows the reference's style.
export const IMG2IMG_STRENGTHS = [
  { value: 0.5, label: "Stay close (keeps the mood)" },
  { value: 0.7, label: "Balanced inspiration" },
  { value: 0.9, label: "Creative upgrade (premium remix)" },
] as const;

// Selectable in the UI. First entry of each list is the default.
export const CLAUDE_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6"] as const;
export const OPENAI_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gpt-4.1-mini"] as const;

// ── IMAGE MODELS (text-to-image, tab-specific) ───────────────────────────────
// `price` is the per-image cost for our normal 4:5 portrait output
// (1024x1280 ≈ 1.31 MP, billed at 2 MP for per-megapixel models).
type ImageModelOption = { value: string; label: string; purpose: string; price: number | null };

// OpenAI image models plus the existing fal alternatives.
export const HORSE_IMAGE_MODELS: readonly ImageModelOption[] = [
  ...OPENAI_IMAGE_MODELS,
  {
    value: "fal-ai/bytedance/seedream/v4/text-to-image",
    label: "Seedream 4.0",
    purpose: "Best value",
    price: 0.03,
  },
  {
    value: "fal-ai/flux-2-pro",
    label: "FLUX 2 Pro",
    purpose: "Balanced premium",
    price: 0.045, // $0.03 first MP + $0.015 second MP
  },
] as const;

// Recipes & Fashion: value + a text-capable model for design pins.
export const OTHER_IMAGE_MODELS: readonly ImageModelOption[] = [
  ...OPENAI_IMAGE_MODELS,
  {
    value: "fal-ai/bytedance/seedream/v4/text-to-image",
    label: "Seedream 4.0",
    purpose: "Best value",
    price: 0.03,
  },
  {
    value: "fal-ai/bytedance/seedream/v4.5/text-to-image",
    label: "Seedream 4.5",
    purpose: "Premium",
    price: 0.04,
  },
  {
    value: "fal-ai/ideogram/v3",
    label: "Ideogram V3 Turbo",
    purpose: "Text / Creative",
    price: 0.03, // TURBO speed only
  },
] as const;

// Combined list (deduped) — used for label/price lookups by slug.
export const ALL_IMAGE_MODELS: readonly ImageModelOption[] = [
  ...HORSE_IMAGE_MODELS,
  ...OTHER_IMAGE_MODELS.filter(
    (o) =>
      !HORSE_IMAGE_MODELS.some((h) => h.value === o.value) &&
      !RECIPE_DESIGNED_IMAGE_MODELS.some((recipeModel) => recipeModel.value === o.value)
  ),
];

// Image models available for a given content tab. Defaults are explicit above.
export function imageModelsFor(
  contentType: "horses" | "recipes" | "fashion",
  recipeDesignPin = false
): readonly ImageModelOption[] {
  if (contentType === "horses") return HORSE_IMAGE_MODELS;
  if (contentType === "recipes" && recipeDesignPin) return RECIPE_DESIGNED_IMAGE_MODELS;
  return OTHER_IMAGE_MODELS;
}

// Default image model shared by every workspace.
export const DEFAULT_IMAGE_MODEL: string = DEFAULT_OPENAI_IMAGE_MODEL;

export const BATCH_OPTIONS = [1, 5, 10, 15, 20] as const;

// Camera framing options shown in the UI.
export const FRAMINGS = [
  { value: "random", label: "Random (varied)" },
  { value: "eye", label: "Horse eye (macro)" },
  { value: "closeup", label: "Extreme close-up" },
  { value: "portrait", label: "Tight portrait" },
  { value: "half", label: "Half body" },
  { value: "full", label: "Full body" },
  { value: "wide", label: "Wide / landscape" },
] as const;

export type Framing = (typeof FRAMINGS)[number]["value"];

// Directive injected into the image prompt for each framing. "random" has none
// (the scene's own action decides), giving natural variety across a batch.
// This is the SINGLE most important composition rule and overrides the action.
export const FRAMING_DIRECTIVES: Record<string, string> = {
  eye:
    "CAMERA FRAMING (most important rule, overrides everything else): EXTREME MACRO of a single horse EYE. The eye fills most of the frame with a soft natural catchlight, long eyelashes, and fine surrounding coat hair in razor-sharp detail. Show only the eye and the area immediately around it — no full head, no muzzle, no body.",
  closeup:
    "CAMERA FRAMING (most important rule, overrides everything else): EXTREME CLOSE-UP of the horse's face — the eyes, muzzle and forelock fill the entire frame. Very shallow depth of field, soft bokeh. Do NOT show the body or legs.",
  portrait:
    "CAMERA FRAMING (most important rule, overrides everything else): TIGHT HEAD-AND-NECK PORTRAIT — only the head and neck fill the frame, 135mm telephoto at f/2.8, background fully blurred into soft bokeh. Do NOT show the full body or legs.",
  half:
    "CAMERA FRAMING (most important rule, overrides everything else): HALF-BODY shot — show the horse from the head down to the mid-body / chest and front-legs area only. Do NOT show the whole horse and do NOT show the hind legs or hooves.",
  full:
    "CAMERA FRAMING (most important rule, overrides everything else): FULL-BODY shot — the ENTIRE horse is visible from the ears down to all four hooves inside the frame, nothing cropped (no cropped head, no cropped legs), natural side or three-quarter stance.",
  wide:
    "CAMERA FRAMING (most important rule, overrides everything else): WIDE shot — the whole horse is visible with generous surrounding environment and more background, a wider scene. Do not crop the horse.",
};

// Sent to the image model's negative_prompt per framing — the strongest lever
// for steering crop on Seedream.
export const FRAMING_NEGATIVES: Record<string, string> = {
  eye: "full body, whole horse, full head, full face, muzzle, ears, two eyes, distant horse, wide shot, legs, hooves",
  closeup: "full body, whole horse, legs, hooves, distant horse, wide shot, small subject in frame",
  portrait: "full body, whole horse, legs, hooves, distant horse, wide landscape shot, small subject",
  half: "full body, whole horse head to hooves, all four legs visible, hooves, distant horse, wide landscape shot, tiny horse in frame",
  full: "extreme close-up, head only, face filling frame, cropped legs, cut-off legs, cropped head, cut-off head, tight crop",
  wide: "extreme close-up, tight portrait, head only, face filling frame, cropped horse",
};

// Pricing for cost estimate per image. Edit these numbers anytime.
// Text models: USD per 1M tokens (input / output).
// Fal model: flat USD per generated image.
export const PRICING = {
  text: {
    "claude-haiku-4-5":   { in: 1.00, out: 5.00 },
    "claude-sonnet-4-6":  { in: 3.00, out: 15.00 },
    "gpt-5.4-mini":       { in: 0.75, cached: 0.075, out: 4.50 },
    "gpt-5.4":            { in: 2.50, cached: 0.25, out: 15.00 },
    "gpt-4.1-mini":       { in: 0.40, cached: 0.10, out: 1.60 },
  } as Record<string, { in: number; out: number; cached?: number }>,
  fal: {
    "fal-ai/bytedance/seedream/v4/text-to-image": 0.03,
    "fal-ai/bytedance/seedream/v4.5/text-to-image": 0.04,
    "fal-ai/flux-2-pro": 0.045,
    "fal-ai/flux-pro/v1.1-ultra": 0.06,
    "fal-ai/imagen4/preview/ultra": 0.06,
    "fal-ai/flux/schnell": 0.006,
    "fal-ai/ideogram/v3": 0.03,
    "fal-ai/qwen-image": 0.04,
    // Flux Dev image-to-image is $0.03 per rounded-up megapixel, not a flat
    // per-image price. Its final dimensions are not known before rendering.
  } as Record<string, number>,
};

export function estimateCost(
  textModel: string,
  usage: { in: number; out: number; cached?: number } | null,
  falModel: string
): number {
  return estimateTextCost(textModel, usage) + estimateImageCost(falModel);
}

// Average tokens used per planning call. Used to project cost before generation.
export const AVG_USAGE = { in: 350, out: 220 } as const;

export function estimatePerImage(textModel: string, falModel: string): number {
  return estimateCost(textModel, { in: AVG_USAGE.in, out: AVG_USAGE.out }, falModel);
}

export function estimateTextCost(
  textModel: string,
  usage: { in: number; out: number; cached?: number } | null
): number {
  const t = PRICING.text[textModel];
  if (!t || !usage) return 0;
  const cached = Math.max(0, Math.min(usage.in, usage.cached ?? 0));
  // GPT-5.4 uses higher rates when its input exceeds 272k tokens.
  const longContext = textModel === "gpt-5.4" && usage.in > 272_000;
  const inputRate = longContext ? t.in * 2 : t.in;
  const cachedRate = longContext ? (t.cached ?? t.in) * 2 : (t.cached ?? t.in);
  const outputRate = longContext ? t.out * 1.5 : t.out;
  return ((usage.in - cached) * inputRate + cached * cachedRate + usage.out * outputRate) / 1_000_000;
}

export function estimateImageCost(falModel: string): number {
  return PRICING.fal[falModel] ?? 0;
}

export function isRecipeDesignedImageModel(value: string): value is RecipeDesignedImageModelValue {
  return RECIPE_DESIGNED_IMAGE_MODELS.some((model) => model.value === value);
}

export function resolveRecipeDesignedImageModel(value: string) {
  return (
    RECIPE_DESIGNED_IMAGE_MODELS.find((model) => model.value === value) ??
    RECIPE_DESIGNED_IMAGE_MODELS[0]
  );
}

// Vertical 4:5 output
export const IMAGE = {
  width: 1024,
  height: 1280,
  aspect_ratio: "4:5",
} as const;

// ── QUALITY SUFFIX (scene-adaptive) ──────────────────────────────────────────
// Appended to every image prompt. The right block is chosen from the scene type
// so emotional scenes get portrait/bokeh/foal direction and western scenes get
// landscape direction — they no longer fight each other.

// Shared realism + clean-output cues for every scene.
const BASE_QUALITY =
  "Photorealistic wildlife-style photograph of a REAL horse, shot on a full-frame DSLR with a sharp prime lens. " +
  "It must look like a genuine outdoor nature photograph of a real living animal, NOT an illustration, render, or AI image. " +
  "Horse with EXACTLY FOUR LEGS, two front and two back, four hooves total, " +
  "anatomically correct equine skeleton and muscle, natural realistic body proportions, " +
  "realistic mane and tail with individual flowing strands, real coat texture showing fine individual hairs, " +
  "natural realistic eyes with a true soft catchlight, accurate muzzle, nostrils, lips, whiskers and facial structure. " +
  "Natural color grade, true-to-life coat and skin tones, soft natural daylight, realistic shallow depth of field, believable shadow falloff. " +
  "Authentic documentary-style outdoor equine photography, clean and professional, believable natural light and depth, sharp authentic detail. " +
  "No painterly or stylized look, no cartoon feel, no AI artifacts, no plastic sheen, no fake luxury gloss, no exaggerated cinematic drama, no over-sharpening, no HDR halos.";

// Emotional scenes: mare+foal and loving couples. Portrait/bokeh first.
const EMOTIONAL_QUALITY =
  "Tender, emotional equine portrait, intimate and heartwarming. " +
  "Soft warm natural light — golden hour, gentle overcast diffusion, or morning mist — no harsh sun. " +
  "For close couple or head shots: 135mm telephoto, f/2.8 shallow depth of field, " +
  "heads and necks filling the frame, the background melted into soft creamy bokeh " +
  "(autumn leaves, golden meadow, green pasture, misty forest). " +
  "For full-body bonding shots: 50-85mm, both horses in sharp focus with gentle background separation. " +
  "If a foal is present it is clearly smaller than the mare, with long thin legs, a soft fuzzy coat, " +
  "and oversized curious eyes — never an adult horse shrunk down. " +
  "When the pair is a black horse and a white horse, render the jet-black and pure-white coat contrast " +
  "in full detail with both coats equally lit — that contrast is the centerpiece.";

// Western scenes: ranch, herds, cowboys, landscape hero shots.
const WESTERN_QUALITY =
  "Photorealistic American Western photograph. " +
  "Real outdoor American landscape, huge sky, wide depth, natural earth tones, " +
  "real dust, grass, water and rock textures, golden hour or natural daylight. " +
  "If a cowboy is present: realistic Western clothing (jeans, work shirt, cowboy hat, boots), " +
  "realistic saddle and tack, natural riding posture, correct hand anatomy, believable rider-horse interaction. " +
  "35mm wide for landscape or 85-200mm telephoto for action, all four legs clearly visible.";

// A photograph of a monumental painted mural, not a three-dimensional horse.
const MURAL_QUALITY =
  "Photograph a giant horse mural painted on a textured wall, several times taller than the artist beside it. " +
  "The horse is a flat hand-painted artwork, not a living or three-dimensional horse. Show wall texture, brushstrokes and a human scale reference. " +
  "Natural lighting, believable human anatomy, no watermark or logo.";

function isMuralScene(sceneType: string): boolean {
  return /mural|artist/i.test(sceneType);
}

function isHorseArtScene(sceneType: string): boolean {
  return /dreamy greeting horse art scene|art blessing horse scene|fantasy floral horse art scene/i.test(sceneType);
}

function isEmotionalScene(sceneType: string): boolean {
  return /foal|couple|affection|bonding|portrait|black horse|majestic|funny|playful/i.test(sceneType);
}

const HORSE_ART_QUALITY =
  "Decorative horse art image with graceful anatomy, readable expressions, flowing mane detail, elegant floral framing, soft atmospheric light, and a polished greeting-card or blessing-style composition. " +
  "Allow painterly, illustrative, romantic, celestial, floral, or soft fantasy styling. " +
  "Use moonlight, sunrise glow, mist, stars, constellations, roses, blossoms, wreaths, arches, or symbolic framing when they fit the selected scene family. " +
  "Keep it beautiful, peaceful, emotionally warm, and visually coherent. Do not include decorative text, greeting words, captions, or typography by default. Avoid dark fantasy, horror, gore, aggression, or messy clutter.";

export function qualitySuffixFor(sceneType: string): string {
  if (isHorseWallPaintingSceneType(sceneType)) return "Photograph a finished horse painting directly on a textured wall. The horse is flat painted artwork, with visible brushwork and natural light; no living horse, text, or watermark.";
  if (/black horse in gentle rain scene/i.test(sceneType)) return `One black horse in gentle rain with a naturally damp, detailed coat and soft overcast light. ${BASE_QUALITY}`;
  if (isHorseArtScene(sceneType)) return HORSE_ART_QUALITY;
  if (isMuralScene(sceneType)) return `${MURAL_QUALITY} ${BASE_QUALITY}`;
  const block = isEmotionalScene(sceneType) ? EMOTIONAL_QUALITY : WESTERN_QUALITY;
  return `${block} ${BASE_QUALITY}`;
}

// Back-compat default (western flavor) for any caller without a scene type.
export const QUALITY_SUFFIX = qualitySuffixFor("western");

// ── NEGATIVE PROMPT (scene-adaptive) ─────────────────────────────────────────
// Strong push away from fantasy / sci-fi / illustration plus anatomy guards.

const NEGATIVE_BASE =
  // Anatomy
  "five legs, six legs, three legs, extra leg, extra limb, extra hoof, missing hoof, " +
  "duplicate leg, duplicated limbs, floating leg, missing leg, fused legs, merged legs, " +
  "deformed legs, twisted legs, broken legs, bent backwards joints, bad leg perspective, " +
  "extra tail, two tails, extra head, two heads, deformed head, malformed body, " +
  "extra ears, fused body parts, mutated anatomy, malformed, disfigured, " +
  "bad anatomy, wrong anatomy, asymmetrical body, duplicate horse, cloned horse, " +
  // Style — push hard against non-photoreal and the "AI look"
  "fantasy, sci-fi, science fiction, surreal, magical, magic glow, floating objects, " +
  "futuristic gear, neon, glowing eyes, fake eyes, distorted eyes, extra pupils, melted face, warped face, melted muzzle, " +
  "unrealistic sky colors, oversaturated, overprocessed, over-sharpened, HDR halos, airbrushed, unnatural blur, fake gloss, luxury gloss, " +
  "cartoon, anime, illustration, painting, painterly, drawing, sketch, stylized, " +
  "3d render, cgi, plastic look, plastic skin, waxy skin, waxy coat, glossy fake sheen, glassy eyes, doll eyes, perfume-ad look, video game look, abstract, " +
  "AI-generated look, AI artifacts, fake-looking, doll-like, mannequin, " +
  // Quality
  "low quality, low resolution, low detail, jpeg artifacts, noise, grainy, " +
  "text, words, letters, caption, signature, watermark, logo, frame, border";

// Foal-specific failures (Seedream often renders an adult horse at small scale).
const NEGATIVE_FOAL =
  "adult horse presented as a foal, foal with adult proportions, oversized foal, " +
  "foal same size as mare, miniature adult horse, deformed foal face, foal with long adult legs, ";

// Rider / cowboy failures — only relevant to western scenes.
const NEGATIVE_RIDER =
  "distorted rider, deformed cowboy, extra fingers, missing fingers, malformed hands, " +
  "fused hands, unrealistic saddle, costume look, plastic clothing, ";

// Mural scenes deliberately CONTAIN a painting, so we must not negate
// "painting / illustration / drawing".
const NEGATIVE_MURAL =
  "living horse emerging from the wall, three-dimensional sculpture, floating artist, " +
  "cartoon, anime, fantasy, fake, plastic, plastic horse, blurry, blurry details, soft focus, soft details, low quality, " +
  "distorted horse, bad anatomy, extra legs, extra heads, ugly eyes, weak eyes, dull eyes, " +
  "messy composition, weak composition, " +
  "duplicate person, duplicate horse, flat lighting, dull lighting, " +
  "real 3d horse standing in the room, real horse in the room, horse detached from the wall, " +
  "floating horse, horse stepping out of the wall, " +
  "text, watermark, logo, frame, AI artifacts";

const NEGATIVE_HORSE_ART =
  "horror, dark fantasy, gothic horror, demon horse, monster horse, undead, skull, blood, gore, violence, attack scene, broken anatomy, extra legs, extra heads, fused limbs, distorted face, melted face, ugly eyes, warped muzzle, deformed horse, muddy composition, text, words, letters, greeting text, good morning text, good night text, caption, typography, unreadable text, garbled letters, watermark, logo, cheap clipart, crude collage";

export function negativePromptFor(sceneType: string): string {
  if (isHorseWallPaintingSceneType(sceneType)) return NEGATIVE_MURAL;
  if (isHorseArtScene(sceneType)) return NEGATIVE_HORSE_ART;
  if (isMuralScene(sceneType)) return NEGATIVE_MURAL;
  return isEmotionalScene(sceneType)
    ? NEGATIVE_FOAL + NEGATIVE_BASE
    : NEGATIVE_RIDER + NEGATIVE_BASE;
}

// Back-compat default.
export const NEGATIVE_PROMPT = negativePromptFor("western");

// ── FASHION ──────────────────────────────────────────────────────────────────
export const FASHION_QUALITY_SUFFIX =
  "Professional women's fashion photography, photorealistic and elegant. " +
  "Realistic female model with correct anatomy, natural relaxed hand poses, natural body proportions. " +
  "The clothing or product is clearly visible, well-lit, and the hero of the image. " +
  "Soft premium lighting — natural window light, golden hour, or soft studio diffusion. " +
  "Clean boutique or lifestyle background, uncluttered and non-distracting. " +
  "Modern, elegant, French market aesthetic. Shot on a full-frame camera with a 50-85mm lens, " +
  "shallow depth of field, magazine quality. Photorealistic, correct proportions, " +
  "no distorted hands, high detail, fashion editorial look.";

export const FASHION_NEGATIVE =
  "distorted hands, extra fingers, missing fingers, deformed hands, fused fingers, clawed hands, " +
  "bad anatomy, wrong proportions, deformed face, distorted body, extra limbs, missing limbs, " +
  "oversexualized, overly revealing, inappropriate pose, lingerie, nude, " +
  "fantasy, surreal, magical, cartoon, anime, illustration, painting, " +
  "3d render, cgi, plastic look, mannequin-like, doll-like, " +
  "text, watermark, logo, frame, border, " +
  "blurry, low quality, low resolution, oversaturated, harsh lighting, unflattering light";

// ── RECIPE / FOOD ────────────────────────────────────────────────────────────
export const FOOD_QUALITY_SUFFIX =
  "Professional food photography, ultra realistic and mouth-watering. " +
  "Appetizing fresh detail and texture (melty cheese, glossy sauce, crisp edges, steam, crumbs, garnish). " +
  "Natural appetizing colors, soft natural lighting, shallow depth of field, clean uncluttered background, tasteful styling. " +
  "Shot on a full-frame camera with a 50mm or macro lens, high detail, magazine quality. " +
  "Realistic photograph only, correct food shapes and proportions.";

export const FOOD_NEGATIVE =
  "cartoon, anime, illustration, painting, 3d render, cgi, plastic food, fake food, " +
  "deformed, ugly, messy plating, unappetizing, burnt, moldy, raw where it should be cooked, " +
  "extra fingers, deformed hands, text, words, watermark, logo, " +
  "blurry, low quality, low resolution, oversaturated, bad lighting";

// Design-pin quality (title text baked into the image) + a negative that does
// NOT exclude text, but pushes against garbled lettering.
export const FOOD_QUALITY_DESIGN =
  "Scroll-stopping, premium Pinterest recipe pin design, vertical 2:3 layout, modern viral food-blog aesthetic. " +
  "Two beautifully styled, appetizing photos of the same dish with steam, fresh garnish and rich texture. " +
  "An elegant, eye-catching title banner: tasteful color or a soft gradient, stylish modern typography, and a small decorative accent (a thin divider line, a little leaf or fork-and-knife icon, or a slim frame). " +
  "Strong contrast, balanced spacing, high-end professional layout. " +
  "Crisp, perfectly readable title text with correct spelling. Sharp, high resolution, vibrant natural food colors.";

export const FOOD_NEGATIVE_DESIGN =
  "cartoon, anime, 3d render, cgi, plastic food, fake food, deformed, ugly, messy plating, unappetizing, " +
  "burnt, blurry, low quality, low resolution, oversaturated, " +
  "gibberish text, misspelled text, distorted letters, jumbled letters, unreadable text, extra letters";

// ── MODEL-SPECIFIC PROMPT ADAPTER ────────────────────────────────────────────
// The creative idea (the planner's prompt) stays the same for every model; only
// the realism/quality framing around it changes to suit how each model reads
// prompts. Caption text is never touched here.
type ImgContent = "horses" | "recipes" | "fashion";

// Premium boost for non-horse premium models (e.g. fashion/recipe on Seedream 4.5).
const PREMIUM_BOOST =
  "Premium quality: ultra-realistic detail, rich fine texture, flawless natural anatomy and proportions, " +
  "balanced professional composition, crisp sharp focus, magazine-grade lighting and color grading.";

const HORSE_SEEDREAM_REALISM =
  "Seedream horse direction: keep the prompt visually clear and realistic. " +
  "Favor honest outdoor horse photography, clean anatomy, natural eyes and muzzle detail, real coat texture, believable mane and tail movement, and soft natural light. " +
  "Keep backgrounds clean and supportive, never busy. Avoid fake gloss, waxy texture, poster-like drama, and stylized AI beauty.";

const HORSE_SEEDREAM_ART =
  "Seedream horse art direction: keep the composition clean, beautiful, and clearly decorative. " +
  "Favor graceful horses, soft floral or celestial framing, readable silhouettes, harmonious color, and a dreamy emotional mood. " +
  "Allow painterly or illustrative beauty, but avoid horror, clutter, muddy detail, and broken anatomy.";

// Strongest premium realism for HORSES (FLUX 2 Pro). Documentary / nature-photo
// oriented — refined detail and natural light, deliberately NOT over-processed.
const HORSE_PREMIUM_REALISM =
  "Premium realism: authentic outdoor horse photography with documentary-style naturalism. " +
  "Refined true-to-life detail in the eyes, muzzle, whiskers, coat, mane and tail, accurate equine anatomy and natural proportions, " +
  "believable natural light and outdoor depth, lifelike skin and hair texture, natural color, and a clean real-camera feel. " +
  "It must read as a genuine photograph of a real horse in nature — not art, not a render, not over-processed. " +
  "Avoid exaggerated drama, heavy HDR, over-sharpening, waxy surfaces, and any glossy plastic sheen.";

const HORSE_PREMIUM_ART =
  "Premium horse art direction: elegant decorative horse imagery with graceful anatomy, refined floral or celestial composition, soft luminous atmosphere, and emotionally clear storytelling. " +
  "Allow romantic illustration, blessing-card warmth, moonlit fantasy, and polished painterly detail. " +
  "Keep it beautiful and coherent, never dark, grotesque, or cluttered.";

// Strong no-text rule for Ideogram (which loves rendering text — we don't want it).
const NO_TEXT_RULE =
  "Important: absolutely NO text, no letters, no words, no numbers, no captions, " +
  "no logo, no watermark, no signature, no typography anywhere in the image.";

// Compact realism tag per content type — used by fast/clean models (Flux Schnell,
// Ideogram) instead of the long quality block, so the prompt stays short and clear.
const COMPACT_QUALITY: Record<ImgContent, string> = {
  horses:
    "Photorealistic outdoor photo of a REAL horse, like genuine nature photography, not AI or cartoon. " +
    "Exactly four legs and correct equine anatomy, natural mane and tail, real coat texture, " +
    "realistic eyes, muzzle and face, natural daylight, sharp authentic detail. No painterly or stylized look.",
  recipes:
    "Photorealistic, appetizing food photography, fresh natural texture and color, " +
    "soft natural lighting, shallow depth of field, clean background, high detail.",
  fashion:
    "Photorealistic fashion photograph. Realistic female model with correct anatomy and natural hands, " +
    "the clothing clearly visible, soft premium lighting, clean background, high detail.",
};

// Structured realism/anatomy block for Qwen-Image (responds well to explicit rules).
const QWEN_STRUCT: Record<ImgContent, string> = {
  horses:
    "Realism requirements: anatomically correct horse with exactly four legs and four hooves, " +
    "natural body proportions, realistic muscle and coat, natural mane and tail, realistic eyes and muzzle. " +
    "Avoid: extra or distorted legs, deformed anatomy, fused limbs, melted face, fake gloss.",
  recipes:
    "Realism requirements: realistic food shapes and textures, natural appetizing colors, " +
    "correct proportions, believable plating. Avoid: deformed, fake, plastic-looking food, garbled text.",
  fashion:
    "Realism requirements: realistic female anatomy and natural body proportions, " +
    "correct hands with five fingers, realistic fabric folds and texture. " +
    "Avoid: distorted hands or limbs, deformed face, extra fingers, unnatural proportions.",
};

// Build the final image prompt tuned for the selected model. The base creative
// prompt is identical across models; only the quality/realism framing differs.
export function buildModelPrompt(
  basePrompt: string,
  suffix: string,
  imageModel: string,
  contentType: ImgContent,
  design = false,
  sceneType?: string
): string {
  // Recipe design pins deliberately bake the title TEXT into the image, so they
  // must keep the full design suffix and never get the no-text / compact rules.
  if (design) {
    return imageModel.includes("seedream") && imageModel.includes("4.5")
      ? `${basePrompt}\n\n${suffix}\n\n${PREMIUM_BOOST}`
      : `${basePrompt}\n\n${suffix}`;
  }

  // Flux Schnell — fast distilled model: keep it short and direct.
  if (imageModel.includes("flux") && imageModel.includes("schnell")) {
    return `${basePrompt}\n\n${COMPACT_QUALITY[contentType]}`;
  }

  // Ideogram V3 Turbo — clean, direct, with a hard no-text rule.
  if (imageModel.includes("ideogram")) {
    return `${basePrompt}\n\n${COMPACT_QUALITY[contentType]}\n\n${NO_TEXT_RULE}`;
  }

  // Qwen-Image — full quality block plus a structured anatomy/realism section.
  if (imageModel.includes("qwen")) {
    return `${basePrompt}\n\n${suffix}\n\n${QWEN_STRUCT[contentType]}`;
  }

  const isPremium =
    (imageModel.includes("seedream") && imageModel.includes("4.5")) ||
    imageModel.includes("flux-2") ||
    (imageModel.includes("flux-pro") && imageModel.includes("ultra")) ||
    imageModel.includes("imagen");

  // Horses: premium models (FLUX 2 Pro) get the strongest nature-photo realism
  // block; Seedream 4.0 (default) keeps the strong-but-natural realism suffix.
  if (contentType === "horses") {
    if (isHorseWallPaintingSceneType(sceneType)) return `${basePrompt}\n\n${suffix}`;
    const artScene = isHorseArtScene(sceneType ?? "");
    if (imageModel.includes("flux-2")) {
      return `${basePrompt}\n\n${suffix}\n\n${artScene ? HORSE_PREMIUM_ART : HORSE_PREMIUM_REALISM}`;
    }
    if (imageModel.includes("seedream")) {
      return `${basePrompt}\n\n${suffix}\n\n${artScene ? HORSE_SEEDREAM_ART : HORSE_SEEDREAM_REALISM}`;
    }
    return isPremium
      ? `${basePrompt}\n\n${suffix}\n\n${artScene ? HORSE_PREMIUM_ART : HORSE_PREMIUM_REALISM}`
      : `${basePrompt}\n\n${suffix}`;
  }

  // Recipes / Fashion premium models — generic premium boost.
  if (isPremium) {
    return `${basePrompt}\n\n${suffix}\n\n${PREMIUM_BOOST}`;
  }

  // Default (e.g. Seedream 4.0) — standard quality suffix.
  return `${basePrompt}\n\n${suffix}`;
}
