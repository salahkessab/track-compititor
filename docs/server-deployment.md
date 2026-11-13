# Recipe Intelligence on a persistent server

The server runs the complete Next.js app and its worker together. SQLite,
receipts and files use a persistent disk; private R2 is an optional extra copy.
Closing a browser or turning off the owner's computer does not stop server jobs.
This is a single-owner deployment, not a multi-tenant SaaS.

## Deployment status

The server runtime, portable migration tools and HTTPS extension connection are
implemented. The [InstaBox deployment](../deploy/instabox/README.md) supports a
personal workspace with private runtime credentials. A deployment must verify its
own data transfer and record counts before declaring cutover complete. R2 object
storage alone cannot run this application. InstaBox Free has mandatory pauses and
cooldowns; persistent storage does not mean uninterrupted availability.

Use a persistent Linux Node 24 host, with at least 2 GB RAM initially for Next.js,
the worker and image decoding. Check actual peak usage before reducing it. A Docker
host can run `docker compose --env-file .env.server -f compose.server.yaml up -d --build`. A managed Node
host can use `npm ci --ignore-scripts && npm rebuild canvas && npm run build:recipe-intelligence && npm run build`
and `npm run server:start`, with a persistent disk and public HTTPS reverse proxy.
The native modules must be installed on the target architecture. Do not copy
Windows node_modules to Linux. A serverless Vercel function is not a persistent host.

The Docker Compose file includes Caddy for HTTPS. Point SERVER_DOMAIN's DNS to
the host and permit ports 80 and 443. Node's port is bound to the host's loopback
interface. No database port is exposed. Managed hosting can supply HTTPS instead.

## Secrets and persistent storage

Create an ignored `.env.server` with `node scripts/migrate-recipe-intelligence-server.cjs key`.
This creates the encryption key without printing it. Back up that file privately.
Add APP_PASSWORD, optional OPENAI_API_KEY and FAL_KEY, the existing private R2 variables,
SERVER_DOMAIN, and the server variables documented in `.env.example`.
On managed hosting put these in its secret environment settings. Never commit,
publish, include in a Docker build context, or send that file to the browser.

- RECIPE_INTELLIGENCE_MODE must be `server`; do not also set LOCAL or VERCEL.
- RECIPE_INTELLIGENCE_ROOT must name the persistent mount, not an ephemeral folder.
- RECIPE_INTELLIGENCE_ORIGIN must exactly match the public HTTPS origin.
- RECIPE_INTELLIGENCE_SECRET_KEY is a permanent 32-byte base64 AES-GCM key.
  Rotating or losing it without re-encrypting credentials breaks saved WordPress connections and OpenAI keys.
- APP_PASSWORD protects the web interface and API. Any nonempty username works.
- Only one host should own this workspace. Use one replica, one persistent disk.
  The worker's SQLite lease prevents two workers on that same database.

The API checks the password independently of middleware, rejects mismatched Host
and Origin headers, and requires the existing CSRF header on mutations. Local
launcher tokens cannot authenticate the cloud workspace. Paid generation retains
its separate per-batch approval and reservation rules.

### Entering an OpenAI key in Settings

In Recipe Intelligence → Settings → **OpenAI API key**, paste a project key and
choose **Save and test key**. The server verifies it with a metadata-only GET to
`https://api.openai.com/v1/models`; the project key needs Models read permission.
This does not generate content. The existing model-access check separately checks
the selected writing and image models before paid budget approval.

The app saves only an encrypted, purpose-tagged credential in SQLite settings.
The browser clears its input after submission; snapshots, exports, errors and
status responses never return the saved key. Web and worker processes resolve
the current saved key for each request, so saving or replacing it needs no restart.
A rejected replacement preserves the working key. Key changes clear cached model
access checks. The saved workspace key takes priority over OPENAI_API_KEY for
Recipe Intelligence; removing it restores the environment fallback. Other image
and design tools continue using their existing environment configuration.

The local launcher uses Windows DPAPI. Migration re-encrypts a saved provider key
alongside WordPress credentials in the disposable backup; the original is unchanged.
Server backups include the encrypted credential, so retain the server encryption key.

## Image metadata preparation

