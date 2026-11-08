// Horse scene seeds — weighted 70% emotional (mare+foal / horse couple), 30% western.

// ── SHARED SETTINGS (all scene types) ──────────────────────────────────────
const SETTINGS = [
  "wide-open Texas ranchland at golden hour",
  "Monument Valley with sandstone buttes",
  "Arizona red rock country near Sedona",
  "Utah high desert with distant mesas",
  "Wyoming open plains under a huge sky",
  "Montana valley with Rocky Mountain backdrop",
  "Colorado high-country meadow in late summer",
  "Grand Teton style lake with sharp peaks",
  "Yellowstone prairie at dawn",
  "Oklahoma tallgrass prairie in afternoon light",
  "New Mexico high desert with juniper and sage",
  "Big Bend Texas badlands",
  "South Dakota Black Hills foothills",
  "Nevada Great Basin sagebrush flat",
  "California Sierra foothills in spring",
  "Idaho sagebrush plain with distant peaks",
  "Kansas Flint Hills rolling grassland",
  "Nebraska Sandhills under summer sky",
  "Painted Desert in Arizona",
  "North Dakota badlands at sunset",
  "San Juan Mountains in Colorado",
  "Bighorn Mountains in Wyoming",
  "Sawtooth Mountains in Idaho",
  "Sonoran Desert with saguaro cacti",
  "Texas Hill Country at dusk",
  "open dusty cattle range in west Texas",
  "Custer State Park grassland",
  "Oregon high desert at first light",
  "rolling prairie under summer thunderheads",
  "lush green countryside meadow with soft sky",
  "misty morning pasture with wooden fence",
  "golden meadow near a quiet river bend",
  "gentle hillside pasture in warm afternoon light",
];

const LIGHTS = [
  "golden hour warm sidelight",
  "dusty backlit sunset",
  "soft morning mist with cool light",
  "dramatic storm-cloud overcast",
  "clean late-morning daylight with soft natural contrast",
  "blue hour cool ambient",
  "alpenglow on distant peaks",
  "dawn pink sky, low contrast",
  "late afternoon long shadows across grass",
  "silver overcast diffusion",
  "moody pre-storm light",
  "clear high-altitude light with deep blue sky",
  "warm diffused light through morning clouds",
  "soft golden backlight filtering through tall grass",
  "soft post-rain light with muted highlights",
  "bright winter daylight softened by thin cloud",
];

// ── EMOTIONAL SCENE POOLS (70%) ─────────────────────────────────────────────
const EMOTIONAL_SCENE_TYPES = [
  "mare and foal bonding scene",
  "horse couple affection scene",
] as const;

const EMOTIONAL_BREEDS = [
  "black Friesian mare and her small chestnut foal",
  "white Andalusian and black Quarter Horse pair",
  "bay Quarter Horse mare and her pale foal",
  "black and white Paint Horse pair",
  "chestnut mare and her cream-colored foal",
  "Palomino mare and her foal",
  "dark bay mare and her small foal",
  "grey Andalusian and black horse as an affectionate couple",
  "jet-black horse and pure white horse as a couple",
  "bay Mustang mare and her foal",
  "black-and-white Pinto mare and her foal",
  "black Quarter Horse mare and her young foal",
  "white horse and black horse standing close as a pair",
  "dapple grey mare and her foal",
  "sorrel mare and her nursing foal",
  "black Friesian and white Andalusian as a bonded pair",
  "dark brown mare and her wobbly newborn foal",
];

const EMOTIONAL_ACTIONS = [
  // ── TIGHT PORTRAIT / CLOSE-UP (heads together, bokeh background) ──
  "tight portrait of jet-black horse and pure white horse with heads almost touching, soft autumn bokeh background, 135mm shallow depth of field",
  "close-up portrait of black horse and white horse facing each other, heads gently pressed together, blurred forest background with warm autumn colors",
  "intimate head portrait of white horse and black horse side by side, noses nearly touching, soft green bokeh meadow background",
  "black horse and white horse in a tight two-head portrait, cheeks touching, warm diffused backlight, shallow depth of field",
  "close portrait of two horses — one dark bay, one pale grey — heads turned toward each other in quiet connection, blurred natural background",
  "tight portrait crop of black Friesian and white Andalusian heads close together, autumn leaf bokeh, 135mm telephoto",
  "two horses — jet black and snow white — in a intimate face-to-face close-up, both calm, noses almost touching, shallow focus on their eyes",
  "portrait of a black horse leaning its head gently against a white horse's neck, bokeh background of golden autumn leaves",
  // ── FULL BODY COUPLE SCENES ──
  "black horse and white horse touching noses in an open field at golden sunset",
  "horse couple standing forehead to forehead in soft afternoon light in a wide meadow",
  "black and white horse pair standing close in a scenic field, both facing the same direction, sides touching",
  "two horses with strong color contrast facing each other gently in a lush pasture",
  "black stallion and white mare standing close in a meadow at dusk, warm backlight",
  "horse couple with contrasting coats running side by side through open grassland",
  "two horses with necks arched together in a quiet autumn pasture",
  // ── MARE AND FOAL ──
  "mare nuzzling her foal gently in a sunny meadow",
  "mare and foal standing close together in golden morning light",
  "mare grooming her foal near a weathered wooden fence",
  "foal nursing beside its protective mother in a green pasture",
  "mare watching over her resting foal curled in the grass",
  "foal walking closely beside its mother along a fence line",
  "mare and foal in misty morning countryside light",
  "foal pressing close to its mother for warmth during golden sunset",
  "mare and foal running together across a wide green meadow",
  "mare gently protecting her foal in a wide open field with soft sky",
  "foal resting on the grass near its standing mother in warm afternoon sun",
  "foal reaching up toward the mare's muzzle while both stand in soft overcast pasture light",
  "mare and foal crossing a narrow dirt path through tall grass with quiet evening light",
  "newborn foal wobbling beside the mare in fresh pasture light, the mare staying close and watchful",
  "two horses standing nose to nose in silver overcast light, both muzzles sharp and the pasture melting behind them",
  "pair of horses pausing beside a weathered fence after rain, heads close, muted evening light",
  "two horses walking shoulder to shoulder through tall grass with wind moving their manes",
];

const EMOTIONAL_MOODS = [
  "tender and protective",
  "deeply bonded and loving",
  "gentle and nurturing",
  "heartwarming and emotionally rich",
  "soft and affectionate between two horses",
  "peaceful and deeply connected",
  "sweet and intimate",
  "quiet love and trust between horses",
];

const EMOTIONAL_TONES = [
  "warm", "tender", "loving", "emotional", "gentle", "heartfelt",
  "touching", "intimate", "nurturing", "soft",
];

// ── BLACK HORSE POOLS (single majestic black horse) ─────────────────────────
const BLACK_BREEDS = [
  "solid black Friesian stallion with a long flowing mane",
  "pure black Friesian horse with thick wavy mane and tail",
  "black Friesian stallion with a dense natural mane",
  "jet-black Friesian horse with a long silky mane",
  "powerful black Friesian stallion with a strong arched neck",
  "elegant black Friesian mare standing proud",
  "black Friesian with a dense dark coat and subtle healthy shine",
];

const BLACK_ACTIONS = [
  "black Friesian standing quietly in an autumn meadow, long mane moving in soft wind, soft golden light",
  "tight portrait of a black Friesian's head and neck, deep dark eyes, warm side light, soft autumn bokeh background, 135mm shallow depth of field",
  "black stallion standing alert in a green field at golden hour, dark coat showing real detail in the light",
  "black horse trotting through tall grass, mane and tail flowing, soft backlight and dust at hoof level",
  "close portrait of a black horse with a wind-shifted mane, blurred forest background in warm autumn colors",
  "black Friesian rearing gently in an open field (believable, not theatrical), autumn trees behind",
  "black horse grazing in a misty morning pasture, soft cool light",
  "black stallion on a grassy rise at sunset, rim-lit by warm sun with real coat texture visible",
  "black horse turning its head toward the camera beside a weathered fence, late-day light on the muzzle",
  "black horse walking through shallow fog at dawn, forelock slightly damp, calm eye contact",
];

const BLACK_MOODS = [
  "striking and powerful",
  "proud and elegant",
  "dark and quietly striking",
  "calm and noble",
  "strong and graceful",
];

const BLACK_TONES = [
  "powerful", "elegant", "proud", "striking", "noble", "graceful", "grounded",
];

// ── SINGLE-HORSE BREED POOLS (one beautiful horse of a chosen breed) ─────────
const SINGLE_HORSE_ACTIONS = [
  "tight head-and-neck portrait of the horse, soft autumn bokeh background, 135mm shallow depth of field, warm side light",
  "the horse standing proud in an open meadow at golden hour, mane catching the warm light",
  "the horse trotting through tall grass, mane and tail flowing, soft backlight",
  "close portrait of the horse with a flowing mane, blurred forest background in warm autumn colors",
  "the horse standing alert in a green field, healthy coat texture, gentle morning light",
  "the horse grazing in a misty morning pasture, soft cool light",
  "the horse on a grassy rise at sunset, rim-lit by warm sun",
  "the horse standing beside a weathered wooden fence in soft afternoon light",
  "the horse walking slowly toward the camera through knee-high grass, ears forward, honest natural light",
  "close portrait with whiskers and muzzle texture visible, background falling into soft meadow blur",
  "the horse pausing near a creek bank after rain, damp coat texture and quiet overcast light",
  "the horse standing in light snow with breath visible in cold air and a calm direct gaze",
];

const SINGLE_HORSE_MOODS = [
  "striking and powerful",
  "proud and elegant",
  "calm and noble",
  "strong and graceful",
  "gentle and beautiful",
];

const SINGLE_HORSE_TONES = [
  "elegant", "proud", "graceful", "noble", "beautiful", "striking", "grounded",
];

// Breed focus -> full subject description used as the seed breed.
const BREED_LABELS: Record<string, string> = {
  appaloosa: "a striking leopard Appaloosa horse with a bold spotted coat", // overridden by APPALOOSA_VARIANTS below for variety
  arabian: "an elegant Arabian horse with a refined dished face and high-set arched neck",
  andalusian: "a graceful grey Andalusian horse with a thick flowing mane",
  palomino: "a golden Palomino horse with a flaxen mane and tail",
  paint: "a striking American Paint Horse with bold contrasting patches",
  mustang: "a rugged wild Mustang with a natural weathered coat",
  white: "a stunning pure white horse with a long flowing mane",
  buckskin: "a buckskin horse with a golden coat and black points",
  chestnut: "a rich chestnut horse with a healthy copper coat",
  haflinger: "a golden Haflinger horse with a pale flaxen mane",
};

