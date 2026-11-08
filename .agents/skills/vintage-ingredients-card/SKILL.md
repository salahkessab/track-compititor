---
name: vintage-ingredients-card
description: Create a Vintage Ingredients Card recipe graphic using the complete saved art direction, exact title and uploaded food photo in a direct OpenAI image edit. Use when the owner requests this style in Recipes / Recipe Designs.
---

# Vintage Ingredients Card

Apply the complete canonical creative prompt in `references/full-prompt.md`. Replace `{{TITLE}}` and `{{INGREDIENTS}}` with the owner's exact title and ingredient lines, including quantities. In the direct workflow, send the owner's food photograph as the first image to OpenAI image edits; optional style references follow it. Ask the model for the complete finished graphic, including the title and every ingredient. Use the app's selected image model, history, cost ledger and explicit paid-call approval. The app exports a 1200 × 1500 PNG and retains the native OpenAI result. Compare the output with the original photo and supplied ingredient list; an AI edit cannot guarantee identical pixels or error-free text. Use the repo's runtime preset `vintage_ingredients_card`; this skill alone does not configure the deployed application.