Every generated final image passes the official ExifTool CLI before the app
returns its preview. The CLI is provided by exact-pinned `exiftool-vendored`
39.3.0 and its 13.63.0 platform package; the backend checks `exiftool -ver`
against 13.63. `EXIFTOOL_PATH` may select another absolute path to that same
version. Windows includes the executable and supporting files. Linux requires
Perl (installed in the runtime Docker image) and the npm Perl package. Keep
optional npm dependencies enabled. The checked-in `config/image-metadata.config`
enables common PNG generation fields; arbitrary home-directory configs are not loaded.

Final resizing/composition/conversion finishes first. ExifTool edits only a
temporary copy, then the backend rereads it and compares decoded pixels,
compressed image payload, dimensions, alpha, orientation, ICC and attribution.
The source, preparation jobs and verification receipts stay private under
`RECIPE_INTELLIGENCE_ROOT/verified-images` (or `IMAGE_ASSET_ROOT` for standalone
image tools). Private R2 sync includes this directory. PNG and WebP variants are
prepared and verified independently, once, and reused. Cleanup never re-encodes.

GPS, device identifiers, personal/contact fields, optional timestamps/comments,
Software/CreatorTool and supported prompt/workflow/parameters/model/seed/sampler/
steps/CFG fields are removed. Copyright, attribution and color/display fields
are preserved. Conflicting attribution in a field targeted for removal, unknown
non-writable fields, malformed images, verification failures and changed cache
bytes block output. Retry uses saved private bytes, never another paid generation.

C2PA/JUMBF is inspected separately and removed from the final copies under the
user's updated policy (`optional-metadata-v3-remove-c2pa`). The private original
remains unchanged. ExifTool reopens every output and checks that embedded
manifests and supported XMP manifest links are absent. External manifest servers
are not contacted or modified. Possible rights inside a manifest block cleanup
until those rights can be preserved. Old verification receipts must pass the new
policy before being reused. Signatures are not validated.
“Ready” and the small check icon mean this metadata policy passed verification;
they make no claim about SynthID removal or avoiding Pinterest/other AI labels.
The “Clean metadata before upload” indicator is always enabled because the same
automatic policy also protects previews and downloads.

A serverless Vercel deployment has no durable image store or guaranteed Perl
runtime. Generation fails before billing there unless the persistent image
backend/storage and pinned CLI are available. Deploy the complete Docker service
for the full workflow. Do not use raw-provider URLs as a fallback.

