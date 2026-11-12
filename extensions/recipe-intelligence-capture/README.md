# Recipe Intelligence Capture 2.1.0

Capture a recipe article and its photographs from the page you have open in Chrome, including pages that reject the app's server-side URL fetch.

Version 2.1.0 remembers the connected app address and storage folder, shows connection status before importing, and can reopen a closed app tab. A changed launcher port is detected from an open app tab for the same workspace. Captures are saved before connecting, so an offline app does not lose the pending import. The recipe photo filters and saved generation history are unchanged.

**Open generation screen** brings the local app's Chrome window to the front and restores it if minimized. The Generate button is in that local app, where the estimate is approved.

## Install once

Download the ZIP from **Recipe Intelligence → Use a recipe URL → Capture recipes with the Chrome extension**, or use this repository folder directly.

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder (the folder containing `manifest.json`). If using the ZIP, extract it first.
3. Pin **Recipe Intelligence Capture** from Chrome's Extensions menu. Disable the older Article Rewriter Studio extension if you no longer need it.
4. Open **Recipe Intelligence** with the desktop shortcut in the same Chrome profile. Click the extension while on the local app page to connect. It remembers the workspace without capturing that page.

After updating files in this folder, click **Reload** on the extension's card and close old capture tabs before starting a new capture.

Chrome uses the exact folder selected during **Load unpacked**, which may be a Desktop or Downloads copy rather than this repository. Replace files in that installed folder, then reload the extension. A fresh capture should show **Capture v2.1.0** at the top. Old capture tabs and resumed imports keep their previously captured photos. The download contains flat icon paths; replace the complete package, including its manifest, when updating a ZIP installation.

## Use

1. Open the recipe in Chrome and wait for its article and images to appear. Scrolling through the recipe can load lazy photographs.
2. Click **Recipe Intelligence Capture** in the toolbar. A capture preview opens in a separate tab.
3. Click **Import and see estimate**. All discovered photos are selected; optionally uncheck any you do not want.
4. Keep the capture tab open until it finishes. Your local app opens the estimate for this exact recipe.
5. Review the cost and click **Generate article + images** in the app when ready.

No AI requests or charges occur during capture or import. The extension never approves a generation job.

If the app disconnects, reopen it with the desktop shortcut and click **Reconnect**, then **Resume import and see estimate**. After closing a capture tab, open the extension again and choose **Resume previous import**. Only the last submitted capture is stored for recovery, including an import submitted while offline. Repeating an interrupted import uses the same capture ID, reuses its saved article, and skips photos already acknowledged by the app. A completed capture keeps its estimate ID; **Open generation screen** does not create another job or approve spending.

## What is captured

- The main readable article, its title and source URL, recipe metadata, ingredients, instructions, and supported article context such as storage and serving guidance.
- Up to 24 article photos, including loaded/lazy image URLs and recipe metadata images. Related posts, navigation, forms, comments, scripts and obvious advertisements are excluded.
- Actual image files, not just remote links. Each image is limited to 10 MB and 40 megapixels, with a minimum size of 160 × 120. Browser-readable formats such as AVIF are converted to JPEG when needed.

The local app stores plain article text and structured recipe facts under `research/browser/` in its selected storage folder. Photos go under `research/references/`. The local app validates files and groups exact duplicates. The app currently generates recipe articles; an article without readable ingredients and instructions can be captured but cannot receive a recipe-writing estimate.

A webpage must be readable in Chrome. The extension does not solve access challenges or retrieve hidden/paywalled content. Some images may still be unavailable. Failed photos are listed; the successfully captured article and images are retained. With no usable source photos, the normal app estimate can include three newly generated images from the recipe facts.

## Connection and permissions

The extension connects to authenticated Recipe Intelligence tabs on HTTPS or `http://127.0.0.1`. Open the cloud app with `?tab=recipe-intelligence`, click the extension, or enter the exact app address in Connection settings. It does not probe unrelated HTTPS tabs. No API key or copied launcher token is needed. It stores only the verified app origin and workspace identity. Queries, fragments, launch tokens and credentials are never saved as connection settings. If multiple workspaces are open without a remembered match, choose the intended destination. An interrupted capture remains bound to its original workspace.

**Connection settings** also accepts the local app address shown inside Recipe Intelligence. The extension can reopen a remembered app tab while the local application is running. If the application is stopped or the browser session expires, start it with the Windows shortcut in the same Chrome profile. Chrome cannot start the Windows worker through this extension. A changed port can be recovered after the launcher opens the app at its new address.

The Vercel studio can supply the extension download and setup instructions, but does not run the persistent worker. A configured HTTPS server workspace (including the InstaBox deployment) supports capture imports directly and works without the Windows worker. Open the intended workspace before connecting the extension.

HTTP/HTTPS host access allows photographs to be fetched from the page's image CDN and lets the extension find the local app. There are no automatically running content scripts, remote executable scripts, analytics, third-party upload services, cookie permissions or externally callable extension endpoints. Direct photo downloads omit credentials and reject redirects. A fallback may copy an already rendered image only when Chrome permits canvas access.

The local connection uses an isolated script in the app tab and its existing HttpOnly session. The app's exact-origin and CSRF checks remain enabled; no permissive CORS rule is added. Browser captures stay outside the URL-fetch queue and cannot be estimated before the import finishes.

Chrome documentation: [script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting), [cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests). A foreground extension tab performs the transfer so closing a small toolbar popup cannot interrupt it.

## Development checks

From the repository root, run `npm test`. Capture tests cover sanitized DOM extraction, JSON-LD and plain HTML recipes, source URL validation, bounded downloads, authenticated transfer of actual image bytes, incomplete imports, recovery, duplicate handling, cost estimates, UI progress and the absence of paid calls before approval. Connection tests cover closed tabs, changed ports, ambiguous workspaces, expired sessions, offline captures and secret-free settings. Package tests verify every required file and icon in the downloadable ZIP. The extension needs no build step or external dependencies.

The connection flow takes inspiration from the owner's [Article Rewriter Studio extension](https://github.com/salahkessab/rewrite-articles-flippa/tree/main/extension): remember the app, reuse its tab, retain a handoff until receipt, and open the exact destination. This implementation retains Recipe Intelligence's authenticated local API and idempotent import receipts instead of adding an all-pages message bridge.
