---
name: recipe-article-writer
description: Write or update Recipe Intelligence articles using the user's premium Master Prompt V4, preserved recipe facts, natural American English, private source records, SEO fields and WordPress formatting.
---

# Recipe article writer

Read and follow the complete user-supplied [Master Prompt V4 and mandatory section 18](../../../lib/recipe-intelligence/masterRecipePrompt.ts), preserved in `MASTER_RECIPE_PROMPT` with version `recipe-master-v4`. The application format key remains `master_recipe_v1` for compatibility; it does not identify the prompt revision. The [runtime adapter](../../../lib/recipe-intelligence/prompts.ts) maps that brief to structured fields, and [article-document.ts](../../../lib/recipe-intelligence/article-document.ts) renders the requested headings and complete recipe card. Application jobs execute these definitions; this skill is not a runtime prompt loader.

Use GPT-5.5 and `master_recipe_v1` by default. Prioritize accuracy, usefulness, originality and natural American English over article length. There is no fixed total word count. Follow the master's approximately 80–130-word introduction, ingredient explanations, numbered method, useful tips, serving/storage/variation sections, meaningful optional FAQs, complete recipe card and SEO fields. Omit unhelpful optional sections and forced conclusions. Never pad a short recipe or manufacture FAQs to satisfy a quota.

Use the V4 heading “Ingredients and Why They Work.” Group related ingredient explanations naturally rather than explaining every ingredient separately. Give each section distinct useful information; remove repeated explanations. Keep benefits, tips, variations and FAQs optional. The recipe card may repeat essential ingredients and instructions so it remains independently usable.

Preserve ingredients, quantities, units, temperatures, timings, servings, essential technique and food safety instructions. Keep the authoritative recipe object separate from authored prose. Distinguish source-supported claims from reliable general culinary explanations; do not invent measurements, storage durations, guaranteed substitutions, anecdotes, testimonials or testing claims. Put unresolved source inconsistencies in editorial notes outside the publishable article.

Follow section 18 in every publishable field, including the dish title, headings, SEO metadata, instructions, image labels and recipe-card JSON. Exclude the original author, publisher, competitor branding, source URLs, promotional links, personal stories and distinctive descriptions. Do not automatically append “Recipe source” or `isBasedOn`. Use `articleTitle` for a plain dish name rather than reprinting a branded source title. Never claim to have created or tested the recipe or appropriate another writer's research or discovery. If a claim needs attribution, omit it from the article and keep the attribution concern in private editorial notes rather than stripping necessary credit. Only use source photographs with appropriate rights; original reference files are not publication assets.

Preserve provenance in the local `source.json`, `research-sources.json`, saved request/evidence records and `editorial-notes.txt`. Publishable HTML, Markdown, text, recipe-card JSON and WordPress content do not automatically include those records. A full project/download bundle remains an editorial archive and may contain private research; do not publish that archive wholesale. Keep source facts available for factual verification without exposing their research URL in the article.

The [earlier article sample](../../../tests/fixtures/approved-recipe-photos/approved-article.json) illustrates factual fidelity; its former structure and word target do not override the new master prompt. Its facts belong only to that recipe. Output the application schema when working through the app; the renderer supplies headings, the exact ingredient list inside the recipe card, HTML and Markdown. For standalone writing, follow the master's publication-ready output structure directly.

Use the application import/batch workflow and its explicit cost approval for paid work. Preparation is free. Keep advisory checks non-blocking and allow at most one budgeted correction. Save the article before images. Refresh image placement locally without another writing call. Keep successful articles when an image fails.

When changing the profile, increment its application version, update meaningful tests, and retain old job snapshots. Never depend on personal skill directories or temporary attachment paths at runtime. Store each final request with its job.