Reference: [OpenAI API authentication](https://developers.openai.com/api/reference/overview#authentication).

## Safe cutover

### Portable transfer without R2

`scripts/migrate-portable-workspace.cjs` supports migration using only a private
file transfer and the destination's persistent disk. Stop the source app and wait
for paid requests, image preparation and WordPress sends to finish first. Keep a
separate complete source backup, including its encrypted credentials.

With `RECIPE_INTELLIGENCE_SECRET_KEY` configured privately, run:

```sh
node scripts/migrate-portable-workspace.cjs prepare /absolute/source /absolute/new-bundle
node scripts/migrate-portable-workspace.cjs restore /absolute/bundle /absolute/new-workspace <manifest-sha256>
```

On Windows, preparation reads DPAPI credentials and re-encrypts them for the
server in the backup only. Transfer the bundle and server key through private
channels. Do not place the key in command arguments or source control. The sealed
manifest pins file hashes and table counts. Restore authenticates the database,
verifies every file and credential, and only creates a new workspace directory.
It refuses an existing destination. Existing cloud work must be inspected and
backed up before deciding which data is authoritative; this tool does not merge
two workspaces. Originals remain unchanged. Older backups/logs are retained in
the separate complete backup, not copied into the active runtime bundle.

Set `R2_ENABLED=0`, `RECIPE_INTELLIGENCE_ALLOW_EMPTY=0` and initially
`RECIPE_INTELLIGENCE_WORKER_PAUSED=1` for a disk-only cutover. Complete the
authentication, counts, image, credential-unlock and restart checks below before
enabling worker processing. Do not rotate an existing server encryption key
without re-encrypting its saved credentials.

### R2-assisted transfer

1. Back up source code and SQLite. Wait for active generation and WordPress sends
   to settle, then finish the R2 sync. Verify that all current files are synced.
2. Stop the local launcher. Do not restart it against the migrated data during
   cutover: two independent copies of a database cannot coordinate worker leases.
3. Run `npm run build:recipe-intelligence`, then
   `node scripts/migrate-recipe-intelligence-server.cjs prepare "D:\article track" "<private-backup-folder>\server.ribak"`.
   Replace the paths for the installation. The script refuses a running worker,
   uses SQLite's backup API, re-encrypts WordPress and saved OpenAI credentials on the backup, encrypts
   the whole snapshot, uploads it to private R2 and records its SHA256 receipt.
   The source database and Windows credentials remain unchanged.
4. Set MIGRATION_KEY and MIGRATION_SHA256 from that receipt on the server. Keep the
   same R2 bucket/prefix and encryption key. Set WORKER_PAUSED=1 for verification.
   Do not set ALLOW_EMPTY as a workaround for a failed migration.
5. Start the host. It authenticates and validates the snapshot, restores it once,
   restores the current R2 files with checksum checks, and starts web and worker.
   Initial hydration can take several minutes; allow a long initial health timeout.
   Subsequent restarts never overwrite the live database with the snapshot.
6. Verify site, recipe, report, batch, API-ledger and artifact counts; inspect a
   saved article and image. Check the WordPress connection profile without publishing.
   Test authentication, a free import and a host restart. No paid AI test is needed.
7. Remove WORKER_PAUSED and restart the service after verification. Jobs resume
   from their saved checkpoints. Keep the Windows launcher stopped and point the
   Chrome extension to the public HTTPS app. Reopen old interrupted captures in
   their original workspace; do not silently transfer them to another workspace.
8. Open the HTTPS app from another device while the PC application is stopped.
   Only after this succeeds is the server cutover complete. Retain the rollback backup.

GET /api/server-health returns only readiness; it checks the worker heartbeat.
The process supervisor shuts down both children when either fails. Configure the
host to restart failed services (Compose uses `restart: unless-stopped`). Graceful
shutdown leaves uncertain paid requests reserved rather than automatically repeating them.

## Recovery and limitations

Use the host's persistent-volume snapshots and the app's SQLite backup API. In
server mode, the worker additionally uploads an AES-GCM encrypted database backup
to private R2 once a day, checking the uploaded size and checksum before recording
success. It does not make AI calls. These backups are retained; monitor storage
growth and configure retention deliberately. The latest object key and checksum
are stored under `server_database_backup` in SQLite settings. Earlier objects are
under the private bucket's `migrations/backup-` prefix. R2 file sync and these
database backups are separate; a database backup can reference files whose latest
upload is still pending, so persistent-volume snapshots remain useful too.
Never recover a running SQLite database by copying only its main file without WAL;
use the backup API or a stopped clean database. Restore DB and encryption key as a pair.
On a new host, restore the matching private R2 configuration as well.

For rollback, stop the server first. Never run both the pre-migration Windows DB
and the migrated server DB as active owners. If the server has accepted new work,
do not simply revert to the old snapshot: migrate that newer data back first.

Recipe Designs and Layered Designs now save settings, assets, jobs and history in
the authenticated server workspace in server mode. Image bytes and large editable
scenes live in private, checksummed files under `studio-storage`; SQLite stores
their references. Opening the tab imports missing browser records from that same
origin without replacing newer server records or resurrecting deletions. Network
failures are shown rather than silently switching to browser storage. Local mode
retains IndexedDB. Histories on another device or an old localhost/Vercel origin
are separate and require a deliberate transfer from that origin; the new server
cannot read them automatically. Browser originals are retained.

## Verification

`npm test`, `npx tsc --noEmit`, and `npm run build` validate server and hosted paths.
`node scripts/smoke-recipe-intelligence-server.cjs` exercises password protection,
an unpaid import, restart persistence and worker shutdown using disposable storage.
Tests mock providers and do not generate paid content.
Docker/Linux and live HTTPS cutover checks require the selected target host; they
must not be reported as passed based on a Windows smoke test alone.

Verified on 12 November 2026: 321 automated tests passed; TypeScript and the hosted
production build passed. The disposable server smoke test passed authentication,
restart persistence, stable workspace identity and graceful worker shutdown with
zero paid calls. The original workspace still has 10 batches, 166 artifacts with
matching checksums, 2,421 indexed URLs, 78 unchanged API-call records and 373 synced
R2 objects. A source-code and SQLite checkpoint was saved before these changes.
Linux/Docker execution, remote hosting and final cutover remain unverified until
the host is selected and accessible.
