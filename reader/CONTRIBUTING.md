# Contributing to Reader

Thanks for your interest in contributing. This is the open source branch of the codebase that runs at `https://r.jina.ai` and `https://s.jina.ai`. The MongoDB-backed SaaS storage layer is not part of this branch — local development uses the stateless / bucket-cached modes only.

If you're not sure where to start, take a look at [architecture.md](./architecture.md) first.

## Local development

### Requirements

- **Node.js 22+** — earlier versions will not build.
- **Docker** *(optional)* — only needed if you want to run the bucket-cached storage mode against a local MinIO. Pure stateless mode needs nothing extra.
- **LibreOffice** *(optional)* — only needed if you want to test MS Office document handling locally.

### First-time setup

```bash
git clone git@github.com:jina-ai/reader.git
cd reader
npm install
# Optional: only if you want the local bucket cache
docker compose up -d
```

`docker compose up -d` starts:

| Service | Port(s)        | Purpose                                                            |
| ------- | -------------- | ------------------------------------------------------------------ |
| `minio` | `9000`, `9001` | S3-compatible object storage for cached pages. Console on `:9001`. |

### Running the server

In VSCode, press `F5` to launch the debugger.

Or, after exporting the environment variables (see below):

```bash
docker compose up -d
npm run dev
```

### Useful scripts

- `npm run build` — TypeScript compile (also runs an integrity check).
- `npm run build:watch` — incremental build.
- `npm run start` — run the compiled `crawl` entrypoint.
- `npm run dry-run` — run `search.js` with `NODE_ENV=dry-run` to resolve the DI graph and exit. Used to warm `NODE_COMPILE_CACHE` in the Dockerfile.
- `npm run lint` — ESLint over `.js` / `.ts`.

## Environment variables

Reader picks up configuration from environment variables. The most relevant ones for local development are:

### Storage & data

| Variable                   | Notes                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `GCP_STORAGE_ENDPOINT`     | Object storage endpoint (use the local MinIO endpoint for dev). Enables Stage 1 bucket-cached mode. |
| `GCP_STORAGE_BUCKET`       | Bucket name for cached objects.                                                       |
| `GCP_STORAGE_ACCESS_KEY`   | MinIO root user locally.                                                              |
| `GCP_STORAGE_SECRET_KEY`   | MinIO root password locally.                                                          |
| `GCP_STORAGE_REGION`       | Optional; for parity with GCS.                                                        |
| `GCLOUD_PROJECT`           | Alternative trigger for the bucket layer when combined with `GCP_STORAGE_ENDPOINT`.   |
| `CACHE_LOCAL_STORAGE_ROOT` | Filesystem root for local cache (alternative to object storage in stateless modes).   |

### Vendors & integrations

| Variable                                          | Purpose                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `JINA_SERP_API_KEY` / `JINA_SERP_API_ORIGIN`      | Jina SERP backend.                                                   |
| `JINA_SERP_API_POLICY`                            | SERP routing policy.                                                 |
| `SERPER_SEARCH_API_KEY`                           | serper.dev search backend.                                           |
| `THORDATA_PROXY_URL` / `THORDATA_PROXY_URL_ALT`   | Thordata residential proxy.                                          |
| `THORDATA_SERP_API_KEY`                           | Thordata SERP API.                                                   |
| `BRIGHTDATA_PROXY_URL` / `BRIGHTDATA_ISP_PROXY_URL` / `BRIGHTDATA_SERP_API_KEY` | BrightData proxy + SERP. |
| `CLOUD_FLARE_API_KEY`                             | Required for the `cf-browser-rendering` engine.                      |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_KEY`        | Billing integration.                                                 |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `GOOGLE_AI_STUDIO_API_KEY` / `REPLICATE_API_KEY` | LLM/VLM access. |

### Overrides & toggles

| Variable                          | Purpose                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `PORT`                            | HTTP port.                                                         |
| `NODE_ENV`                        | `dry-run` is recognized for offline `search` runs.                 |
| `DEBUG_BROWSER`                   | Run headless Chrome with non-headless / debug behavior.            |
| `OVERRIDE_CHROME_EXECUTABLE_PATH` | Use a specific Chrome binary instead of the bundled Puppeteer one. |
| `OVERRIDE_JINA_VLM_URL`           | Point at a different VLM endpoint.                                 |
| `OVERRIDE_READERLM_V`             | Switch between ReaderLM versions.                                  |
| `OVERRIDE_GOOGLE_DOMAIN` / `OVERRIDE_BING_DOMAIN` | Use a regional search domain.                      |
| `OVERRIDE_MANAGE_SERVER_URL`      | Redirect calls to the management server.                           |
| `JINA_BOGO_SITES_RESORT_ORIGIN`   | Origin for the bogo-sites resort list.                             |
| `JINA_CRAWLER_OFFLOAD_ORIGIN`     | Offload crawler traffic to a peer cluster.                         |
| `PREFERRED_PROXY_COUNTRY`         | Hint for proxy country selection.                                  |
| `SLACK_REPORT_WEBHOOK_URL`        | Slack channel for runtime reports.                                 |

### `SECRETS_COMBINED`

You can pass a base64-encoded JSON object via `SECRETS_COMBINED` to bundle multiple variables into one. See `src/services/envconfig.ts`.

## Tests

The repo uses the Node.js built-in test runner (no Jest, no Vitest).

```bash
npm run test:unit       # unit tests
npm run test:e2e        # end-to-end tests (slower, hits docker services)
npm test                # both

npm run test:unit:coverage
npm run test:e2e:coverage
npm run test:coverage   # combined coverage report (c8)
```

Tests are written in TypeScript under `tests/` and compiled into `tests-build/` before running. The test entrypoints are `tests-build/run-unit.js` and `tests-build/run.js`.

## Submitting changes

1. Open an issue first if the change is non-trivial — it saves churn for both sides.
2. Keep PRs focused. A bug fix and a refactor in the same PR are harder to review and revert.
3. Run `npm run lint` and `npm test` before pushing.
4. Reference the issue in the PR description if one exists.

## Reporting issues

Bug reports are most useful when they include:

- The exact URL (for `r.jina.ai`) or query (for `s.jina.ai`).
- The request headers in use, especially any `x-*` overrides.
- The expected vs actual output.

Open an issue on GitHub and we'll take a look.
