# Runtime V2 parity drift audit

Date: 2026-08-25

The seven source-only parity failures produced by the intentional terminal and
document-ingestion changes have been reconciled without recording any
post-migration execution evidence. Existing `preMigrationEvidence` arrays remain
unchanged, every affected capability still has `postMigrationStatus: "NOT RUN"`
and `result: "NOT RUN"`, and no source-only result is presented as an Electron
workflow pass.

## Reconciled source drift

| Signal | Verified cause | Reconciliation |
|---|---|---|
| `surface:dashboard-terminal sourceSha256` | The terminal source intentionally removed the visible “open when needed” text. The existing four mock/fallback declarations retained the same paths and text; only their source lines moved from 625/3369 to 626/3375. | Recorded the current source digest and exact declaration pointers. The original pre-migration evidence remains intact. |
| `surface:garden-chat sourceRefs` and `sourceSha256` | Garden upload controls now persist an ingestion request identity, reconnect to the durable job stream, and recover reload/cancel races. The `garden_chat` anchor moved from line 9931 to 10092. | Recorded the current source reference/digest and line-only movement of the same 17 fallback declarations. No UI or recovery execution result was inferred. |
| `workflow:ingestion mockOrFallbackDeclarations`, `sourceRefs`, and `sourceSha256` | `/api/ingest` was intentionally reduced from the direct in-process extractor to the bounded Runtime V2 compatibility adapter. Its anchor moved from line 1992 to 68; the four direct-route fallback declarations moved behind the worker boundary, leaving zero in the route’s audited source set. | Recorded the current route digest, anchor, and empty declaration set while retaining the original pre-migration route/evidence and all `NOT RUN` post fields. |
| `nextApiRoutes` source catalog | Three scoped ingestion recovery routes were added: `POST /api/ingest/jobs/lookup`, `GET /api/ingest/jobs/[jobId]/events`, and `POST /api/ingest/jobs/[jobId]/cancel`. | Updated the catalog from 518 routes / `2ebb72fd536913178a99460d952c1f4c9c9b110bcb1fd3af489b561d2708afd9` to 521 routes / `31660425632289306aa3f0480585cad06b53693f647b51f0eb59c0b1f4028116`. |

## Inventory corrections

- Recorded the ComfyUI image-generation branch as Runtime V2 source-verified but
  not centrally activated or post-migration tested. The workflow remains
  `NOT RUN`; provider/edit/upload branches are not implied migrated, and the
  detached setup installer remains a separate inventory gap.
- Added stable capability `tool-family:code-index` for the visible **Graft code
  index** Garden switch, finite graph build, and repository-scoped Graft MCP
  path used by Codex, OpenCode, and Ruflo. Its evidence proves the capability
  existed in the pre-migration source (including the original dashboard line
  3246); its post-migration status and result remain `NOT RUN`.
- Replaced the nonexistent execution-inventory term
  `workflow:quartz-build` with the established
  `workflow:quartz-publishing` capability on both Quartz compiler entries.
- Corrected the Quartz publish cancellation description. The current source has
  no user `AbortSignal` cancellation path: only the build timeout sends
  `SIGTERM` to the direct child, without Runtime V2 descendant containment.
- The parity registry now contains 476 rows, including 33 tool-family rows.
  Sixty-four of 112 unique execution-inventory references join the parity
  registry; 48 execution-only taxonomy terms remain explicitly pending.
- A migrated inventory entry now fails validation if any declared capability ID
  is still pending reconciliation. The closed check applies to Runtime V2
  current-ownership states, not to legacy targets, explicit not-cut-over states,
  or incompatibility notes.

## Source-only checks

- `node qa/runtime-v2/run-parity.mjs --inventory-only`: **PASS**, 476 rows.
- `node qa/runtime-v2/validate-execution-inventory.mjs`: **PASS**, 122 entries,
  37 runtime-agent joins, and 13 recorded gap rows.
- `node --test qa/runtime-v2/parity-drift.test.mjs qa/runtime-v2/execution-inventory-validation.test.mjs`:
  **PASS**, 7/7.

No application, service, worker, compiler, bundler, build, packaging, browser,
model, container, Electron workflow, or post-migration parity workflow was
started.

## 2026-08-26 packaged-closure/static reconciliation

