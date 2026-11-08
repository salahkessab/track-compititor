# Facebook Post Quality Skill

Goal: the final post (image + caption together) must be coherent and high quality for a
U.S. horse-lover audience.

## Rules
- Image and caption must work together.
- The caption must match the image: correct breed, coat color, number of horses, and
  background. No mismatch.
- The final engagement question must be clear and on its own separate line.
- Keep everything natural, warm, and simple.

## Bad example (avoid)
- Image: a single grey Andalusian. Caption: "This black mare and her foal..." (mismatch).
- Question jammed onto the end of the last paragraph.

## Good example
- Image: black blanket Appaloosa in autumn light. Caption describes the dark coat and
  spotted rump, then ends with the question on its own line.

## Self-check
- Does the caption's breed/color/count/background match the image?
- Is the final question on its own line with a blank line before it?
- Is the tone natural and warm for a U.S. horse audience?

## Where it is applied in code (WIRED)
- `lib/prompts.ts` -> `SYSTEM` "MATCH THE IMAGE" rule + caption rules; `RECIPE_SYSTEM`
  "MATCH THE DISH" rule.
- `app/api/generate/route.ts` -> `questionOwnLine()` in `parseJson` guarantees the
  question is on its own line for every caption (generate + regenerate, horses + recipes).
- `humanizeText()` strips quotes/em dashes; `stripHashtags()` removes hashtags.
