# GitHub and Vercel deployment

This repository includes the hosted Next.js studio, the Windows local application,
and a persistent-server runtime for Recipe Intelligence. It uses Node.js 24.x.
See the [server deployment and migration guide](server-deployment.md) to run the
whole workspace without a PC. That deployment requires a persistent host.

The isolated InstaBox trial has a [GitHub deployment workflow](../deploy/instabox/README.md#automatic-updates-from-github)
for pushes to `main`. It builds and tests on the existing Free VM before updating
the app, with an encrypted database backup and recovery on installation failure.
The worker's server data and credentials are separate from GitHub source code.

## Hosted studio

Import the GitHub repository into Vercel with the Next.js framework preset,
the repository root as the root directory, and `npm run build` as the build
command. Use the `main` branch for production.

Set these server-side environment variables before deploying:

- `APP_PASSWORD`: a strong password protecting the UI and API. The browser's
  Basic Auth prompt accepts any nonempty username, for example `admin`.
- `OPENAI_API_KEY`: the OpenAI project key used for text and image requests.
- `FAL_KEY`: optional, for the existing fal models and hosted image URLs.

Store credentials in Vercel's environment settings, never in Git. Do not set
`RECIPE_INTELLIGENCE_LOCAL`, `RECIPE_INTELLIGENCE_ROOT`, or the local launch token
on Vercel. Preview deployments need the same password protection if API keys
are configured there.

The Vercel-hosted studio supports its existing recipe-design and image-generation
tools. Deploying to Vercel alone does not migrate the database or run the durable
worker. The persistent-server runtime supports tracking, reports, batches, private
files and encrypted WordPress connections. Keep RECIPE_INTELLIGENCE_MODE unset on
Vercel; use the migration guide for the complete server deployment.

## Local Recipe Intelligence

Clone the repository onto a Windows computer with Node.js 24 LTS and follow
the [Windows setup guide](recipe-intelligence.md). The launcher prepares the
local build and asks where to store data. Keep the storage folder outside the
source repository. Existing storage can be reused on the same computer.

The `.gitignore` excludes environment secrets, local build output, experiments,
SQLite files and private-key files. The `.vercelignore` also excludes tests,
documentation and local worker scripts from deployment uploads. API keys,
WordPress Application Passwords, uploaded originals and generated recipe files
are not part of the application source.

## Verification

Run `npm test`, `npx tsc --noEmit`, and `npm run build` before publishing changes.
Tests mock paid providers. On Windows, the launcher smoke test is
`node scripts/smoke-recipe-intelligence.cjs` after preparing the local build.

The deployment preparation on 11 November 2026 updated compatible multipart,
CSS tooling, source-map and ID-generation dependencies. PostCSS is overridden
to the application's patched 8.5.x dependency so Next.js does not retain its
older pinned copy. The complete npm audit then reported zero known
vulnerabilities. This does not replace future dependency checks. Relevant
upstream advisories include [PostCSS source-map loading](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)
and [form-data multipart fields](https://github.com/advisories/GHSA-hmw2-7cc7-3qxx).

Vercel references: [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Git connections](https://vercel.com/docs/cli/git),
and [deployment commands](https://vercel.com/docs/cli/deploy).
