# UI-TARS Integration — Architecture Note (pre-implementation)

Status: **inspection complete, implementation in progress.** This note records
what was actually found in the two cloned repositories, the selected integration
method, upstream limitations, and deviations from the task brief. It is written
before code so the design is falsifiable against the real source.

## 1. What the cloned repositories actually contain

### 1.1 Breadboard (this repo) — integration points found

| Concern | Actual location / mechanism |
| --- | --- |
| Loopback sidecar pattern | `gbrain-adapter/` — a Bun HTTP server bound to `127.0.0.1`, timing-safe bearer-secret auth on every non-health route, sanitized error codes (never a stack/path/secret), unauthenticated `/health` that leaks nothing. This is the direct template for the UI-TARS adapter. |
| Service supervision | `desktop/src/main/service-definitions.ts` builds `DesktopServiceDefinition`s (command, env, `healthCheck` HTTP probe, `startupTimeoutMs`, `gracefulShutdownMs`, `restartPolicy`). GBrain is registered `required: false` so it never blocks app startup. |
| Optional-runtime toggle | `GBRAIN_MODE` = `disabled \| optional \| required`, read from persistent config; service only registered when enabled. Model for `UI_TARS_MODE`. |
| Secret generation/storage | `desktop/src/main/runtime-config.ts` — `randomSecret(bytes)` (crypto base64url) generates per-install secrets persisted in the desktop config file (outside the app dir), injected into services via **env**, never argv. `redactSecrets(line, config)` strips every known secret from every log line (`log-manager.ts` applies it as a write hook). This IS the established secret mechanism — no separate encryption-at-rest layer exists. |
| Database + migrations | `dashboard/src/lib/db.ts` opens a single `better-sqlite3` DB and calls idempotent `ensureXSchema(db)` functions (`ensureGBrainSchema`, `ensureArtifactSchema`, …). Additive columns guarded via `PRAGMA table_info`. No migration framework — schema is code. |
| Dashboard API convention | Next.js route handlers (a **modified** Next.js — see `dashboard/AGENTS.md`), `export const runtime = "nodejs"`, `dynamic = "force-dynamic"`, auth via `requireUserId()` from `@/lib/server-auth`, errors via `apiErrorResponse`, gating via `requireEnabled()` (`@/lib/hermes/route-helpers.ts`). |
| Existing agent surfaces | `dashboard/src/app/api/hermes/agents` and `.../agency-agents` (prompt-based persona catalog, `dashboard/src/lib/hermes/agency-agents.ts`). The dashboard is a single page (`dashboard/src/app/dashboard/{page,dashboard-client}.tsx`) with panel components under `components/hermes/`. |
| Capability tokens | Hermes uses `hermesCapabilitySecret` to sign short-lived capability tokens (`capability-policy.ts`). Precedent for scoped, signed, expiring grants — reused conceptually for single-use approval tokens. |
| Data directory | `paths.dataRoot` (desktop) → `BREADBOARD_DATA_DIR` (dashboard). Mutable runtime data lives under `dataRoot/<service>/`, never in the installed app dir (`resources`). |

### 1.2 UI-TARS (`./UI-TARS`) — what it is and is NOT

The cloned `bytedance/UI-TARS` repository is the **research / model repository**:

- `UI-TARS/codes/ui_tars/` — a **Python** package `ui-tars` v0.1.4. Its entire job is
  *"parsing LLM-generated GUI action instructions, generating pyautogui scripts,
  and coordinate conversion."* Three files: `action_parser.py`, `prompt.py`,
  `__init__.py`. **Zero dependencies. No server, no sessions, no browser, no event
  stream, no process management.**
- `UI-TARS/{data,figures}`, papers, deployment notes for the vision-language model.

**It does not contain the Agent TARS browser runtime.** The README explicitly
redirects browser/desktop execution elsewhere:
- Desktop/agent runtime → `github.com/bytedance/UI-TARS-desktop` (the Agent TARS
  monorepo: `@agent-tars/*`, `@agent-infra/*` packages).
- Browser automation → `web-infra-dev/Midscene`.

