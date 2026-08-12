# skills.sh live synchronization validation

Date: 2026-07-19  
Result: Passed

> Historical evidence: this report predates the standalone Breadboard catalog
> proxy. Its direct-authentication and command-line download paths have been
> replaced; see `docs/SKILLS_CATALOG_PROXY.md` for the current architecture.

## Authentication and secret handling

- The former dashboard deployment successfully authenticated to the upstream catalog with a request-scoped Vercel deployment identity.
- The token value was never printed, logged, embedded in screenshots, or written into this report.
- Existing `.env.local` values were left intact.

## Live catalog synchronization

The explicit forced synchronization completed successfully across the `all-time`, `trending`, and `hot` views:

- 50 pages fetched
- 24,074 view records received
- 13,991 stable skills stored after identity deduplication
- no synchronization failure or stale fallback

After the configured stale window elapsed, the repaired startup scheduler completed another authenticated refresh:

- 52 pages fetched
- 25,203 view records received
- 14,593 stable skills currently available
- 852 records added, 13,365 changed/reranked, and 250 safely marked unlisted relative to the previous snapshot
- current snapshot is fresh and `lastFailure` is null

## Live search, detail, and audit validation

The opt-in live integration test passed end to end:

- exhausted every catalog page rather than stopping after the first page
- found `grill-me` through generic API search
- retrieved the immutable detail hash and published files
- exercised the upstream audit endpoint, accepting only the documented no-audits 404 as an alternative
- downloaded through the former command-line transport in an isolated temporary project (no longer used by Breadboard)
- completed temporary quarantine, review, promotion, and qualified slash-command resolution for general, PDF, and React-oriented examples

The authenticated browser detail view for `/mattpocock:grill-me` returned two files and five passing upstream audit providers:

- Gen Agent Trust Hub
- Socket
- Snyk
- Runlayer
- ZeroLeaks

Upstream audits remain supplementary; Breadboard still requires its own inactive quarantine, integrity check, permission review, and explicit approval.

## Generic lifecycle and UI validation

- Generic lifecycle/routing/catalog UI run: 36 passed, 0 failed, 1 optional historical live-search test skipped.
- The separate authenticated live integration covered live API search, detail, audit, and the former download transport.
- Quarantine limits, traversal rejection, hash pinning, tamper rejection, conditional coding storage, collision-safe slash commands, update review, rejection, removal, and permission recording all passed.

## UI screenshots

- [Live catalog](./skills-catalog-live.png)
- [Live detail and upstream audits](./skills-catalog-detail-live.png)

The first screenshot was captured before the subsequent automatic refresh, so it visibly reports 13,991 skills. The latest durable snapshot contains 14,593.

Both captures were made at 1440×1000 and were visually inspected. The catalog controls, filters, pagination/list rows, detail metadata, audit results, file inventory, and review action are readable without clipping.

## Build issue found and fixed

The authenticated browser run exposed a Next.js runtime-boundary error: shared `instrumentation.ts` caused the browser instrumentation bundle to trace the Node-only SQLite catalog scheduler and attempt to compile `better-sqlite3`, `node:fs`, and `node:crypto`.

The scheduler now lives in `src/instrumentation-node.ts`, while shared instrumentation conditionally imports it only for `NEXT_RUNTIME === "nodejs"`, following the installed Next.js instrumentation guidance. A regression test verifies that the shared file no longer imports the catalog store or synchronizer.

## Final validation

- Dashboard suite: 1,205 tests; 1,191 passed, 14 opt-in tests skipped, 0 failed
- TypeScript: passed
- Scoped ESLint: passed
- Next.js production build: passed
- Authenticated dashboard dev server: restarted and responding on port 3000

The production build retains four pre-existing Turbopack NFT tracing warnings associated with `next.config.ts` and markdown/Quartz route tracing. They did not fail compilation and are unrelated to the skills.sh synchronization change.
