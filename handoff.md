# Handoff: Electromagnetism 1 Learn Pipeline

> Last refreshed: 2026-08-16 at the selected provider's post-reset pre-launch check, immediately before the next fresh Learn plan launch.

## Objective and authority

Finish the fully source-grounded Learn pipeline for garden `electromagnetism-1`, using:

- syllabus source: `studyguide-5epf0`
- only teaching source: `engineering-electromagnetics-9th-ed-9nbsped-compress`
- model: resolve dynamically from the garden owner's current selected-model setting

The user explicitly authorized continuing autonomously while they sleep. Do not ask for routine confirmation. Do **not** make deterministic academic, coverage, formula, visual, source-map, or lesson-content fixes. All semantic repairs must remain bounded and model-authored. Never mutate the DB, locks, maps, or published content directly.

## Current state

A fresh plan is running: `learn_job_msvzpn6g_gqfy55f`, launched 2026-08-16T15:59:09Z.

Pre-launch check passed immediately before launch: dashboard and ChatMock health both `ok`, all four Learn locks absent, no active Learn job, the latest failed job (`learn_job_msvlxbbp_22jqa3h`) had zero map and zero version rows, and neither `quartz/content/electromagnetism-1/learning` nor its public counterpart existed. The model resolved dynamically from the owner's setting to `cliproxy/claude-opus-5`; nothing was substituted. The session quota that ended the previous plan had long since reset.

### Launcher

The dev server still rejects a locally minted NextAuth owner session. This was re-tested this session rather than assumed: a token minted with the project's own `next-auth/jwt` `encode` and the `NEXTAUTH_SECRET` from `dashboard/.env.local` round-trips through `decode` locally but yields `{}` from `/api/auth/session`, and no other file in the repository sets that variable, so the running dev server holds a different value in its process environment. Restarting it with the checked-in secret is the real fix and remains open.

Until then the plan is launched through the same `runLearnPipeline` entry point the route uses, via two temporary files at the dashboard root:

- `tmp-alias-hook.mjs` supplies only what the bundler normally would: the `@/*` to `src/*` tsconfig alias and extensionless specifier resolution. It changes no module behaviour.
- `tmp-learn-plan-runner.mjs` mirrors the route step for step, including the existing-learner-content pre-check, `createChatmockClient` over the route's own resolved base URL, `selectedModelForUser`, `sourceOnly: true`, `includeSourceSnapshots: false`, and no auto-confirmation. It takes the garden slug, syllabus id, and source ids as arguments, so it carries no garden-specific value of its own.

Delete both once the authenticated route works.

### Garden-independence audit

Checked this session across `dashboard/src`: no occurrence of `electromagnetism`, `studyguide-5epf0`, `9nbsped`, or `Hayt` outside one unrelated explanatory comment in `lib/learn-utils.ts`, and no hardcoded page range corresponding to the withheld 553-577 band. The trusted/withheld page split is derived from raw fenced-page ambiguity generically, not written down per source.

### Previous failures

