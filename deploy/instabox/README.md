# InstaBox personal deployment

This configuration supports an isolated trial or the owner's personal workspace.
No provider credentials or production data belong in the source archive. Keep them
in the private persistent workspace and `runtime.env`. A personal cutover requires
the verified backup and data checks in [server-deployment.md](../../docs/server-deployment.md).
The Free plan remains subject to mandatory pauses and cooldowns.

## Account and billing

Use the **Free** workspace only. Confirm its plan and live limits before creating
one machine. Do not upgrade, add paid credits, or create a machine in a paid
workspace. On 2026-11-12 the trial API confirmed **Free**, 4 vCPU, 8 GiB RAM,
20 GiB persistent data disk, 16 GiB root disk, 30 minutes idle pause and a
**120-minute maximum run**. The pricing page advertised a longer runtime; use
the actual machine's `maxRunMinutes`, not that advertised figure. Check the
account each time, since limits can change.
The API returned 480 while suspended/stopped but 120 while running; the running
machine value is the effective limit observed in this trial.

Access uses the official device/agent approval flow. Use only machines:read,
machines:write and images:read, with a seven-day expiration. Do not print the
resulting key or copy browser cookies. Local trial credentials are encrypted for
the Windows user. This key does not change billing or delete machines.

## Deploy

1. Create one `agent-browser` machine named `recipe-intelligence-trial` and confirm
   its free plan. It supplies Docker on Linux amd64. The Dockerfile uses Node 24.
2. Upload a reviewed source archive without `.env*`, `.git`, databases, credentials,
   local build folders, logs or generated work. Extract into
   `/data/recipe-intelligence-trial/source`.
3. Publish port 3000 and use the exact returned HTTPS origin. Keep app password
   authentication enabled, even if the port also has provider access protection.
