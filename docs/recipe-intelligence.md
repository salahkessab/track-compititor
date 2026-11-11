# Recipe Intelligence

Recipe Intelligence runs inside the existing studio with a local SQLite database and a separate worker. It tracks up to ten websites, discovers URLs on request, verifies historical publication dates, and creates English article and image drafts in batches of up to twenty recipes. It has no scheduled monitoring or automatic publishing.

## Start and stop on Windows

1. Install Node.js 24 LTS with npm if needed.
2. Double-click **Start Recipe Intelligence.cmd** in the application folder.
3. Choose a writable local folder. The suggestion is `RecipeAutomation` inside Windows Documents. Paths with spaces and other local drives are supported. The live database cannot use network shares or mapped network drives.
4. Wait for the first build. The launcher prepares dependencies, compiles the worker, starts Next.js on an available `127.0.0.1` port, and opens the browser. Later launches reuse a healthy instance and rebuild when application inputs change.
5. Open **Add a website** in **Tracked websites**, then request a scan or open **Find recipes**. Website maintenance and older scans are under their details sections.

**Stop Recipe Intelligence.cmd** stops only this launcher's application and worker. Closing the browser leaves work running. No administrator rights, service, startup entry, or scheduled task are needed. Paused work stays paused after restart.

The native folder picker is compiled once using the installed .NET Framework. The selected folder and preferred port are saved under `%LOCALAPPDATA%\RecipeIntelligence`. To choose another workspace, stop the application and double-click **Choose Recipe Storage.cmd**. Existing files remain in the previous folder; folders are not merged automatically.

If the studio has `APP_PASSWORD` configured, its existing login remains in effect. Open the local workspace through the launcher to establish its separate local API session. The previous port is reused when available. Browser-local histories remain tied to their original browser origin if a port changes. SQLite history belongs to the selected folder.

## Discover and search

Manual discovery checks robots directives, advertised sitemaps, homepage feed/API links, and common feed/sitemap URLs. It supports RSS, Atom, sitemap indexes, compressed sitemaps, and advertised XML pagination. Source errors are independent. Pausing a website stops its discovery and report inspection work. Archiving requires confirmation and preserves history and existing content drafts.

In **Find recipes**, select active websites and an inclusive date range. Active sites and the last seven reporting days are initially selected; nothing runs until **Start historical search** is pressed. **Today**, **Last 7 days**, and **Last 30 days** only change the date fields. The default timezone is Africa/Casablanca. Previously verified matches appear immediately. Advertised public WordPress date filters and matching feed hints prioritize candidates, followed by remaining article URLs. Article evidence determines membership.

Each result retains raw publication evidence, precision, classification reason, and verification time. Date-only values stay date-only. Known instants are stored in UTC with their original offset. Modification, sitemap modification, discovery, and publication remain separate. Reissued feed dates and updated articles do not turn old recipes into new publications. Missing or conflicting original dates are excluded from verified totals.

Reports save progress in SQLite and display matches progressively. Select verified recipes while indexing continues. **Pause deeper indexing** retains pending work; **Continue / resume indexing** checks the remaining index. A report pauses after 250 inspected pages per segment; discovery pauses after 500 sources per segment. Results use pages of 100 rows. The JSON download contains all verified members available at export time.

“Available sources processed” describes the queue, not complete historical coverage. Feeds can be recent-only, sources can be restricted, and pages can lack structured recipe/publication evidence. Coverage notes remain visible after processing ends. A fresh search requests discovery again; a resumed report inspects remaining checkpoints and newly available index records.

## Write articles and create images