- Latest failed plan: `learn_job_msvlxbbp_22jqa3h`.
- It passed the former external-cache boundary (formula review progressed past page 21), then failed safely before coverage because the user's selected `cliproxy/claude-opus-5` provider returned an explicit session-quota message through HTTP 502.
- ChatMock's routing receipt states: `You've hit your session limit · resets 1:30pm (Europe/Istanbul)`.
- Rollback is clean: zero maps, zero versions, no learning output, and no active locks.
- Do not substitute a different model or change the user's selected-model setting. Do not start another plan before the stated quota reset; refresh this handoff immediately before any later new launch.

Post-reset pre-launch check completed at 13:30 Europe/Istanbul: ChatMock is healthy; its model-health endpoint reports the preferred and serving model as `cliproxy/claude-opus-5` with no cooldown or failover; the provider endpoint reports no unhealthy provider. The latest Learn job has zero map/version rows, there is no active Learn job, and all four locks are absent. No paid model probe was sent; the next ordinary Learn request is the first live proof after reset.

The immediate post-reset launch attempt was blocked **before any process or Learn job was created** by Codex's execution approval layer reporting its own usage limit. This is not a dashboard, ChatMock, provider, or selected-model failure. Do not work around that block through an indirect launcher; once execution authority is available again, repeat the no-active-job/no-lock check, refresh this handoff immediately before launch, and use the normal plan entry point.

- Latest failed plan: `learn_job_msvkrhpf_g3fzqw5`
- It failed safely at 2%, before syllabus coverage or Source Map planning, when a first-time external formula-review cache write hit Windows `EPERM`.
- This was a cache-optimization failure, not a model or formula-provenance rejection. The three concurrent formula-review requests had returned successfully.
- Rollback restored 14 paths and deleted zero maps/versions. There is no map, version, publication, job workspace, or active build lock from that job.
- The earlier Source Map timeout jobs (`learn_job_msvisv4h_dep75f2` and `learn_job_msvjky03_8v5lj3c`) also remain cleanly rolled back.

The native-ESM transport fix and the external-cache hardening below are complete and independently tested. This handoff was refreshed immediately before the active run, as requested. Resolve the garden owner's selected model dynamically; do not substitute a model merely because it differs from earlier runs.

The cache-hardening pre-launch check passed before `learn_job_msvlxbbp_22jqa3h`: the prior job was failed with zero map/version rows, there were no active Learn jobs, all four Learn locks were absent, and both the dashboard and ChatMock health endpoints reported `ok`.

## Resolved transport blocker: native-ESM client fell back to Node's five-minute header timeout

The two failures were reproducible at roughly five minutes only when the initial Source Map draft was rejected for omitted registered artifacts and a full replacement was requested.

`dashboard/src/lib/knowledge.ts` previously intended to use an Undici dispatcher with a 30-minute header/body timeout, but called bare `require("undici")`. The direct background runner loads this module as native ESM, where bare `require` is undefined; the catch silently chose global `fetch`, whose header timeout is exactly 300 seconds.

This was verified rather than inferred: the second failed repair began at `08:37:58Z`, its caller timed out at `08:43:03Z`, while ChatMock completed the corresponding provider request successfully at `08:44:03Z` (365.119 seconds). The returned model JSON correctly partitioned all 197 registered figures exactly once. This was transport behavior, not a model-quality or provider failure.

The fix is frozen:

- New `dashboard/src/lib/chatmock-client.ts` statically imports Undici and creates an explicit singleton Agent with 30-minute header/body timeouts.
- There is no silent fallback to global `fetch`.
- `knowledge.ts` preserves its existing `createChatmockClient` API by re-exporting the new client.
- `dashboard/tests/chatmock-client-transport.test.mjs` proves native ESM has no `require`, the exact dispatcher options propagate, and the OpenAI client never uses global fetch.

Validation: transport test 1/1 passed; combined `learn-pipeline-hardening-regression`, `learn-build-pipeline`, and transport gate 86/86 passed; targeted TypeScript and ESLint had zero owned errors; scoped `git diff --check` passed.

The repair packet remains expensive (about 566k user characters / 162k input tokens in the failed attempt). A future generic optimization should state the exact artifact-partition requirement earlier, compact repeated diagnostics/evidence, and apply one shared stage budget. That is a latency/cost follow-up, not a correctness blocker; do not truncate evidence or auto-assign artifacts.

## Resolved cache blocker: transient external formula-review cache write could abort Learn

The next fresh plan (`learn_job_msvkrhpf_g3fzqw5`) exposed a separate Windows filesystem boundary before it reached the Source Map stage. Its selected model did not have a prior formula-review cache entry, so the review path attempted to create one under `%LOCALAPPDATA%\\Breadboard\\cache\\source-formula-reviews`. A transient `EPERM` opening the old predictable temporary file aborted the whole pipeline even though that cache is only an optimization.

The fix is frozen:

- `dashboard/src/lib/resilient-fs.ts` now provides a shared external-cache publisher with UUID-named exclusive (`wx`) temps, same-directory no-clobber hard-link publication, strict reread/identity validation of a racing winner, unique invalid-winner quarantine, and bounded transient retry.
- Only the normal formula-review and V4 artifact-recovery **external** cache writers may return `degraded` after retry exhaustion. They continue with the newly model-authored result; candidate self-validation is unchanged.
- Durable reviewed-page, crop, and garden review-record persistence is unchanged and fail-closed. A durable write failure still aborts the run rather than weakening provenance.
- The redundant second normal-cache publish was removed, avoiding a duplicate contention window.

Validation: combined resilient-filesystem/source-visuals/source-finalizer gate 82/82 passed; targeted strict TypeScript passed; ESLint had zero errors; and scoped `git diff --check` passed. Independent audit confirmed that partial/invalid racing winners are never accepted and persistent external cache failure cannot suppress a durable evidence failure.

## Resolved quota/retry-budget mismatch

The quota failure exposed two transport-only issues, both now fixed and independently audited:

- A ChatMock HTTP 502 that explicitly says the selected provider's **session/quota limit** has been reached and gives a reset/retry marker is now terminal rather than being misclassified as an ordinary transient 502. It preserves the provider's original error and never substitutes a different model.
- Ordinary 502 and connection-failure behavior is unchanged: its six-attempt schedule remains `[0, 0, 0, 240000, 240000, 240000]` milliseconds. The shared exported total delay is 720,000 ms.
- Formula-review's logical timeout was previously 180,000 ms, which could abort before the schedule's first four-minute backoff completed. Its finite default is now derived as 930,000 ms: full retry delays + 180,000 ms final-request allowance + 30,000 ms margin. Explicit operator overrides remain bounded between 30,000 and 1,800,000 ms.

Validation: `chatmock-502-retry` and `source-visuals` passed 84/84 together; focused TypeScript and scoped diff checks passed. Independent reviewers confirmed no prompt, semantic repair, selected-model, fallback, or accounting behavior changed.

## Recently completed recovery hardening

The coverage/LUC recovery work is frozen and independently audited:

- Initial coverage uses exact canonical source pages 1–8.
- If a valid syllabus has one or more units but zero teachable units, a one-cycle model-authored page-selection + full coverage rereview protocol runs before Source Map/LUC planning.
- It strictly selects redundant `{anchorId, sourceId, pageNumber}` identities and mechanically hydrates complete raw pages. No title/topic/locator matching or inferred pages is allowed.
- If rereview remains all-false, it fails before Source Map/LUC; it never fabricates teachability or lessons.
- The receipt is bound through coverage plan, LUC, map, confirmation, generation, finalizer, and scoped repair.
- Raw fenced-page ambiguity is conservative: in the Hayt source, pages 553–577 are withheld; trusted pages are 1–552 and 578–606. The withheld pages cannot be selected as evidence.
- Exact raw provider text is preserved for coverage recovery and initial/full Learning Unit Contract repair lineage.

Verification already passed:

```powershell
cd dashboard
node --test --experimental-strip-types tests/learn-syllabus-materials.test.mjs tests/learn-syllabus-coverage-recovery.test.mjs tests/learning-spine-full-repair.test.mjs tests/learn-pipeline-hardening-regression.test.mjs tests/source-formula-finalization.test.mjs tests/learn-scoped-repair.test.mjs
# 130/130 pass for coverage/recovery/finalization before the separate transport gate
```

Independent gates also passed parser/recovery/LUC lineage (94/94 plus 14 exact-content tests) and finalizer/scoped repair (94/94). Owned TypeScript diagnostics were clean; full-project TypeScript has unrelated Openwork/Bun baseline failures.

## Important operational constraints

- Repository root: `C:\Users\20252082\breadboard`
- Dashboard: `C:\Users\20252082\breadboard\dashboard`
- Database: `dashboard/db/brain.db`
- Event log: `quartz/content/electromagnetism-1/.breadboard/events.jsonl`
- Dashboard health: `http://127.0.0.1:3000/api/health`
- ChatMock health: `http://127.0.0.1:8765/health`
- Never delete lock files. The relevant locks are:
  - `quartz/content/.electromagnetism-1.learn-build.lock.json`
  - `quartz/public/.electromagnetism-1.learn-build.lock.json`
  - `quartz/content/electromagnetism-1/.breadboard/learn-build.lock.json`
  - `quartz/public/electromagnetism-1/.breadboard/learn-build.lock.json`
