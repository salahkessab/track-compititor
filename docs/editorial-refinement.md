The existing recipe and Home & Decor writers stay primary. New article jobs run
an automatic final editorial refinement before saving the accepted article.
Selected Humanizer guidance is pinned to
[`b48c832f0f809c1b5658edbb838c2521b72f2413`](https://github.com/blader/humanizer/tree/b48c832f0f809c1b5658edbb838c2521b72f2413).
The upstream source, MIT license and attribution are in `vendor/humanizer/`.

This is deliberately a narrow copy-edit pass. The backend identifies bounded
wordy phrases or introductory filler in eligible surrounding prose. The existing
writing model selects which exact proposed edits improve clarity and voice; it
cannot return a new article or arbitrary replacement text. Already-good text,
other languages without an eligible pattern, marked-up/cited paragraphs, and
passages outside the bounded review remain unchanged. No eligible edit means no
extra API request. A conservative reservation is included in new job estimates.

Recipe ingredients, amounts, units, preparation/optional labels, instructions,
methods, times, temperatures, servings, yield, nutrition, tips, variations,
storage, headings, SEO fields, evidence IDs, URLs, image plans, formatting and
structured data are not exposed for rewriting. Unknown fields are protected too.
The whole candidate object is checked against the canonical object, accepting
only the exact precomputed copy edits. Compact-format JSON-LD descriptions use
the canonical introduction, even when the displayed introductory prose is edited.

`article-generated.json` preserves the recipe writer's initial validated output;
an optional existing correction has its own `article-corrected.json`.
`article-canonical.json` preserves the final writer output before refinement.
`editorial-refinement.json` records the pinned revision, hashes, model, status,
candidate count and accepted IDs. A malformed response, unauthorized change,
failed validation, budget limit or provider failure rejects the edit, records the
reason and retains the original article. Existing uncertain-request accounting
remains in force; no automatic paid retry is added.

The accepted article feeds the saved HTML/Markdown/text, preview and existing
WordPress publishing path. Home & Decor uses the same refinement module for its
preview/ZIP (its direct WordPress publishing is not implemented). Previously saved
articles are not silently rewritten; new generated versions receive the pass.
This is editorial refinement, not guaranteed AI-detector evasion.
