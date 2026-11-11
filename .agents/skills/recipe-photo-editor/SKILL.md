---
name: recipe-photo-editor
description: Edit original recipe photographs using Recipe Intelligence's realistic food workflow, with visibly rearranged ingredient layouts, paper labels, and consistent cookware, utensil and surface colors while preserving the food and cooking context.
---

# Recipe photo editor

Read the canonical [photo profile](../../../lib/recipe-intelligence/photoProfile.ts). `PHOTO_INSTRUCTIONS`, `ANALYSIS_INSTRUCTIONS`, `photoPayload` and their version constants control the worker. Keep changes there; do not maintain a second runtime prompt inside this skill.

Review the paired [approved examples](../../../tests/fixtures/approved-recipe-photos/README.md). The pasta remains in its frying pan. The chili sequence retains distinct pale-onion, spiced-onion, clear-broth, chicken-added, creamy and served stages. Never transfer the food into another vessel.

Use the current v3 application profile. Cooking and served photos preserve food, quantities, texture, consistency, stage, vessel category, shape, structural material, handles, utensil shape/function, food arrangement, props and camera angle. Visibly change cookware/bowl, spoon/utensil and surface colors separately, including every relevant panel of a cooking collage. A background change or a different collage grid alone is insufficient. The same recurring objects use consistent colors throughout the recipe.

Material preservation does not mean preserving the old color: a wooden spoon may change wood stain/tone while retaining grain, and a metal utensil may change metallic finish while retaining reflections. Keep clear glass transparent and exposed uncoated metal cooking surfaces metallic. Never replace the vessel or utensil with a different type. Defaults are muted blue cookware, dark walnut utensils and a warm beige surface, all configurable and frozen per recipe.

Ingredient photos preserve every ingredient and preparation group, including separate cheese/bean varieties. Require a visibly different arrangement of the existing containers and their contents: move the main container to a different side/row and exchange other groups so their relative positions and neighbors change. A wider crop, whole-layout shift/rotation/mirror, background recolor or new labels does not count as rearrangement. Keep every container, ingredient and group present; do not combine or split them. Replace floating captions with small paper labels that move with the correct containers. A shared seasoning dish may have one card listing its supported names. Exclude decorative footnotes and asterisks from labels; include confidently identified visible groups even if the original lacks a caption. Uncertain names require review for that photo only.

Use each photo's own original bytes at the Images edit endpoint. Default: Sunburst 2.6, high, 1536 × 864, opaque, auto moderation, no partial previews, omitted complexity. Extend the surface proportionally for landscape framing without stretching food. Preserve other explicit supported settings and never silently switch models.

Original blogger photographs are reference inputs only. They may appear in the clearly labeled original/edited comparison for review, but never as images in the final article, WordPress copy, or recipe-card image fields. Insert only saved generated/edited outputs. If an edit is missing, failed or unreadable, omit it and retain its retry status; never fall back to the original photograph or its source URL.

Use the application workflow: free discovery and deduplication; up to three photos auto-selected, four or more require selection; estimate selected photos plus cached GPT-5.5 high-detail analysis in groups of ten or fewer; explicit job budget approval; independent image stages and targeted retries. Three is a review threshold, not a maximum. An earlier test's spending approval does not authorize a new job.

Save provider receipts before exports. Repair from receipts without a new paid call. Keep uncertain charges reserved. Preserve successful outputs and article text. Use saved approved files and mocked responses for implementation tests, with no paid generation. Increment the application profile version when editing the instructions and retain frozen versions on existing jobs.
