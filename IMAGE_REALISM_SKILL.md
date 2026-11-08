# Image Realism Skill

Goal: every generated image looks like a real photograph, not AI.

## Rules
- Prioritize realistic lighting, natural anatomy, real camera feel, detailed coat
  texture, correct eyes, legs, hooves, mane, and proportions.
- Avoid AI artifacts: extra legs, strange eyes, melted faces, fake plastic shine,
  blurry mush, or fantasy look (unless requested).
- Apply quality checks before final output.

## Bad example (avoid)
- A horse with five legs, glowing eyes, plastic skin, or a warped face.

## Good example
- Sharp coat hair detail, natural catchlight in the eye, four correct legs, believable
  light and shadow.

## Self-check
- Natural eyes (no glow, no extra pupils)?
- Exactly four legs and four hooves, correct proportions?
- Real coat/hair texture, natural mane and tail?
- No melted face, fused/extra limbs, plastic shine, or blur?

## Where it is applied in code (WIRED)
- `lib/prompts.ts` -> `SYSTEM` "IMAGE REALISM SELF-CHECK" + ABSOLUTE NO-GO LIST.
- `lib/config.ts` -> `QUALITY_SUFFIX` / `qualitySuffixFor` (realism cues) and
  `NEGATIVE_PROMPT` / `negativePromptFor` (anti-artifact list). For recipes:
  `FOOD_QUALITY_SUFFIX` / `FOOD_NEGATIVE` (+ design variants).
- `app/api/generate/route.ts` -> `renderImage` appends the quality suffix and sends the
  negative prompt; framing negatives in `FRAMING_NEGATIVES` steer the crop.
