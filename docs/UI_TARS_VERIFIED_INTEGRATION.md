# UI-TARS / Agent TARS — Verified Integration Note

Written **after** inspecting the real upstream source (not from docs). Every claim
below is grounded in a specific file at the pinned commit. This is the
prerequisite record required before changing Breadboard.

## Cloned source + pinned revision

- **Path (sibling of Breadboard, not inside its tree):**
  `C:\Users\20252082\OneDrive - TU Eindhoven\Desktop\UI-TARS-desktop`
- **Upstream:** `https://github.com/bytedance/UI-TARS-desktop`
- **Pinned commit SHA:** `c2ad42e3eb9b27830db41a3e6f51ca7179d9b168`
- **Package manager / build:** `pnpm@9.10.0` + `turbo` (monorepo). Do **not** track
  `main` implicitly; the SHA above is authoritative.

The monorepo is treated as an **upstream development/reference source only**. It is
**not** vendored into Breadboard. Breadboard's `ui-tars-adapter` depends on the
**official published npm packages** pinned to the versions that correspond to this
SHA (verified present on npm): `@agent-tars/core@0.3.0`, `@tarko/agent@0.3.0`,
`@agent-infra/browser@0.2.2`, `@tarko/model-provider@0.3.0`,
`@tarko/agent-interface@0.3.0`. Breadboard code touches **only** the adapter's
`RuntimeClient` boundary — never these packages directly.

## Packages found (smallest responsible units)

| Responsibility | Package | Key source (at SHA) |
| --- | --- | --- |
| Headless agent execution (programmatic) | `@agent-tars/core` (`AgentTARS`) | `multimodal/agent-tars/core/src/agent-tars.ts` — `class AgentTARS extends MCPAgent` (→ `@tarko/agent` `BaseAgent`) |
| Base agent loop, hooks, event stream, abort | `@tarko/agent` | `multimodal/tarko/agent/src/agent/{base-agent,runner/tool-processor}.ts` |
| Event/type contracts | `@tarko/agent-interface` | `src/{agent,agent-event-stream}.ts` |
| Browser operation | `@agent-tars/core` browser env + tools | `environments/local/browser/` (tools `browser_navigate`, `browser_click`, `browser_form_input_fill`, `browser_screenshot`, `browser_press_key`, `browser_vision_control`, …) |
| Browser process lifecycle + isolation | `@agent-infra/browser` (`LocalBrowser`) | `packages/agent-infra/browser/src/{local-browser,base-browser,types}.ts` — Puppeteer-based |
| Model-provider config (provider-agnostic) | `@tarko/model-provider` | `src/types.ts` — `Model { provider, baseURL?, apiKey?, id }` |
| (Not used for MVP) headless HTTP server + sessions | `@tarko/agent-server` | `src/server.ts` |

## Selected runtime-start mechanism: **programmatic library API** (not CLI, not server)

The brief prefers an official programmatic API over CLI/output-scraping. Agent TARS
exposes a first-class one, so the adapter uses `@agent-tars/core` **in-process**:

```ts
// Inside ui-tars-adapter (Node), behind RuntimeClient:
const agent = new BreadboardAgentTARS({
  model: { provider, id: model, baseURL: endpoint, apiKey },   // provider-agnostic
  browser: { control: 'dom' | 'hybrid' | 'gui' },              // browserStrategy
  // workspace/tools constrained to browser-only (no filesystem/shell/MCP)
});
agent.getEventStream().subscribe(normalizeAndEmit);            // event streaming
await agent.run({ input: task });                              // headless execution
agent.abort();                                                 // stop
```

- `BreadboardAgentTARS extends AgentTARS` overrides `onBeforeToolCall` (approval).
- No CLI subprocess and no terminal scraping — structured events are consumed
  directly from the event stream.

## Event protocol found

`@tarko/agent-interface` `AgentEventStream` (`agent-event-stream.ts`). Subscribe via
`agent.getEventStream().subscribe(cb)` / `subscribeToTypes([...])`. Relevant event
types (upstream → normalized Breadboard event):

| Upstream event | Normalized |
| --- | --- |
| `agent_run_start` | `run.started` |
| `tool_call` (name `browser_navigate`, `browser_click`, …) | `action.proposed` / `action.started` |
| `tool_result` | `action.completed` / `action.failed`; `browser_navigate` result carries page URL → `observation.page` |
| `environment_input` w/ `ScreenshotMetadata` **and** `browser_screenshot` tool result | `observation.screenshot` |
| `assistant_message` / `plan_*` | `run.status` (concise; **no** raw chain-of-thought forwarded) |
| `agent_run_end` / `final_answer` | `run.completed` |

