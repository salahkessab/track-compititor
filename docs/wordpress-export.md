# WordPress image upload and copy

Recipe Intelligence can connect to multiple WordPress websites. Each connection is independent of tracked discovery websites, and there is no hard-coded destination. It uses the site's standard WordPress REST API and an Application Password with media-upload permission.

## Connect a website

1. Open **Settings → WordPress websites** in the local application.
2. In that website's WordPress dashboard, open **Users → Profile → Application Passwords**, name a new password **Recipe Intelligence**, and generate it.
3. Enter the website's HTTPS address, WordPress username and Application Password in the local form. Click **Connect website**.
4. Use **Connect another website or update credentials** to add another destination or replace a revoked password.

The password is encrypted using Windows DPAPI for the current Windows account. It is never returned by the local API or stored in browser storage. Moving the database to another Windows account requires reconnecting. Disconnect removes the local credential; revoke the Application Password in WordPress if it should no longer be usable.

## Copy an article with hosted images

1. Open the recipe under **My articles**.
2. Choose the **WordPress destination**. With multiple connections, choose a website explicitly.
3. Click **Upload images and copy**. Each finished, edited JPEG used by the saved article uploads to that destination's Media Library. Original reference photographs are excluded.
4. Paste into the WordPress visual editor. The copied HTML contains the uploaded image URLs and media IDs. Select a featured image in WordPress as usual.

Uploads reuse existing finished images; there are no AI generation calls. This feature uploads media and prepares clipboard content. Publishing remains a separate action in WordPress. The original local HTML, saved articles, images and paid-stage records are preserved.

If the browser blocks clipboard access after a long upload, click **Copy uploaded article**, or use **Download WordPress HTML**. Both reuse the completed uploads.

## Recovery and limits

- A separate ledger records the target website, image checksum, media ID, HTTPS URL and upload receipt. Copying the same image to the same website reuses its saved upload across restarts. A different website gets its own upload.
- Failed images do not prevent the other images from uploading. Copying resumes failed work and reuses successes. The complete formatted article is offered only when all images in that saved article have hosted URLs.
- A timeout or ambiguous server response retains an uncertain state. Clicking again reconciles the receipt or searches WordPress for the stable image slug; it does not blindly repeat the upload. If no match is available, check the destination's Media Library before further repair.
- The saved article version is checked while exporting. If it changes during upload, click again to use the latest version without repeating completed uploads.
- Only public HTTPS sites are accepted. DNS is checked and pinned; redirects are not followed with credentials or uploads. Response sizes, local paths, file checksums, image types and pixel dimensions are bounded.
- Standard WordPress REST routes must be enabled, and the account must have `upload_files` capability. A security plugin that blocks API access may require configuration on that website. Other CMS platforms require separate adapters.
- Schema version 5 adds only `wordpress_media`. Existing databases are backed up with SQLite's backup API before migration.

Official references: [Media REST API](https://developer.wordpress.org/rest-api/reference/media/), [Application Passwords](https://developer.wordpress.org/advanced-administration/security/application-passwords/).

## Verification on 11 November 2026

All 221 tests passed, including sixteen dedicated WordPress backend and interface tests. TypeScript, hosted and local production builds, and the isolated Windows launcher smoke test passed. The smoke test verified saved imports, duplicate-worker prevention, controlled shutdown, schema version 5 and zero paid provider calls. Tests cover separate destinations, generated-image bytes, authenticated request boundaries, Windows encryption, clipboard fallback, retries and receipt recovery.

The local application was restarted and its new Settings form checked in the browser. All eight existing batches, eight content items, 101 stages, 55 API ledger entries, thirteen reference photos, ten content photos and 121 saved artifacts were unchanged. All 121 artifact file checksums matched. The database has a pre-migration backup, and no WordPress media uploads or paid AI requests occurred during verification.

The public API at `tastymealidea.com` advertises the standard media route and Application Password support. The URL is saved as a suggested first connection only. Authenticated upload on that live site remains unverified until the owner enters a private Application Password in the application and requests an upload.

![WordPress connection settings](wordpress-export/settings.png)
