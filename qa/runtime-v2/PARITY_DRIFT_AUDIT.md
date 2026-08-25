# Runtime V2 parity drift audit

Date: 2026-08-25

The frozen pre-migration artifacts `feature-parity.json` and
`FEATURE_PARITY_MATRIX.md` were not regenerated, rebased, or edited during this
audit. Current source-only parity still fails, as it should, for two genuine
post-freeze source changes.

## Original four failures

| Original signal | Classification | Audit outcome |
|---|---|---|
| `surface:dashboard-terminal mockOrFallbackDeclarations` | Stale generated line pointers plus a validator defect | Declaration count, paths, and text are unchanged. Only pointers moved from lines 625/3369 to 626/3375. The validator now ignores only line-number movement for a complete, non-truncated evidence set. |
| `surface:dashboard-terminal sourceSha256` | Intentional source drift, not parity evidence | Remains **FAIL**. The frozen hash is `1397eaea717e5c069b44bb1ad4d7213d64a47bd652883be5fa432eb8a3539e7e`; current source is `de314fdb9b0c917c8b6e77d1604bbdc7aef8b209be2688d4324fb90c9b17cf80`. Current edits include reload recovery and passive/reconnect lifecycle behavior, but have no inspected post-migration Electron evidence. |
| `surface:dashboard-terminal baselineContractSha256` | Validator defect: derivative duplicate | The checksum is derived from the contract fields, so comparing it as another drift field duplicated the already-reported constituent failure. It is now recomputed for both frozen and current rows as an integrity check. Every constituent field is compared directly. |
| aggregate source-catalog drift | Intentional source drift with imprecise old diagnostics | Remains **FAIL**, now named specifically as `nextApiRoutes`. Route count remains 518, while the frozen hash `2ebb72fd536913178a99460d952c1f4c9c9b110bcb1fd3af489b561d2708afd9` changed to `57d16f925059603202f4d797b1d8dc816810e8af3b2bc6cfdb4e08267a5d89fe`. |

The only Next route files with filesystem modification times newer than the
frozen snapshot are `dashboard/src/app/api/hermes/health/route.ts` and
`dashboard/src/app/api/gbrain/status/route.ts`, both intentionally changed for
passive status/reconnect lifecycle behavior. Modification time is investigative
evidence, not a cryptographic attribution. The frozen catalog stores one
aggregate digest rather than per-file digests, so the exact old bytes cannot be
reconstructed from the baseline artifact. That evidence-granularity gap is not
papered over by updating the frozen hash.

## Validator hardening

- All 28 fields declared by `contractFieldsComparedToSource` are now compared
  directly. The previous validator checked only a subset and relied on the
  aggregate contract hash to catch omitted fields.
- `baselineContractSha256` is recomputed for each frozen and current row. An
  inconsistent checksum is a structural failure, while an underlying field
  change is reported once by name.
- Non-truncated mock/fallback evidence ignores source line movement only; path,
  text, count, and truncation changes still fail. Truncated evidence remains
  hash-strict because its unseen tail cannot be audited safely.
- Source-catalog failures identify the exact catalog and changed count/hash
  fields instead of naming six possible catalogs in one ambiguous message.

## Source-only checks

- `node --test qa/runtime-v2/parity-drift.test.mjs`: **PASS**, 5/5.
- `node qa/runtime-v2/run-parity.mjs --inventory-only`: **FAIL**, 2 genuine
  issues across 475 rows.

No application, service, worker, compiler, bundler, build, packaging, or memory
QA process was started.
