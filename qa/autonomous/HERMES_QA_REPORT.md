# Hermes authenticated-provider Electron QA report

Date: 2026-08-15 (Europe/Istanbul)

> **Superseded by [`HERMES_CORE_COMPLETION_REPORT.md`](HERMES_CORE_COMPLETION_REPORT.md).**
> The provider-backed PASS rows below predate the answer-leakage audit and must
> not be used as current grounding, context-retrieval, terminal-readback,
> artifact-content, or renderer-refresh completion evidence until the corrected
> specs produce fresh receipts.

## Executive result (historical; superseded)

The isolated Electron QA profile historically referenced the same legitimate ChatMock
provider session used by normal Breadboard without copying or printing its
credentials. The reference is an external, read-only auth-file path. All
Breadboard application state remains disposable: database, account, garden,
conversation, artifact, Hermes, temporary-file, log, Terminal, and download
paths stay under the QA run.

The historical completion criterion was recorded as passed, but that result is
invalidated for current completion reporting by the answer-leakage audit. A
fresh corrected replay is required before claiming it again:

> A real model-backed Hermes turn completed through the actual Breadboard
> Electron UI.

The prompt `Reply with the exact phrase HERMES_E2E_OK.` produced the visible
assistant text `HERMES_E2E_OK` in run
[hermes-conversational-attempt.json](../../.qa-results/runs/20260815103416-50300-07249c32/hermes-conversational-attempt.json).
The preceding redacted SSE receipt shows the provider delta and the ChatMock
log records `/v1/chat/completions` HTTP 200; those are supporting evidence only,
not the success assertion. The UI assertion is the completion criterion.

The authenticated source file was verified unchanged (hash and last-write
metadata) after the successful replay. No credential contents appear in a
scenario, receipt, log, or report.

## Authentication architecture and repair

Normal development resolves ChatMock's Codex home to
`.runtime/codex-desktop/auth.json`. That file contains the existing provider
session. Isolated QA deliberately changes `CODEX_HOME` to the disposable run
tree, which is why the old QA ChatMock returned 401 despite Hermes and ChatMock
being healthy.

The QA-only path is now:

```text
normal Breadboard .runtime/codex-desktop/auth.json
                 │ external absolute reference
                 ▼
QA ChatMock CHATMOCK_AUTH_FILE (read-only)
                 │
                 ▼
disposable QA database / users / gardens / chats / artifacts / Hermes state
```

`CHATMOCK_AUTH_FILE` is accepted only when explicitly supplied through
`BREADBOARD_QA_PROVIDER_AUTH_FILE`. QA validates that it is a regular file,
resolves its real path, rejects a path inside the disposable data root, and
sets `CHATMOCK_AUTH_READ_ONLY=1`. Token refreshes remain in memory for the
request and are never persisted to the reference file. With no explicit opt-in,
QA remains credential-free and keeps the old blocked behavior.

Changed QA/auth files are [chatmock utils](../../chatmock/chatmock/utils.py),
[ChatMock account selection](../../chatmock/chatmock/accounts.py),
[desktop QA mode](../../desktop/src/main/qa-mode.ts), and the
[QA environment](../electron/environment.ts). The focused ChatMock auth test
passes 5/5; the full desktop suite passes 137/137.

## Provider-backed scenario re-audit

The canonical summary is [HERMES_PROVIDER_REPLAY_RECEIPT.json](HERMES_PROVIDER_REPLAY_RECEIPT.json).
The main Electron inventory is retained at
[hermes-provider-backed-inventory.json](../../.qa-results/runs/20260815120820-4696-d0239b6d/hermes-provider-backed-inventory.json).
The renderer-refresh reproduction and post-repair replay are retained at
[renderer-refresh-reproduction.json](../../.qa-results/runs/20260815120302-34996-239a261f/renderer-refresh-reproduction.json).
The focused dashboard-Terminal replay is retained at
[scenario-results-20260815123613-18440-68acd14f.json](../../.qa-results/runs/20260815123613-18440-68acd14f/scenario-results-20260815123613-18440-68acd14f.json).

| Result | Count |
| --- | ---: |
| PASS | 5 |
| FAIL | 0 |
| BLOCKED | 7 |
| SKIPPED_OPTIONAL | 2 |
| NOT_SUPPORTED | 1 |
| **Provider-blocked rows re-audited** | **15** |