The source-only checker initially rejected 53 structural differences across the
496-row frozen registry. The generated baseline and matrix were refreshed only
through `node qa/runtime-v2/registry-snapshot.mjs --write-artifacts`, and only
after each source group below was inspected. A concurrent finalization of the
service manifest was allowed to settle and was reviewed before the final
generator pass; the transient stale snapshots were not accepted as evidence.

### Reconciled source identity drift

| Scope | Verified cause | Reconciliation |
|---|---|---|
| All 16 `artifact:*` rows; `workflow:artifact-lifecycle`; `workflow:document-editing` | `dashboard/src/lib/hermes/artifact-store.ts` gained reviewed Runtime V2 delegation for watermark/Office work, atomic artifact promotion and durable-ready checks, plus user-scoped Garden publication. The shared artifact anchor moved from 588 to 591, the lifecycle anchor from 336 to 339, and the document-edit anchor from 525 to 528. | Updated only current source references/digests. Artifact identities, kinds, routes, lifecycle contracts and the four fallback declarations are unchanged; the fallback evidence moved by line number only. |
| `recovery:durable-runtime-jobs` | Runtime service diagnostics and ownership work moved the completion-authority anchor in `native/runtime-core/src/process_owner.rs` from 3155 to 3135. The accepted-start boundary, owned root PID, normal target exit, complete accounting and no-supervisor/cleanup-error requirements remain intact. | Updated only the current source reference/digest. No weaker completion or recovery claim was accepted. |
| `service:quartz`; document-page retrieval; local rewriting; model gateway; speech synthesis; video transcription | Reviewed packaged-service closure profiles and receipt probes changed `desktop/runtime-v2/manifests/services.json`. Final OpenWork reconciliation split its old combined profile: lean/hot retain managed data-root probes, while packaged mode now probes immutable app-root OpenWork source/runtime receipts, bundled Node and Bun, sealed agent scripts and packaged OpenCode. Accidental ChatMock/Hermes mode edits were removed before the final snapshot. | Updated only manifest-backed source references/digests. Current anchors are model gateway 1386, Quartz 1466, document retrieval 1691, local rewriting 1750, speech 1810 and video transcription 1895. Service IDs, capability arrays, mode uniqueness and launch ownership remain closed. |
| `workflow:runtime-setup` | Reviewed fixed-source setup/probe work moved the managed setup executor anchor from 2098 to 2106. | Updated only the current source reference/digest. The managed setup capability and route/worker contract are unchanged. |
| `nextApiRoutes` source catalog | One fail-closed QA diagnostic route was added at `dashboard/src/app/api/internal/runtime-service-evidence/route.ts`. It defaults to 404 unless explicitly enabled, accepts loopback traffic only, requires a timing-safe 64-hex bearer token, and caps the streaming request body at 1 KiB. Its closed service inventory is exercised by `qa/memory/service-evidence-contract.test.mjs`; it is not a user capability or live parity receipt. | Updated the catalog from 524 routes / `80f4f3eab81fbd84b86fa11e8c89221ac196d07435e51562807483a45c20ad7e` to 525 routes / `f7a647536eb74a6f4926513da485d3f1939fb213b5183ffe1141df9a4bea9810`. Removing exactly this route from the current catalog reproduces the former count and digest. |

No capability ID was added, removed, renamed or rerouted by this reconciliation.
For every affected row, independently frozen semantic fields remained
byte-identical except the reviewed source references, source digests and
line-only mock/fallback pointers described above. The preserved historical
evidence/status digest remains
`6041e56b28ec01e1cedbf269fe41bf5199f6fcdb60e0a804dc9608a6ef418cfa`.
All 496 rows still have `postMigrationStatus: "NOT RUN"` and `result: "NOT RUN"`;
zero rows contain post-migration evidence. No `PASS` or `BLOCKED` result was
created.

### Source-only checks

- `node qa/runtime-v2/run-parity.mjs --inventory-only`: **PASS**, 496 rows.
- `npm run qa:runtime-v2:inventory`: **PASS**, 142 entries (83 finite, 59
  persistent), 37 runtime-agent joins, 8 gap rows, 644 source paths and 313
  mapped process-boundary files.
- `node --test qa/runtime-v2/parity-drift.test.mjs qa/runtime-v2/execution-inventory-validation.test.mjs`:
  **PASS**, 8/8.
- `node --test qa/memory/service-evidence-contract.test.mjs`: **PASS**, 8/8.

No application, service, worker, compiler, bundler, build, packaging, browser,
model, container, Electron workflow, or post-migration parity workflow was
started.
