# Hermes conversational-runtime E2E QA report

Date: 2026-08-15 (Europe/Istanbul)  
Scope: credential-free, isolated Breadboard Electron development profile  
Primary replay: `20260815093543-38632-15778faa`  
Earlier harness-timing failure: `20260815091221-48964-fdfef81c`  
Earlier successful provider-blocked replay: `20260815091944-40336-dfd2cf90`

## Executive result

Hermes itself started and its authenticated loopback health endpoint reported
healthy. The real Electron Garden Chat path was exercised end to end:

```text
Electron renderer composer
  -> Breadboard POST /api/chat (HTTP 200)
  -> Hermes runtime
  -> isolated ChatMock /v1 provider
  -> provider response
  -> Breadboard renderer
```

The provider leg stopped with a non-retryable HTTP 401 because the isolated
ChatMock profile has no ChatGPT credentials. No credential-free local chat
fixture or local model exists in this checkout. Consequently, the required
conversation-producing scenarios remain **BLOCKED**, not PASS. The attempt
receipt is [hermes-conversational-attempt.json](../../.qa-results/runs/20260815093543-38632-15778faa/hermes-conversational-attempt.json)
and the redacted service log is retained beside its diagnostics.

The Playwright test itself passed its QA assertions: the real user message was
visible, the attachment control accepted a deterministic text file, the
composer returned to an enabled state, and a workspace reload completed. That
runner PASS must not be read as a conversational-model PASS.

## Conversational surfaces

| Surface | Source of truth | E2E state in this pass |
| --- | --- | --- |
| Garden workspace chat | `workspace-client.tsx` uses `AssistantComposer` with `capabilitySurface="garden_chat"`; `/api/chat` delegates to `garden-chat-adapter.ts` and AgentRuntime/Hermes. | **Attempted through Electron; BLOCKED at provider.** |
| Garden Agent Chat panel | `components/hermes/garden-agent-chat.tsx` uses `useAgentSession("garden_chat")` and `AgentRuntimePanel`; it exposes New chat, recents, Skills, Scheduled, Proposals, and Artifacts. | **Inspected; no separate successful model turn.** Its runtime path is the same `garden_chat` session contract. |
| Dashboard Terminal / general assistant | `components/hermes/dashboard-agent-terminal.tsx` uses `useAgentSession("dashboard_terminal")` and `AgentRuntimePanel`. | **Opened/closed and catalog/readiness-checked in the first Electron pass; conversational completion BLOCKED by the same provider.** |
| Quartz page assistant | `/api/quartz-ai/*` is an authenticated Breadboard proxy; it does not call Hermes directly from the renderer. | **Inspected; no model turn because the shared provider was unavailable.** |
| Shared composer and runtime panel | `assistant-composer.tsx` and `agent-runtime-panel.tsx` implement streaming, progress, permissions, Stop, queued steering, retry, artifacts, attachments, model/reasoning selection, agent/tool/skill/MCP controls. | **Controls and semantics inspected; live tool/progress/steering completion requires a model run.** |
| Artifacts | `artifact-conversation.tsx`, `artifact-panel.tsx`, and `/api/hermes/tools/artifacts`. | **Panel/catalog inspected; creation/open/persistence BLOCKED without a response.** |
| Skills, agents, MCP/connectors | Command/capability hubs and `/api/hermes/skills`, `/api/hermes/agents`, `/api/hermes/mcp` plus first-party tool routes. | **Catalog/search/detail UI checks PASS; installation, delegation, and tool execution BLOCKED without a model/approved optional runtime.** |
| Attachments and image input | Garden chat file picker and composer attachment chips; image attachments are represented as actual image input when a vision-capable provider is selected. | **Text attachment accepted by the real UI. Model question BLOCKED. No vision claim is made.** |

The first failure run showed that a cold Next route could paint a visible
textarea before React hydration. The shared QA helper now waits for the actual
React handlers and for chat-history loading before typing. The replay after
that repair reached `/api/chat` and Hermes, so this was a harness timing defect,
not a product or Hermes result.

