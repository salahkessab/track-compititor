import { isHorseArtSceneType, type InspirationMode } from "./prompts";
import { isHorseWallPaintingSceneType } from "./horseSceneGuidance";

// Each action is independent of the setting and camera crop. Nine actions and
// eight compatible settings give 72 combinations before a pair must repeat.
const PAIR_SETTINGS = [
  { setting: "a spring meadow with soft green grass", light: "gentle overcast daylight" },
  { setting: "an autumn pasture with distant trees", light: "warm late-afternoon side light" },
  { setting: "a snow-covered paddock with a weathered fence", light: "soft cool winter morning light" },
  { setting: "a grassy hillside after a light rain", light: "diffused light under a clearing sky" },
  { setting: "a quiet ranch pasture with a wooden fence", light: "warm early-morning backlight" },
  { setting: "a misty field with a distant tree line", light: "muted dawn light" },
  { setting: "an open field with pale grasses", light: "soft afternoon light" },
  { setting: "a sheltered paddock beside a barn", light: "soft shade and reflected daylight" },
] as const;

const PAIR_SUBJECTS = [
  "two adult horses, one chestnut and one grey",
  "two adult horses, one bay and one palomino",
  "two adult horses, one dark bay and one dapple grey",
  "two adult horses, one black and one chestnut",
  "two adult horses, one buckskin and one grey",
  "two adult horses, one paint and one bay",
  "two adult horses, one palomino and one dark brown",
  "two adult horses, one grey and one bay",
  "two adult horses, one chestnut and one buckskin",
] as const;
const BLACK_WHITE_SUBJECTS = [
  "two adult horses, one black and one white",
  "a black Friesian and a white horse",
  "a black horse and a white Andalusian",
  "two adult horses, one solid black and one naturally white",
  "a white horse and a black horse with a long natural mane",
  "a black horse and a white horse with a natural mane",
  "a white Andalusian and a black Friesian",
  "a black horse and a white horse with distinct natural coats",
  "a white horse and a black horse with relaxed natural manes",
] as const;
const PAIR_ACTIONS: Record<"couple" | "friendship" | "blackwhite", readonly string[]> = {
  couple: [
    "the pair gently touch noses",
    "the pair walk calmly side by side",
    "one horse rests its muzzle lightly against the other's neck",
    "the pair stand close with relaxed ears, looking in the same direction",
    "the pair turn toward one another with a little space between their faces",
    "the pair pause together, one looking toward the camera and the other to the side",
    "the pair graze close together, naturally angled apart",
    "one horse watches quietly while its companion turns its head toward it",
    "the pair stand close with their necks gently crossing",
  ],
  friendship: [
    "the friends gently groom one another at the withers",
    "the friends stand head-to-tail in relaxed companionship",
    "the friends walk together with an easy, unhurried stride",
    "one friend nudges the other's shoulder gently",
    "the friends rest side by side with their heads lowered",
    "the friends graze nearby, each facing a different direction",
    "the friends pause shoulder to shoulder with relaxed ears",
    "one friend sniffs the other's mane in a relaxed moment",
    "the friends stand close while looking in opposite directions",
  ],
  blackwhite: [
    "the contrasting pair stand shoulder to shoulder",
    "the contrasting pair gently touch noses",
    "the contrasting pair walk together in profile",
    "the black horse turns toward the white horse with relaxed ears",
    "the white horse looks toward the camera while the black horse looks aside",
    "the contrasting pair graze close together",
    "the contrasting pair pause quietly with their heads lowered",
    "the black horse rests its muzzle lightly against the white horse's neck",
    "the white horse turns toward its black companion in a relaxed moment",
  ],
};