// ── GIANT HORSE MURAL ARTIST STYLE (varied every generation) ─────────────────
// Wall / setting variety (each feels like a different place)
const MURAL_WALLS = [
  "a large old studio wall of cracked, dusty concrete in warm earthy tones",
  "a weathered plaster wall with peeling paint and fine cracks",
  "an old red-brick wall in a converted warehouse loft",
  "a weathered stone wall in a rustic barn with hay and timber beams",
  "a large aged stucco wall in a sunlit Mediterranean courtyard",
  "an industrial concrete wall with rust stains in a modern gallery",
  "a whitewashed village wall outdoors in soft daylight",
  "a moody dark studio wall lit by a single spotlight",
  "a graffiti-style city alley wall with rough texture",
  "a clean bright modern art-studio wall with big windows",
];

// Breed + coat color + mane style
const MURAL_BREEDS = [
  "a massive hyper-realistic buckskin horse with a long flowing black mane",
  "a giant photorealistic jet-black Friesian horse with a thick wavy mane",
  "an enormous lifelike chestnut horse with a healthy copper coat and a windswept mane",
  "a huge hyper-realistic dapple-grey Andalusian with a cascading mane",
  "a giant realistic golden palomino horse with a pale flaxen mane",
  "a towering lifelike Appaloosa with a spotted coat and a short upright mane",
  "an enormous hyper-realistic bay horse with a neatly braided mane",
  "a giant realistic white Andalusian with a long silky mane",
  "a massive dark dapple horse with a dramatic, storm-blown mane",
];

// The artist varies (gender, age, look) — combined with a pose for big variety.
const MURAL_ARTISTS = [
  "a young woman artist with a long ponytail",
  "a bearded man in a paint-stained shirt",
  "an older male artist with grey hair and glasses",
  "a young man with curly hair and rolled-up sleeves",
  "a woman in denim overalls with short hair",
  "a focused female street artist in a hoodie",
  "a tall man in a canvas apron",
  "a petite woman artist on a small step stool",
  "a middle-aged woman with hair in a bun",
  "a slim young man with a beanie",
];

// Pose + what they're painting + camera composition. The horse artwork stays
// clearly monumental, with the human artist providing scale.
const MURAL_POSES = [
  "reaching up to paint the horse's flowing mane with a fine brush, seen from the side, warm light raking across the wall",
  "stepping back to study the mural while holding a palette, wide shot showing the whole wall and open space around the artwork",
  "spray-painting details near the horse's shoulder, dynamic low angle with a little dust in the air",
  "carefully adding detail to the horse's emotional eye, close three-quarter view, dramatic shadows",
  "standing beside the finished horse painting looking up at it, soft natural light, balanced composition",
  "kneeling among paint cans mixing color, the mural beside them, golden side light",
  "on a small ladder working on the upper part of the mural, wide realistic shot",
  "gently touching the painted muzzle in a quiet moment, warm spotlight and deep shadows",
  "leaning in to outline the horse's neck, brush in hand, shot from a low angle for drama",
  "blending color on the horse's body with a cloth, captured mid-motion with soft backlight",
];

const MURAL_LIGHTS = [
  "warm earthy directional lighting with dramatic shadows and strong contrast",
  "dramatic shafts of sunlight from a tall window striking the mural",
  "a dark studio lit only by warm spotlights aimed at the horse",
  "a soft golden studio spotlight focused on the mural",
  "moody side lighting with deep rich shadows",
  "warm directional light raking across the textured wall to reveal the paint",
  "warm window light spilling across the studio floor",
];

const MURAL_MOODS = [
  "awe-inspiring and artistic",
  "dramatic and powerful",
  "intimate human-and-art moment",
  "emotional and museum-quality",
  "quiet creative studio mood",
];

const MURAL_TONES = [
  "awe-struck", "artistic", "impressive", "inspiring", "moving", "creative",
];

// ── WESTERN SCENE POOLS (30%) ───────────────────────────────────────────────
const WESTERN_SCENE_TYPES = [
  "cowboy riding scene",
  "wild herd running scene",
  "ranch lifestyle scene",
  "wide landscape hero shot",
  "water crossing scene",
  "dust at golden hour scene",
  "mountain backdrop scene",
  "desert trail scene",
] as const;

const WESTERN_BREEDS = [
  "American Quarter Horse",
  "Mustang",
  "American Paint Horse",
  "Appaloosa",
  "Tennessee Walking Horse",
  "Missouri Fox Trotter",
  "Morgan",
  "American Saddlebred",
  "Thoroughbred",
  "Palomino Quarter Horse",
  "Pinto",
  "Arabian (working ranch type)",
  "Friesian (in a Western setting)",
  "Andalusian (in a Western setting)",
  "Buckskin Quarter Horse",
];

const WESTERN_ACTIONS = [
  "cowboy riding across an open Texas ranch at golden hour",
  "pack of horses running through dust on a dry plain",
  "lone wild horse standing in Monument Valley",
  "cowboy crossing a wide Wyoming plain",
  "wild mustangs running near Montana mountains",
  "small herd grazing in a Utah desert valley",
  "ranch horse standing by a weathered wooden fence in Colorado",
  "horse drinking at a lake in Grand Teton style scenery",
  "horse and rider on a red rock trail in Arizona",
  "ranch hand working cattle on horseback at sunrise",
  "horse galloping through tall prairie grass",
  "horse herd crossing shallow water in a wide valley",
  "cowboy pausing on horseback to look across the valley",
  "saddle horse tied at a hitching post outside a wooden barn",
  "horses moving single file along a high mountain trail",
  "horse rearing playfully in open country (believable, not theatrical)",
  "cowboy roping demonstration in a dusty ranch arena",
  "horse and rider silhouetted on a ridge at sunset",
  "horses kicking up dust as they turn at dusk",
];

const WESTERN_MOODS = [
  "powerful and free",
  "proud and stoic",
  "alert and watchful",
  "weathered and resilient",
  "wild and untamed",
  "bonded and trusting (between horse and rider)",
  "spirited and energetic",
  "calm and steady",
  "fierce and determined",
  "hard-working ranch mood",
  "quiet end-of-day mood",
];

const WESTERN_TONES = [
  "proud", "steady", "awe-struck", "gritty", "free",
  "reflective", "joyful", "raw", "grateful", "bold", "peaceful",
];

// ── HELPERS ─────────────────────────────────────────────────────────────────
// Appaloosa coat variety — real patterns and base colors, rotated each time.
const APPALOOSA_VARIANTS = [
  "a striking leopard Appaloosa, white base coat covered in many bold black leopard spots across the face, neck and body, authentic mottled muzzle skin, soft flaxen mane, high-contrast and crisp",
  "a leopard Appaloosa with a white coat and dense chestnut-and-brown leopard spots all over, soft flaxen mane, mottled muzzle, sharp detail",
  "a bay-based leopard Appaloosa, warm reddish-brown spots scattered over a spotted white coat, dark mane, authentic mottled skin around the muzzle",
  "a blanket Appaloosa, solid dark bay body with a bright white spotted blanket over the hips and rump, scattered dark spots inside the white, mottled muzzle",
  "a black blanket Appaloosa, deep black coat with a white spotted rump blanket dotted with black spots, striped hooves, mottled muzzle",
  "a snowflake Appaloosa, dark chestnut coat sprinkled with many small white snowflake spots across the body and hips, mottled muzzle",
  "a few-spot leopard Appaloosa, mostly white coat with a handful of dark spots and soft roan mottling around the eyes and muzzle",
  "a chestnut blanket Appaloosa, copper-red body with a white spotted blanket over the back and hips, flaxen mane and tail, mottled muzzle",
];

