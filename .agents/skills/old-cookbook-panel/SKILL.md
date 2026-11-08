---
name: old-cookbook-panel
description: Create a Old Cookbook Panel recipe graphic using the complete saved art direction, exact title and uploaded food photo in a direct OpenAI image edit. Use when the owner requests this style in Recipes / Recipe Designs.
---

# Old Cookbook Panel

Apply the complete canonical creative prompt in `references/full-prompt.md`. Replace `{{TITLE}}` with the exact owner-supplied recipe title. In the direct workflow, send the owner's food photograph as the first image to OpenAI image edits; optional style references follow it. Ask the model for the complete finished graphic, including the exact title. Use the app's selected image model, history, cost ledger and explicit paid-call approval. The app exports a 1200 × 1500 PNG and retains the native OpenAI result. Review the output against the original photo because an AI edit cannot guarantee identical pixels. Use the repo's runtime preset `old_cookbook_panel`; this skill alone does not configure the deployed application.
