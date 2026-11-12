# Recipe Intelligence article library QA

Date: 2026-11-12

Source visual truth: `C:/Users/pc/AppData/Local/Temp/codex-clipboard-5bec03c9-5250-40c0-8956-1acebf92c4a1.png` (2048 × 895 pixels).

Browser-rendered implementation evidence: `.test-build/library-qa/desktop.jpg` (1265 × 712 pixels); `.test-build/library-qa/mobile.jpg` (390 × 844 CSS viewport). Screenshots are local verification artifacts, not production content.

State: isolated local Next.js preview with 25 mock article rows and saved approved recipe photo fixtures. API requests were intercepted by a local mock server; no live generation or spending approval occurred.

## Comparison

Source and desktop screenshot were viewed together. This implements the reference's article-list hierarchy, not a pixel-for-pixel clone: the existing dark/gold theme and navigation are retained. CSS viewport sizes were compared at their native sizes, without stretching or equalizing pixel dimensions. The screenshot source does not supply device-pixel-ratio metadata.

- Typography: article titles use the existing readable sans-serif UI face, semibold weight and natural wrapping; the app heading retains its existing serif face. Unlike the source, long titles wrap rather than truncate.
- Layout: repeated horizontal rows replace the batch dropdown as the primary view. Each desktop row contains title/state, original thumbnails, generated thumbnails, and cost/action. Rows are taller than the source to fit both image groups and explicit spending information. On a phone, those groups stack with no hidden primary action or horizontal overflow observed.
- Color: existing charcoal surfaces, subdued borders, light text, gold primary buttons, and green completion states are intentional adaptations. Focus rings and labels remain visible.
- Images: original and generated photographs use actual approved test assets with deliberate thumbnail crops. Originals are explicitly labeled reference-only. No source platform food posters or branding are copied. Full images remain available through article details and output links.
- Copy: one primary approval button per ready article; estimated cost and maximum approved spend are distinct. Completed rows show actual item-specific spend. Advanced budget and batch controls are closed initially.

## Interaction checks

- Pagination changed from page 1 to page 2 and disabled Next on the final page.
- Searching Rigatoni returned four matching rows and reset pagination to page 1.
- Mock approval changed only the chosen row to running; other rows retained their approval buttons.
- Opening a completed article exposed its existing article/download/gallery actions and Skip this photo controls.
- Desktop and 390-pixel mobile layouts inspected in the browser.
- Browser console error inspection returned no errors.
- Automated regression coverage checks item-level budget isolation, stale estimates, rollback, references/output previews and exact approval payloads.

## Findings and iteration history

No actionable P0/P1/P2 visual findings remain. Initial mobile lazy-loaded thumbnails finished loading on interaction and all three were visible on the subsequent screenshot. Generated format variants were deduplicated for legacy jobs during implementation review.

Focused-region comparison used the article rows and spending action within the full-view images; an additional crop was unnecessary because text and thumbnails were readable.

P3 follow-up: optional adjustable row density for very large libraries. Not required for this simplified workflow.

Final result: passed