export type PairDirection = { subject: string; setting: string; light: string; action: string };
export const PAIR_DIRECTION_COUNT = PAIR_SETTINGS.length * PAIR_ACTIONS.couple.length;
export function pairDirection(mode: string | undefined, batchIndex: unknown, batchOffset: unknown, hasReference: boolean, customSubject: string | undefined, framing?: string): PairDirection | null {
  if (hasReference || customSubject?.trim() || framing === "eye" || !mode || !Object.prototype.hasOwnProperty.call(PAIR_ACTIONS, mode)) return null;
  if (!Number.isInteger(batchIndex) || Number(batchIndex) < 0 || Number(batchIndex) > 49 || !Number.isInteger(batchOffset) || Number(batchOffset) < 0 || Number(batchOffset) >= PAIR_DIRECTION_COUNT) return null;
  const index = Number(batchIndex);
  const offset = Number(batchOffset);
  const actionIndex = (index + offset) % 9;
  const setting = PAIR_SETTINGS[(index * 3 + offset) % PAIR_SETTINGS.length];
  return {
    subject: mode === "blackwhite" ? BLACK_WHITE_SUBJECTS[actionIndex] : PAIR_SUBJECTS[actionIndex],
    ...setting,
    action: PAIR_ACTIONS[mode as keyof typeof PAIR_ACTIONS][actionIndex],
  };
}
// These cues do not dictate shot distance, so a chosen close-up or wide crop wins.
const VISUAL_DIRECTIONS = [
  "Keep the focal point clear and the composition balanced.",
  "Place the focal point slightly off-center if the requested composition allows.",
  "Use a natural three-quarter viewpoint if compatible with the requested crop.",
  "Capture a candid moment with clear separation between visible subjects.",
  "Emphasize the visible subject's natural texture and a clean silhouette.",
  "Use a quiet, asymmetrical balance if compatible with the requested crop.",
  "Use a natural eye-level viewpoint if compatible with the requested scene.",
  "Use gentle tonal contrast suited to the requested light and medium.",
] as const;
export function visualDirection(batchIndex: unknown, batchOffset: unknown, hasReferenceOrCustom: boolean): string | undefined {
  if (hasReferenceOrCustom || !Number.isInteger(batchIndex) || Number(batchIndex) < 0 || Number(batchIndex) > 49 || !Number.isInteger(batchOffset) || Number(batchOffset) < 0 || Number(batchOffset) >= PAIR_DIRECTION_COUNT) return undefined;
  return VISUAL_DIRECTIONS[(Number(batchIndex) + Number(batchOffset)) % VISUAL_DIRECTIONS.length];
}

// Shared GPT Image guidance: Sunburst, Flare, GPT Image 2 and 1.5 all accept
// plain visual instructions. Quality and size are API settings, not magic tags.
export function openAIPlannerSystem(base: string, transparent = false): string {
  return `${base}\n\nGPT IMAGE PROMPT DIRECTION\n` +
    `Write the image prompt as a coherent visual brief: subject, visible action, composition, light, medium and essential constraints. ` +
    `Keep the selected subject and framing; resolve conflicting seed details instead of mixing incompatible places, weather or lighting. ` +
    `For references, explicitly describe what should remain recognizable and what should change. ` +
    `Use plain language rather than image-model tags, and retain the required JSON and caption format.` +
    (transparent ? ` The image must have a transparent background: do not describe a surrounding scene, backdrop or checkerboard.` : "");
}