function pick<T>(arr: T[] | readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fresh<T>(all: readonly T[], used?: T[]): readonly T[] {
  if (!used?.length) return all;
  const leftover = all.filter((x) => !used.includes(x));
  return leftover.length ? leftover : all;
}

// ── TYPES ───────────────────────────────────────────────────────────────────
export type SceneSeed = {
  setting: string;
  breed: string;
  mood: string;
  light: string;
  action: string;
  tone: string;
  sceneType: string;
};

export type UsedSeeds = Partial<{
  settings: string[];
  breeds: string[];
  moods: string[];
  lights: string[];
  actions: string[];
  tones: string[];
  sceneTypes: string[];
}>;

// ── SCENE MODE ────────────────────────────────────────────────────────────────
// User-selectable scene focus. "auto" keeps the 70/30 emotional/western mix.
// "emotional" forces emotional (used for reference uploads).
export type BreedMode =
  | "appaloosa"
  | "arabian"
  | "andalusian"
  | "palomino"
  | "paint"
  | "mustang"
  | "white"
  | "buckskin"
  | "chestnut"
  | "haflinger";

// Modes powered by the declarative MODE_REGISTRY (grouped Scene Focus).
export type RegistryMode =
  // Decorative art
  | "dreamy_greeting" | "art_blessing" | "fantasy_floral" | "horse_wall_painting"
  // Emotion
  | "friendship" | "protective" | "owner_bond" | "horse_human_bond" | "gentle_eye" | "lonely" | "tender"
  // Action
  | "running" | "herd" | "jumping" | "dusty_run" | "windy_mane" | "splashing" | "river_crossing" | "beach_running" | "wild_motion" | "walking"
  // Funny / Curiosity
  | "yawning" | "big_nose" | "messy_forelock" | "side_eye" | "barn_peek" | "rolling" | "tongue_out" | "curious"
  // Beauty / Premium
  | "golden_hour" | "snow" | "autumn" | "misty" | "black_bg" | "silhouette" | "cinematic" | "eye" | "bokeh" | "dramatic_mane" | "appaloosa_wildflowers" | "black_horse_rain"
  // Western / Ranch
  | "cowboy" | "pasture" | "fence" | "barn" | "buttes" | "mountain" | "rodeo" | "farm_sunrise" | "prairie" | "dusty_sunset";

export type SceneMode =
  | "auto"
  | "emotional"
  | "foal"
  | "couple"
  | "blackwhite"
  | "black"
  | BreedMode
  | "mural"
  | "funny"
  | "western"
  | RegistryMode;

// ── FUNNY / CURIOSITY POOLS (10% of auto mix) ───────────────────────────────
// Light, family-friendly, advertiser-safe. Real horse behavior caught at a
// funny moment — never cartoonish or fake.
const FUNNY_BREEDS = [
  "a fluffy pony with a wild messy forelock",
  "a chestnut horse with an expressive face",
  "a curious bay horse with big bright eyes",
  "a Palomino with a windblown mane",
  "a spotted Appaloosa with a goofy expression",
  "a young playful grey horse",
  "a shaggy Haflinger with hay stuck in its mane",
];

const FUNNY_ACTIONS = [
  "caught mid-yawn so it looks like a huge laugh, lips curled and teeth showing",
  "flehmen response lifting its upper lip like a big cheesy grin at the camera",
  "poking its head through a fence rail to sniff the camera, nose huge in the lens",
  "rolling on its back in the grass with all four legs in the air",
  "making a silly side-eye expression with one ear forward and one back",
  "playfully splashing through a shallow puddle, water flying",
  "bucking and kicking up its heels in pure play, mane flying",
  "leaping a small jump with ears pricked and a wild happy expression",
  "sticking its tongue out toward the camera",
  "peeking around a barn corner with only its head visible, curious",
  "nibbling at the photographer's hood, caught red-handed",
  "shaking off water in a spray with lips flapping",
  "peeking out of a barn window with a goofy surprised face, messy forelock over one eye",
  "pressing its nose right against the camera lens so the muzzle fills the frame, eyes crossed slightly",
  "trotting straight toward the camera with ears up and an open, happy mouth like a grin",
  "wild messy forelock covering its eyes with the lip slightly curled, looking like it just woke up",
  "wide-eyed surprised expression with ears straight up, caught mid-chew with hay hanging from its mouth",
  "standing in an awkward but adorable posture, front legs crossed, head tilted at the camera",
  "leaning its whole head over a stall door upside down begging for attention",
  "curiously staring straight into the lens with a comically serious face, nostrils flared",
];

const FUNNY_MOODS = [
  "goofy and lovable",
  "playful and mischievous",
  "curious and cheeky",
  "silly but adorable",
  "full of personality",
];

const FUNNY_TONES = [
  "funny", "playful", "lighthearted", "cheeky", "joyful", "silly",
];

const hasFoal = (s: string) => /foal/i.test(s);
const isBlackWhite = (s: string) => /black/i.test(s) && /white/i.test(s);

// ── EXTRA POOLS FOR THE GROUPED SCENE FOCUS (Emotion / Action / Funny / Beauty /
// Western). These power the new declarative mode registry below. Each pool stays
// large so a batch of 10-20 keeps fresh, non-repeating variety via fresh().

// A general, breed-varied single horse — used by style-driven modes that work
// with any beautiful horse (golden hour, snow, autumn, eye macro, etc.).
const GENERIC_HORSES = [
  "a black Friesian horse with a long flowing mane",
  "a dapple-grey Andalusian with a thick wavy mane",
  "a golden palomino horse with a pale flaxen mane",
  "a rich chestnut horse with a healthy copper coat",
  "a bay Quarter Horse with a dark mane and tail",
  "a striking leopard Appaloosa with a bold spotted coat",
  "a pure white horse with a long silky mane",
  "a buckskin horse with a golden coat and black points",
  "a bold black-and-white Paint horse with crisp patches",
  "a rugged Mustang with a weathered natural coat",
  "a deep liver-chestnut horse with a flaxen mane",
  "an elegant grey Arabian with a refined dished face",
];

const HERD_SUBJECTS = [
  "a band of wild Mustangs of mixed colors",
  "a galloping herd of horses kicking up dust",
  "a group of bay and chestnut horses running together",
  "a small herd of horses with manes flowing in the wind",
  "a tight group of wild horses moving as one",
  "a herd of mixed-color horses thundering across open ground",
];

const OWNER_SUBJECTS = [
  "a young woman resting her forehead gently against her chestnut horse",
  "a girl with her arms wrapped around a grey horse's neck",
  "a calm cowboy standing quietly beside his bay horse",
  "a woman in a knit sweater hugging her black horse",
  "a young rider pressing her cheek to a palomino's muzzle",
  "a person holding the halter of a white horse, foreheads close",
];

const FRIENDSHIP_SUBJECTS = [
  "two horses gently grooming each other's withers",
  "two geldings standing head-to-tail in easy companionship",
  "a chestnut and a grey horse resting their chins on each other's backs",
  "two horses leaning into each other in a relaxed pasture",
  "a pair of horses nuzzling shoulders in the morning sun",
  "two horses dozing side by side under a tree",
];

// Emotional / beauty actions for the new style-driven portrait modes.
const PORTRAIT_ACTIONS = [
  "tight head-and-neck portrait, soft bokeh background, 135mm shallow depth of field",
  "three-quarter head portrait turned slightly toward the camera, blurred background",
  "close portrait with the mane falling softly across the neck, shallow focus",
  "calm front-facing portrait with gentle catchlights in the eyes",
  "elegant side-profile portrait, warm rim light along the jaw and mane",
  "intimate portrait with the head lowered slightly, soft warm light",
];

const ACTION_MOODS = [
  "powerful and free", "energetic and alive", "wild and spirited",
  "strong and dynamic", "fast and fearless",
];
const ACTION_TONES = ["powerful", "free", "energetic", "wild", "bold", "spirited"];

const BEAUTY_MOODS = [
  "premium and elegant", "dramatic and striking", "calm and beautiful",
  "soft and dreamy", "refined and elegant",
];
const BEAUTY_TONES = ["elegant", "dramatic", "striking", "premium", "graceful", "dreamy"];

// Focused setting/light pools for season/time modes.
const SNOW_SETTINGS = [
  "a quiet snow-covered field under soft grey sky",
  "a snowy pasture with frost on the fence rails",
  "an open snowfield with distant pine trees",
  "fresh snow with gentle falling flakes",
];
const AUTUMN_SETTINGS = [
  "a forest edge glowing with golden and red autumn leaves",
  "a meadow framed by orange autumn trees",
  "a path covered in fallen autumn leaves",
  "an autumn pasture with warm amber foliage behind",
];
const MISTY_SETTINGS = [
  "a misty morning pasture with soft fog hanging low",
  "a foggy meadow at first light, muted and quiet",
  "a hillside wrapped in cool morning mist",
  "a river valley filled with soft dawn fog",
];
const STUDIO_DARK = [
  "a clean solid black studio background",
  "a deep dark background with a single soft key light",
  "a moody black backdrop with subtle rim lighting",
];
const RANCH_SETTINGS = [
  "a working ranch with a weathered wooden barn",
  "a Texas pasture with a long wooden rail fence",
  "a dusty ranch corral at golden hour",
  "a farm yard at sunrise with soft warm light",
  "open prairie stretching to the horizon",
  "a desert basin with distant sandstone buttes",
  "a green mountain meadow below rocky peaks",
  "a ranch gate and split-rail fence in afternoon light",
];

const HORSE_ART_SUBJECTS = [
  "a white mare with a flowing silver mane",
  "a gentle palomino horse with a soft flaxen mane",
  "a black horse and white horse standing close together",
  "a mare and foal with soft affectionate body language",
  "two elegant horses with long flowing manes",
  "a dapple-grey horse with a graceful arched neck",
  "a chestnut horse with a warm copper coat and kind eyes",
  "a moonlit white horse with a luminous mane",
];

const DREAMY_GREETING_SETTINGS = [
  "a flower-dusted meadow at sunrise with soft mist",
  "a moonlit hillside with faint stars above the trees",
  "a quiet garden path with roses and pale morning glow",
  "a dreamy field of wildflowers under a lavender dawn sky",
  "a calm hilltop beneath a soft crescent moon and light fog",
];

const DREAMY_GREETING_LIGHTS = [
  "soft sunrise glow with peach and gold highlights",
  "gentle moonlight with silver-blue glow",
  "mist-softened dawn light with pastel warmth",
  "calm twilight light with tiny stars beginning to show",
  "soft good-night moon glow with diffused edges",
];

const DREAMY_GREETING_ACTIONS = [
  "a single horse turning softly toward the viewer beside a bed of flowers, greeting-card composition",
  "a mare and foal standing close in dawn mist with tiny blossoms framing the foreground",
  "two horses touching noses under a soft moon with star accents in the sky",
  "a calm horse pausing near a floral arch as the first light lifts behind it",
  "a white horse looking over its shoulder through drifting mist and scattered petals",
  "a peaceful horse resting under a crescent moon with delicate flowers along the lower frame",
];

const DREAMY_GREETING_MOODS = [
  "peaceful and gentle",
  "soft and comforting",
  "good-morning warmth",
  "good-night calm",
  "emotional and tender",
];

const DREAMY_GREETING_TONES = [
  "dreamy", "gentle", "peaceful", "warm", "comforting", "tender",
];

const ART_BLESSING_SETTINGS = [
  "a floral-framed meadow with a soft radiant sky",
  "a calm garden clearing with pale blossoms and warm haze",
  "a symbolic open field with a halo of flowers and light",
  "a quiet decorative grove with floating petals and soft mist",
  "a peaceful moonlit garden with roses and a glowing horizon",
];

const ART_BLESSING_LIGHTS = [
  "soft blessing-like glow with warm cream highlights",
  "gentle sunrise light filtered through floral haze",
  "calm luminous twilight with a soft halo around the subjects",
  "tender pearl-toned light with diffused bloom",
  "moonlit silver glow softened by mist",
];

const ART_BLESSING_ACTIONS = [
  "a mare and foal standing inside a loose wreath of flowers with a calm symbolic composition",
  "two horses leaning gently together beneath a floral arch with a peaceful blessing-card mood",
  "a single white horse in a centered decorative composition with blossoms framing the corners",
  "a horse family scene with petals drifting through warm glowing light",
  "two elegant horses facing each other with a soft halo effect and gentle floral border",
  "a tender horse portrait surrounded by roses and subtle celestial light accents",
];

const ART_BLESSING_MOODS = [
  "peaceful and symbolic",
  "tender and affectionate",
  "calm and spiritual",
  "loving and serene",
  "decorative and heartfelt",
];

const ART_BLESSING_TONES = [
  "peaceful", "blessing-like", "tender", "serene", "symbolic", "heartfelt",
];

const FANTASY_FLORAL_SETTINGS = [
  "a moonlit rose garden under a star-filled sky",
  "a dreamy floral terrace with constellations overhead",
  "a celestial meadow with soft glowing blossoms and mist",
  "a romantic night garden with climbing roses and silver light",
  "a fantasy flower field beneath a bright moon and scattered stars",
];

const FANTASY_FLORAL_LIGHTS = [
  "soft moonlight with silver floral glow",
  "romantic twilight with tiny constellations overhead",
  "celestial blue-violet light with soft luminous edges",
  "dreamy rose-gold dusk light with star sparkle",
  "misty night glow with a bright moon halo",
];

const FANTASY_FLORAL_ACTIONS = [
  "a white horse standing inside a heart-shaped rose frame beneath the moon",
  "two horses in a romantic moonlit pose with constellations and flowers around them",
  "a graceful horse stepping through a field of glowing blossoms under a starry sky",
  "a floral fantasy portrait with roses, soft mist, and a luminous moon behind the mane",
  "a mare and foal in a dreamy celestial garden with petals and tiny stars",
  "an elegant horse framed by climbing roses and soft arc-shaped moonlight",
];

const FANTASY_FLORAL_MOODS = [
  "romantic and magical",
  "soft fantasy and beautiful",
  "dreamy and celestial",
  "floral and tender",
  "decorative and moonlit",
];

const FANTASY_FLORAL_TONES = [
  "romantic", "magical", "floral", "celestial", "dreamy", "soft fantasy",
];

const DREAMY_GREETING_VARIANTS: readonly SceneSeed[] = [
  { sceneType: "dreamy greeting horse art scene", breed: "a single white horse with a silver mane", setting: "soft sunrise wildflower meadow with peach clouds and no decorative text", light: "warm peach sunrise glow with gentle rim light", action: "full-body greeting-card composition, horse standing among small white flowers, open sky above, no moon", mood: "good-morning warmth", tone: "peaceful" },
  { sceneType: "dreamy greeting horse art scene", breed: "a bay mare and tiny foal", setting: "misty morning meadow with pale grass and low fog, no decorative text", light: "cool dawn mist with soft pastel pink edges", action: "wide meadow layout, mare lowering her head toward the foal, flowers kept subtle", mood: "tender morning calm", tone: "comforting" },
  { sceneType: "dreamy greeting horse art scene", breed: "a black horse and white horse pair", setting: "quiet moonlit hillside with sparse stars and silver grass, no decorative text", light: "silver-blue moonlight with soft night glow", action: "close two-horse portrait under open night sky, noses almost touching, no floral arch", mood: "good-night calm", tone: "gentle" },
  { sceneType: "dreamy greeting horse art scene", breed: "a gentle palomino horse with a flaxen mane", setting: "pastel flower field with lavender, buttercups, and soft clouds, no decorative text", light: "creamy pastel daylight with warm haze", action: "three-quarter portrait, horse looking back over shoulder, flowers blurred in foreground", mood: "soft and hopeful", tone: "dreamy" },
  { sceneType: "dreamy greeting horse art scene", breed: "a single black horse with a long mane", setting: "blue night garden with mist, silver leaves, and faint stars, no decorative text", light: "cool silver-blue night glow with subtle backlight", action: "low-angle full-body composition, horse standing in profile, mane moving lightly, no moon visible", mood: "quiet night comfort", tone: "calm" },
  { sceneType: "dreamy greeting horse art scene", breed: "a dapple-grey horse with a soft mane", setting: "cloud-soft sunrise hilltop with tiny stars fading from the sky, no decorative text", light: "pink-gold dawn light breaking through soft clouds", action: "wide open greeting-card layout with the horse small in frame, soft clouds carrying the composition", mood: "peaceful new-day feeling", tone: "warm" },
  { sceneType: "dreamy greeting horse art scene", breed: "a chestnut horse with a kind face", setting: "moonlit garden path with pale blossoms scattered along the ground, no decorative text", light: "gentle moonlight mixed with warm lantern-like glow", action: "close face portrait from the front, flowers along the lower edge, soft stars behind", mood: "gentle good-night feeling", tone: "tender" },
  { sceneType: "dreamy greeting horse art scene", breed: "a white mare and foal", setting: "soft pastel meadow after sunrise with mist lifting behind them, no decorative text", light: "warm morning backlight with pearly highlights", action: "vertical full-body composition, foal tucked at the mare's side, no stars or moon", mood: "protective and hopeful", tone: "heartfelt" },
  { sceneType: "dreamy greeting horse art scene", breed: "two elegant horses with flowing manes", setting: "lavender twilight field with soft clouds and a few bright stars, no decorative text", light: "violet twilight glow with pastel cloud light", action: "wide pair composition, horses walking side by side through low flowers, no heart frame", mood: "dreamy companionship", tone: "soft" },
  { sceneType: "dreamy greeting horse art scene", breed: "a moonlit white horse with a luminous mane", setting: "quiet crescent-moon sky over mist and tall grass, no decorative text", light: "soft crescent moon glow with cool blue highlights", action: "centered portrait with tall grass foreground, minimal flowers, stars placed high and sparse", mood: "restful night mood", tone: "serene" },
];

const ART_BLESSING_VARIANTS: readonly SceneSeed[] = [
  { sceneType: "art blessing horse scene", breed: "a mare and foal with soft affectionate body language", setting: "cream-gold meadow inside a loose floral wreath, no decorative text", light: "warm blessing-like glow with soft cream highlights", action: "circular wreath composition, mare and foal centered, tiny blossoms forming an imperfect frame", mood: "family love and protection", tone: "blessing-like" },
  { sceneType: "art blessing horse scene", breed: "two gentle horses standing close together", setting: "pale blossom arch in a quiet garden clearing, no decorative text", light: "soft blue twilight with pearl highlights", action: "full-body pair beneath a blossom arch, heads leaning together, open space around them", mood: "peaceful companionship", tone: "tender" },
  { sceneType: "art blessing horse scene", breed: "a single white horse with calm eyes", setting: "minimal cream background with a soft halo and faint floral corners, no decorative text", light: "gentle cream halo light around the head and mane", action: "close portrait composition, horse facing slightly left, floral detail kept to the corners", mood: "calm and spiritual", tone: "serene" },
  { sceneType: "art blessing horse scene", breed: "a horse family group with mare, foal, and a second adult horse", setting: "glowing sunset meadow with light rays and drifting petals, no decorative text", light: "warm sunset palette with soft golden rays", action: "wide open composition, family grouped loosely rather than framed, petals moving through the light", mood: "family blessing", tone: "heartfelt" },
  { sceneType: "art blessing horse scene", breed: "a chestnut horse with a gentle close face", setting: "roses and warm haze around a close portrait, no decorative text", light: "soft rose-gold light with subtle side glow", action: "extreme close face portrait, roses along one side only, no wreath or arch", mood: "tender and affectionate", tone: "loving" },
  { sceneType: "art blessing horse scene", breed: "a black horse and white horse pair", setting: "soft circular light frame in a blue-silver meadow, no decorative text", light: "luminous blue palette with gentle rim light", action: "symbolic circular frame behind the pair, horses shoulder to shoulder, no flowers dominating", mood: "unity and peace", tone: "symbolic" },
  { sceneType: "art blessing horse scene", breed: "a palomino mare and pale foal", setting: "open field with gentle sunbeams and small white blossoms, no decorative text", light: "clear warm morning rays filtered through haze", action: "vertical protective composition, mare standing over foal, open frame with no wreath", mood: "protective and peaceful", tone: "gentle" },
  { sceneType: "art blessing horse scene", breed: "a grey horse with a long mane", setting: "decorative grove with soft falling petals and a faint heart-shaped glow, no decorative text", light: "muted pearl and blush palette", action: "three-quarter body pose, subtle heart-shaped light behind the horse, blossoms falling from above", mood: "quiet affection", tone: "soft" },
  { sceneType: "art blessing horse scene", breed: "two horses touching foreheads", setting: "warm sunset field with an open golden sky and minimal flowers, no decorative text", light: "deep warm sunset glow with soft haze", action: "close pair portrait, foreheads touching, open composition with no arch or wreath", mood: "love and stillness", tone: "emotional" },
  { sceneType: "art blessing horse scene", breed: "a single dark bay horse with a soft expression", setting: "cream floral border with small blue blossoms and calm negative space, no decorative text", light: "soft ivory light with cool blue accents", action: "centered blessing-card portrait, horse head lowered slightly, border asymmetrical and delicate", mood: "quiet blessing", tone: "peaceful" },
];

const FANTASY_FLORAL_VARIANTS: readonly SceneSeed[] = [
  { sceneType: "fantasy floral horse art scene", breed: "a white horse with a long luminous mane", setting: "heart-shaped rose frame beneath a bright moon, no decorative text", light: "romantic moonlight with rose-pink highlights", action: "centered full-body pose inside the rose heart frame, petals falling, no lake", mood: "romantic and magical", tone: "romantic" },
  { sceneType: "fantasy floral horse art scene", breed: "two horses with flowing manes", setting: "open starry field with constellations and scattered wildflowers, no decorative text", light: "deep blue-violet celestial light", action: "wide composition under moon and stars, horses facing each other, no heart frame", mood: "dreamy night romance", tone: "celestial" },
  { sceneType: "fantasy floral horse art scene", breed: "a mare and foal", setting: "glowing moon-flower garden with tiny star sparks, no decorative text", light: "soft luminous flower glow with moonlit edges", action: "mare and foal walking through glowing flowers, foal close to mare, no roses", mood: "magical floral tenderness", tone: "soft fantasy" },
  { sceneType: "fantasy floral horse art scene", breed: "a black horse with a silver mane", setting: "moonlit lake edge with floating petals and lavender on the bank, no decorative text", light: "silver moon reflection with cool blue shadows", action: "side-profile horse near still water, moon reflection visible, no floral frame", mood: "mysterious but gentle", tone: "dreamy" },
  { sceneType: "fantasy floral horse art scene", breed: "a dapple-grey horse with a graceful neck", setting: "floral portrait space with constellations behind and soft lavender blossoms, no decorative text", light: "celestial lavender glow with small star points", action: "close portrait, constellations behind the mane, flowers clustered low and to one side", mood: "elegant and celestial", tone: "floral" },
  { sceneType: "fantasy floral horse art scene", breed: "a palomino horse with a pale mane", setting: "sunset fantasy field of wildflowers with rose-gold haze, no decorative text", light: "rose-gold dusk light with tiny floating sparks", action: "full-body walking pose through wildflowers, no moon, no heart frame", mood: "warm magical beauty", tone: "magical" },
  { sceneType: "fantasy floral horse art scene", breed: "two black-and-white horses", setting: "starry forest clearing with blue moon flowers and arched branches, no decorative text", light: "cool moonlit forest glow with blue flower light", action: "wide forest composition, horses standing apart but looking toward each other, no roses", mood: "enchanted and romantic", tone: "celestial" },
  { sceneType: "fantasy floral horse art scene", breed: "a chestnut mare and foal", setting: "lavender field under a crescent moon with drifting petals, no decorative text", light: "soft violet night glow with silver crescent highlights", action: "vertical composition, mare shielding foal, lavender rows leading into the background", mood: "protective floral magic", tone: "tender" },
  { sceneType: "fantasy floral horse art scene", breed: "a single white horse", setting: "celestial garden with circular moon gate and glowing white flowers, no decorative text", light: "pearl moonlight with luminous garden edges", action: "horse stepping through a round moon-gate shape, flowers framing the bottom only", mood: "dreamy moon-garden wonder", tone: "dreamy" },
  { sceneType: "fantasy floral horse art scene", breed: "an elegant dark bay horse", setting: "romantic rose path with stars overhead and soft mist near the ground, no decorative text", light: "dark rose and midnight-blue palette with warm petal highlights", action: "close three-quarter portrait, roses forming a diagonal path behind, no moon dominant", mood: "romantic floral drama", tone: "romantic" },
];

function pickArtVariant(pool: readonly SceneSeed[], used: UsedSeeds): SceneSeed {
  const unusedAction = pool.filter((v) => !(used.actions ?? []).includes(v.action));
  const unusedLayout = unusedAction.filter((v) => !(used.settings ?? []).includes(v.setting));
  const unusedSubject = unusedLayout.filter((v) => !(used.breeds ?? []).includes(v.breed));
  const choices = unusedSubject.length ? unusedSubject : unusedLayout.length ? unusedLayout : unusedAction.length ? unusedAction : pool;
  return { ...pick(choices) };
}

// ── DECLARATIVE MODE REGISTRY ────────────────────────────────────────────────
// Each new Scene Focus chip maps to a spec. The seed is composed from these
// pools using fresh() so repeats are avoided across a batch. Existing modes
// (foal, couple, blackwhite, black, breeds, mural, funny, western) keep their
// own dedicated branches above and are NOT in this registry.
type ModeSpec = {
  sceneType: string;
  breeds: readonly string[];
  actions: readonly string[];
  moods: readonly string[];
  tones: readonly string[];
  settings?: readonly string[]; // overrides the shared SETTINGS pool
  lights?: readonly string[];   // overrides the shared LIGHTS pool
};

const MODE_REGISTRY: Record<string, ModeSpec> = {
  // Decorative horse art
  dreamy_greeting: {
    sceneType: "dreamy greeting horse art scene",
    breeds: HORSE_ART_SUBJECTS,
    actions: DREAMY_GREETING_ACTIONS,
    moods: DREAMY_GREETING_MOODS,
    tones: DREAMY_GREETING_TONES,
    settings: DREAMY_GREETING_SETTINGS,
    lights: DREAMY_GREETING_LIGHTS,
  },
  art_blessing: {
    sceneType: "art blessing horse scene",
    breeds: HORSE_ART_SUBJECTS,
    actions: ART_BLESSING_ACTIONS,
    moods: ART_BLESSING_MOODS,
    tones: ART_BLESSING_TONES,
    settings: ART_BLESSING_SETTINGS,
    lights: ART_BLESSING_LIGHTS,
  },
  fantasy_floral: {
    sceneType: "fantasy floral horse art scene",
    breeds: HORSE_ART_SUBJECTS,
    actions: FANTASY_FLORAL_ACTIONS,
    moods: FANTASY_FLORAL_MOODS,
    tones: FANTASY_FLORAL_TONES,
    settings: FANTASY_FLORAL_SETTINGS,
    lights: FANTASY_FLORAL_LIGHTS,
  },
  horse_human_bond: {
    sceneType: "horse and human bond scene",
    breeds: GENERIC_HORSES.map((horse) => `${horse} and one adult person`),
    actions: [
      "the person rests one hand gently on the horse's neck as they stand together",
      "the person brushes the horse's mane while it stands with relaxed ears",
      "the person and horse walk side by side at an easy pace on a loose lead",
      "the person offers an open palm and the horse calmly reaches toward it",
      "the person gently scratches the horse's withers as it relaxes beside them",
      "the person strokes the horse's cheek while it lowers its head naturally",
      "the person adjusts a simple halter while the horse waits calmly",
      "the person pauses beside the horse with a relaxed hand on its shoulder",
    ],
    settings: [
      "a grassy paddock beside a weathered wooden fence",
      "a quiet meadow with distant trees",
      "the outside of a rustic barn beside a pasture",
      "an open ranch field with pale native grasses",
      "a grassy path along the edge of a pasture",
      "a gently sloping hillside with soft green grass",
      "a sheltered paddock with a simple wooden gate",
      "a meadow bordered by a few scattered trees",
    ],
    lights: [
      "soft overcast daylight", "gentle morning side light", "warm late-afternoon light",
      "diffused daylight after light rain", "soft open shade", "clear, gentle daylight",
    ],
    moods: ["calm companionship", "quiet trust", "easy familiarity", "warm and unposed"],
    tones: ["warm", "genuine", "gentle", "conversational"],
  },
  river_crossing: {
    sceneType: "horse crossing a shallow river scene",
    breeds: GENERIC_HORSES,
    actions: [
      "the horse takes a careful step through shallow water, making small ripples",
      "the horse lifts one forehoof from the stream in a natural walking stride",
      "the horse walks toward the far bank with water moving gently around its lower legs",
      "the horse pauses mid-crossing with its weight naturally settled over its legs",
      "the horse steps between smooth stones as the current ripples around its legs",
      "the horse walks steadily through the stream with a few droplets falling from a lifted hoof",
      "the horse moves across the current at a relaxed pace, with its mane resting naturally",
      "the horse briefly lowers its head toward the water during the crossing",
    ],
    settings: [
      "a clear shallow creek winding through a grassy meadow",
      "a gentle stream with smooth stones along its banks",
      "a shallow river bend bordered by willows",
      "a low-water ford beside an open ranch pasture",
      "a clear stream at the edge of a pine forest",
      "a shallow creek running through a broad mountain valley",
      "a slow-moving river crossing with a sandy bank",
      "a narrow stream bordered by native grasses and reeds",
    ],
    lights: [
      "soft overcast daylight", "gentle morning light", "warm late-afternoon light",
      "clear diffused daylight", "soft light after rain", "natural side light",
    ],
    moods: ["peaceful and adventurous", "calm and observant", "grounded and free", "quiet movement"],
    tones: ["natural", "vivid", "peaceful", "conversational"],
  },
  appaloosa_wildflowers: {
    sceneType: "Appaloosa in a wildflower meadow scene",
    breeds: APPALOOSA_VARIANTS,
    actions: [
      "the horse stands alert among the wildflowers, ears relaxed",
      "the horse walks slowly through the flowers with its head naturally raised",
      "the horse pauses and turns its head toward the camera",
      "the horse grazes among the flowers with an easy, relaxed posture",
      "the horse walks in profile, its coat pattern visible through the grass",
      "the horse looks toward the edge of the meadow as the breeze moves its mane",
      "the horse takes a gentle step forward between clusters of flowers",
      "the horse stands at a three-quarter angle with its mane resting naturally",
    ],
    settings: [
      "a meadow with scattered white daisies and soft grass",
      "a pasture with purple lupines and natural green grasses",
      "a rolling field with yellow buttercups",
      "a grassy hillside with clusters of blue wildflowers",
      "a meadow with pink clover and a distant tree line",
      "an open pasture dotted with small white and yellow blooms",
      "a mountain meadow with native wildflowers and tall grasses",
      "a quiet field with scattered lavender-colored wildflowers",
    ],
    lights: ["gentle morning light", "soft overcast daylight", "warm late-afternoon light", "diffused daylight", "soft light after rain", "natural side light"],
    moods: ["peaceful", "fresh and natural", "quietly curious", "warm and open"],
    tones: ["warm", "gentle", "conversational", "observant"],
  },
  black_horse_rain: {
    sceneType: "black horse in gentle rain scene",
    breeds: [
      "a black Friesian horse with a full mane", "a black horse with a short natural mane",
      "a black Friesian mare with feathered lower legs", "a black horse with a softly wavy mane",
      "a black Andalusian horse with a long mane", "a black Morgan horse with a dense coat",
      "a black horse with a thick forelock", "a black Friesian with a loose, flowing mane",
    ],
    actions: [
      "the horse stands calmly as light rain settles on its coat",
      "the horse walks slowly with damp mane strands resting against its neck",
      "the horse turns its head toward the camera, ears attentive",
      "the horse pauses in profile with a relaxed, natural posture",
      "the horse takes an easy step forward on damp ground",
      "the horse lowers its head slightly as rain falls around it",
      "the horse looks toward the distance, its wet mane moving in a light breeze",
      "the horse stands at a three-quarter angle with a calm expression",
    ],
    settings: [
      "an open grassy paddock with a weathered fence",
      "a pasture with a soft tree line in the distance",
      "a damp meadow with low green grasses",
      "a ranch field near a rustic barn",
      "a grassy rise beside an open pasture",
      "a quiet paddock with dark, rain-damp ground",
      "a meadow bordered by a few leafy trees",
      "a pasture path edged with wet grass",
    ],
    lights: ["soft overcast daylight", "diffuse grey daylight", "cool cloud-filtered light", "gentle light under a rainy sky", "soft daylight through rain clouds", "subtle diffused side light"],
    moods: ["quiet and resilient", "calm and attentive", "gentle and reflective", "grounded and atmospheric"],
    tones: ["thoughtful", "warm", "natural", "observant"],
  },
  horse_wall_painting: {
    sceneType: "horse wall painting scene",
    breeds: GENERIC_HORSES.map((horse) => `a painted depiction of ${horse}`),
    actions: [
      "the artwork depicts the horse in an elegant side-profile walking pose",
      "the artwork depicts a calm horse's head and flowing mane",
      "the artwork depicts the horse standing with its head turned slightly",
      "the artwork depicts a horse in a natural cantering pose",
      "the artwork depicts a graceful horse looking over its shoulder",
      "the artwork depicts a horse with a softly wind-swept mane",
      "the artwork depicts a horse grazing in a simple painted landscape",
      "the artwork depicts a horse in a quiet three-quarter pose",
    ],
    settings: [
      "a lightly weathered white plaster wall", "a warm earth-toned adobe wall",
      "a pale limewashed brick wall", "a rustic barn's painted wooden wall",
      "an old stone courtyard wall", "a softly textured cream stucco wall",
      "a muted terracotta plaster wall", "a weathered grey masonry wall",
    ],
    lights: ["soft natural side light", "gentle diffused daylight", "warm afternoon light", "soft shade with reflected light", "overcast daylight", "subtle morning light"],
    moods: ["timeless and peaceful", "expressive and warm", "quiet and elegant", "rustic and artistic"],
    tones: ["appreciative", "gentle", "warm", "observant"],
  },
  beach_running: {
    sceneType: "horse running along a beach scene",
    breeds: GENERIC_HORSES,
    actions: [
      "the horse canters along firm wet sand, leaving a few natural hoofprints",
      "the horse runs in profile near the waterline, mane moving with its stride",
      "the horse gallops along the shore as small droplets lift from its hooves",
      "the horse canters through a thin wash of shallow surf",
      "the horse runs toward a distant bend in the beach with a balanced stride",
      "the horse canters across the frame, its tail moving naturally in the sea breeze",
      "the horse gallops beside a gently receding wave on wet sand",
      "the horse runs at an easy canter along the edge of the shore",
    ],
    settings: [
      "a wide sandy shoreline with low, gentle waves", "a quiet beach backed by grassy dunes",
      "an open shore with a distant rocky headland", "a long beach with a thin line of sea foam",
      "a broad coastal shore with pale sand", "a beach with dark wet sand and a calm horizon",
      "a gently curving shoreline beside low dunes", "an open beach with a soft sea haze",
    ],
    lights: ["soft morning daylight", "warm late-afternoon light", "gentle overcast light", "clear diffused coastal daylight", "soft light under a hazy sky", "natural side light"],
    moods: ["free and energetic", "joyful and natural", "open and adventurous", "powerful yet relaxed"],
    tones: ["lively", "warm", "free", "observant"],
  },
  // ── EMOTION ──
  friendship: {
    sceneType: "horse friendship affection scene",
    breeds: FRIENDSHIP_SUBJECTS,
    actions: [
      "grooming each other gently along the withers, soft natural light",
      "standing close head-to-tail, swishing tails, relaxed and content",
      "resting chins on each other's backs in a quiet pasture",
      "nuzzling shoulders in warm morning light, blurred background",
      "dozing side by side, leaning slightly into one another",
      "walking together with their necks gently crossing",
    ],
    moods: EMOTIONAL_MOODS,
    tones: EMOTIONAL_TONES,
  },
  protective: {
    sceneType: "protective mare and foal bonding scene",
    breeds: EMOTIONAL_BREEDS.filter(hasFoal),
    actions: [
      "mare standing guard over her foal, body angled protectively, soft light",
      "mare curving her neck around her foal in a sheltering pose",
      "foal tucked close against the mare's side as she watches the horizon",
      "mare nuzzling her foal while keeping a watchful eye, blurred meadow",
      "mare positioned between her resting foal and the open field",
      "foal sheltering under the mare's neck in gentle morning light",
    ],
    moods: ["fiercely tender", "protective and watchful", "gentle but alert", "nurturing and strong"],
    tones: EMOTIONAL_TONES,
  },
  owner_bond: {
    sceneType: "owner and horse bond portrait",
    breeds: OWNER_SUBJECTS,
    actions: [
      "forehead resting against the horse's muzzle, eyes closed, warm light",
      "arms wrapped around the horse's neck in a quiet hug",
      "cheek pressed to the horse's cheek, soft bokeh background",
      "standing close, the horse lowering its head into the person's hands",
      "a tender moment of trust, person and horse breathing together",
      "the horse resting its chin on the person's shoulder",
    ],
    moods: ["trusting and warm", "deeply bonded", "gentle and human", "quiet companionship"],
    tones: EMOTIONAL_TONES,
  },
  gentle_eye: {
    sceneType: "gentle horse eye portrait",
    breeds: GENERIC_HORSES,
    actions: [
      "extreme close-up of one soft dark eye with long lashes and a warm catchlight",
      "macro of the eye and surrounding fine coat hair, gentle reflection in the eye",
      "tender eye close-up, soft light revealing the depth and calm in the eye",
      "intimate macro of the eye with a faint reflection of the meadow",
    ],
    moods: ["gentle and soulful", "calm and deep", "soft and intimate"],
    tones: ["gentle", "soulful", "tender", "calm"],
    lights: ["soft window-style light", "warm golden catchlight", "soft morning light"],
  },
  lonely: {
    sceneType: "lonely horse portrait",
    breeds: GENERIC_HORSES,
    actions: [
      "a single horse standing alone in a wide empty field, small in the frame",
      "a lone horse looking into the distance under a vast quiet sky",
      "one horse standing at a fence line in soft fading light, solitary mood",
      "a solitary horse in a misty open pasture, calm and still",
    ],
    moods: ["quietly solitary", "calm and reflective", "still and peaceful"],
    tones: ["quiet", "reflective", "calm", "still"],
  },
  tender: {
    sceneType: "tender horse moment portrait",
    breeds: GENERIC_HORSES,
    actions: PORTRAIT_ACTIONS,
    moods: EMOTIONAL_MOODS,
    tones: EMOTIONAL_TONES,
  },

  // ── ACTION ──
  running: {
    sceneType: "running horse action scene",
    breeds: GENERIC_HORSES,
    actions: [
      "galloping across open grassland, mane and tail streaming, all four legs dynamic",
      "running straight toward the camera, ears forward, dust rising behind",
      "cantering through tall grass with powerful forward motion, soft backlight",
      "running along a ridge with the mane flying, wide natural framing",
      "sprinting across a field, hooves kicking up earth, frozen mid-stride",
    ],
    moods: ACTION_MOODS,
    tones: ACTION_TONES,
  },
  herd: {
    sceneType: "galloping herd action scene",
    breeds: HERD_SUBJECTS,
    actions: [
      "thundering across a dry plain in a tight group, dust billowing",
      "running together through tall prairie grass, manes flying",
      "a herd turning as one, kicking up a wall of dust at golden hour",
      "wild horses galloping down a shallow valley side by side",
      "the herd crossing open ground in full stride, powerful and free",
    ],
    moods: ACTION_MOODS,
    tones: ACTION_TONES,
  },
  jumping: {
    sceneType: "horse jumping action scene",
    breeds: GENERIC_HORSES,
    actions: [
      "leaping over a natural log jump, legs tucked, caught at the peak of the arc",
      "jumping a low rustic fence in an open field, ears pricked",
      "clearing a small stream in a powerful bound, water below",
      "mid-jump over brush with a clean athletic form, soft backlight",
    ],
    moods: ACTION_MOODS,
    tones: ACTION_TONES,
  },
  dusty_run: {
    sceneType: "dusty ranch run scene",
    breeds: GENERIC_HORSES,
    actions: [
      "running through a dusty ranch corral, golden dust glowing in the sun",
      "turning hard in a dirt arena, dust exploding around the hooves",
      "loping across a dry dusty paddock at golden hour, backlit dust",
      "kicking up a trail of dust along a ranch fence line",
    ],
    moods: ACTION_MOODS,
    tones: ACTION_TONES,
    lights: ["dusty backlit sunset", "golden hour warm sidelight", "late afternoon long shadows across grass"],
  },
  windy_mane: {
    sceneType: "windy mane horse portrait",
    breeds: GENERIC_HORSES,
    actions: [
      "head-and-neck portrait with the mane whipped sideways by strong wind",
      "the long mane and forelock flying across the face in a gust, sharp eyes",
      "wind lifting the full mane into a dramatic sweep, soft bokeh behind",
      "the mane streaming back as the horse faces the wind, warm rim light",
    ],
    moods: BEAUTY_MOODS,
    tones: BEAUTY_TONES,
  },
  splashing: {
    sceneType: "horse splashing water action scene",
    breeds: GENERIC_HORSES,
    actions: [
      "trotting through shallow water, bright splashes flying around the legs",
      "playfully pawing a river crossing, water spraying up in the sunlight",
      "cantering through a flooded field, sheets of water lifting off the hooves",
      "splashing across a shallow stream, droplets caught sparkling in the light",
    ],
    moods: ACTION_MOODS,
    tones: ACTION_TONES,
  },
  wild_motion: {
    sceneType: "wild horse motion scene",
    breeds: HERD_SUBJECTS,
    actions: [
      "wild horses wheeling and turning in open country, full of raw energy",
      "a wild horse bucking and twisting in pure freedom, dust rising",
      "mustangs breaking into a run across the high desert, manes wild",
      "a wild band surging forward across sagebrush flats",
    ],
    moods: ACTION_MOODS,
    tones: ACTION_TONES,
  },
  walking: {
    sceneType: "horse walking toward camera scene",
    breeds: GENERIC_HORSES,
    actions: [
      "walking slowly straight toward the camera, ears forward, calm and curious",
      "approaching the lens through tall grass with an easy relaxed stride",
      "stepping toward the camera in soft morning light, gentle and confident",
      "walking forward along a path, head level, steady eye contact",
    ],
    moods: ["calm and confident", "easy and relaxed", "curious and steady"],
    tones: ["calm", "steady", "confident", "easy"],
  },

  // ── FUNNY / CURIOSITY (route to the funny caption + quality via sceneType) ──
  yawning: {
    sceneType: "funny playful horse moment, big yawn",
    breeds: FUNNY_BREEDS,
    actions: [
      "caught mid-yawn so it looks like a huge laugh, lips curled and teeth showing",
      "a giant yawn with the head stretched up, looking like a belly laugh",
      "mouth wide open in a yawn, eyes half shut, comically dramatic",
    ],
    moods: FUNNY_MOODS,
    tones: FUNNY_TONES,
  },
  big_nose: {
    sceneType: "funny playful horse moment, nose in the lens",
    breeds: FUNNY_BREEDS,
    actions: [
      "pressing its nose right against the camera so the muzzle fills the frame",
      "huge fuzzy nostrils filling the lens, eyes crossed slightly, very close",
      "sniffing the camera so the soft muzzle takes over the whole frame",
    ],
    moods: FUNNY_MOODS,
    tones: FUNNY_TONES,
  },
  messy_forelock: {
    sceneType: "funny playful horse moment, messy forelock",
    breeds: FUNNY_BREEDS,
    actions: [
      "wild messy forelock covering its eyes, lip slightly curled, just-woke-up look",
      "a shaggy forelock flopped over one eye, peeking out goofily",
      "tangled forelock sticking up in all directions, comically disheveled",
    ],
    moods: FUNNY_MOODS,
    tones: FUNNY_TONES,
  },
  side_eye: {
    sceneType: "funny playful horse moment, side-eye",
    breeds: FUNNY_BREEDS,
    actions: [
      "a silly side-eye expression with one ear forward and one back",
      "giving the camera a suspicious sideways glance, comically judgmental",
      "a dramatic side-eye, whites of the eye showing, full of personality",
    ],
    moods: FUNNY_MOODS,
    tones: FUNNY_TONES,
  },
  barn_peek: {
    sceneType: "funny playful horse moment, barn peek",
    breeds: FUNNY_BREEDS,
    actions: [
      "peeking around a barn corner with only its head visible, curious",
      "poking its head over a stall door with a goofy surprised face",
      "peeking out of a barn window, messy forelock over one eye",
    ],
    moods: FUNNY_MOODS,
    tones: FUNNY_TONES,
  },
  rolling: {
    sceneType: "funny playful horse moment, rolling",
    breeds: FUNNY_BREEDS,
    actions: [
      "rolling on its back in the grass with all four legs in the air",
      "mid-roll in the dust, legs flailing happily, totally undignified",
      "flat on its back wriggling in the grass, clearly loving it",
    ],
    moods: FUNNY_MOODS,
    tones: FUNNY_TONES,
  },
  tongue_out: {
    sceneType: "funny playful horse moment, tongue out",
    breeds: FUNNY_BREEDS,
    actions: [
      "sticking its tongue out toward the camera, goofy and relaxed",
      "tongue lolling out sideways mid-chew, eyes soft and silly",
      "blowing a raspberry with lips flapping and tongue showing",
    ],
    moods: FUNNY_MOODS,
    tones: FUNNY_TONES,
  },
  curious: {
    sceneType: "funny playful horse moment, curious close-up",
    breeds: FUNNY_BREEDS,
    actions: [
      "staring straight into the lens with a comically serious face, nostrils flared",
      "tilting its head at the camera with big curious eyes and pricked ears",
      "leaning in close to investigate the camera, intensely curious",
    ],
    moods: FUNNY_MOODS,
    tones: FUNNY_TONES,
  },

  // ── BEAUTY / PREMIUM ──
  golden_hour: {
    sceneType: "golden hour horse portrait",
    breeds: GENERIC_HORSES,
    actions: PORTRAIT_ACTIONS,
    moods: BEAUTY_MOODS,
    tones: BEAUTY_TONES,
    lights: ["warm golden hour sidelight", "glowing golden backlight through the mane", "low golden sun rim-lighting the coat"],
  },
  snow: {
    sceneType: "snow horse portrait",
    breeds: GENERIC_HORSES,
    actions: [
      "standing in fresh snow with breath fogging in the cold air",
      "walking through a snowfield, snow clinging to the mane and lashes",
      "head portrait with snowflakes settling on the forelock, soft grey light",
      "standing still as snow falls gently around, calm and striking",
    ],
    moods: BEAUTY_MOODS,
    tones: BEAUTY_TONES,
    settings: SNOW_SETTINGS,
    lights: ["soft cool overcast snow light", "pale winter daylight", "gentle grey diffused light"],
  },
  autumn: {
    sceneType: "autumn horse portrait",
    breeds: GENERIC_HORSES,
    actions: PORTRAIT_ACTIONS,
    moods: BEAUTY_MOODS,
    tones: BEAUTY_TONES,
    settings: AUTUMN_SETTINGS,
    lights: ["warm autumn afternoon light", "soft golden light through autumn leaves", "amber backlight"],
  },
  misty: {
    sceneType: "misty morning horse portrait",
    breeds: GENERIC_HORSES,
    actions: PORTRAIT_ACTIONS,
    moods: ["dreamy and soft", "calm and atmospheric", "quiet and ethereal"],
    tones: ["dreamy", "soft", "calm", "atmospheric"],
    settings: MISTY_SETTINGS,
    lights: ["soft cool morning mist", "muted foggy dawn light", "pale diffused fog light"],
  },
  black_bg: {
    sceneType: "black background horse portrait",
    breeds: GENERIC_HORSES,
    actions: [
      "dramatic studio portrait against pure black, single soft key light on the face",
      "fine-art head portrait on black, rim light tracing the mane and jaw",
      "low-key portrait emerging from darkness, eyes and coat texture glowing",
      "elegant profile on black background, sculpted by a soft directional light",
    ],
    moods: BEAUTY_MOODS,
    tones: BEAUTY_TONES,
    settings: STUDIO_DARK,
    lights: ["single soft key light", "dramatic low-key rim light", "soft directional studio light"],
  },
  silhouette: {
    sceneType: "sunset silhouette horse scene",
    breeds: GENERIC_HORSES,
    actions: [
      "standing in full profile as a clean silhouette against a glowing sunset sky",
      "head raised against a burning orange horizon, body in shadow",
      "silhouetted on a ridge at dusk, mane edge-lit by the last light",
      "a dark silhouette against a pink-and-gold evening sky",
    ],
    moods: ["dramatic and natural", "calm and golden", "epic and quiet"],
    tones: ["dramatic", "natural", "epic", "golden"],
    lights: ["strong sunset backlight", "glowing dusk horizon light", "warm rim-light at last light"],
  },
  cinematic: {
    sceneType: "cinematic full body horse scene",
    breeds: GENERIC_HORSES,
    actions: [
      "full-body hero shot standing proud in a wide open landscape",
      "the whole horse framed against a sweeping scenic backdrop, all four legs visible",
      "a wide premium full-body shot with dramatic light and rich color grade",
      "standing on a rise in a wide frame, coat catching the light",
    ],
    moods: BEAUTY_MOODS,
    tones: BEAUTY_TONES,
  },
  eye: {
    sceneType: "horse eye macro portrait",
    breeds: GENERIC_HORSES,
    actions: [
      "extreme macro of the eye filling the frame, sharp catchlight and fine lashes",
      "premium eye macro with the surrounding coat hair in razor-sharp detail",
      "dramatic close-up of the dark eye with a clean reflection",
    ],
    moods: BEAUTY_MOODS,
    tones: BEAUTY_TONES,
  },
  bokeh: {
    sceneType: "soft bokeh horse portrait",
    breeds: GENERIC_HORSES,
    actions: [
      "tight portrait with a beautifully blurred creamy bokeh background, 135mm f/2",
      "head portrait with melted background lights, all focus on the soft eyes",
      "close portrait, background dissolved into smooth pastel bokeh",
    ],
    moods: ["soft and dreamy", "premium and calm", "gentle and elegant"],
    tones: BEAUTY_TONES,
  },
  dramatic_mane: {
    sceneType: "dramatic mane horse portrait",
    breeds: GENERIC_HORSES,
    actions: [
      "portrait emphasizing a long, thick, dramatically flowing mane catching the light",
      "the mane sweeping across the frame in rich detail, strong directional light",
      "a powerful mane-focused portrait, every strand defined, deep shadows",
    ],
    moods: BEAUTY_MOODS,
    tones: BEAUTY_TONES,
  },

  // ── WESTERN / RANCH ──
  cowboy: {
    sceneType: "cowboy ranch scene",
    breeds: WESTERN_BREEDS,
    actions: [
      "a cowboy riding across an open ranch at golden hour, natural posture",
      "a ranch hand on horseback working cattle at sunrise",
      "a cowboy pausing on horseback to look across the valley",
      "horse and rider on a dusty trail, realistic Western tack",
    ],
    moods: WESTERN_MOODS,
    tones: WESTERN_TONES,
    settings: RANCH_SETTINGS,
  },
  pasture: {
    sceneType: "ranch pasture scene",
    breeds: GENERIC_HORSES,
    actions: [
      "grazing peacefully in a wide Texas pasture, long rail fence behind",
      "standing in green pasture grass with a barn in the soft distance",
      "a horse at rest in an open pasture, warm afternoon light",
      "walking the fence line of a quiet ranch pasture",
    ],
    moods: WESTERN_MOODS,
    tones: WESTERN_TONES,
    settings: RANCH_SETTINGS,
  },
  fence: {
    sceneType: "horse by wooden fence scene",
    breeds: GENERIC_HORSES,
    actions: [
      "standing beside a weathered wooden rail fence in soft afternoon light",
      "leaning its head over a split-rail fence toward the camera",
      "resting at a rustic ranch gate, warm low sun",
      "framed beside an old wooden fence with golden backlight",
    ],
    moods: WESTERN_MOODS,
    tones: WESTERN_TONES,
    settings: RANCH_SETTINGS,
  },
  barn: {
    sceneType: "barn ranch scene",
    breeds: GENERIC_HORSES,
    actions: [
      "standing in the doorway of a weathered wooden barn, warm light inside",
      "looking out over a stall door in soft barn light",
      "beside an old red barn at golden hour, rich rural mood",
      "in a hay-strewn barn aisle with warm directional light",
    ],
    moods: WESTERN_MOODS,
    tones: WESTERN_TONES,
    settings: RANCH_SETTINGS,
    lights: ["warm indoor barn light", "golden hour warm sidelight", "soft directional light"],
  },
  buttes: {
    sceneType: "desert buttes scene",
    breeds: GENERIC_HORSES,
    actions: [
      "standing before towering sandstone buttes in the high desert",
      "a lone horse against red rock formations at golden hour",
      "framed by desert mesas under a huge sky",
      "on a dusty desert flat with distant buttes glowing warm",
    ],
    moods: WESTERN_MOODS,
    tones: WESTERN_TONES,
    settings: ["Monument Valley with sandstone buttes", "Arizona red rock country near Sedona", "Painted Desert in Arizona", "Sonoran Desert with saguaro cacti"],
  },
  mountain: {
    sceneType: "mountain meadow scene",
    breeds: GENERIC_HORSES,
    actions: [
      "standing in a green alpine meadow below rocky peaks",
      "grazing in a mountain meadow with snow-capped peaks behind",
      "a horse on a high-country meadow at first light",
      "framed against a dramatic mountain backdrop, crisp clear air",
    ],
    moods: WESTERN_MOODS,
    tones: WESTERN_TONES,
    settings: ["Montana valley with Rocky Mountain backdrop", "Colorado high-country meadow in late summer", "Grand Teton style lake with sharp peaks", "San Juan Mountains in Colorado"],
  },
  rodeo: {
    sceneType: "rodeo style horse scene",
    breeds: WESTERN_BREEDS,
    actions: [
      "a spirited ranch horse in a dusty arena, alert and ready",
      "a barrel-racing style turn in a dirt arena, dust flying",
      "a strong rodeo-type horse standing proud at the arena gate",
      "a quick cutting-horse move in soft arena light",
    ],
    moods: WESTERN_MOODS,
    tones: WESTERN_TONES,
    settings: RANCH_SETTINGS,
  },
  farm_sunrise: {
    sceneType: "farm sunrise scene",
    breeds: GENERIC_HORSES,
    actions: [
      "standing in a misty farm field as the sun rises behind",
      "grazing at first light with golden sunrise mist around the legs",
      "silhouetted softly against a pink sunrise over the farm",
      "a calm horse greeting the sunrise by the barn",
    ],
    moods: ["calm and hopeful", "peaceful end-of-night to morning", "quiet and warm"],
    tones: ["peaceful", "calm", "warm", "hopeful"],
    settings: RANCH_SETTINGS,
    lights: ["soft pink sunrise light", "golden sunrise mist", "warm low dawn sun"],
  },
  prairie: {
    sceneType: "open prairie scene",
    breeds: GENERIC_HORSES,
    actions: [
      "standing in tall prairie grass under a vast open sky",
      "walking through endless prairie at golden hour",
      "a horse small against a huge prairie horizon, epic scale",
      "grazing in waving grassland under summer clouds",
    ],
    moods: WESTERN_MOODS,
    tones: WESTERN_TONES,
    settings: ["Wyoming open plains under a huge sky", "Kansas Flint Hills rolling grassland", "Nebraska Sandhills under summer sky", "Oklahoma tallgrass prairie in afternoon light"],
  },
  dusty_sunset: {
    sceneType: "dusty sunset scene",
    breeds: GENERIC_HORSES,
    actions: [
      "standing in a haze of golden dust at sunset, warm backlight",
      "horses moving through dust as the sun drops, glowing rim light",
      "a horse backlit by sunset with dust hanging in the air",
      "kicking up dust on a dry range as the day ends",
    ],
    moods: WESTERN_MOODS,
    tones: WESTERN_TONES,
    settings: RANCH_SETTINGS,
    lights: ["dusty backlit sunset", "glowing golden dusk haze", "warm low sun through dust"],
  },
};

// ── SMART AUTO MIX BUCKETS ───────────────────────────────────────────────────
// When no category is selected, auto mode draws a balanced Facebook-engagement
// spread: 45% emotional, 20% beauty/premium, 15% funny/curiosity,
// 10% western/ranch, 10% breed/color. foal & couple stay weighted heavier
// inside the emotional bucket since they perform best.
const AUTO_EMOTIONAL: SceneMode[] = [
  "foal", "foal", "foal", "couple", "couple", "couple",
  "friendship", "protective", "owner_bond", "tender", "gentle_eye", "lonely",
];
const AUTO_BEAUTY: SceneMode[] = [
  "golden_hour", "autumn", "misty", "snow", "black_bg", "silhouette",
  "cinematic", "bokeh", "dramatic_mane", "eye", "windy_mane", "black",
];
const AUTO_FUNNY: SceneMode[] = [
  "funny", "yawning", "big_nose", "messy_forelock", "side_eye",
  "barn_peek", "rolling", "tongue_out", "curious",
];
const AUTO_WESTERN: SceneMode[] = [
  "western", "cowboy", "pasture", "fence", "barn", "buttes",
  "mountain", "prairie", "dusty_sunset", "rodeo", "farm_sunrise", "running", "herd",
];
const AUTO_BREED: SceneMode[] = [
  "white", "appaloosa", "arabian", "andalusian", "palomino",
  "paint", "buckskin", "chestnut", "haflinger", "mustang", "blackwhite",
];

// ── MAIN EXPORT ──────────────────────────────────────────────────────────────
export function sceneSeed(used: UsedSeeds = {}, mode: SceneMode = "auto"): SceneSeed {
  // Resolve "auto"/"emotional" into a concrete family.
  let resolved: Exclude<SceneMode, "auto" | "emotional">;
  if (mode === "auto") {
    const roll = Math.random();
    let bucket: SceneMode[];
    if (roll < 0.45) bucket = AUTO_EMOTIONAL;        // 45% emotional
    else if (roll < 0.65) bucket = AUTO_BEAUTY;       // 20% beauty / premium
    else if (roll < 0.80) bucket = AUTO_FUNNY;        // 15% funny / curiosity
    else if (roll < 0.90) bucket = AUTO_WESTERN;      // 10% western / ranch
    else bucket = AUTO_BREED;                         // 10% breed / color
    resolved = pick(bucket) as Exclude<SceneMode, "auto" | "emotional">;
  } else if (mode === "emotional") {
    resolved = Math.random() < 0.5 ? "foal" : "couple";
  } else {
    resolved = mode;
  }

  if (resolved === "dreamy_greeting") {
    return pickArtVariant(DREAMY_GREETING_VARIANTS, used);
  }
  if (resolved === "art_blessing") {
    return pickArtVariant(ART_BLESSING_VARIANTS, used);
  }
  if (resolved === "fantasy_floral") {
    return pickArtVariant(FANTASY_FLORAL_VARIANTS, used);
  }

  // New grouped Scene Focus modes are composed from the declarative registry.
  const spec = MODE_REGISTRY[resolved];
  if (spec) {
    // Returned actions include camera and scene-focus instructions. Strip those
    // suffixes for these modes so a batch can avoid repeating the underlying pose.
    const usedActions = ["horse_human_bond", "river_crossing", "appaloosa_wildflowers", "black_horse_rain", "horse_wall_painting", "beach_running"].includes(resolved)
      ? used.actions?.map((action) => action.split("\nSCENE FOCUS:")[0].split(". CAMERA FRAMING (most important rule")[0])
      : used.actions;
    return {
      setting: pick(fresh(spec.settings ?? SETTINGS, used.settings)),
      breed:   pick(fresh(spec.breeds, used.breeds)),
      mood:    pick(fresh(spec.moods, used.moods)),
      light:   pick(fresh(spec.lights ?? LIGHTS, used.lights)),
      action:  pick(fresh(spec.actions, usedActions)),
      tone:    pick(fresh(spec.tones, used.tones)),
      sceneType: spec.sceneType,
    };
  }

  if (resolved === "funny") {
    return {
      setting: pick(fresh(SETTINGS, used.settings)),
      breed:   pick(fresh(FUNNY_BREEDS, used.breeds)),
      mood:    pick(fresh(FUNNY_MOODS, used.moods)),
      light:   pick(fresh(LIGHTS, used.lights)),
      action:  pick(fresh(FUNNY_ACTIONS, used.actions)),
      tone:    pick(fresh(FUNNY_TONES, used.tones)),
      sceneType: "funny playful horse moment",
    };
  }

  if (resolved === "western") {
    return {
      setting: pick(fresh(SETTINGS, used.settings)),
      breed:   pick(fresh(WESTERN_BREEDS, used.breeds)),
      mood:    pick(fresh(WESTERN_MOODS, used.moods)),
      light:   pick(fresh(LIGHTS, used.lights)),
      action:  pick(fresh(WESTERN_ACTIONS, used.actions)),
      tone:    pick(fresh(WESTERN_TONES, used.tones)),
      sceneType: pick(fresh(WESTERN_SCENE_TYPES, used.sceneTypes)),
    };
  }

  if (resolved === "mural") {
    // Compose a varied artist + pose so no two pins feel the same.
    const artist = pick(fresh(MURAL_ARTISTS, used.actions));
    const pose = pick(MURAL_POSES);
    return {
      setting: pick(fresh(MURAL_WALLS, used.settings)),
      breed:   pick(fresh(MURAL_BREEDS, used.breeds)),
      mood:    pick(fresh(MURAL_MOODS, used.moods)),
      light:   pick(fresh(MURAL_LIGHTS, used.lights)),
      action:  `${artist} ${pose}`,
      tone:    pick(fresh(MURAL_TONES, used.tones)),
      sceneType: "artist painting a horse mural",
    };
  }

  if (resolved === "black") {
    return {
      setting: pick(fresh(SETTINGS, used.settings)),
      breed:   pick(fresh(BLACK_BREEDS, used.breeds)),
      mood:    pick(fresh(BLACK_MOODS, used.moods)),
      light:   pick(fresh(LIGHTS, used.lights)),
      action:  pick(fresh(BLACK_ACTIONS, used.actions)),
      tone:    pick(fresh(BLACK_TONES, used.tones)),
      sceneType: "majestic black horse portrait",
    };
  }

  if (BREED_LABELS[resolved]) {
    const breedDesc =
      resolved === "appaloosa"
        ? pick(fresh(APPALOOSA_VARIANTS, used.breeds))
        : BREED_LABELS[resolved];
    return {
      setting: pick(fresh(SETTINGS, used.settings)),
      breed:   breedDesc,
      mood:    pick(fresh(SINGLE_HORSE_MOODS, used.moods)),
      light:   pick(fresh(LIGHTS, used.lights)),
      action:  pick(fresh(SINGLE_HORSE_ACTIONS, used.actions)),
      tone:    pick(fresh(SINGLE_HORSE_TONES, used.tones)),
      sceneType: "majestic single horse portrait",
    };
  }

  // Emotional families — narrow the breed/action pools to the chosen focus.
  let breeds: readonly string[] = EMOTIONAL_BREEDS;
  let actions: readonly string[] = EMOTIONAL_ACTIONS;
  let sceneType = "horse couple affection scene";

  if (resolved === "foal") {
    breeds = EMOTIONAL_BREEDS.filter(hasFoal);
    actions = EMOTIONAL_ACTIONS.filter(hasFoal);
    sceneType = "mare and foal bonding scene";
  } else if (resolved === "couple") {
    breeds = EMOTIONAL_BREEDS.filter((s) => !hasFoal(s));
    actions = EMOTIONAL_ACTIONS.filter((s) => !hasFoal(s));
    sceneType = "horse couple affection scene";
  } else if (resolved === "blackwhite") {
    breeds = EMOTIONAL_BREEDS.filter((s) => isBlackWhite(s) && !hasFoal(s));
    actions = EMOTIONAL_ACTIONS.filter((s) => isBlackWhite(s) && !hasFoal(s));
    sceneType = "horse couple affection scene";
  }

  // Safety fallbacks if a filter ever empties a pool.
  if (!breeds.length) breeds = EMOTIONAL_BREEDS;
  if (!actions.length) actions = EMOTIONAL_ACTIONS;

  return {
    setting: pick(fresh(SETTINGS, used.settings)),
    breed:   pick(fresh(breeds, used.breeds)),
    mood:    pick(fresh(EMOTIONAL_MOODS, used.moods)),
    light:   pick(fresh(LIGHTS, used.lights)),
    action:  pick(fresh(actions, used.actions)),
    tone:    pick(fresh(EMOTIONAL_TONES, used.tones)),
    sceneType,
  };
}
