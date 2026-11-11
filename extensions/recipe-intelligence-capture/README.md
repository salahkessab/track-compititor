# Recipe Intelligence Capture 2.0.3

Capture a recipe article and its photographs from the page you have open in Chrome, including pages that reject the app's server-side URL fetch. This version replaces the supplied Article Rewriter Studio extension's URL-only handoff.

Version 2.0.3 displays the running extension version on every capture page and marks resumed captures from earlier versions. It includes the v2.0.2 filter: exclude images linking to other articles and nested recommendation sections, prefer the article container over the whole page, correctly read image URLs containing commas, and group different crops of the same photo. These changes apply to new captures; existing imports and generation jobs are unchanged.

**Open generation screen** brings the local app's Chrome window to the front and restores it if minimized. The Generate button is in that local app, where the estimate is approved.

## Install once

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder (the folder containing `manifest.json`). If using the ZIP, extract it first.
3. Pin **Recipe Intelligence Capture** from Chrome's Extensions menu. Disable the older Article Rewriter Studio extension if you no longer need it.
4. Open **Recipe Intelligence** with the desktop shortcut in the same Chrome profile.

After updating files in this folder, click **Reload** on the extension's card and close old capture tabs before starting a new capture.

Chrome uses the exact folder selected during **Load unpacked**, which may be a Desktop or Downloads copy rather than this repository. Replace files in that installed folder, then reload the extension. A fresh capture should show **Capture v2.0.3** at the top. Old capture tabs and resumed imports keep their previously captured photos.

## Use

1. Open the recipe in Chrome and wait for its article and images to appear. Scrolling through the recipe can load lazy photographs.
2. Click **Recipe Intelligence Capture** in the toolbar. A capture preview opens in a separate tab.
3. Click **Import and see estimate**. All discovered photos are selected; optionally uncheck any you do not want.
4. Keep the capture tab open until it finishes. Your local app opens the estimate for this exact recipe.
5. Review the cost and click **Generate article + images** in the app when ready.

No AI requests or charges occur during capture or import. The extension never approves a generation job.

If the app disconnects, reopen it with the desktop shortcut and click **Resume import and see estimate**. After closing a capture tab, open the extension again and choose **Resume previous import**. Only the last started capture is stored for recovery. Repeating an interrupted import reuses its saved article and deduplicates identical photos.

## What is captured

- The main readable article, its title and source URL, recipe metadata, ingredients, instructions, and supported article context such as storage and serving guidance.
- Up to 24 article photos, including loaded/lazy image URLs and recipe metadata images. Related posts, navigation, forms, comments, scripts and obvious advertisements are excluded.
- Actual image files, not just remote links. Each image is limited to 10 MB and 40 megapixels, with a minimum size of 160 × 120. Browser-readable formats such as AVIF are converted to JPEG when needed.

The local app stores plain article text and structured recipe facts under `research/browser/` in its selected storage folder. Photos go under `research/references/`. The local app validates files and groups exact duplicates. The app currently generates recipe articles; an article without readable ingredients and instructions can be captured but cannot receive a recipe-writing estimate.

A webpage must be readable in Chrome. The extension does not solve access challenges or retrieve hidden/paywalled content. Some images may still be unavailable. Failed photos are listed; the successfully captured article and images are retained. With no usable source photos, the normal app estimate can include three newly generated images from the recipe facts.

## Connection and permissions

The extension finds authenticated Recipe Intelligence tabs at `http://127.0.0.1`. No fixed port, API key or copied launcher token is needed. Keep the local app open in the same Chrome profile. If multiple local workspaces are open, choose the intended destination.

HTTP/HTTPS host access allows photographs to be fetched from the page's image CDN and lets the extension find the local app. There are no automatically running content scripts, remote executable scripts, analytics, third-party upload services, cookie permissions or externally callable extension endpoints. Direct photo downloads omit credentials and reject redirects. A fallback may copy an already rendered image only when Chrome permits canvas access.

The local connection uses an isolated script in the app tab and its existing HttpOnly session. The app's exact-origin and CSRF checks remain enabled; no permissive CORS rule is added. Browser captures stay outside the URL-fetch queue and cannot be estimated before the import finishes.

Chrome documentation: [script injection](https://developer.chrome.com/docs/extensions/reference/api/scripting), [cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests). A foreground extension tab performs the transfer so closing a small toolbar popup cannot interrupt it.

## Development checks

From the repository root, run `npm test`. Capture tests cover sanitized DOM extraction, JSON-LD and plain HTML recipes, source URL validation, bounded downloads, authenticated transfer of actual image bytes, incomplete imports, recovery, duplicate handling, cost estimates, UI progress and the absence of paid calls before approval. The extension needs no build step or external dependencies.
