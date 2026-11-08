# Skills Index

Reusable skill docs for the horse + recipe Facebook content app. Each skill lists rules,
examples, a self-check, and exactly where it is applied in code.

| Skill | File | Status |
|---|---|---|
| Horse caption quality | `HORSE_CAPTION_SKILL.md` | Wired (SYSTEM prompt + code) |
| Horse image prompt | `HORSE_IMAGE_PROMPT_SKILL.md` | Wired (SYSTEM + config) |
| Reference image | `HORSE_REFERENCE_IMAGE_SKILL.md` | Wired (refUserPrompt + Flux img2img) |
| Facebook post quality | `FACEBOOK_POST_QUALITY_SKILL.md` | Wired (caption-match rule + questionOwnLine) |
| Image realism | `IMAGE_REALISM_SKILL.md` | Wired (SYSTEM realism check + quality/negative) |
| Model selection | `MODEL_SELECTION_SKILL.md` | Partly wired (auto-select + UI) / guidance |
| CSV export | `CSV_EXPORT_SKILL.md` | Wired (downloadCSV); metadata export = doc-only |

Key code locations:
- Prompts: `lib/prompts.ts` (`SYSTEM`, `RECIPE_SYSTEM`, `userPrompt`, `refUserPrompt`,
  `recipeUserPrompt`, `captionOnlyUserPrompt`).
- Generation + parsing: `app/api/generate/route.ts` (`planWith*`, `planText`,
  `renderImage`, `renderFluxImg2Img`, `regenerateCaption`, `parseJson`, `humanizeText`,
  `stripHashtags`, `questionOwnLine`, `fixCaption`).
- Scenes: `lib/sceneSeed.ts`, `lib/recipeSeed.ts`.
- Config + pricing: `lib/config.ts`.
- UI + export: `app/page.tsx`.
