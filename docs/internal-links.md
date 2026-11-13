# Recipe Intelligence internal links

Install the downloadable Recipe Intelligence Bridge **1.3.0** ZIP in WordPress (replace the existing bridge). Existing Site Token or Application Password credentials continue to work. No additional WordPress permissions are granted.

Open a saved recipe's **Images & WordPress** details, choose its destination, and select **Suggest internal links**. The first use downloads the site's published-post catalogue; later suggestions refresh it after 24 hours. **Sync articles** forces a full refresh. Choose up to five suggestions and use **Apply selected**, then inspect the preview before preparing a WordPress draft. Applying an empty selection removes the approved links.

The search uses MiniSearch 7.2.0 on the server, with title and category boosts and a shared-topic relevance gate. It makes no OpenAI calls. Exact title matches can be linked in plain prose paragraphs outside ingredients, instructions and recipe cards. Other selections appear under **Related recipes**. A search can return no suitable results. This is a relevance aid, not a Google ranking guarantee.

## Storage and safety

- `internal_catalogue:<connectionId>` in workspace settings stores the published records and serialized MiniSearch index. Connections are identified by their normalized WordPress site URL.
- `internal_links:<itemId>` stores server-generated suggestions, selected post IDs, destination, catalogue revision and the saved HTML's SHA-256. It does not overwrite the article's prose or saved source artifacts.
- Complete pagination must succeed before one atomic settings write replaces the catalogue. Failed refreshes leave the old index intact and surface an error; stale suggestions are not generated after a failed required refresh. The bridge rejects a catalogue revision change during pagination. Maximum catalogue size is 50,000 posts.
- `GET /wp-json/recipe-intelligence/v1/articles?page=N&revision=...` uses the existing scoped authentication. It returns public, published `post` records only, excluding passwords, drafts and private posts; summaries strip shortcodes and HTML. Returned URLs must be HTTPS and within the connected site's origin and path.
- Content or destination changes require new suggestions. A catalogue refresh removes deleted or changed targets from rendered selections. Applying stale suggestions fails. Duplicate URLs and links already present are omitted.
- HTML is constructed by escaping text and validated URLs, never accepting user-supplied HTML. Headings, ingredient lists, instructions and the recipe card are protected.
- HTML previews/downloads, Markdown/text downloads, ZIP exports, clipboard HTML, and WordPress payloads read the same approved selections. Publishing review hashes include the rendered links. Existing publication receipts continue preventing automatic updates or duplicate posts.
- No background publication or edits to already published WordPress posts are performed. Home & Decor is unchanged.

## Verification

`tests/recipe-internal-links.cjs` covers the mocked complete draft workflow, destination isolation, duplicate suppression, target deletion, changed content, failed pagination, failed refresh, plugin upgrades, URL validation and HTML safety. `tests/recipe-internal-links-ui.cjs` covers explicit selection/application, preview and destination changes. Existing WordPress tests cover authentication transport, publication review and idempotency.

MiniSearch's MIT notice is preserved in `third-party-notices/minisearch-MIT.txt` and its installed package.
