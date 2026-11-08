// Recipe / food scene seeds. Returns a SceneSeed-shaped object so it reuses the
// same generation pipeline and anti-repeat dedup as the horse seeds.
import type { SceneSeed, UsedSeeds } from "./sceneSeed";

export type RecipeMode =
  | "auto"
  | "dessert"
  | "comfort"
  | "breakfast"
  | "dinner"
  | "soup"
  | "healthy"
  | "baking"
  | "pasta"
  | "chicken"
  | "beef"
  | "seafood"
  | "drink";

const DISHES: Record<string, string[]> = {
  dessert: [
    "a thick fudgy chocolate brownie stack",
    "a slice of creamy New York cheesecake with berry topping",
    "warm apple pie with a scoop of vanilla ice cream",
    "gooey chocolate chip cookies fresh from the oven",
    "a layered strawberry shortcake",
    "molten chocolate lava cake with a soft center",
    "classic tiramisu in a glass",
    "lemon meringue pie with toasted peaks",
  ],
  comfort: [
    "a loaded baked mac and cheese",
    "creamy chicken pot pie with a golden crust",
    "slow-cooked beef stew in a rustic bowl",
    "cheesy scalloped potatoes",
    "southern fried chicken with buttery biscuits",
    "meatloaf with mashed potatoes and gravy",
    "a pulled pork sandwich with coleslaw",
  ],
  breakfast: [
    "a tall stack of fluffy pancakes with maple syrup and butter",
    "crispy bacon and eggs with golden toast",
    "a loaded breakfast burrito cut in half",
    "golden waffles with berries and cream",
    "avocado toast with a poached egg",
    "warm cinnamon rolls with cream cheese glaze",
  ],
  dinner: [
    "a juicy grilled steak with herb butter",
    "roasted garlic butter salmon with vegetables",
    "honey garlic glazed chicken thighs",
    "a loaded burger with melted cheese and crispy fries",
    "baked lemon herb chicken with potatoes",
  ],
  soup: [
    "a creamy bowl of tomato soup with grilled cheese",
    "hearty beef and vegetable soup",
    "loaded baked potato soup with toppings",
    "chicken noodle soup in a rustic bowl",
    "creamy broccoli cheddar soup",
  ],
  healthy: [
    "a colorful grilled chicken and quinoa bowl",
    "a fresh garden salad with avocado",
    "a salmon and roasted vegetable plate",
    "a berry and yogurt breakfast bowl",
    "a shrimp and avocado salad",
  ],
  baking: [
    "a golden loaf of homemade sourdough bread",
    "soft cinnamon swirl bread",
    "fresh dinner rolls in a basket",
    "a rustic rosemary focaccia",
    "flaky butter croissants",
  ],
  pasta: [
    "creamy garlic parmesan pasta",
    "spaghetti and meatballs in rich tomato sauce",
    "baked cheesy lasagna",
    "fettuccine alfredo with grilled chicken",
    "penne in a creamy tomato sauce",
  ],
  chicken: [
    "crispy golden fried chicken pieces",
    "honey garlic chicken thighs",
    "creamy tuscan chicken",
    "parmesan crusted baked chicken",
    "buffalo chicken wings with dip",
  ],
  beef: [
    "a juicy ribeye steak sliced on a board",
    "slow-braised beef short ribs",
    "a classic double cheeseburger",
    "beef and broccoli stir fry",
    "homemade beef tacos",
  ],
  seafood: [
    "a garlic butter shrimp skillet",
    "grilled salmon fillet with lemon",
    "crispy fish and chips",
    "seared scallops with herb butter",
    "a seafood boil platter",
  ],
  drink: [
    "a creamy iced coffee with whipped cream",
    "a fresh mixed berry smoothie",
    "a tall glass of lemonade with mint",
    "a hot chocolate topped with marshmallows",
    "an iced matcha latte",
  ],
};

const STYLES = [
  "on a rustic wooden table",
  "on a clean white plate with soft shadows",
  "in a cozy home kitchen setting",
  "on a marble countertop",
  "on a dark moody slate board",
  "with fresh ingredients scattered around",
  "styled on parchment paper",
  "in a warm farmhouse setting",
];

const ANGLES = [
  "overhead flat-lay shot",
  "45-degree angle close-up",
  "straight-on close-up with shallow depth of field",
  "macro close-up showing texture and detail",
];

const LIGHTS = [
  "soft natural window light",
  "warm cozy lighting",
  "bright airy daylight",
  "moody dramatic side light",
];

const TONES = [
  "cozy", "comforting", "crave-worthy", "homemade",
  "fresh", "indulgent", "warm", "simple",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function fresh<T>(all: readonly T[], used?: T[]): readonly T[] {
  if (!used?.length) return all;
  const left = all.filter((x) => !used.includes(x));
  return left.length ? left : all;
}

// Returns a SceneSeed (same shape as horse seeds) so the rest of the pipeline
// and the dedup logic work unchanged. Mapping:
//   breed = dish, setting = plating style, action = camera angle, sceneType = "<category> recipe"
export function recipeSeed(used: UsedSeeds = {}, mode: RecipeMode = "auto"): SceneSeed {
  const cats = Object.keys(DISHES);
  const category = mode !== "auto" && DISHES[mode] ? mode : pick(cats);
  const tone = pick(fresh(TONES, used.tones));
  return {
    setting: pick(fresh(STYLES, used.settings)),
    breed: pick(fresh(DISHES[category], used.breeds)),
    mood: `${tone}, appetizing ${category} food`,
    light: pick(fresh(LIGHTS, used.lights)),
    action: pick(fresh(ANGLES, used.actions)),
    tone,
    sceneType: `${category} recipe`,
  };
}
