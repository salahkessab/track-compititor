# Experiment: article and image prompt improvements + new design

Branch `claude/article-image-experiment`. **Not for production.** `main`, the InstaBox deployment and your normal local app are unchanged.

## What changed (compare against `main`)

| Area | Change | Files |
|---|---|---|
| Articles | A rewritten step is no longer thrown away just because it adds a correct °F/°C conversion (`375°F (190°C)`) or spells a duration (`five minutes`). Wrong conversions still revert to the source step. | `lib/recipe-intelligence/artifacts.ts` (`canonicalStep`) |
| Articles | The default Master recipe prompt gets a short wording guide condensed from the pinned Humanizer skill: varied rhythm, no staged run-ups, a list of overused AI words, no "not just X but Y". It cannot override recipe facts or the schema. | `lib/recipe-intelligence/prompts.ts` (`MASTER_STYLE_ADDENDUM`) |
| Image to Image | When a quick-instruction button is active, the forced "always change dishware and table" block is removed and replaced with "apply ONLY the listed changes". This is the conflict most likely behind rearrangement not happening. | `lib/recipeImageToImagePrompt.ts` |
| 2-in-1 | Names each photo's role (image 1 base scene, image 2 extra ingredients) and says user edits win over the default dishware/surface changes. | `lib/recipeTwoInOnePrompt.ts` |
| Design | New "Kitchen Studio" look (warm paper, terracotta, sage, espresso nav, Fraunces headings), light and dark. Pure CSS; remove one import to undo. | `app/experiment-theme.css`, `app/layout.tsx` |

Not in this branch yet (needs your approval because they make paid calls or are larger): the ingredient position plan with a vision call, protected Recipe Designs mode, reasoning-effort setting, decor paragraph fix. See the plan.

## Run it next to the normal app (Node 24 or newer)

```bash
git clone https://github.com/salahkessab/track-compititor.git recipe-studio-experiment
cd recipe-studio-experiment
git checkout claude/article-image-experiment
npm ci
node scripts/run-experiment.cjs
```

It prints a URL such as `http://127.0.0.1:<free port>`. A green "EXPERIMENT BUILD" label is shown on every page.

Stop only the experiment: `node scripts/run-experiment.cjs stop`

### Isolation guarantees
- Own launcher config and lock, own storage folder and own random free port, in `~/RecipeStudioExperiment` (change with `EXPERIMENT_HOME`). The script refuses any folder that overlaps your normal app's config or storage.
- Its own build output inside this clone.
- **Offline by default:** `OPENAI_API_KEY`, `FAL_KEY` and `ANTHROPIC_API_KEY` are blanked, R2 is disabled and no WordPress settings are passed. Generation buttons will report an error instead of spending money.
- Do not copy your production `.env.local` here. Paid tests need a separate test key in this clone's own `.env.local` and `--allow-paid`, and only after you approve the call list.
- The InstaBox workflow only runs on pushes to `main`, and `vercel.json` disables Vercel deployments for this branch name.

## Offline tests

```bash
npm test
node --test tests/experiment-article-image.cjs
```

## What to compare (after approval of any paid test)
1. Image to Image with the "Rearrange ingredients" button on an ingredient spread: do items move now?
2. Same photo with "Soft natural light" only: do dishware and table stay as photographed?
3. 2-in-1 with two photos: both photos' foods present, base scene from photo 1.
4. One recipe article: how many steps are original wording vs copied source wording; sentence rhythm and openings.
5. The look of every tab in light and dark mode.

## Experimental switches for article writing (off by default)

Set these in the environment before `node scripts/run-experiment.cjs --allow-paid`. They only affect this experiment.

| Switch | Effect |
|---|---|
| `EXPERIMENT_ARTICLE_REASONING=low` or `medium` | The article writer plans before drafting. More detail, higher cost (about $0.24 per article in our test instead of $0.17). |
| `EXPERIMENT_LEAN_ARTICLE=1` | Lean layout: introduction, then ingredients and instructions (the recipe card), then tips. The prompt asks for a short introduction in the reference style and leaves the long optional sections empty. Step photographs are not placed in this layout. |

| `EXPERIMENT_STORY_ARTICLE=1` | Story layout, close to the source article's length (its word count, up to +15%; 1,300–1,500 when unknown). Introduction opens on the recipe's occasion, adds a general scene written to "you" (never a claim about a real person or the author), then describes the dish. Then: what makes it special, ingredients and instructions, tips, what to serve with it, FAQ, storage. Takes precedence over the lean layout. |

All keep every fact rule: the writer cannot invent ingredients, quantities, times, temperatures, experience, testing or reader reviews, and the style guidance is described in our own words, never copied from any website.
## Writing style menu

Recipe options now has a **Writing style** menu (Master recipe article only). The choice is saved with each batch and article, so different articles can use different styles without restarting. When no style is chosen, the switches above still decide (story, then lean, otherwise classic).

| Style | What changes |
|---|---|
| Classic | The default Master recipe article. |
| Lean | Short introduction, recipe, tips. |
| Story | Occasion, a general family scene, what makes it special, tips, serving ideas, FAQ, storage; close to the source's length. |
| Quick & Practical | No stories. Straight to what you make, why it works, tips and mistakes to avoid, short answers. About 60% of the source's length. |
| Holiday / Occasion | Opens on a supported occasion (or a general gathering), make-ahead and hosting tips, serving to guests. Never claims a tradition the source does not state; cooking more is described in words, never with new quantities. |
| Budget / Family | Everyday family life, why it works for families, money-saving tips, kid-friendly serving, leftovers. Never states prices. |
| Step-by-step Beginner | Plain words, "before you start", fuller step wording, how to know each stage is done, beginner questions. |

In every style the ingredients, quantities, times, temperatures and order of steps stay exactly as in the source.
