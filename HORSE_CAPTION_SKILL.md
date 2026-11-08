# Horse Facebook Caption Quality Skill

Goal: every horse caption must be powerful, image-specific (hook AND body), emotional,
varied, and built to get comments from a U.S. horse-lover audience. Runs automatically on
every horse caption — implemented in the `SYSTEM` prompt in `lib/prompts.ts` (used by
normal generation, reference generation, and regenerate/edit), with code safety nets in
`app/api/generate/route.ts` (`questionOwnLine`, `humanizeText`, `stripHashtags`) and an
anti-repeat list of used final questions.

## 1. Hook must be specific to the exact image
Before finalizing, ask: "Could this hook fit many horse photos?" If yes, rewrite it.
Build it from the strongest visible detail: foal beside the horse, mare-and-foal bond,
two horses close, black/white pair, spotted Appaloosa coat, Paint patches, black Friesian
coat, golden sunset, stormy sky, dramatic wind, close-up face, flowing mane, snow, running
movement, dust rising, mountain background, breath in cold air, ranch fence, autumn trees.

## 2. Body must also stay image-specific
Every sentence connects to something VISIBLE or to the emotion that detail creates. If a
sentence could fit many horse photos, rewrite it. Use concrete details (dust rising,
breath in cold air, golden light on the mane, two heads touching, foal tucked close...).
Banned generic body phrases: steady and strong, strong without trying, quiet power, real
presence, calm and noble, says everything, without a single sound, peaceful moment.

## 3. Banned generic hook phrases
presence, real/serious presence, carries real presence, quiet power, quiet kind of grace,
calm noble look, noble, strong without trying, beautiful/stunning/amazing/gorgeous horse,
look at this horse, stopping the scroll, stop scrolling, this picture/photo, morning
gentleness in one frame, a quiet moment together, says everything, made for this light,
just hits different, without a single sound.

## 4. Foal captions lead with emotion
Foal must be in the hook or first sentence. Focus on protection, trust, softness,
curiosity, safety, the bond. Question usually about the pair / mare and foal.

## 5. Two-horse captions are a story
Mention both. Lead with relationship, closeness, contrast (black vs white), body language.
If heads are close, say so. Question must match the pair.

## 6. Movement images need energy
Running / charging / dust / coming toward camera -> energetic wording (dust rising, lifted
hoof, flying mane, forward motion, speed). Never "easy trot" for a powerful action shot.

## 7. Rotate final questions (anti-repeat)
~60% name questions, ~40% easy emotional questions. Do not reuse a question already used in
the batch (the app passes used questions in the avoid list). Lists per scene type are in
the SYSTEM prompt (one horse / pair / mare and foal).

## 8. Structure & limits
Hook (1 emoji) -> blank -> Paragraph 1 (strongest visible details) -> blank -> Paragraph 2
(emotion tied to the image) -> blank -> question alone. 45-85 words, simple U.S. English,
1-2 emojis, no hashtags (unless asked), no quotation marks, no place names.

## 9. Strict final self-check (rewrite if any "no")
1. Hook specific to this exact image?
2. Body paragraphs also image-specific?
3. Avoided all banned generic phrases?
4. Foal led with / both horses mentioned, when present?
5. Movement feels energetic, when present?
6. Final question varied (not repeated in the batch)?
7. Question on its own line and easy to answer?
8. Would a U.S. horse lover want to comment?
9. Short (45-85 words), 1-2 emojis, no quotation marks?

## Where it is wired (active in code)
- `lib/prompts.ts` -> `SYSTEM` (all rules above) + `userPrompt` / `refUserPrompt`
  (`avoidQuestionsBlock` injects used questions).
- `app/api/generate/route.ts` -> all planners + `regenerateCaption` use `SYSTEM`;
  `Avoid` type carries `questions`; `questionOwnLine` keeps the question on its own line.
- `app/page.tsx` -> extracts each previous caption's final question and sends it in
  `avoid.questions` for anti-repetition.
