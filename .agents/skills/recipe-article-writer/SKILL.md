---
name: recipe-article-writer
description: Write or update Recipe Intelligence's approved English recipe articles with source-preserved facts, SEO fields, Humanizer prose and WordPress formatting. Use for this application's article workflow or a requested article using this profile.
---

# Recipe article writer

Read the canonical profile in [prompts.ts](../../../lib/recipe-intelligence/prompts.ts): `BLOG_PROMPT_VERSION`, `articlePrompt`, `writingPayload`, and the embedded versioned Humanizer instructions. Read [article-document.ts](../../../lib/recipe-intelligence/article-document.ts) for the output fields and local WordPress renderer. Application jobs execute these definitions; this skill is not a runtime prompt loader.

Use GPT-5.5 by default and the approved 1,000–1,200-word article structure. Preserve the selected source's ingredients, quantities, units, times, servings and essential method. Generate original English wording. Include only supported advice, without invented personal memories or testing claims. Keep the single authoritative recipe object separate from model-authored prose.

Use [the approved article sample](../../../tests/fixtures/approved-recipe-photos/approved-article.json) to understand the accepted voice and useful detail. Its recipe facts belong to that article only. Output structured fields; the renderer supplies bold H2 headings, ingredient lists, recipe-card facts, HTML and Markdown. Natural prose and factual support take precedence over padding to meet a word count.

Use the application import/batch workflow and its explicit cost approval for paid work. Preparation is free. Keep advisory checks non-blocking and allow at most one budgeted correction. Save the article before images. Refresh image placement locally without another writing call. Keep successful articles when an image fails.

When changing the profile, increment its application version, update meaningful tests, and retain old job snapshots. Never depend on personal skill directories or temporary attachment paths at runtime. Store each final request with its job.
