# Recipe Intelligence Capture 2.9.1

In a manual draft, **Add all article photos** collects the photos detected in the open article in one click. Review the selected photos before importing. Rescanning reuses existing photos. The capture reports incomplete loading and the existing 80-photo discovery limit.

Capture a recipe or Home & Decor article and its photographs from the page you have open in Chrome, including pages that reject the app's server-side URL fetch.

Right-click selected article text or a photo on a public page and choose **Add selected text to article draft** or **Add image to article draft**. Choose an existing section or create a heading, then click **Add to draft**. Further selections on that article open the same editor. You can also paste paragraphs or a public photo URL. To supplement an automatic capture, choose **Add text or photos manually** in its review first. Manual drafts are saved per article in this browser. Select Recipes or Home & Decor before sending the reviewed draft to the app.

Version 2.8.0 adds reviewed multipart drafts, highlighted boundaries, per-site range preferences and measured photo dimensions. Save a draft before opening another page, then use Add part / rescan to review and apply the changes. One draft per website is retained in this browser.

Version 2.7.1 reads deferred picture sources and full-size photo links. If an image fails, choose a saved copy for that specific photo in the import notes.

Version 2.7.0 retains each photo's source heading and shows it in the capture preview. Home & Decor stores stable section identities and keeps text-only sections when photos are unchecked. Review the linked heading below each reference; uploaded or older references without a source association can be assigned there. Generated-image removal affects only that image in the article preview and ZIP, preserves all prose and other placements, and can be undone without generation. Output placement is validated by identity, not the remaining photo count. The writing model still evaluates visual relevance; an uncertain reference must be excluded rather than assigned to a different topic. This is not a guarantee of perfect visual understanding.

Version 2.6.0 added bounded lazy-photo scrolling, verification-page detection, previews in pages of 12, and up to 80 reference candidates. It stops before finalizing an import with missing selected photos: **Retry missing photos** reuses acknowledged uploads; **Continue with saved photos** explicitly accepts the missing photos. Truncated text, discovery limits, incomplete loading and converted/displayed image copies are reported. Update the backend as well as the extension; an older backend is refused before data transfer.

Version 2.5.0 added **Save article to → Home & Decor**. The connected app's Home & Decor tab selects this destination automatically for a new capture; you can change it before saving. Decor imports use the decor article reader, never recipe ingredient validation. Select photos and room groups and review the estimate in Home & Decor before approving generation. Interrupted imports retain their original destination. If a decor article was previously submitted as a recipe, start a fresh capture and choose Home & Decor. Automatic classification and other article-writing niches are not part of this update.

Version 2.4.1 saves captures for review without switching you to the app. It remembers the connected app address and storage folder, shows connection status before importing, and can reopen a closed app tab. A changed launcher port is detected from an open app tab for the same workspace. Captures are saved before connecting, so an offline app does not lose the pending import. The recipe photo filters and saved generation history are unchanged.

**Review My articles** brings the local app's Chrome window to the front and restores it if minimized. The Generate button is in that local app, where each article starts only when you click Generate.

## Install once

Download the ZIP from **Settings → Chrome extension**, or use this repository folder directly.

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder (the folder containing `manifest.json`). If using the ZIP, extract it first.
3. Pin **Recipe Intelligence Capture** from Chrome's Extensions menu. Disable the older Article Rewriter Studio extension if you no longer need it.
4. Open **Recipe Intelligence** with the desktop shortcut in the same Chrome profile. Click the extension while on the local app page to connect. It remembers the workspace without capturing that page.

After updating files in this folder, click **Reload** on the extension's card and close old capture tabs before starting a new capture.

Chrome uses the exact folder selected during **Load unpacked**, which may be a Desktop or Downloads copy rather than this repository. Replace files in that installed folder, then reload the extension. A fresh capture should show **Capture v2.8.0** at the top. Old capture tabs and resumed imports keep their previously captured photos and destination. The download contains flat icon paths; replace the complete package, including its manifest, when updating a ZIP installation.

## Use

1. Open the article in Chrome. If the website shows a verification screen, complete it normally until the article is visible.
2. Click **Recipe Intelligence Capture** in the toolbar. A capture preview opens in a separate tab. The original article scrolls automatically for up to 20 seconds / 72 steps, then returns to its starting position. No page controls are clicked. If verification is detected, use the original tab to complete it and press **Capture page again**.
3. Choose **Recipes · My articles** or **Home & Decor** in **Save article to**, then click Save. All discovered photos are selected; optionally uncheck any you do not want.
4. Keep the capture tab open until it finishes. If photos fail, retry the missing photos after they become readable in the source tab, or explicitly continue with the successfully saved photos. The capture ID and successful uploads are retained. No generation starts and no app switch occurs automatically.
5. When you finish collecting, click **Review My articles** or **Review Home & Decor**. Decor opens the specific captured article so you can choose photos and room groups, review its estimate, and approve generation.
6. Below $2.50 maximum expected spend, Generate starts that article directly. If the estimate or reserved maximum reaches $2.50, the app shows the cost and asks before starting. Existing budget enforcement remains active; a changed or expired quote must be reviewed again.

No AI requests or charges occur during capture or import. The extension never approves a generation job.