4. Create `/data/recipe-intelligence-trial/runtime.env`, mode 0600, containing only
   `APP_PASSWORD`, a fresh 32-byte base64 `RECIPE_INTELLIGENCE_SECRET_KEY`,
   `RECIPE_INTELLIGENCE_ORIGIN`, and `RI_PUBLIC_HOST` (that origin's hostname).
   No OpenAI, R2, WordPress, or other provider secrets.
5. Create `/data/recipe-intelligence-trial/workspace` owned by UID/GID 1000 (the
   container's unprivileged node user). The directory is new; do not move or modify
   another workspace.
6. From `source`, run:

   ```sh
   docker compose --env-file /data/recipe-intelligence-trial/runtime.env -p recipe-intelligence-trial -f deploy/instabox/compose.yaml up -d --build
   ```

The compose file defaults to empty AI keys and disabled R2. For a personal
deployment, private `runtime.env` may supply `OPENAI_API_KEY`, `FAL_KEY` and
`ANTHROPIC_API_KEY`; Compose forwards those values to the app. The saved encrypted
OpenAI credential remains authoritative for Recipe Intelligence. After restoring
a real workspace, set `RECIPE_INTELLIGENCE_ALLOW_EMPTY=0`. Keep `R2_ENABLED=0`
when relying only on the included persistent disk. Free hosting does not make
the owner's normal model-provider requests free; acceptance checks use no paid calls.
The small Caddy gateway requires the exact forwarded hostname and restores the
canonical upstream Host, because InstaBox rewrites Host to loopback. The app's
origin and CSRF checks remain enabled; the app port is internal to Docker.

## Acceptance checks

- External HTTPS responds and unauthenticated access is denied.
- Authenticated snapshot reports server mode, a healthy worker, and no AI key.
- Cross-origin writes are rejected; a valid free import can be created.
- Workspace identity and that import survive a container restart.
- Pause/resume and full VM stop/start preserve the database and files.
- Tests using mocked providers verify that receipts are reused and uncertain
  paid requests do not repeat. No real generation is an acceptance test.
- Run the existing tests, TypeScript check and production build on Linux.
- Confirm zero `api_calls` and zero InstaBox charged usage after verification.

The runtime container runs as the unprivileged `node` user. For Linux tests,
use a separate disposable container with `NODE_ENV=test`, without environment
files or workspace mounts. It may run as root to compile tests under `/app`; that does not change
the app container's user or grant tests access to its secrets or stored data.

```sh
docker run --rm --user 0 -e NODE_ENV=test --entrypoint sh recipe-intelligence-trial-app:latest \
  -c 'npm test && npx tsc --noEmit && node scripts/smoke-recipe-intelligence-server.cjs'
```

## Verified on 2026-11-12

- Linux production and worker builds passed. TypeScript passed.
- Linux suite: 320 passed, zero failed, one Windows-only DPAPI test skipped.
- Separate server smoke test passed password protection, saved workspace/import
  recovery, controlled shutdown and zero paid requests.
- External HTTPS passed password, exact-origin/CSRF and healthy-worker checks.
- A free test import and workspace identity survived container restart, a
  102-second VM suspension with preserved processes, and a full VM stop/start.
  A manually suspended VM returned HTTP 503 until explicitly resumed.
- Trial SQLite integrity is `ok`; it contains one test import, zero batches,
  zero tracked sites and zero `api_calls`. OpenAI credentials are absent and R2
  is disabled. The app runs as UID 1000; only the gateway publishes port 3000.
- Reported InstaBox cost and overage are $0 on the confirmed Free machine.
  Usage billing can lag; no paid plan or paid provider operation was enabled.
- The original Windows database still has 10 batches, 10 content items,
  78 API ledger entries and 166 artifacts. All 166 file checksums passed;
  production data and the 373 synchronized R2 records were retained.

This validates hosting and recovery only. It does not migrate the original
workspace, connect provider credentials, or certify uninterrupted paid work
through an enforced maximum-runtime pause.

## Automatic updates from GitHub

`.github/workflows/instabox.yml` deploys pushes to `main` in the private
`salahkessab/track-compititor` repository. It also supports **Actions → Update
InstaBox app → Run workflow** on `main`. It uses the repository's self-hosted
Linux runner, named/labeled `recipe-intelligence-instabox`, on this same Free VM.
No GitHub-hosted runner, artifact upload, hosted cache, paid model, or extra VM is
used. Registration uses GitHub's one-hour registration token, then the runner
retains its own credentials privately on the VM. Personal GitHub and InstaBox
API keys are not stored as workflow secrets.

The runner is installed under `/data/recipe-intelligence-trial/actions-runner`
and managed by GitHub's `svc.sh` systemd service as the unprivileged `user`.
It starts again when the VM starts. Keep this repository private and restrict
write access to trusted maintainers: its workflows can deploy to this machine.
Only `push` to `main` and manual `main` runs trigger this workflow; pull requests
do not execute on the deployment runner. Checkout is pinned and does not retain
the temporary GitHub token in the checkout.

Each update:

1. Builds a Docker image tagged with the exact commit SHA. No runtime environment
   files or production data enter its context.
2. Runs the existing tests, TypeScript and server smoke test in a disposable
   container with no network, secrets or production mounts.
3. Pauses new worker tasks and API mutations for maintenance, allowing active
   tasks to settle. Reads remain available while draining.
4. Stops the app, saves a consistent encrypted SQLite backup with a checksum,
   and starts the tested image using the existing workspace and server secrets.
5. Verifies web/worker readiness, the running commit, workspace identity, and
   stored record counts. The encrypted backup stays in `workspace/backups`.
6. Restores the preceding image and backup if installation fails during the
   maintenance window. A failed rollback retains its deployment record for
   inspection instead of overwriting data on another attempt.

The runner never replaces `runtime.env` and never restores the Windows database.
WordPress passwords, images, recipes and settings remain in the existing server
workspace. No automatic retry of uncertain paid calls is introduced. The first
upgrade from the trial's pre-maintenance image is allowed only without paid-call
history or active publishing/generation; later releases use the drain handshake.

Deployment state is stored in `current-deployment.json` and, during a cutover,
`pending-deployment.json` under the trial directory. Immutable Compose/Caddy
files live under `releases/<commit>`. `/api/server-health` reports the running
revision. Backups, images and releases are retained for recovery; monitor disk
space and remove only versions no longer needed for rollback.

If the VM sleeps, GitHub jobs wait for the runner to reconnect. This workflow
does not wake it, bypass a cooldown, or extend the free runtime. After a hard
interruption during cutover, inspect `pending-deployment.json` before retrying;
the runner refuses to overwrite a possibly newer workspace. Maintenance markers
expire after 20 minutes so an abandoned drain does not lock the app indefinitely.

GitHub references: [self-hosted runner billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[adding a runner](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners),
and [Linux service setup](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application).

## Sleep and suitability

InstaBox can pause a running machine, including in-flight network requests. A
legitimate task activity lease can protect API waits from **idle** pause, but it
does not override the maximum runtime. Never use artificial traffic to bypass
free-plan limits. A max-run pause has an enforced cooldown (which increases for
consecutive max-run pauses). Test the app's recovery before enabling paid work.

The current trial deliberately has no real API key. Do not claim it is ready for
unattended paid batches just because a pause/resume smoke test passes. A later
cutover needs approved credentials, a fresh production backup, and handling of
lease expiry and uncertain requests around suspension. Keep the local original
until the user accepts that cutover.

Official documentation:
- https://instabox.sh/docs/account/pricing
- https://instabox.sh/docs/account/billing
- https://instabox.sh/docs/machines/auto-pause
- https://instabox.sh/docs/machines/storage
