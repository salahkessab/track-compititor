# Horse Image Prompt Skill

Goal: generate strong, realistic, viral-ready horse image prompts for Facebook.

## Rules
- Make the prompt specific, visual, and realistic. Cover: breed, coat color/pattern,
  pose/action, lighting, background, camera lens + angle, mood, and composition.
- Avoid artificial, plastic, cartoon, fake, or over-edited looks.
- Keep horse anatomy realistic: exactly four legs and hooves, correct proportions,
  natural mane/tail, real coat texture.
- For Facebook engagement, prefer emotional scenes: mare and foal, horse couple,
  dramatic single horse, running horses, cowboy/ranch scenes, snow scenes, golden hour.
- Prompt structure: subject -> pose/action -> setting -> time of day + lighting ->
  lens + angle + composition -> realism cues -> quality cues -> brief negative cues.
- Add negative-prompt cues against extra limbs, fantasy, text, plastic look.

## Bad example (avoid)
> A beautiful majestic horse, fantasy lighting, 3d render, stunning, vibrant colors.

## Good example
> A jet-black Friesian and a pure-white Andalusian standing forehead to forehead in a
> misty autumn meadow at golden hour. 135mm telephoto, f/2.8, heads filling the frame,
> background melted into soft bokeh. Real coat texture, both coats equally lit, natural
> earth tones, sharp focus, professional outdoor photography. No text, no extra limbs,
> no fantasy, no painterly look.

## Self-check
- Are breed, coat, pose, light, background, lens/angle, and mood all present?
- Is it photoreal (no cartoon/plastic/fantasy)?
- Is the anatomy correct (four legs/hooves, proportions)?
- Is it an emotional/viral-friendly scene?

## Where it is applied in code (WIRED)
- `lib/prompts.ts` -> `SYSTEM` (SCENE CATEGORIES, IMAGE PROMPT GOALS, PROMPT STRUCTURE,
  ABSOLUTE NO-GO LIST). Used by every planner in `app/api/generate/route.ts`:
  `planWithClaude`, `planWithOpenAI`, `planWithClaudeRef`, `planWithOpenAIRef`.
- Scene variety comes from `lib/sceneSeed.ts` (`sceneSeed`).
- `lib/config.ts` -> `QUALITY_SUFFIX` (`qualitySuffixFor`) and `NEGATIVE_PROMPT`
  (`negativePromptFor`) are appended in `renderImage` for the actual render.
