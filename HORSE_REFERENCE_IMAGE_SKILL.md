# Horse Reference Image Skill

Goal: when the user uploads a viral reference image, produce a new original image that
keeps its winning qualities without copying it.

## Rules
- Respect the reference's style and subject. Do not copy it exactly unless requested.
- Preserve the main idea but create a new, original version.
- Extract the style, framing, emotion, lighting, color, and engagement pattern.
- Do not mix in unrelated details.
- Keep the result suitable for a horse Facebook page.
- If the user selects a specific Scene focus or a Custom subject, that LOCKS the subject:
  borrow only the STYLE from the reference, keep the chosen subject.
- True image-to-image (Flux Dev) transforms the uploaded photo; strength controls how
  far it moves from the original (Strict 0.5 / Balanced 0.7 / Creative 0.9).

## Bad example (avoid)
- Returning a near-identical clone of the uploaded photo.
- Changing a mare-and-foal reference into a cowboy scene.

## Good example
- Upload a black+white couple portrait -> generate a new black+white couple in the same
  tight bokeh portrait style, different pose and background.

## Self-check
- Does the new image clearly share the reference's style/subject/emotion?
- Is it original, not a copy?
- If a scene focus/custom subject was set, did that subject win (style only from ref)?
- Is it photoreal and Facebook-appropriate?

## Where it is applied in code (WIRED)
- `lib/prompts.ts` -> `refUserPrompt` (STEP 1 deep analysis, STEP 2 build new image,
  lockScene logic).
- `app/api/generate/route.ts` -> `planWithClaudeRef` / `planWithOpenAIRef` (vision),
  and `renderFluxImg2Img` (true img2img with `FLUX_I2I`, strength from `imgStrength`).
- `lib/config.ts` -> `FLUX_I2I`, `IMG2IMG_STRENGTHS`.
- UI: `app/page.tsx` ReferenceZone + img2img strength selector.