export function buildOpenAIImagePrompt(args: {
  prompt: string; kind: "horses" | "recipes" | "fashion"; scene: string;
  designed: boolean; hasReferences: boolean; framing?: string; transparent?: boolean;
  direction?: PairDirection | null; visualDirection?: string; sceneGuidance?: string;
  referenceCount?: number; referenceMode?: InspirationMode; referenceStrategy?: string;
  customSubject?: string; canvasSize?: string; referenceMedium?: "photograph" | "artwork";
}): string {
  const mural = args.kind === "horses" && /mural/i.test(args.scene);
  const wallPainting = args.kind === "horses" && isHorseWallPaintingSceneType(args.scene) && !args.hasReferences && !args.customSubject?.trim();
  const art = args.kind === "horses" && (isHorseArtSceneType(args.scene) || (args.hasReferences && args.referenceMedium === "artwork"));
  const unknownReferenceMedium = args.kind === "horses" && args.hasReferences && !args.referenceMedium;
  const tightMural = mural && ["eye", "closeup", "portrait"].includes(args.framing || "");
  const medium = mural
    ? tightMural ? "Create a realistic close photograph of a horse mural painted on a wall."
      : "Create a realistic photograph of a giant horse mural painted on a wall, with an artist for scale when the crop allows."
    : wallPainting ? args.transparent ? "Create an isolated fragment of textured wall with a finished horse painting."
      : "Create a realistic photograph of a finished horse painting on a textured wall."
    : art ? isHorseArtSceneType(args.scene) ? "Create decorative horse artwork in the requested artistic medium and style."
      : "Create horse artwork in the requested artistic medium and style."
    : unknownReferenceMedium ? "Create a horse image in the requested visual medium; preserve the reference medium unless a change is requested."
    : args.kind === "recipes" && args.designed ? "Create the requested food post design, with the dish as the visual focus."
    : `Create a photorealistic ${args.kind === "horses" ? "equine" : args.kind === "recipes" ? "food" : "fashion"} photograph with believable light and texture.`;
  const details = mural
    ? tightMural ? "The horse is flat painted artwork; show paint and wall texture. The artist may be outside this close crop."
      : "The horse is a flat painting on the wall; show paint and wall texture, and show the artist much smaller when visible."
    : wallPainting ? "The horse is flat painted artwork; show brushwork and wall texture where the crop and background allow."
    : art ? "Keep the horse's anatomy coherent and its expression readable within the requested artistic style."
    : unknownReferenceMedium ? "Keep the requested horse count, relationship and anatomy coherent in the requested visual medium."
    : args.kind === "horses" ? "Keep the requested horse count and relationship, natural anatomy and proportions, and realistic eyes, coat and mane where visible."
    : args.kind === "recipes" ? "Keep the food, ingredients and presentation consistent with the requested dish."
    : "Keep the requested garment clearly visible, with natural fabric, hands and proportions.";
  let references = "";
  if (args.hasReferences) {
    const role = args.customSubject?.trim()
      ? "The explicitly requested subject takes priority. Use the references for visual style, not for replacing that subject."
      : args.referenceMode === "close"
        ? "Stay close to the reference subject and essential recognizable markings, pose and composition; make only the requested refinements and honor any explicitly requested crop."
        : args.referenceMode === "creative"
          ? "Use the references as creative inspiration; preserve the essential requested subject and recognizable traits while creating a new interpretation."
          : "Preserve the reference subject and its essential recognizable traits while making the requested balanced changes.";
    references = `Reference images: ${role}` +
      (args.referenceCount && args.referenceCount > 1 ? " Assign each reference its described role without adding unrequested subjects." : "") +
      (args.referenceStrategy?.trim() ? ` Reference roles: ${args.referenceStrategy.trim()}` : "");
  }
  const framing = args.kind === "horses" && !isHorseArtSceneType(args.scene) && args.framing && args.framing !== "random"
    ? `Camera framing: follow the requested ${args.framing} crop. Show only the parts of subjects or background that fit this crop.` : "";
  const canvas = args.canvasSize && args.canvasSize !== "auto"
    ? `Output canvas: compose for ${args.canvasSize}; keep the chosen subject and framing legible within this canvas.` : "";
  const subject = args.customSubject?.trim() ? `Requested subject: ${args.customSubject.trim()}. This subject takes priority over random scene details.` : "";
  const background = args.transparent
    ? "Background: fully transparent, with no solid backdrop, checkerboard or surrounding scenery." : "";
  const text = args.designed ? "Render only the requested text, correctly spelled and legible; add no extra text or logos."
    : "Do not add text, logos or watermarks.";
  const direction = args.direction
    ? `Scene variation: ${args.direction.subject}; ${args.direction.action}${args.transparent ? "" : `, in ${args.direction.setting}`}, with ${args.direction.light}. Show only what fits the requested crop.` : "";
  const variety = args.visualDirection && !args.designed ? `${args.visualDirection} Preserve the requested subject, scene, medium and crop.` : "";
  return [medium, subject, `Scene and composition: ${args.prompt}`, args.sceneGuidance ? `Scene focus: ${args.sceneGuidance}` : "", direction, variety, details, references, framing, canvas, background, text].filter(Boolean).join("\n\n");
}