Per the brief ("if the cloned repo does not contain the required Agent TARS
browser runtime, state that clearly and use the minimum additional official
ByteDance repository or package required — do not silently substitute an
unrelated framework"), this is recorded as a **hard finding**, and the runtime
must be sourced separately. The runtime-sourcing decision is escalated to the
user because it requires installing a large external ByteDance artifact and
network/model-provider access on the user's Windows machine.

## 2. Selected integration method

**Wrap, don't embed.** Breadboard owns a dedicated loopback adapter
(`ui-tars-adapter/`, modeled 1:1 on `gbrain-adapter/`). The adapter is the *only*
component that ever talks to an Agent TARS runtime. Breadboard's dashboard,
API, DB, UI, auth, and audit trail are the sole control plane. The frontend
never sees the adapter port, the adapter secret, or any provider key.

To keep Breadboard **independent of unstable upstream APIs** (brief §18), the
adapter defines a stable internal `RuntimeClient` interface and ships **two**
implementations behind it:

1. `FakeRuntimeClient` — a deterministic, dependency-free in-process runtime that
   emits the normalized event sequence (navigate → screenshot → propose action →
   pause for approval → complete). This makes every acceptance criterion except
   the two that require a real model+browser **fully testable in CI today**, and
   is exactly the "deterministic fake UI-TARS runtime" the brief's test sections
   repeatedly call for.
2. `AgentTarsRuntimeClient` — the real wrapper around the official Agent TARS
   package(s), selected once the runtime-sourcing decision is made. Isolated
   behind the same interface so no Breadboard code imports upstream types.

Selection is by env (`UI_TARS_RUNTIME=fake|agent-tars`), mirroring
`gbrain-adapter/src/backends/select.ts`.

## 3. Upstream limitations already identified

- **No pause-before-action primitive is guaranteed by the model SDK.** UI-TARS
  models emit an *action plan*; execution is the harness's job. The adapter
  therefore enforces approval at the **execution layer it owns** (before it
  hands an action to the browser driver), never after. If a chosen Agent TARS
  entrypoint executes actions internally without an interception hook, the
  adapter will drive the browser directly (via the runtime's lower-level page
  API) rather than simulate post-hoc approval (brief §10). This is a real risk
  to be validated against whichever runtime package is selected.
- The Python `ui-tars` SDK is action-parsing only; it cannot be the runtime.
- Agent TARS is a large monorepo; only the minimal browser-operator package(s)
  will be wrapped, never the whole tree (brief §13/§18).

## 4. Run state machine (Breadboard-owned, normalized)

`queued → starting → running → awaiting_approval ⇄ running → {completed | failed
| aborted | runtime_lost}`. Terminal states never re-open. Monotonic
`sequence_number` per run enables resume. Normalized event types
(`run.*`, `observation.*`, `action.*`, `approval.*`, `artifact.created`,
`runtime.disconnected`) are the only shapes persisted; raw upstream payloads are
bounded/diagnostic only.

## 5. Deviations from the brief

1. **Runtime not bundled in the cloned repo** (finding §1.2) — real Agent TARS
   runtime sourced separately; MVP control plane + adapter are built and tested
   against `FakeRuntimeClient` first so progress is not blocked by the external
   dependency or by model-provider availability.
2. **No encryption-at-rest primitive exists** in Breadboard. Per brief §3
   ("use encrypted-at-rest if Breadboard already has an established mechanism;
   otherwise use OS secure storage or the closest existing abstraction; do not
   invent insecure reversible encoding"), provider API keys are stored in a
   dedicated server-only secrets table, **never** returned to the frontend
   (write-only field; shown as configured/not-configured), and redacted from all
   logs via the existing `redactSecrets` hook. A follow-up to move these to OS
   credential storage (Windows DPAPI / Credential Manager) is noted as residual
   risk rather than shipping a home-grown cipher.
3. This is a **phased** delivery. See the phase plan in the accompanying report;
   criteria requiring a real model+browser (E2E navigation, real screenshots)
   and the packaged Windows smoke test are gated on the runtime-sourcing
   decision and are reported honestly as not-yet-passed until evidence exists.