1. Select up to twenty verified recipes. Choose **Keep original recipe** or **Choose best complete recipe** for each one. Original is the initial default. Independent research is off for original recipes unless explicitly enabled.
2. Choose the output and automation. The current defaults are summarized below. **Advanced options** contains the article style, models, quality, complexity and other supported controls; **Photo colors** contains the recipe palette. **WordPress blog: 1,000–1,200 words** is the default for new batches; **Compact recipe** remains available. Optional alternative source URLs avoid a paid web-search request. Settings are copied into the batch.
3. Click **Prepare batch estimate**, inspect the estimate, and set a USD spending limit.
4. Click **Approve … limit**. The application first reads current official model/pricing documentation and free account model metadata. It makes no generation probe and never silently substitutes models or quality. Once approved, budget changes move under **Change spending limit**; cost approval remains prominent when additional budget or a changed photo selection needs approval.
5. Follow progress in **My articles**. Articles save before images start. Each successful image is then embedded in the saved HTML, so the download and sandboxed preview show completed photographs without external files. Preview, WordPress copy, article download, and a complete ZIP are at the top of each result. Edited photos appear below; originals are available only through **Compare with originals**. Markdown, plain text, prompts and JSON are under **Other formats, prompts and recipe data**. Connect your sites in **Settings → WordPress websites**, then choose a destination beside an article and use **Upload images and copy** to save its edited images in that site's Media Library before pasting. See the [WordPress connection guide](wordpress-export.md). Publishing and selecting the featured image remain manual actions in WordPress.

| Automation | Review point |
| --- | --- |
| Full automatic | Only ambiguous source selection or an essential/technical blocker |
| Review before articles | Extracted recipe and enabled research, before writing |
| Review before images | Saved article, before generating images |

Best-source selection compares dish identity, complete ingredients/method, and explicit timing/yield evidence. It chooses one complete source and records its reason, without numeric scores or judging agents. It never blends conflicting recipes. If complete sources have no clear advantage, only that recipe waits for review.

The versioned [writing prompt](../lib/recipe-intelligence/prompts.ts) embeds adapted Humanizer v3 instructions. It does not depend on an installed skill path or add a paid stage. Authoritative ingredients and recipe-card facts are rendered locally. Straightforward formatting, numeric, unit, and cooking-method discrepancies are corrected locally where possible. One optional AI correction may run inside the approved budget. Unresolved minor issues are warnings. Unsupported tips, storage claims, nutrition, experiences, and citations are omitted.

The blog template adapts the supplied recipe-blogger brief: introduction, reasons to make the recipe, ingredients, prep/cook time, numbered method, variations, serving ideas, storage/reheating, pro tips, FAQs, and a short closing. It requests warm sensory prose, natural SEO, and original wording. The recipe title supplies the focus keyword; related terms come from the dish. Platform placeholders such as `{title}` and `{ingredients}` require no manual entry. The article uses “and” in newly written prose.

Optional guidance is extracted from relevant sections of the selected source page and supplied as evidence for the writer. Older verified records may refresh that page before writing; captured ingredients, method, servings, and exact times must match before extra guidance is accepted. This is a free source fetch, not independent research. Missing support means an optional section can be omitted. Personal anecdotes, nutritional values, substitutions, or storage claims must not be invented to fill the template. Evidence references support review but do not guarantee that every generated sentence is correct.

The displayed word count includes the rendered title, headings, ingredients, method, and supported article sections, excluding the source footer. The 1,000–1,200-word range is an advisory target. One optional correction can address a short article within the approved budget; there is no regeneration loop or filler requirement. Already-created batches retain their captured article style, and saved articles and images are not automatically regenerated after a template update. To use the new style, prepare a new batch. Rich-text copying requires browser clipboard support; otherwise the app offers plain text and the HTML download.

Writing uses the verified GPT-5.4 Mini profile. Existing studio text/image models remain available in their original tools. Recipe Intelligence supports Image 2.6 Sunburst and Flare, with separate rendering quality and complexity. Default complexity omits the parameter. The first approved production image confirms generation compatibility and is retained.

Featured and alternative photographs export at **1200 × 1500**; Pinterest exports at **1000 × 1500**. Sharp validates, rotates, and proportionally resizes native output with a centered crop. Prompts keep the plated food inside a safe composition area. Optional Pinterest text is drawn locally. Source photos are not submitted for copying. Finished exports are JPEG; the native-format control selects the provider response format.

## Spending and recovery

Set `OPENAI_API_KEY` in the application's `.env.local` file and restart the launcher for paid content work. Keys stay in server processes. Discovery and reports work without a key and never call an AI provider even when a key exists.

