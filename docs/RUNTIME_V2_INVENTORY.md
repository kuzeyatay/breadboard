# Runtime V2 execution inventory

- Date: 2026-08-25
- Status: **source audited, not executed**
- Migration status: **not cut over**

The authoritative machine-readable artifact is
[`qa/runtime-v2/execution-inventory.json`](../qa/runtime-v2/execution-inventory.json).
It inventories the execution roots visible in the current worktree and records the
required Runtime V2 disposition for each root. It does not claim that those roots
have been migrated, measured, or exercised successfully.

This inventory was completed without starting a compiler, bundler, Electron,
Next.js, Rust/Cargo, a browser, a model, a container stack, or a product service.
All non-null measurements come from pre-existing receipts.

Run `npm run qa:runtime-v2:inventory` for the committed source-only structural,
ownership-boundary, parity-join, count, dependency, and source-path checks. The
validator reads files only and does not start product code.

## Inventory totals

| Measure | Count |
| --- | ---: |
| Execution entries | 122 |
| Finite entries | 66 |
| Persistent entries | 56 |
| Individually expanded runtime-agent jobs | 37 |
| Other finite operations | 29 |
| Unclassified or blocked gaps | 13 |

Every entry has exactly one classification from this closed vocabulary:

| Classification | Count | Required disposition |
| --- | ---: | --- |
| `core` | 4 | Required application/control-plane process. The legacy supervisor helper is transitional and is explicitly removed after cutover. |
| `disposable-job` | 65 | A finite contained tree that exits after one attempt or operation. |
| `on-demand-service` | 32 | A leased service that starts for demand and stops after its final lease and idle TTL. |
| `scheduled-service` | 10 | A registered scheduler/gateway that runs only by explicit schedule or policy. |
| `external` | 11 | A process or endpoint Breadboard does not start or own. |
| `proven-lightweight` | 0 | Reserved for a measured, justified resident helper; no current row has enough evidence. |

`classification` is the required target disposition. `finite` and `persistent`
describe whether the represented work is logically bounded or service-like;
`exits_after_work` records whether the current implementation actually returns its
execution tree after the work. `current_state` and the current clauses in
`startup_policy`, `idle_behavior`, and `cancel_behavior` preserve legacy behavior,
while `target_state` is the unambiguous cutover requirement. This distinction is
important for finite logical attempts that still run inside a resident dashboard or
sidecar today, and for currently resident compiler children that must become finite
jobs.

Each JSON row also records the runtime ID, source identity, display name,
capability IDs, current owner, executable/runtime, root command, dependency chain,
descendant/model/Chromium/Docker/WSL/large-file flags, cancellation and recovery
behavior, memory baseline, measured peak, post-completion return, target state,
source anchors, and evidence.

## What the existing memory evidence proves

The installed-app baseline receipt is an aborted startup capture, not a passing
product baseline:

| Point | Owned processes | Private MB | Working-set MB | Free commit MB |
| --- | ---: | ---: | ---: | ---: |
| Before launch | 0 | 0.0 | — | 18,999.0 |
| First visible startup | 16 | 413.8 | 794.4 | 19,176.6 |
| Captured peak | 17 | 3,634.2 | 3,780.7 | 16,185.5 |

At that peak, the Quartz Node process accounted for **2,894.4 MB private bytes**
and its esbuild child accounted for **270.7 MB private bytes**. The capture was
aborted with `UNEXPECTED_EAGER_COMPILER`; it reached startup only. Cleanup stopped
the QA-owned tree and verified that none of its captured PIDs remained. Source:
[`qa/runtime-v2/evidence/baseline-installed-2026-08-24T20-09-33-083Z/receipt.json`](../qa/runtime-v2/evidence/baseline-installed-2026-08-24T20-09-33-083Z/receipt.json).

The existing isolated 30-cycle dashboard compiler receipt is separate evidence:

| Bundler | Initial RSS MB | Peak RSS MB | Settled RSS MB |
| --- | ---: | ---: | ---: |
| Turbopack | 438.0 | 534.0 | 520.3 |
| Webpack | 680.5 | 853.5 | 685.6 |

Source: [`qa/memory/latest-dashboard-compiler.json`](../qa/memory/latest-dashboard-compiler.json).
It was not rerun during this work.

The evidence explains why a heap or commit cap is only a crash barrier. A cap does
not make a resident compiler, model, browser, SQLite engine, or container return
memory. The target lifecycle must reclaim the complete process tree:

- Quartz serving is `service:quartz`, an on-demand server for prebuilt output.
- Quartz compilation is `job:quartz-esbuild-compiler` under the finite
  `job:quartz-publish` build boundary; it may not run at ordinary startup.
- Agent Browser uses `job:agent-browser-chromium-worker`, one finite browser tree
  per run, rather than a persistent automation browser service.
- mem0 is `service:mem0-semantic-engine`, an on-demand leased memory service with
  an idle TTL. Today it is cached on `globalThis` and retains better-sqlite3 handles
  in the dashboard process (`dashboard/src/lib/mem0/client.ts:53-130`); its memory
  is not measured, so this is a lifecycle risk, not a proven numeric cause.
- Hermes and GBrain now have source-level on-demand leases and 10-minute idle
  shutdown under the transitional Electron owner; the actual first use retains
  the submitted operation while the service starts. This source has not been
  rebuilt or executed. Runtime V2 still has to take ownership before cutover.
  ChatMock remains policy/lease driven, not automatically core. The Postiz
  coordinator is scheduled; its Docker stack is a separate on-demand lease.

## Persistent and external roots

The JSON carries the detailed command, dependencies, flags, cancellation, recovery,
and evidence for every row. The complete target groupings are:

### Core

- `core:electron-shell`
- `core:runtime-v2`
- `service:dashboard`
- `core:legacy-runtime-supervisor-helper` — current cutover helper only; target is
  replacement by Runtime V2, not permanent core residency.

### On-demand services

`service:chatmock`, `service:hermes`, `service:gbrain`, `service:cliproxy`,
`service:quartz`, `service:ui-tars`, `service:cad`, `service:colpali`,
`service:humanizer`, `service:voicebox`, `service:scriberr`,
`service:postiz-stack`, `service:inbox-zero-stack`,
`service:deep-research-sidecar`, `service:deer-flow`, `service:vibe-trading`,
`service:stock-analyst`, `service:openwork-engine`, `service:openwork`,
`service:openscience`, `service:money-printer`, `service:wardrobe`,
`service:comfyui`, `service:vlm-ocr`, `service:solidworks-mcp`,
`service:penecho`, `service:spotify-playback-browser`,
`service:whatsapp-gateway`, `service:recall`,
`service:interactive-visualizer-browser`, `service:mem0-semantic-engine`, and
`service:local-mcp-stdio`.

The local MCP row is deliberately not external. If Breadboard starts a stdio
executable, Runtime V2 owns its complete tree. Each accepted command needs a
versioned allow-listed manifest and a lease; arbitrary renderer-provided executable
paths are rejected.

### Scheduled services

`service:background-coordinator`, `service:postiz-coordinator`,
`schedule:scheduled-chats`, `schedule:memory-autofetch`,
`schedule:email-poller`, `schedule:review`, `schedule:caldav`,
`schedule:telegram-gateway`, `schedule:ifixai-maintenance`, and
`schedule:runtime-run-recovery`.

The current background coordinator is a shared eager process. Its target state is
the set of independently registered scheduled definitions above, not a permanent
catch-all host.

### External boundaries

`external:model-providers`, `external:container-engine`,
`external:scriberr-endpoint`, `external:comfyui-endpoint`,
`external:vlm-ocr-endpoint`, `external:solidworks`,
`external:penecho-server`, `external:remote-mcp-endpoints`,
`external:dashboard-dev-turbopack`, `external:dashboard-dev-webpack`, and
`job:dashboard-production-build`.

The production build is finite but remains classified `external`: it is an explicit
developer/release operation outside the installed product's Runtime V2 authority.
Remote MCP, OCR, Scriberr, ComfyUI, and PenEcho rows include only endpoints whose
process lifetime Breadboard does not control. Their corresponding app-launched
processes are separate on-demand-service rows.

## Finite non-agent jobs

The 28 non-agent `disposable-job` rows are:

`job:quartz-esbuild-compiler`, `job:code-index-build`,
`job:agent-browser-chromium-worker`, `job:learn-worker`, `job:learn-recovery`,
`job:ingestion`, `job:artifact-render`, `job:quartz-publish`,
`job:generated-visual-browser`, `job:deep-tutor-index-build`, `job:sf3d`,
`job:manim-render`, `job:audio-analysis`, `job:document-skill-bridge`,
`job:office-cli`, `job:watermark-scrub`, `job:speech-media-tools`,
`job:hermes-terminal-execution`, `job:skill-premortem`, `job:skill-factcheck`,
`job:skill-watch`, `job:skill-agent-loop`, `job:skill-omh`, `job:skill-loopx`,
`job:runtime-setup`, `job:chatmock-oauth`, `job:runtime-probes`, and
`job:subsai-transcription`.

