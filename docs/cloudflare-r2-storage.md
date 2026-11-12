# Private Cloudflare R2 file storage

Recipe Intelligence uses a local Next.js server, a separate Node worker and SQLite. SQLite contains tracked sites, publication evidence, jobs, checkpoints, usage reservations, credentials encrypted with Windows DPAPI, and artifact metadata. Files are written atomically into the selected local folder. Hosted tools have a separate lifecycle and do not open this database.

R2 adds private object storage alongside the existing filesystem. It does not migrate SQLite or turn the application into a hosted multi-user SaaS. The worker syncs generated images, article files, downloaded reference photos, browser captures, request/response recovery files, saved reports and WordPress receipts. Database files, database backups, environment files, credentials and logs are excluded. Existing files are discovered too. No file is removed locally to save space automatically.

## Server configuration

Add these values to the application's git-ignored `.env.local` or supply them as server environment variables, then restart the local launcher:

```dotenv
R2_ENABLED=1
R2_ACCOUNT_ID=<32-character Cloudflare account ID>
R2_BUCKET_NAME=<existing private bucket name>
R2_ACCESS_KEY_ID=<S3 Access Key ID>
R2_SECRET_ACCESS_KEY=<S3 Secret Access Key>
R2_PREFIX=track-competitor
```

`R2_ENABLED=0` disables all R2 requests and retains local operation. Incomplete enabled configuration appears as a Settings error and does not prevent local processing. `R2_PREFIX` is optional and defaults to `track-competitor`; use a separate prefix for separate applications. A persistent workspace UUID further separates local workspaces. Keep that UUID and SQLite when restoring a workspace.

For an Automatic/default jurisdiction bucket, the endpoint is derived as `https://<account-id>.r2.cloudflarestorage.com`, with S3 region `auto`. Only if the bucket uses a jurisdiction, set `R2_ENDPOINT` to the exact account endpoint ending in `.eu.r2.cloudflarestorage.com`, `.us.r2.cloudflarestorage.com` or `.fedramp.r2.cloudflarestorage.com`. Arbitrary endpoints are rejected before credentials can be sent.

Create an R2 API token with **Object Read & Write**, scoped only to the application's bucket. Use its S3 **Access Key ID** and **Secret Access Key**, not a Cloudflare management bearer token or Global API Key. Bucket administration permissions are unnecessary. Keep public access and the public development URL disabled. The application does not add public ACLs, custom domains or CORS policies. It never puts R2 credentials or presigned URLs into frontend code or article HTML.

## Sync and recovery

The existing worker scans the allow-listed asset folders every 30 seconds and transfers one object at a time without blocking recipe generation. **Settings → Private cloud files → Sync files** requests discovery and retries pending failures. The page displays synced, pending and failed file counts. It requires the same local authentication and CSRF protection as other workspace operations.

Objects use immutable keys containing the workspace, relative filename and SHA-256. SQLite records transfer status, content type, size and checksum. A lost upload response is reconciled with S3 HEAD before uploading again. Errors use bounded exponential backoff and redacted messages. Uploaded bytes are unchanged: R2 introduces no image recompression. WordPress separately receives lossless WebP from the approved saved output.

When a required artifact or reference is missing locally, authenticated downloads and export preparation can restore the matching private R2 object, verify its byte count and SHA-256, and atomically restore the local file. Worker stages restore known inputs and receipts before processing; a failed restore holds that stage rather than making another paid request. Corrupt remote data is never accepted. Existing local files are not silently overwritten.

Confirmed recipe deletion queues its cloud objects for deletion, including previous versions. Deletion tombstones prevent the worker from restoring or re-uploading those files. Shared source files remain until no recipe uses them. If R2 is unavailable, queued deletion remains visible and resumes when the same destination is configured again. Changing buckets or prefixes does not delete the old destination automatically.

SQLite migration 7 adds only object-transfer records and deletion tombstones, with a SQLite backup before migration. Keep database backups separately: R2 file copies alone cannot reconstruct tracking history or billing records. A second machine needs the matching database and workspace identity; Windows-protected WordPress credentials still need reconnecting there.

## Limits and verification

Files larger than 128 MiB, temporary files, unsupported extensions, symlinks and files outside approved asset folders are not uploaded. Original local files remain available. The application continues to need its local server and worker; this integration does not provision a cloud worker, database, subscription, public gallery or Vercel credentials.

Run `npm test`, `npx tsc --noEmit`, the hosted/local builds and `node scripts/smoke-recipe-intelligence.cjs`. The launcher smoke test forces R2 off for its disposable workspace. Mocked R2 tests cover private object keys, no credential disclosure, checksum restore, lost PUT responses, versioning, deletion and migration.

After compiling with `npm run build:recipe-intelligence` and configuring the environment, run `node scripts/check-r2-storage.cjs` before starting regular sync. It uploads a new disposable text object, verifies its metadata and exact bytes through S3, then removes only that test object. It makes no AI request and does not print credentials.

On Windows, use the local launcher to prepare dependencies. It installs the locked packages without npm's inferred native rebuild, uses the Node-API binaries shipped with better-sqlite3 13, and separately prepares optional native canvas. Its SQLite availability probe runs in a child process so the launcher does not lock the binary during dependency replacement.

### Verification on 12 November 2026

- Full automated suite: 316 passed, no failures or skipped tests.
- TypeScript, hosted production build and local production build passed.
- Windows launcher smoke test passed: selected folder, persisted imports, duplicate-instance prevention, controlled shutdown and restart; zero paid calls.
- Local WordPress REST integration passed 31 checks, including real WebP media bytes/MIME and the first image as featured image. No customer WordPress site was changed.
- The existing workspace migrated from schema 6 to 7 after a SQLite backup. Its ten content items, 78 API call records and 166 artifact records were unchanged; all 166 saved artifact files still match their recorded SHA-256 values.
- Following explicit approval, a bucket-scoped Object Read & Write credential was created and saved only in the ignored server `.env.local`. The bucket has no custom public domain and its public development URL remains disabled.
- Real S3 upload, metadata/readback verification and deletion of a disposable test object passed. R2 is enabled in the running local application.
- Initial sync completed: **373 objects, 362,664,767 bytes**, no pending or failed transfers. A separate S3 inventory check confirmed every object key and size against the database.
- An image and an HTML article were restored from R2 into a disposable local workspace and matched their recorded SHA-256 values. Production files remained untouched. Anonymous access to an existing object was rejected with `InvalidArgument: Authorization` (HTTP 400).
- Both production frontend output directories were checked: neither S3 credential appears in their 78 static files. The original 78 AI usage records and 166 artifact checksums remained unchanged; no new AI request was made.
- A fresh SQLite backup after sync includes the workspace identity and all 373 synced-object records, in addition to the pre-migration backup.

Official references: [Cloudflare S3 setup](https://developers.cloudflare.com/r2/get-started/s3/), [R2 token permissions](https://developers.cloudflare.com/r2/api/tokens/), [AWS SDK v3 configuration](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).