Only normalized fields + a bounded diagnostic payload are persisted; raw upstream
payloads are never stored unbounded.

## Screenshots

Two real sources: (1) the `browser_screenshot` tool (`page.screenshot()` via
Puppeteer, base64 PNG) and (2) `environment_input` events carrying
`ScreenshotMetadata`. The adapter can also pull an on-demand screenshot from
`agent.getBrowserManager()` → active page. Screenshots are written to the
Breadboard data dir (`<data>/ui-tars/screenshots/`), associated to run +
sequence number, and served **only** through authenticated Breadboard routes —
never from an adapter URL.

## Browser process ownership + isolation

`@agent-infra/browser` `LocalBrowser.launch()` → `puppeteer.launch(...)`
(`local-browser.ts:97`). Isolation controls (`types.ts`):
- `userDataDir` → **dedicated isolated profile** under
  `<data>/ui-tars/browser-profiles/<runId>/`. **`profilePath` is never set**, so no
  user Chrome/Edge profile, cookies, extensions, or password manager are inherited.
- `headless` configurable (default forced for MVP), `--disable-extensions`.
- **Process ownership:** the Puppeteer `Browser` owns the OS process;
  `browser.process()?.pid` gives the pid the adapter tracks as run-owned.
- **Teardown:** `browser.close()`; on forced exit the adapter kills the tracked pid.
  Stale profiles/pids from prior runs are cleaned on adapter startup when ownership
  is provable (pid recorded in `<data>/ui-tars/sessions/`).

## Approval interception point (verified — this is the crux of brief §10/§14)

**Exact boundary:** `@tarko/agent` `tool-processor.ts`. Per
`multimodal/tarko/agent/src/agent/runner/tool-processor.ts`:

1. `args = await this.agent.onBeforeToolCall(sessionId, {toolCallId, name}, args)`
   is **awaited before** `this.executeTool(...)` (lines ~263 → ~308). Therefore
   **pausing** = `await`-ing an approval promise inside the overridden
   `onBeforeToolCall` genuinely blocks execution. This is **real** pre-action
   interception, not post-hoc simulation.
2. **Throwing does NOT deny** — the surrounding `try/catch` (lines ~264-266) logs
   the hook error and proceeds to execute with the *original* args. So a thrown
   error is not a safe denial mechanism.
3. **Real denial mechanism:** an `abortSignal?.aborted` check runs **immediately
   before** `executeTool` (line ~283) and emits an abort `tool_result` instead of
   running the tool. So on **rejection**, the adapter trips the run's abort
   (`agent.abort()` / abort signal) while paused in `onBeforeToolCall`; when the
   hook resolves, the pre-execution abort check prevents the tool from running.

**Conclusion:** true pre-action interception **is** supported. Approval is enforced
at the documented boundary above:
- Sensitive action detected in `onBeforeToolCall` (by tool name + args:
  submit-intent `browser_click`/`browser_press_key` Enter, off-allowlist
  `browser_navigate`, `browser_evaluate`, download/upload/clipboard) →
  emit `approval.requested`, run → `awaiting_approval`, **await** decision.
- Approve → resolve → tool executes.
- Reject → trip abort → tool is not executed; run → `aborted`.
This satisfies criterion 6 deterministically without faking. (MVP semantics:
rejection aborts the run; per-tool "skip and continue" is a documented later
extension.)

## Model-provider requirements (provider-agnostic)

`@tarko/model-provider` `Model { provider, id, baseURL?, apiKey? }`
(`ModelProviderName` includes OpenAI-compatible). Maps 1:1 to the config schema
(`provider`, `model`, `endpoint`, credential). **No provider or key is hardcoded.**
The adapter receives the resolved key only via secure env injection from Breadboard
(server-side secret store), never argv/logs/responses. A UI-TARS-compatible
vision-language endpoint is required for `gui`/`hybrid`; `dom` mode can bring up
with a general tool-calling model. This is documented, not silently assumed.

## Windows packaging implications (detected, not silently failed)

- **Node**, not Bun: Puppeteer + these CJS/ESM packages run on Node. The adapter is
  a **Node** service (desktop supervisor already bundles a Node runtime). (Contrast:
  gbrain-adapter runs on Bun.)
- **Puppeteer Chromium**: `@agent-infra/browser` uses Puppeteer, which needs a
  Chromium binary (downloaded via `puppeteer` install, or an OS Chrome/Edge via
  `browser-finder`). Packaging must ship/download a Chromium and point the adapter
  at it under the data dir — documented as a runtime prerequisite, not bundled model
  weights.