Together with the externally classified finite dashboard production build, these
make the 29 non-agent finite operations.

## Runtime-agent jobs

All 37 run kinds are expanded as individual disposable-job entries. The stable
join key is `runtime-agent:<profile-id>`; all 37 primary IDs exist in the finalized
475-row feature-parity registry. The execution runtime ID for every table row is
`job:<capability-id>` (for example, `job:runtime-agent:codex`).

| Capability ID | Source run kind | Route root |
| --- | --- | --- |
| `runtime-agent:codex` | `codex` | `/api/codex/runs` |
| `runtime-agent:opencode` | `opencode` | `/api/opencode/runs` |
| `runtime-agent:ruflo` | `ruflo` | `/api/ruflo/runs` |
| `runtime-agent:deep-research` | `deep_research` | `/api/deep-research/runs` |
| `runtime-agent:agent-browser` | `agent_browser` | `/api/agent-browser/agents/[agentId]/runs` |
| `runtime-agent:agent-reach` | `agent_reach` | `/api/agent-reach/runs` |
| `runtime-agent:get-doc` | `get_doc` | `/api/get-doc/runs` |
| `runtime-agent:deep-tutor` | `deep_tutor` | `/api/deep-tutor/runs` |
| `runtime-agent:career-ops` | `career_ops` | `/api/career-ops/runs` |
| `runtime-agent:open-gym` | `open_gym` | `/api/open-gym/runs` |
| `runtime-agent:meeting-notes` | `meeting_notes` | `/api/meeting-notes/runs` |
| `runtime-agent:trading-agent` | `trading_agents` | `/api/tradingagents/runs` |
| `runtime-agent:vibe-trading` | `vibe_trading` | `/api/vibe-trading/runs` |
| `runtime-agent:stock-analyst` | `stock_analyst` | `/api/stock-analyst/runs` |
| `runtime-agent:deer-flow` | `deer_flow` | `/api/deer-flow/runs` |
| `runtime-agent:openplanter` | `openplanter` | `/api/openplanter/runs` |
| `runtime-agent:openwork` | `openwork` | `/api/openwork/runs` |
| `runtime-agent:openscience` | `openscience` | `/api/openscience/runs` |
| `runtime-agent:max-research` | `max_research` | `/api/max-research/runs` |
| `runtime-agent:socials-manager` | `socials_manager` | `/api/socials-manager/runs` |
| `runtime-agent:inbox-zero` | `inbox_zero` | `/api/inbox-zero/runs` |
| `runtime-agent:hardware-blueprint` | `hardware_blueprint` | `/api/hardware-blueprint/runs` |
| `runtime-agent:parametric-cad` | `parametric_cad` | `/api/cad/runs` |
| `runtime-agent:hyperframes` | `hyperframes` | `/api/hyperframes/runs` |
| `runtime-agent:resource2skill` | `resource2skill` | `/api/resource2skill/runs` |
| `runtime-agent:openmontage` | `openmontage` | `/api/openmontage/runs` |
| `runtime-agent:vimax` | `vimax` | `/api/vimax/runs` |
| `runtime-agent:vox-director` | `vox_director` | `/api/vox-director/runs` |
| `runtime-agent:shorts` | `shorts` | `/api/shorts/runs` |
| `runtime-agent:formsmith` | `formsmith` | `/api/shaper/runs` |
| `runtime-agent:video-use` | `video_use` | `/api/video-use/runs` |
| `runtime-agent:money-printer` | `money_printer` | `/api/money-printer/runs` |
| `runtime-agent:legal` | `legal_agent` | `/api/legal/runs` |
| `runtime-agent:wardrobe` | `wardrobe` | `/api/wardrobe/runs` |
| `runtime-agent:matraix` | `matraix` | `/api/matraix/runs` |
| `runtime-agent:bolt-slides` | `bolt_slides` | `/api/bolt-slides/runs` |
| `runtime-agent:agent-tars` | `agent_tars` | `/api/ui-tars/agents/[agentId]/runs` |

Each corresponding JSON row includes its real service/job dependencies, process and
model flags, route root, cancellation behavior, restart/recovery semantics, and
pre-migration source anchors. The current generic run manager often stores active
runs and events in process-local or `globalThis` maps
(`dashboard/src/lib/conversations/external-agent-runs.ts:589-944`). Runtime V2 must
therefore persist attempts, event replay, approvals, cancellation intent, and
restart fencing before cutover; a transcript card alone is not execution recovery.