## Required Hermes E2E scenarios

| Scenario | Result | Evidence / reason |
| --- | --- | --- |
| Basic exact phrase `HERMES_E2E_OK` | **BLOCKED** | Real Garden Chat submission reached Hermes; isolated ChatMock returned HTTP 401 “Missing ChatGPT credentials”; no assistant completion. |
| Multi-turn `COBALT-731` | **BLOCKED** | Requires a completed first model turn; same provider blocker. |
| Conversation isolation | **BLOCKED** | Requires two completed sessions and a return to A; same provider blocker. |
| Garden grounding deterministic fact | **BLOCKED** | The first pass proved document upload/Quartz readback, but no model-backed retrieval answer can be claimed without a provider. The fact was not placed in the prompt. |
| First-party tool execution | **BLOCKED** | No model decision/tool callback can be produced without a model response; no tool call is fabricated. |
| Artifact generation/open/persistence | **BLOCKED** | Artifact panel is present, but artifact creation is model/tool driven and no assistant turn completed. |
| Text attachment question | **BLOCKED** | Real text attachment selection and visible chip passed (`attachmentVisible: true`); the subsequent runtime question is provider-blocked. |
| Image input | **BLOCKED** | No credential-free vision-capable provider is configured; no silent image-success claim is made. |
| Cancellation | **BLOCKED** | No sufficiently long model run exists to cancel. Stop control is present in the shared panel. |
| Steering | **BLOCKED** | No active model run exists to steer. Queue/steer controls are present and source-inspected. |
| Error recovery | **BLOCKED** | Provider failure was observed in Hermes logs and the composer became usable again, but the required subsequent successful normal message could not run. |
| Renderer refresh | **BLOCKED** | Workspace reload after the failed turn passed, but durable completed conversation history was not available. |
| Application restart | **BLOCKED** | First-pass restart persistence for account/garden/source passed; durable Hermes conversation restart needs a completed model turn. |

Observed diagnostics included Hermes backend readiness, dashboard health/model
probes, the actual `/api/chat` request, renderer/network events, and Hermes
stdout/stderr. The relevant Hermes tail was:

```text
Provider: custom  Model: gpt-5.6-sol
Endpoint: http://127.0.0.1:<isolated-port>/v1
Error: HTTP 401: Missing ChatGPT credentials. Run 'python3 chatmock.py login' first.
Non-retryable client error (HTTP 401). Aborting.
```

The endpoint and run secrets were redacted; no credentials were read or
printed. No Hermes-to-Breadboard tool callback occurred, so there is no tool
success to report.

## Previous 26 BLOCKED scenarios

The first report’s 26 selected BLOCKED scenarios were re-audited. Primary
categories are mutually exclusive; secondary contributing causes are noted in
the reason text.

| Primary category | Count |
| --- | ---: |
| Hermes unavailable | 0 |
| Model/provider unavailable (including model-backed runtime tasks) | 15 |
| Optional external integration unavailable | 4 |
| Missing fixture/configuration | 3 |
| QA test-harness limitation | 4 |
| Product feature intentionally disabled | 0 |
| Other | 0 |
| **Total** | **26** |