- **Node 20+** (root `@types/node ^20`).
- Only the **adapter package + its pinned npm deps** are packaged, never the
  monorepo.

## RuntimeClient boundary (keeps upstream churn out of Breadboard)

`ui-tars-adapter/src/runtime-client.ts` defines a stable interface with two impls,
selected by `UI_TARS_RUNTIME=fake|agent-tars`:
- `FakeRuntimeClient` — deterministic, dependency-free; for unit + CI tests.
- `AgentTarsRuntimeClient` — wraps `@agent-tars/core` per the above; used for
  integration, E2E, and packaged Windows smoke tests. The fake is **never** presented
  as satisfying real-browser acceptance criteria.

## Post-install finding: published-package API drift (important)

The pinned SHA's in-tree `@agent-infra/browser` is **0.1.1** (`LocalBrowser.launch()`),
but installing `@agent-tars/core@0.3.0` from npm resolves `@agent-infra/browser` to
the **published 0.2.2**, whose API changed to
`Browser.create({ launchOrConnect: LaunchOptions })` exposing `pptrBrowser`
(the Puppeteer `Browser`) and a `wsEndpoint` property — `LocalBrowser`/`RemoteBrowser`
are no longer top-level exports. The adapter therefore targets the
**mutually-compatible published set** (`@agent-tars/core@0.3.0` + `@agent-infra/browser@0.2.2`),
isolated behind `RuntimeClient`, and this was verified live:

- Adapter boots with `UI_TARS_RUNTIME=agent-tars` → `/health` returns
  `{"runtime":"agent-tars","realBrowser":true}`.
- Real-browser isolation test (`test/e2e/real-browser.test.ts`) launches Edge via
  `Browser.create({launchOrConnect:{headless:true,userDataDir}})`, captures a real
  PNG, submits the fixture form exactly once, and confirms the owned PID is dead
  after `close()`.
- Also required adding `react` as a dependency (transitive peer of
  `@agent-infra/browser` via `valtio/react`), and `puppeteer-core` (installed) means
  a **system Chrome/Edge is used** (located via `@agent-infra/browser-finder`) rather
  than a bundled Chromium — a packaging input, not a silent failure.

## End-to-end verification with a real model (ChatMock) + real browser

Driven through the adapter's RunManager against `@agent-tars/core` with model
`gpt-5.6-sol` via ChatMock (`http://127.0.0.1:8765/v1`, OpenAI tool-calling
confirmed) and real Edge, `dom` strategy:

- The real model performed `browser_navigate` → `browser_form_input_fill` (name)
  → `browser_form_input_fill` (email) → `browser_get_clickable_elements` →
  `browser_click` (submit) — all flowing through the normalized event pipeline.
- **9 real screenshots** were captured and streamed (`observation.screenshot`).
- The form submission (the network POST) was **gated**: `approval.requested` →
  **rejected** → `run.aborted{reason:rejected}`, and **`submissions_to_server=0`**
  (the rejected submission never reached the server).

Findings this exercise surfaced and fixed:

1. **`@agent-tars/core@0.3.0` is a bundled monolith** carrying its OWN internal
   `LocalBrowser` (0.1.1-style, puppeteer handle via `.getBrowser()`), distinct
   from the standalone `@agent-infra/browser@0.2.2` (`.pptrBrowser`). The gate
   attaches by resolving either shape.
2. **Bridging a pre-launched isolated browser via `cdpEndpoint` failed** across
   this published pair (ws vs http endpoint, then a CDP-handshake mismatch). The
   robust path is to let AgentTARS self-launch — Puppeteer's default is already an
   ephemeral fresh profile (no user cookies/profile/extensions) — and attach
   ownership + the gate to it.
3. **AgentTARS ships shell (`run_command`/`run_script`) + filesystem tools with no
   browser-only switch.** Without enforcement the model fell back to the shell and
   submitted the form OUT of band (bypassing the gate). The adapter now hard-denies
   any non-`browser_*` tool at `onBeforeToolCall` (aborting the run), so the runtime
   controls only the isolated browser.
4. **Submit gating uses Puppeteer request interception** (`browser-gate.ts`): the
   actual form POST / off-allowlist navigation is paused before it leaves the
   browser and only continued on approval — proven deterministically
   (`test/e2e/submission-gate.test.ts`) AND in the live agentic run above.

## Deviations / residual risks

- Rejection aborts the whole run (safe, deterministic) rather than skipping one tool.
- `gui`/`hybrid` visual grounding needs a UI-TARS vision model; `dom` is the safe
  bring-up strategy and is the MVP default.
- Puppeteer Chromium provisioning on packaged Windows is the main packaging task and
  is tracked as such.
