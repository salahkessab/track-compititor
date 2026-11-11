# Recipe Intelligence: approved writing and reference-photo workflow

Open the local application with **Start Recipe Intelligence.cmd**, then choose **Use a recipe URL**.

1. Enter a recipe URL and choose **Prepare URL (free)**, or choose **Start with uploaded photographs**. Preparations are saved and resumable. Uploads alone support images only; writing requires a recipe URL with usable recipe facts.
2. Inspect the original-photo gallery. One to three usable photos are selected automatically. Four or more start unchecked. Select any desired number up to the bounded 80-photo preparation limit and save the selection.
3. Choose article and images, article only, or images only. Reference editing is the default. If there are no usable references, add uploads, use article only, or explicitly select the existing three-output text-image workflow.
4. Choose the output and automation. Open **Advanced options** only to change models and other generation controls, or **Photo colors** to change the palette. Defaults are GPT-5.5 for writing/understanding and Sunburst 2.6, high, 1536 × 864, opaque, auto moderation, no partial previews, default/omitted complexity. Blue cookware, dark walnut spoons/utensils and a beige surface are saved with the recipe. Use the three color controls or **Reset photo palette**. Wood retains its grain while its tone changes; metal utensils retain metallic reflections while their finish changes. Glass remains transparent.
5. Prepare the estimate. Review the selected count, per-stage estimate and spending reservation. Explicitly approve this job's limit. Earlier test budgets are never reused.
6. Open **My articles** and choose the recipe from **Saved work**. Articles save before images. Preview, Copy for WordPress, Download article, and Download all (ZIP) appear above the gallery. The gallery shows edited outputs; **Compare with originals** reveals the reference photographs. JPEG/PNG downloads stay beside each photo. Other formats and prompts, processing/repair controls, and billing details are collapsed until needed. Failed steps and context reviews remain visible.

Historical reports in **Find recipes** still support selecting up to 20 recipes and per-recipe source choices. New reference jobs use the same import/photo-selection system. A waiting selection or unclear photo affects only that recipe/photo. If research chooses a different source, its photos must be prepared and selected, followed by a refreshed estimate and approval.

The three automation modes remain available. A source change cannot bypass Review Before Articles. Review Before Images saves the article first. Full Automatic still requires photo selection when more than three photos are discovered.

## Instructions and snapshots

Canonical writing instructions, structured fields and the adapted Humanizer profile live in `lib/recipe-intelligence/prompts.ts`; the renderer lives in `article-document.ts`. Canonical photo-editing and high-detail understanding instructions live in `photoProfile.ts`. The two project skills in `.agents/skills/` point to these definitions and the saved examples in `tests/fixtures/approved-recipe-photos/`.

Every new item saves profile versions, instructions, writing request, selected originals, hashes, palette and estimate. Final dispatched requests are saved under `research/requests`. Provider receipts are saved under `research/api-receipts` before image conversion or article file processing. ZIP prompts omit inline base64 for readability; original reference bytes remain in local storage.

Photo understanding is one cached GPT-5.5 pass in groups of at most ten selected originals, with explicit high-detail input. It identifies ingredients, labels, vessel, cooking stage and supported article placement. It does not score quality. Images with unclear context wait for a targeted context review. Unmapped images go in a separate gallery.

Photo profile v3 requires a visibly new ingredient-container layout, with changes to relative positions and neighboring groups. A recolored surface, crop or whole-layout shift is insufficient. Containers keep their contents, and paper labels follow the corresponding containers. Cooking and served photos retain food arrangement, stage, vessel/utensil type and camera angle; cookware, spoon and surface color changes apply to every relevant collage panel, including spoon close-ups. Analysis profile v2 describes original container positions and all recurring utensils, and excludes decorative footnotes from ingredient labels. These requirements run within the existing analysis and edit calls, without another paid checking stage. Frozen v2 jobs and their existing outputs keep their original instructions and two-color palette.

## Recovery and compatibility

Migration 4 uses SQLite's backup API before rebuilding the content-item table to allow imports independently of historical recipe records. Foreign keys are checked before commit. Old batch settings and their three-image stages remain intact. Imports never become verified publications and never create tracked websites.

Disk/export failures reuse saved receipts. An unknown paid outcome keeps its reservation and is not repeated automatically. Retrying one image keeps the article and other images. A changed photo selection before approval invalidates the quote; refresh the estimate before approving. Jobs already approved keep their saved selection. Pending items added to an approved batch require approval of the refreshed estimate.

Original photographs are reference inputs and are shown only in the labeled original/edited comparison for review. Article HTML, Markdown, WordPress copy and recipe-card image fields use saved generated/edited outputs only. A missing, failed or unreadable edit is omitted from the article; the original file or source URL is never substituted. The downloadable comparison gallery is a review artifact, separate from the publishable article.

Reference downloads use the same public-address, redirect, robots and per-domain rate checks as discovery. Uploads are limited to still JPEG, PNG or WebP, 10 MB and 40 megapixels each. Paths and checksums are checked before reading. Authenticated local API routes retain the existing loopback and CSRF protection. Hosted builds open no SQLite database.

Discovery is bounded to 80 candidates per recipe and uses identifiable article containers and metadata. Unusual page layouts, inaccessible CDN images, ambiguous ingredient names and visually different near-duplicates may need manual selection or uploads. Responsive variants and byte-identical or decoded-pixel-identical copies are grouped; unrelated visual similarity is not guessed. ZIP downloads are limited to 250 MB; larger jobs retain individual downloads.

## Verification

Run `npm test`, `npx tsc --noEmit`, and `npm run build`. The Windows launcher prepares the separate local build. Tests use the saved approved images and mocked provider responses, including actual multipart reference delivery, source changes, chunked understanding, review isolation, migration, frozen prompts, receipt reuse, and uncertain outcomes. No paid generation is required for verification.

Implementation verification on November 10, 2026: 201 tests passed; TypeScript, hosted production build and local production build passed. `node scripts/smoke-recipe-intelligence.cjs` passed against an isolated Windows local folder, verifying saved imports, folder reuse, duplicate-worker prevention and controlled shutdown with zero paid calls. The ZIP was also read successfully using Windows' ZIP reader.

Photo-profile v3 update verification on November 10, 2026: all 203 tests passed, including three-color UI submission, legacy palette validation, frozen v2 requests, restart persistence and receipt reuse. TypeScript, both production builds, skill validation and the isolated Windows launcher smoke test passed. The restarted local app serves the spoon/utensil control and the worker is online. All seven existing batches and 48 API ledger entries were unchanged. No new paid calls or image regenerations were made; visual results from the revised prompt require a future approved image job.

The existing workspace was backed up and migrated to schema 4. All six original batches, six content items, 77 stages, 38 API ledger entries and 70 artifact records were unchanged when compared using their pre-migration columns. All 70 saved artifact file checksums matched. The updated app and worker restarted successfully, without new paid API calls.
