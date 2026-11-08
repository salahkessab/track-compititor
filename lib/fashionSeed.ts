import type { SceneSeed, UsedSeeds } from "./sceneSeed";

export type FashionMode =
  | "auto"
  | "robe"
  | "chemisier"
  | "top"
  | "pantalon"
  | "ensemble"
  | "pull"
  | "gilet"
  | "chaussures"
  | "sac"
  | "veste"
  | "casual_chic"
  | "elegant"
  | "urbain"
  | "minimaliste"
  | "ete"
  | "automne"
  | "produit_seul"
  | "exterieur"
  | "interieur";

const PRODUCTS: Record<string, string[]> = {
  robe: [
    "a flowy ivory satin midi dress",
    "a white floral midi dress with delicate print",
    "an elegant black round-neck dress",
    "a long natural linen beige dress",
    "a champagne silk wrap dress",
    "a white off-shoulder summer dress",
    "a pastel floral wrap dress with soft drape",
  ],
  chemisier: [
    "a white silk long-sleeve blouse",
    "a fluid pale sky-blue blouse",
    "a fine blue-and-white striped blouse",
    "an ivory satin blouse with a delicate bow",
    "a powder pink crepe blouse",
  ],
  top: [
    "a white silk camisole with thin straps",
    "a beige nude ribbed knit top",
    "a black asymmetric jersey top",
    "an ivory satin bandeau top",
    "a white lace off-white top",
  ],
  pantalon: [
    "cream tailored trousers",
    "natural linen straight-leg trousers",
    "pearl-grey high-waist wide-leg trousers",
    "white cigarette-cut trousers",
    "beige straight-leg trousers with pressed crease",
  ],
  ensemble: [
    "a white off-white blazer and trouser set",
    "a beige midi skirt and blazer co-ord",
    "a natural linen two-piece set",
    "an ivory silk blouse and trouser set",
    "a powder pink tailored suit",
  ],
  pull: [
    "an oversized cream cashmere sweater",
    "a caramel fine-knit sweater",
    "a soft off-white wool sweater",
    "a pearl grey cashmere turtleneck",
    "a powder pink cropped knit sweater",
  ],
  gilet: [
    "a camel cashmere cardigan",
    "a long beige wool cardigan",
    "a short ivory knit cardigan",
    "an oversized soft grey wool cardigan",
  ],
  chaussures: [
    "white leather thin-strap sandals",
    "beige nude leather heels",
    "discreet gold leather mules",
    "natural leather low-heel ankle boots",
    "soft ivory leather ballet flats",
  ],
  sac: [
    "a cream grained leather handbag",
    "a natural leather tote bag",
    "an ivory leather baguette bag",
    "a camel leather bag with fine gold chain",
    "a beige nude leather clutch",
  ],
  veste: [
    "a beige linen blazer",
    "a cream white leather jacket",
    "a fitted cream tailored blazer",
    "an oversized light grey blazer",
    "a lightweight white cotton jacket",
  ],
  casual_chic: [
    "a casual chic outfit: light wash jeans and a fluid white blouse",
    "a casual chic outfit: slim jeans and a beige blazer",
    "a casual chic outfit: linen trousers and an ivory silk top",
    "a casual chic outfit: jeans and a caramel cashmere sweater",
  ],
  elegant: [
    "an elegant outfit: ivory satin midi dress",
    "an elegant outfit: off-white tailored suit",
    "an elegant outfit: black v-neck dress with beige heels",
    "an elegant outfit: silk blouse and cream trousers",
  ],
  urbain: [
    "an urban look: grey coat and leather ankle boots",
    "an urban look: white leather jacket and straight jeans",
    "an urban look: grey turtleneck and straight trousers",
    "an urban look: beige trench coat and light jeans",
  ],
  minimaliste: [
    "a minimalist look: total white monochrome outfit",
    "a minimalist look: beige and nude ensemble",
    "a minimalist look: simple ivory dress with no accessories",
    "a minimalist look: linen trousers and a bare shoulder top",
  ],
  ete: [
    "a summer outfit: light white strappy dress",
    "a summer outfit: white linen set and sandals",
    "a summer outfit: pastel floral midi dress",
    "a summer outfit: white top and long beige skirt",
  ],
  automne: [
    "an autumn outfit: caramel cashmere sweater and beige trousers",
    "an autumn outfit: long terracotta dress and ankle boots",
    "an autumn outfit: wool cardigan and light jeans",
    "an autumn outfit: camel coat and cream ensemble",
  ],
  produit_seul: [
    "a cream grained leather bag photographed alone on a neutral background",
    "an elegant pair of shoes on a white surface",
    "a blouse neatly folded on a marble surface",
    "fashion accessories arranged on an off-white background",
    "a garment hanging on a hanger against a textured neutral wall",
  ],
  exterieur: [
    "a female model in a light dress on a lively Parisian street",
    "a female model in a chic outfit in front of a luxury boutique",
    "a female model in an elegant look in a blooming garden",
    "a female model in a summer outfit on a sunny boulevard",
    "a female model in a minimalist look on a Parisian bridge",
  ],
  interieur: [
    "a female model in an elegant dress in a bright Parisian apartment",
    "a female model in a chic outfit near a window with natural light",
    "a female model in a chic look in an elegant café",
    "a female model in a relaxed outfit in a modern kitchen",
    "a female model in an ensemble in a neutral-toned living room",
  ],
};

const SETTINGS = [
  "Parisian cobblestone street with elegant shopfronts",
  "bright white-walled fashion boutique interior",
  "light and minimal Parisian apartment",
  "Parisian café with velvet banquettes",
  "blooming garden with soft green foliage",
  "clean off-white studio background",
  "soft grey concrete textured background",
  "white marble staircase in an elegant hall",
  "rooftop terrace with city view",
  "aged stone wall in warm light",
];

const ACTIONS = [
  "three-quarter portrait, model looking slightly to the side",
  "full-length, natural relaxed posture",
  "face-on portrait with a confident gaze",
  "back view showcasing the cut of the garment",
  "slightly turned, one hand lightly in pocket",
  "seated elegantly, legs crossed",
  "standing, one arm gently raised holding an accessory",
];

const LIGHTS = [
  "soft natural north-facing window light",
  "warm late-afternoon golden light",
  "soft studio light with white reflector",
  "diffused light on a slightly overcast day",
  "warm urban golden-hour light",
];

const TONES = [
  "élégant", "naturel", "féminin", "chic", "simple", "raffiné", "doux", "minimaliste",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function fresh<T>(all: readonly T[], used?: T[]): readonly T[] {
  if (!used?.length) return all;
  const left = all.filter((x) => !used.includes(x));
  return left.length ? left : all;
}

export function fashionSeed(used: UsedSeeds = {}, mode: FashionMode = "auto"): SceneSeed {
  const cats = Object.keys(PRODUCTS);
  const category = mode !== "auto" && PRODUCTS[mode] ? mode : pick(cats);
  const tone = pick(fresh(TONES, used.tones));
  return {
    setting: pick(fresh(SETTINGS, used.settings)),
    breed: pick(fresh(PRODUCTS[category], used.breeds)),
    mood: `${tone}, élégant, mode féminine française`,
    light: pick(fresh(LIGHTS, used.lights)),
    action: pick(fresh(ACTIONS, used.actions)),
    tone,
    sceneType: `fashion ${category}`,
  };
}