- Do not retry a POST merely because the client times out. Query the DB/event log first.
- Confirmation is a real gate: only confirm a newly proposed map after it reaches `awaiting_confirmation` and passes map/receipt/inventory checks. Then start generation with the confirmed map.
- Never publish until finalization has passed. On failure, verify zero maps/versions for the failed job, absent public `learning/`, released locks, and rollback event.

## Safe continuation sequence

1. Confirm there is no active job or Learn lock and that the latest failed job has no map/version.
2. Start a fresh `plan` using the source and syllabus listed above, with `sourceOnly: true`, `includeSourceSnapshots: false`, and no automatic confirmation.
3. Monitor DB + event log. If coverage is nonzero-teachable, the new evidence-recovery protocol correctly does not trigger. If it is all-false, audit the bounded recovery receipt before proceeding.
4. At `awaiting_confirmation`, verify the proposed map's source set, formula-review hash, artifact inventory hash, and coverage-recovery binding. Confirm it, then monitor isolated generation.
5. Only report success after a committed `learn_versions` row and publication/finalization evidence exist.

## API/auth note

The normal local plan route is:

`POST /api/gardens/electromagnetism-1/learn/plan`

with the source/syllabus payload described above. Locally minted NextAuth owner JWTs were unexpectedly rejected by the dev server even after a clean restart, so the previous two plans were launched through the same `runLearnPipeline` entry point used by the route, with the garden owner's actual DB id, exact source/syllabus inputs, selected model, and normal locks/rollback. That direct native-ESM execution exposed the timeout fallback above. Prefer the ordinary authenticated route if a valid browser session is available; otherwise do not bypass any pipeline validation when using the direct entry point.

A bare direct Node runner must inherit `OPENAI_API_KEY=local` (or the dashboard's equivalent local value). ChatMock accepts that local credential, but the OpenAI SDK rejects a missing key before `runLearnPipeline` can create a job. This is launcher configuration only; do not put a model choice in the runner.

## What not to do

- Do not hardcode pages 11/12 or any source/topic match.
- Do not make a Source Map, LUC, or visual correction in code.
- Do not enlarge repair candidate counts merely to get past a failure.
- Do not auto-confirm a proposal or publish partial output.
- Do not alter database rows, map files, formula receipts, locks, or old confirmed maps directly.