## Ownership, cancellation, and recovery rules

1. A disposable job is successful only when its complete process tree exits and
   its result/artifact boundary is durable. A cancelled job must reach a terminal
   cancellation confirmation; killing only the immediate child is insufficient.
2. An on-demand service has one registered executable definition, explicit leases,
   an idle TTL, complete descendant containment, and a measured post-idle return.
3. A scheduled service starts only from a registered schedule or policy event. A
   shared eager process is current-state evidence, not permission for target
   residency.
4. An external row is never started or killed by Breadboard. The boundary is
   request cancellation, health/reconnect behavior, and explicit uncertainty about
   side effects.
5. Restart recovery must be durable and fenced. Work observed after owner loss is
   `uncertain` unless completion can be proven; Runtime V2 must not blindly retry a
   model call, publish, browser action, payment-like action, or file mutation.
6. Approval-gated Agent Browser and Agent TARS actions retain approve/reject state
   durably. A restart cannot silently convert an unapproved action into execution.

## Source-of-truth registries and drift risk

The inventory joins several registries that currently overlap rather than deriving
from one manifest:

- Runtime-agent source run kinds and launch dispatch:
  `dashboard/src/lib/conversations/external-agent-runs.ts:1-153,589-944`.
- Visible profile names, ordering, surfaces, and combinations:
  `dashboard/src/lib/hermes/capability-combinations.ts:145-324`.
- Electron-managed service commands and startup policy:
  `desktop/src/main/service-definitions.ts`.
- Background schedule/process ownership:
  `dashboard/src/instrumentation-node.ts:13-130`,
  `dashboard/src/lib/background-coordinator-launcher.ts:31-115`, and
  `dashboard/scripts/background-coordinator.mjs:1-29`.
- Canonical feature parity:
  [`qa/runtime-v2/feature-parity.json`](../qa/runtime-v2/feature-parity.json), with
  475 rows.
- Registry snapshot/drift tooling:
  [`qa/runtime-v2/registry-snapshot.mjs`](../qa/runtime-v2/registry-snapshot.mjs).

All 37 primary runtime-agent IDs join feature parity. Across the full execution
inventory, 62 of 112 unique capability references currently exist in feature
parity. The remaining 50 are execution-only service/workflow/recovery/tool taxonomy
terms until explicitly reconciled. This is recorded as a blocker rather than
silently claiming a complete join.

## Open gaps before cutover

| Gap | Status | Required closure |
| --- | --- | --- |
| `GAP-MEMORY-001` | No per-entry measurements | Capture cold, steady, peak, completion, and post-idle private-byte/commit measurements when runtime execution is authorized. |
| `GAP-BASELINE-002` | Installed baseline aborted | Complete a no-compiler visible Electron workflow baseline. |
| `GAP-SPAWN-003` | Aggregate job families remain | Split runtime setup, artifact/media, and probe families into trusted leaf definitions. |
| `GAP-DESCENDANT-004` | Transitive descendants unknown | Capture installed process trees and enforce containment before first instruction. |
| `GAP-BREAKAWAY-005` | Detached/unref ownership escapes | Remove detach/unref for every app-launched ComfyUI, Spotify, and Recall tree. |
| `GAP-MEM0-006` | Retained in-process engine unmeasured | Measure and move mem0 behind the registered leased-service boundary and TTL. |
| `GAP-MCP-007` | Dynamic local executables | Allow-list local stdio manifests; keep only independently managed endpoints external. |
| `GAP-RECOVERY-008` | Process-local run ownership | Persist attempt events, approvals, cancellation intent, fencing, and uncertainty. |
| `GAP-SURFACE-009` | Pre-migration parity defects | Fix the documented Video Use, Meeting Notes, Terminal conflict, and command-hub mismatches before parity freeze. |
| `GAP-DOCKER-010` | Docker/WSL pressure unmeasured | Measure engine, WSL, container, and post-idle return separately from stack leases. |
| `GAP-OFFICE-011` | Upstream Office resident unknown | Identify and classify the resident process without weakening the finite Office CLI job. |
| `GAP-SOURCE-012` | Dirty source snapshot | Freeze and hash committed registries; fail CI on drift. |
| `GAP-CAPABILITY-JOIN-013` | Taxonomy not fully joined | Add or explicitly version the 50 execution-only capability terms. |

Until those gaps close, the correct status remains `SOURCE_AUDITED_NOT_EXECUTED`
and `NOT_CUT_OVER`.
