# Hermes authenticated-provider Electron QA report

Date: 2026-08-15 (Europe/Istanbul)

## Executive result

The isolated Electron QA profile now references the same legitimate ChatMock
provider session used by normal Breadboard without copying or printing its
credentials. The reference is an external, read-only auth-file path. All
Breadboard application state remains disposable: database, account, garden,
conversation, artifact, Hermes, temporary-file, log, Terminal, and download
paths stay under the QA run.

The required completion criterion passed:

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
[hermes-provider-backed-inventory.json](../../.qa-results/runs/20260815110339-48428-049ecd44/hermes-provider-backed-inventory.json).
Dashboard-Terminal replay evidence is retained at
[scenario-results-20260815112014-39684-999ca1e7.json](../../.qa-results/runs/20260815112014-39684-999ca1e7/scenario-results-20260815112014-39684-999ca1e7.json).

| Result | Count |
| --- | ---: |
| PASS | 4 |
| FAIL | 1 |
| BLOCKED | 10 |
| **Provider-blocked rows re-audited** | **15** |

| Scenario | Result | Evidence / interpretation |
| --- | --- | --- |
| `garden-chat-document-grounding` | **PASS** | Uploaded Markdown fact was queried through Garden Chat; `GROUNDING_SEVEN_OK` appeared in the assistant UI. |
| `garden-chat-follow-up-context` | **BLOCKED** | Provider was reachable, but no completed follow-up invariant was visible in the renderer within the bound. |
| `conversation-isolation` | **PASS** | Separate Garden B marker was not exposed when returning to Garden A; `ISOLATION_ALPHA_OK` completed visibly. |
| `conversation-history-search-reopen` | **BLOCKED** | No completed history conversation was available to reopen with the required marker. |
| `conversation-branch-independence` | **BLOCKED** | Real edit/create-branch control was exercised, but no completed branch response appeared. |
| `chat-cancel-and-recover` | **PASS** | Visible stop control recovered the Garden Chat composer and `CHAT_RECOVERY_OK` completed. |
| `terminal-command-completion` | **BLOCKED** | Focused dashboard-Terminal UI opened, but the safe command did not reach a completed result within the bound. |
| `terminal-cancel-and-reuse` | **PASS** | Focused dashboard-Terminal replay stopped the active run and left the composer reusable. |
| `terminal-error-recovery` | **BLOCKED** | Deterministic failing Terminal task did not reach a completed recovery result. |
| `terminal-refresh-run-state` | **BLOCKED** | No completed Terminal output was available to restore after renderer refresh. |
| `artifact-create-open-content` | **BLOCKED** | Provider-backed artifact request did not produce an owned artifact card/content view. |
| `artifact-refresh-restart-persistence` | **BLOCKED** | An earlier text-marker check was a prompt/history false positive; audited card selector found no artifact. |
| `learn-plan-confirm-build` | **BLOCKED** | No deterministic approved Learn plan/build fixture is enabled in the isolated profile. |
| `learn-cancel-and-retry` | **BLOCKED** | No deterministic approved Learn plan/build fixture is enabled in the isolated profile. |
| `desktop-renderer-refresh-persistence` | **FAIL** | A completed assistant marker was not visible after renderer reload; this requires product-versus-harness follow-up rather than being relabeled PASS. |

The separate basic exact-phrase UI check is PASS in the retained receipt above.
Text attachment selection was exercised through the real file picker and the
grounding fixture; no vision success is claimed. Optional tool/artifact,
steering, Learn, and long-running Terminal completion remain blocked unless
their UI invariant is actually observed.

## Interpretation of FAIL and BLOCKED

`BLOCKED` means the bounded UI invariant was not established or the optional
fixture/surface was unavailable; it is not a claim that the provider returned
401. The provider-backed run reached ChatMock model health and multiple
`/api/chat` HTTP 200 responses. `FAIL` is reserved for a reached assertion
whose required state was not preserved; the renderer-refresh row is currently
the one such candidate and needs a focused reproduction before any product
repair is attempted.

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
its QA containment changes are not part of a parent Git commit. If the
renderer-refresh FAIL becomes a Hermes defect, reproduce it in that checkout
and preserve any fix as a separate nested-repository change.

## Remaining work

The authenticated provider blocker is removed and the real Electron model-turn
criterion is met. The remaining 10 BLOCKED rows and one FAIL are actionable QA
results, not hidden provider transport failures. Next work should focus on:

1. a focused renderer-refresh/history reproduction to distinguish persistence
   defect from assistant-message selector/hydration behavior;
2. a bounded Terminal/tool fixture that produces a deterministic visible
   completion in the dashboard Terminal;
3. reviewed artifact and Learn fixtures; and
4. a vision-capable provider profile before claiming image reasoning.
