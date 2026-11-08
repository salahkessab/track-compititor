# Model Selection Skill

Goal: pick the right model for each task and keep cost transparent.

## Rules
- Text (captions): default `gpt-5.4-mini` or `claude-haiku-4-5` (cheap, good enough).
  Use `gpt-5.4` / `claude-sonnet` only when you want richer writing (costs more).
- Image (text-to-image): `Seedream V4` ($0.03) is the default — strong for both photos
  and the designed-pin title text.
- Reference upload: `Flux Dev` image-to-image ($0.025) transforms the uploaded photo.
- Show the model name on each result and the per-image + total cost.
- Prefer quality models for final posts; cheaper models are fine for quick tests.

## Bad example (avoid)
- Using the most expensive text model for short captions (no quality gain, higher cost).

## Good example
- `gpt-5.4-mini` + Seedream V4 ~ $0.031/image for everyday posting.

## Self-check
- Is the chosen text model cheap enough for short captions?
- Is the image model right for the task (Seedream for pins, Flux for reference)?
- Is the cost shown to the user?

## Where it is applied in code (WIRED for selection, doc for guidance)
- UI selection: `app/page.tsx` Provider toggle + Text model `Select`
  (`CLAUDE_MODELS` / `OPENAI_MODELS`).
- Image engine: `app/api/generate/route.ts` chooses `MODELS.fal` (Seedream) for normal
  renders and `FLUX_I2I` for reference uploads; badge via `prettyFal` in `app/page.tsx`.
- Pricing + estimate: `lib/config.ts` `PRICING`, `estimateCost`, shown in `app/page.tsx`.
- NOTE: there is no in-UI image-model dropdown (image engine is chosen automatically:
  Seedream normally, Flux for references). This is guidance + auto-selection, not a
  user toggle.