Quotes use documented model-specific rates and the Image 2.6 calculator formula. Known-source estimates use the actual request payload size, with an allowance for a possible correction draft. Unknown research results retain a conservative input allowance. Text input is estimated separately. The ledger records reservations before dispatch, request hashes, provider identifiers, reported usage, and costs calculated from usage. Paid calls have no automatic retries. Reservations are conservative scheduling allowances; the provider has no exact image dollar cap, so one request's usage can exceed its estimate. New calls stop when the remaining approved budget cannot cover their reservation.

Unknown outcomes retain their reservation while other recipes continue within the remaining budget. Check the provider's billing records before recording a confirmed charge; enter zero only if no charge is confirmed. Reconciliation does not repeat the request. Request any targeted retry separately. Missing usage also retains its reservation while preserving a successful output.

Provider receipts save before rendering or resizing. Interrupted local saves reuse receipts without another paid call, including after an application or prompt update. **Retry this stage** reuses a saved response. **Repair saved article files** and **Repair saved image** perform local work only. **Generate replacement within approved budget** explicitly authorizes a new article/image request and creates another version directory. Article regeneration reuses successful images; image retries do not rewrite articles. Corrections are limited to one attempt per article version.

The root contains `database`, `reports`, `research`, `articles`, `images`, `exports`, `backups`, and `logs`. Recipe bundles live in `articles/<item-id>/v<version>/` and contain:

- `article.html`, `article.md`, `article.txt`, `recipe.json`, `seo.json`
- `source.json`, `research-sources.json`
- Successful `featured.jpg`, `alternate.jpg`, `pinterest.jpg`
- `manifest.json`, including file hashes and stage status

Writes use temporary files and atomic renames. Downloads verify checksums. SQLite uses foreign keys, WAL, short transactions, and backups before schema upgrades. Settings includes backup and integrity controls. Keep the live database on a local drive; copy completed backups for off-device storage.

## Free disk space after generation

In **My articles**, open a finished recipe and choose **Delete from computer**. The confirmation shows the space it will free. **Delete permanently** removes that recipe from the library and deletes its articles, generated images, all older versions, saved generation requests/responses, and unused imported originals from the selected storage folder. This cannot be undone; download anything you want to keep first.

Original photos still used by another saved recipe are kept until its last generation is deleted. Separate downloads, backups, tracked-site history and WordPress uploads are not removed. A small billing record remains so deletion cannot erase recorded or uncertain charges. Active generation cannot be deleted; cancel pending work or wait for it to finish. If a file is locked, close it and use **Retry deletion**; this never restarts generation.

## Source and runtime limits

Public requests serialize per domain with at least two seconds spacing, at most three concurrent requests, and stricter robots delays when advertised. Requests validate public DNS results and redirects and enforce time, size, and decompression limits. XML external entities and DTDs are rejected. Pagination/redirect loops record errors. Login, CAPTCHA, paywall, and anti-bot restrictions are not bypassed.

Recipe extraction prefers relevant Recipe JSON-LD and also supports one article with clearly labelled ingredient lists and ordered cooking steps. The HTML fallback preserves ingredient groups, quantities and method text. It copies explicit recipe-body duration and serving labels. A single approximate duration label can be displayed as approximate in the blog article; it is never converted into an exact JSON-LD time. Conflicting optional durations remain absent with an advisory note. Related Article JSON-LD and explicit publication metadata can verify the publication date. Feed dates alone cannot. JavaScript-only pages, image-only cards, ambiguous collections, or missing essential facts need another accessible source. Some websites expose no historical API or archive. Processing completion never claims complete archive coverage.

The local API requires a launcher session, exact loopback host, matching mutation origin, and CSRF header. Storage paths stay within the selected root. Previews are escaped and sandboxed. Hosted builds/requests never open SQLite. No cloud database, Redis, multi-agent service, scheduled monitoring, or automatic publishing was added.

See the [verification record](recipe-intelligence-verification.md) for test results and observed model access.