| Scenario | Result | Evidence / interpretation |
| --- | --- | --- |
| `garden-chat-document-grounding` | **PASS** | Uploaded Markdown fact was queried through Garden Chat; `GROUNDING_SEVEN_OK` appeared in the assistant UI. |
| `garden-chat-follow-up-context` | **BLOCKED** | `PRODUCT_PREREQUISITE_MISSING`: provider completed the grounded turn, but no deterministic follow-up invariant was visible in the bounded renderer replay. |
| `conversation-isolation` | **PASS** | Separate Garden B marker was not exposed when returning to Garden A; `ISOLATION_ALPHA_OK` completed visibly. |
| `conversation-history-search-reopen` | **NOT_SUPPORTED** | `INTENTIONALLY_UNSUPPORTED`: the implemented Garden Chat surface exposes Recents only; no chat-history search control is present. |
| `conversation-branch-independence` | **BLOCKED** | `PRODUCT_PREREQUISITE_MISSING`: the real edit/create-branch control was visible, but the provider did not yield a completed branch response. |
| `chat-cancel-and-recover` | **PASS** | Visible stop control recovered the Garden Chat composer and `CHAT_RECOVERY_OK` completed. |
| `terminal-command-completion` | **BLOCKED** | `PRODUCT_PREREQUISITE_MISSING`: the dashboard-Terminal UI opened, but no safe command reached a completed result within the bound. |
| `terminal-cancel-and-reuse` | **PASS** | The recovered dashboard-Terminal replay stopped the active run and left the composer reusable. |
| `terminal-error-recovery` | **BLOCKED** | `PRODUCT_PREREQUISITE_MISSING`: the recovered Terminal surface accepted the failing-task workflow, but no completed recovery result appeared in the real UI. |
| `terminal-refresh-run-state` | **BLOCKED** | `PRODUCT_PREREQUISITE_MISSING`: no completed Terminal output was available to restore after renderer refresh. |
| `artifact-create-open-content` | **BLOCKED** | `PRODUCT_PREREQUISITE_MISSING`: the provider-backed artifact request did not produce an owned artifact card/content view. |
| `artifact-refresh-restart-persistence` | **BLOCKED** | `QA_FIXTURE_MISSING`: no completed artifact card existed; the earlier text-marker check was a prompt/history false positive. |
| `learn-plan-confirm-build` | **SKIPPED_OPTIONAL** | `OPTIONAL_DEPENDENCY_NOT_CONFIGURED`: Learn is optional and no deterministic provider-backed build fixture is enabled. |
| `learn-cancel-and-retry` | **SKIPPED_OPTIONAL** | `OPTIONAL_DEPENDENCY_NOT_CONFIGURED`: no approved generated Learn plan fixture is enabled. |
| `desktop-renderer-refresh-persistence` | **PASS** | The focused replay awaited the successful transcript PATCH; both user and assistant rows and the exact assistant marker survived renderer reload. |

The raw provider inventory retained two environment-level exceptions while a
long sequence changed the Terminal surface. The per-probe close/reopen repair
removed that cascade in the focused replay; the remaining Terminal blocks are
the missing completion/error prerequisite, not product FAILs.

The separate basic exact-phrase UI check is PASS in the retained receipt above.
Text attachment selection was exercised through the real file picker and the
grounding fixture; no vision success is claimed. Optional tool/artifact,
steering, Learn, and long-running Terminal completion remain blocked unless
their UI invariant is actually observed.

## Interpretation of FAIL and BLOCKED

`BLOCKED` means a required invariant or prerequisite was not established;
`SKIPPED_OPTIONAL` means an explicitly optional surface had no approved
fixture; `NOT_SUPPORTED` means the product surface is intentionally absent;
`FLAKY` means a bounded replay exposed a harness timing/surface race with a
separate focused replay available; and `FAIL` is reserved for a reached
assertion that reproduces a product defect. The provider-backed run reached
ChatMock model health and multiple `/api/chat` HTTP 200 responses.

No canned response, fake model, direct Hermes API assertion, or internal tool
shortcut was used. Primary assertions were Playwright actions and visible
Electron UI state. Health endpoints and service logs were diagnostic only.

## Isolation and privacy checks

- QA `CODEX_HOME`, Hermes home, council ledger, downloads, Terminal workspace,
  service logs, and evidence run roots are disposable and physically guarded.
- The external auth reference is outside the disposable root and read-only;
  no token value is present in this report or the provider receipts.
- Diagnostics redact headers, cookies, URLs, bodies, and configured secret
  values. Retained traces/binary screenshots are local evidence and are not
  declared publication-clean.
- The QA harness intentionally retains evidence under the gitignored root
  `.qa-results`; that is an evidence exception, not an application-state
  escape.
- The normal provider auth source remained unchanged after the UI PASS.

## Hermes repository boundary

No Hermes source change was made to obtain provider access. The separate
ignored `hermes-agent` checkout remains independently dirty from prior work;
its QA containment changes are not part of a parent Git commit. The
renderer-refresh investigation required no product or nested Hermes source
change: the failure was a QA race caused by reloading before the successful
chat-transcript PATCH. The permanent provider regression now waits for that
response and verifies both persisted roles before reloading.

## Remaining work

The authenticated provider blocker is removed and the real Electron model-turn
criterion is met. The provider replay now has 5 PASS, 7 BLOCKED, 2
SKIPPED_OPTIONAL, and 1 NOT_SUPPORTED result, with no unreproduced FAIL. Next work
should focus on:

1. a bounded Terminal/tool fixture that produces a deterministic visible
   completion in the dashboard Terminal;
2. a reviewed artifact fixture and a credential-free Learn plan fixture; and
3. a vision-capable provider profile before claiming image reasoning.