If the app disconnects, reopen it with the desktop shortcut and click **Reconnect**, then **Resume saving**. After closing a capture tab, open the extension again and choose **Resume previous import**. Only the last submitted capture is stored for recovery, including an import submitted while offline. Repeating an interrupted import uses the same capture ID, reuses its saved article, and skips photos already acknowledged by the app. A completed capture keeps its estimate ID; **Review My articles** does not create another job or approve spending.

## What is captured

- The main readable article, its title and source URL, recipe metadata, ingredients, instructions, and supported article context such as storage and serving guidance.
- Up to 80 article-photo candidates, including lazy image URLs, multiple responsive variants and recipe metadata images. Reaching the 80-candidate or 2,500-image inspection limit is reported; it is not a claim to have captured the whole site. The preview shows 12 at a time, independently of the selected import count. Home & Decor still allows at most 12 photos per paid generation. Related posts, navigation, forms, comments, scripts and obvious advertisements are excluded.
- Actual image files, not just remote links. Each image is limited to 10 MB and 40 megapixels, with a minimum size of 160 × 120. Browser-readable formats such as AVIF are converted to JPEG when needed.
- Preview and import use the same recovered image bytes. A 24 MB encoded-image cache and paged previews bound retained image data. Normal downloads are preferred, then same-origin requests from the original page, then already displayed pixels where Chrome allows canvas access. Download attempts have bounded timeouts. Converted or displayed copies are labeled, and their count is retained in the import notes; these are not claimed to be original files.
- Black or transparent loading placeholders are rejected. If a photo is unavailable, leave the article tab open, scroll to that photograph and let it finish loading, then use **Retry missing photos**. A lazy `data-src` alone never proves its pixels have loaded.
- Text extraction has character, node and depth limits; reaching them is reported. Home & Decor retains at most 40,000 characters and reports when more text was available. Successful image transfer alone does not mean the complete article was captured.

Recipes store plain article text and structured recipe facts under `research/browser/`, with photos under `research/references/`. Home & Decor stores its own article record and references under `articles/home-decor/`. The app validates files and groups exact duplicates. An article without readable ingredients and instructions cannot receive a recipe-writing estimate; choose Home & Decor for decor articles.

A webpage must be readable in Chrome. The extension does not solve access challenges or retrieve hidden/paywalled content. No universal success rate is promised. Failed photos are listed and retained for retry; a partial import requires explicit acceptance before an estimate. With no usable source photos, an explicitly continued recipe import may receive the normal text-based image estimate, which still requires generation approval in the app.

## Connection and permissions

The extension connects to authenticated Recipe Intelligence tabs on HTTPS or `http://127.0.0.1`. Open the cloud app with `?tab=recipe-intelligence`, click the extension, or enter the exact app address in Connection settings. It does not probe unrelated HTTPS tabs. No API key or copied launcher token is needed. It stores only the verified app origin and workspace identity. Queries, fragments, launch tokens and credentials are never saved as connection settings. If multiple workspaces are open without a remembered match, choose the intended destination. An interrupted capture remains bound to its original workspace.

**Connection settings** also accepts the local app address shown inside Recipe Intelligence. The extension can reopen a remembered app tab while the local application is running. If the application is stopped or the browser session expires, start it with the Windows shortcut in the same Chrome profile. Chrome cannot start the Windows worker through this extension. A changed port can be recovered after the launcher opens the app at its new address.

The Vercel studio can supply the extension download and setup instructions, but does not run the persistent worker. A configured HTTPS server workspace (including the InstaBox deployment) supports capture imports directly and works without the Windows worker. Open the intended workspace before connecting the extension.

HTTP/HTTPS host access allows photographs to be fetched from the page's image CDN and lets the extension find the local app. There are no automatically running content scripts, remote executable scripts, analytics, third-party upload services, cookie permissions or externally callable extension endpoints. Direct photo downloads omit credentials and reject redirects. If a same-origin photo fails, version 2.4.1 can retry its listed URL from the unchanged recipe tab using normal same-origin browser credentials. Cookies are never read or transferred to the app. Access denials, redirects, cross-origin page requests and oversized responses remain blocked. A fallback may copy an already rendered image only when Chrome permits canvas access.

The local connection uses an isolated script in the app tab and its existing HttpOnly session. The app's exact-origin and CSRF checks remain enabled; no permissive CORS rule is added. Browser captures stay outside the URL-fetch queue and cannot be estimated before the import finishes.

Chrome documentation: [script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting), [cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests). A foreground extension tab performs the transfer so closing a small toolbar popup cannot interrupt it.

## Development checks

From the repository root, run `npm test`. Capture tests cover sanitized DOM extraction, JSON-LD and plain HTML recipes, source URL validation, bounded downloads, authenticated transfer of actual image bytes, incomplete imports, recovery, duplicate handling, cost estimates, UI progress and the absence of paid calls before approval. Connection tests cover closed tabs, changed ports, ambiguous workspaces, expired sessions, offline captures and secret-free settings. Package tests verify every required file and icon in the downloadable ZIP. The extension needs no build step or external dependencies.

The connection flow takes inspiration from the owner's [Article Rewriter Studio extension](https://github.com/salahkessab/rewrite-articles-flippa/tree/main/extension): remember the app, reuse its tab, retain a handoff until receipt, and open the exact destination. This implementation retains Recipe Intelligence's authenticated local API and idempotent import receipts instead of adding an all-pages message bridge.