| Scenario | Primary blocker and follow-up result |
| --- | --- |
| `pdf-upload-ingestion` | **Missing fixture/configuration**: no deterministic PDF fixture; still blocked. |
| `unsupported-upload-visible-error` | **Missing fixture/configuration**: no harmless unsupported-extension fixture; still blocked. |
| `upload-background-dismissal` | **Missing fixture/configuration**: committed uploads finish too quickly to guarantee a background state; still blocked. |
| `garden-link-ingestion` | **Optional external integration unavailable**: no controlled Reader URL/outbound fixture; still blocked. |
| `garden-chat-document-grounding` | **Model/provider unavailable**: no credential-free completed model turn; still blocked. |
| `garden-chat-follow-up-context` | **Model/provider unavailable**: grounded first turn cannot complete; still blocked. |
| `conversation-isolation` | **Model/provider unavailable**: no two meaningful conversations; still blocked. |
| `conversation-history-search-reopen` | **Model/provider unavailable**: no completed Hermes sessions; still blocked. |
| `conversation-branch-independence` | **Model/provider unavailable**: no completed multi-turn session to branch; still blocked. |
| `chat-cancel-and-recover` | **Model/provider unavailable** with no cancellable run; still blocked. |
| `skill-install-and-invoke` | **Optional external integration unavailable**: no reviewed immutable public QA skill; still blocked. |
| `terminal-command-completion` | **Model/provider unavailable** with a secondary QA workspace/task dependency; still blocked. |
| `terminal-cancel-and-reuse` | **Model/provider unavailable** with a secondary cancellable-task dependency; still blocked. |
| `terminal-error-recovery` | **Model/provider unavailable** with a secondary scoped-workspace/failing-task dependency; still blocked. |
| `terminal-refresh-run-state` | **Model/provider unavailable** with a secondary active-task dependency; still blocked. |
| `agent-safe-run-completion` | **Optional external integration unavailable**: optional agent runtime not configured; still blocked. |
| `agent-cancel-and-recover` | **Optional external integration unavailable**: optional agent runtime intentionally absent from the critical profile; still blocked. |
| `artifact-create-open-content` | **Model/provider unavailable**: no model-backed artifact; still blocked. |
| `artifact-refresh-restart-persistence` | **Model/provider unavailable**: no artifact exists to persist; still blocked. |
| `learn-plan-confirm-build` | **Model/provider unavailable**: no credential-free generated plan; still blocked. |
| `learn-cancel-and-retry` | **Model/provider unavailable**: no approved generated plan; still blocked. |
| `desktop-renderer-refresh-persistence` | **Model/provider unavailable**: completed conversation prerequisite absent; workspace refresh itself remains covered by the first pass. |
| `desktop-required-service-recovery` | **QA test-harness limitation**: no safe service-ownership termination hook; still blocked. |
| `windows-paths-with-spaces` | **QA test-harness limitation**: this replay did not move the worker to a deliberately spaced root; still blocked. |
| `packaged-critical-restart-path` | **QA test-harness limitation**: no verified executable/installer was supplied; still blocked. |
| `desktop-clean-exit-process-tree` | **QA test-harness limitation**: full child/grandchild ownership proof was not available; supporting release checks passed. |

**Unblocked in this Hermes pass: 0 of 26.** The provider was intentionally
not replaced with a canned response or a direct Hermes mock. A future run can
replay the 15 model-backed rows when an explicitly approved, credential-free
provider/model fixture is supplied.

## Direct Hermes tests

Using the existing nested Hermes virtual environment:

- `tests/hermes_cli/test_env_loader.py` plus `tests/hermes_cli/test_early_recovery.py`:
  **33 passed** in 14.02s.
- QA-focused environment, endpoint-guard, backup, import/post-setup, and
  recovery selections: **5 passed, 277 deselected** in 2.59s.
- Combined focused QA containment result: **38 passed**.

Supplemental gateway coverage (`tests/gateway/test_tui_approval_redaction.py`
and `tests/test_tui_gateway_server.py`, excluding live/integration selections)
ran **421 passed, 2 failed, 31 deselected**. The two failures are in the
already-dirty nested checkout: one test’s monkeypatch no longer accepts the
current `_run_prompt_submit(..., client_turn_id=...)` keyword, and the golden
transcript compares different usage metadata for the compute-host path. They
are not part of the QA-specific containment tests, were not changed or
discarded, and are not claimed as repaired by this pass.

The broad selected Hermes files collected 786 tests but were not used as a
completion gate after a bounded run showed the suite could hang. The focused
results above are the reproducible direct-test evidence for this report.

## Bugs, repairs, and layer attribution

### QA harness repair

- **Layer:** Playwright journey synchronization.
- **Cause:** the cold Garden route painted a server-rendered textarea before
  React installed `onChange`/`onKeyDown`, and chat-history loading still held
  the composer disabled.
- **Repair:** `qa/electron/user-journeys.ts` now waits for the actual React
  handlers, an enabled New chat control, and an editable composer. This is
  QA-only synchronization and does not change production behavior.
- **Replay:** first attempt `20260815091221-48964-fdfef81c` failed before any
  `/api/chat` call; replays `20260815091944-40336-dfd2cf90`,
  `20260815092637-46740-d4cf43bb`, and final `20260815093543-38632-15778faa`
  reached the real runtime.

### Provider boundary (not a product repair)

- **Layer:** model/provider configuration.
- **Evidence:** Hermes backend healthy; ChatMock model catalog responds, but
  the isolated profile has no ChatGPT credentials and no local chat model.
- **Effect:** `/api/chat` returns HTTP 200 while the Hermes stream records a
  non-retryable upstream 401 and no assistant completion. This is correctly a
  BLOCKED result, not a renderer PASS or a production defect.

No Breadboard production file and no Hermes source file was changed by this
follow-up to make the QA pass easier. The prior first-pass report documents the
four independent Breadboard repairs and their replays.

## Local model/provider audit

`ollama` and LM Studio are not installed. `llama-server` and `llama-cli` are
present as WinGet binaries, but no `.gguf`/local chat model was found and no
credential-free model server was configured. ChatMock’s local support in this
checkout is for embeddings; its chat route requires a configured upstream
provider. Supplying a fake response server would violate the requested
production-equivalent Hermes path, so it was not used.

## Nested `hermes-agent` repository state

Read-only provenance at the time of this report:

```text
remote: https://github.com/nousresearch/hermes-agent
branch: main (tracks origin/main; behind by 4854 commits)
HEAD: 55ef425d0c3967022cb54093112e638c5c3f9e01
status: 75 entries (50 tracked modified, 25 untracked)
```

This is an ignored independent checkout of the `nousresearch/hermes-agent`
repository, not a parent Git submodule or gitlink (`git ls-files --stage
hermes-agent` is empty and no `.gitmodules` entry exists). The status contains
substantial pre-existing work unrelated to this pass. The QA-specific Hermes
containment files/hunks from the earlier Breadboard QA work are identifiable in
`hermes_cli/_early_recovery.py`, `hermes_cli/backup.py`,
`hermes_cli/env_loader.py`, `hermes_cli/main.py`,
`hermes_cli/web_server.py`, and the corresponding focused tests:

```text
tests/hermes_cli/test_backup.py
tests/hermes_cli/test_dashboard_admin_endpoints.py
tests/hermes_cli/test_early_recovery.py
tests/hermes_cli/test_env_loader.py
tests/hermes_cli/test_web_server.py
```

Those changes were preserved; no reset, discard, push, or history rewrite was
performed. Because the parent ignores this directory, a parent commit cannot
ship those nested changes automatically. They require a deliberate nested-repo
commit or another separately versioned distribution decision.

Breadboard does have a reproducible packaging pin: both
`desktop/scripts/prepare-runtimes.mjs` and `desktop/scripts/prepare-app-resources.mjs`
require exactly `55ef425d0c3967022cb54093112e638c5c3f9e01`, write the commit
marker into staged Hermes resources, and verify the marker during packaging.
That pins the source revision used by packaging, but the parent does not itself
version the nested checkout or provide its clone acquisition history.

## Final limitations and next action

This pass establishes the real Electron-to-Hermes failure boundary and proves
that the QA harness now reaches it safely. It does not establish that a normal
user can complete a model-backed conversation because no approved provider is
available. To complete the conversational PASS rows, supply one of:

1. a reviewed, credential-free local chat model and deterministic model profile;
2. a separately approved isolated provider profile whose credentials are not
   copied into QA evidence; and
3. reviewed deterministic fixtures for vision, skills, optional agents, and
   long-running cancellation/steering where those capabilities are claimed.

Then replay the same Electron spec first, followed by the multi-turn,
grounding, tool, artifact, cancellation, steering, refresh, and restart rows.
Until that happens, the truthful coverage result is **0/26 previous blockers
unblocked and 0 successful model-backed Hermes turns**.
