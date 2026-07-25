# Hermes runtime migration

## Status

Hermes is the default agent runtime for new desktop installations. The packaged
and installed Windows acceptance tests pass. OpenHarness remains packaged and
selectable as the temporary rollback runtime; it has not been deleted.

Pinned Hermes revision:
`55ef425d0c3967022cb54093112e638c5c3f9e01` (`hermes-agent` 0.19.0).

There are no intentional frontend or visual changes in this migration. The
browser continues to use the existing `/api/openharness/*` and
`/api/quartz-ai/*` compatibility contracts.

## Architecture and ownership

```text
Existing Breadboard UI
        |
Existing Breadboard API and SSE routes
        |
Breadboard AgentRuntime abstraction
        |
HermesRuntimeAdapter
        |
Hermes JSON-RPC/WebSocket service on 127.0.0.1
        |
Existing ChatMock/OpenAI-compatible provider
```

The renderer never communicates with Hermes. Hermes's selected port, session
token, tool secret and provider configuration exist only in the Electron
supervisor, the dashboard server environment and the Hermes child process.

Breadboard remains authoritative for:

- authentication, users, Gardens and Garden permissions;
- canonical conversations, messages, conversation/shared memory, artifacts,
  proposals and audit records in SQLite;
- runtime-session mappings, active-run/idempotency state and restoration;
- model/agent/skill/connection selections and capability decisions;
- filesystem grants, approval decisions, expiry and revocation;
- validation and execution of Garden, GBrain, MCP, artifact and terminal tools;
- the normalized event journal and current SSE contract.

Hermes owns only the model loop, temporary agent/live-session state and raw
runtime streaming. Its memory features are disabled for the embedded profile.
A missing Hermes live session is disposable and can be reconstructed from the
Breadboard transcript.

## Migration map

| Previous OpenHarness responsibility | AgentRuntime responsibility | Hermes implementation |
| --- | --- | --- |
| `/global/health` and provider discovery | `health`, `listModels` | Authenticated Hermes status/JSON-RPC client; ChatMock remains the provider |
| OpenHarness agent selection | Server-owned session policy | One source-gated Breadboard profile/toolset; Breadboard assembles persona and surface context |
| Workspace session creation | `createSession`, `restoreSession` | `session.create`; stored/live IDs remain server-only and the transcript can rebuild a session |
| `prompt_async` | `startRun` | `config.set` for model/reasoning, then `prompt.submit` |
| Instance SSE | `streamSession` | Hermes frames normalize to the existing Breadboard events and SSE payloads |
| Permission events | `resolveApproval` | Breadboard stores and revalidates the exact operation before resolving the Hermes pause |
| Abort | `stopRun` | `session.interrupt` plus Breadboard terminal/tool cancellation and process-tree termination |
| Runtime tool manifests | Capability projection | Hermes receives only the bundled `breadboard` toolset |
| Garden plugin | Breadboard-owned tools | Hermes plugin calls authenticated loopback Breadboard tool routes |
| Terminal plugin | Breadboard terminal broker | Existing root/command/environment/timeout/output/audit enforcement remains authoritative |
| MCP loading | Breadboard MCP proxy | Only selected server/tool calls are proxied; credentials remain in Breadboard |
| Artifact plugin | Breadboard artifact service | Existing IDs, versions, storage, permissions and events remain canonical |
| Temporary history | Disposable runtime context | Breadboard seeds/reconstructs Hermes from canonical messages |
| Bun service supervision | Managed Python process | Existing Electron `ServiceManager` starts the bundled Hermes runtime on loopback |

## Public contract retained

The migration retains:

- all existing `/api/openharness/*` and `/api/quartz-ai/*` route paths and
  frontend request/response shapes;
- Garden Chat, Terminal and Quartz AI conversation behavior;
- Agents, models, Skills, Connections, Prompts and Artifacts contracts;
- permission decisions, stop controls, steering and refresh restoration;
- `assistant.delta`, `assistant.completed`, `reasoning.status`,
  `tool.started`, `tool.completed`, `permission.requested`,
  `verification.updated`, `session.status`, `error`, artifact lifecycle,
  `done` and `cancelled` events.

The selected runtime is server configuration. The browser cannot select a
runtime or supply a runtime URL.

## Runtime files

### Added

- `dashboard/src/lib/agent-runtime/config.ts`
- `dashboard/src/lib/agent-runtime/contracts.ts`
- `dashboard/src/lib/agent-runtime/errors.ts`
- `dashboard/src/lib/agent-runtime/runtime.ts`
- `dashboard/src/lib/agent-runtime/hermes-wire.ts`
- `dashboard/src/lib/agent-runtime/hermes-events.ts`
- `dashboard/src/lib/agent-runtime/mcp-proxy.ts`
- `dashboard/src/lib/agent-runtime/adapters/openharness.ts`
- `dashboard/src/lib/agent-runtime/adapters/hermes.ts`
- `dashboard/src/app/api/openharness/tools/mcp/route.ts`
- `dashboard/tests/hermes-events.test.mjs`
- `desktop/scripts/hermes-runtime-smoke.mjs`
- `hermes-agent/plugins/breadboard/plugin.yaml`
- `hermes-agent/plugins/breadboard/__init__.py`
- this migration record

### Modified

Migration-specific changes are grouped below. Pre-existing unrelated changes
in the working tree are not part of this list.

- Dashboard runtime/API: model, health, agent, capability, permission, session,
  abort, steer, MCP and tool routes under `dashboard/src/app/api/`.
- Dashboard persistence/lifecycle:
  `dashboard/src/lib/db.ts`, `dashboard/src/lib/openharness/runtime-store.ts`,
  `session-service.ts`, `route-core.ts`, `event-stream.ts`, `events.ts`,
  `capability-lifecycle.ts`, `terminal-execution.ts`, `tool-scopes.ts`,
  `tool-service-auth.ts`, `garden-chat-adapter.ts`, and conversation
  `turn-service.ts`.
- Dashboard dependency manifests: `dashboard/package.json` and lockfile
  (MCP SDK 1.29.0).
- Existing session renderer integration:
  `use-agent-session.ts` and its contract/source tests. No runtime identifier,
  URL or secret was added to renderer state.
- Desktop lifecycle and packaging:
  `app-lifecycle.ts`, `path-resolver.ts`, `runtime-config.ts`,
  `service-definitions.ts`, Electron Builder configuration, desktop package
  scripts, runtime/app staging, package verification, packaged smoke and
  installed smoke scripts.
- Hermes maintained patch:
  `tui_gateway/server.py`, `tui_gateway/compute_host.py` and their two focused
  test modules.

## Database changes

The existing `openharness_runtime_sessions` table name is intentionally
retained for compatibility. The additive migration adds:

- `runtime_kind TEXT NOT NULL DEFAULT 'openharness'`, restricted to
  `openharness` or `hermes`;
- `external_session_id TEXT`, the runtime-neutral stored session ID;
- `live_session_id TEXT`, the disposable transport/live-session ID;
- `last_event_sequence INTEGER NOT NULL DEFAULT 0`;
- index `idx_agent_runtime_sessions_external(runtime_kind,
  external_session_id)`.

Existing `openharness_session_id` values are backfilled into
`external_session_id`; no canonical conversation or message rows are moved to
Hermes. Existing capability decisions, runs, steer requests, message metadata,
artifacts and audits remain Breadboard-owned.

## Configuration

Dashboard/server variables:

| Variable | Meaning |
| --- | --- |
| `AGENT_RUNTIME=hermes|openharness` | Selects the server-side adapter |
| `AGENT_RUNTIME_FALLBACK=none|hermes|openharness` | Optional pre-session fallback only; must differ from the primary |
| `HERMES_BASE_URL` | Validated loopback-only Hermes URL |
| `HERMES_DASHBOARD_SESSION_TOKEN` | High-entropy Hermes gateway credential |
| `HERMES_REQUEST_TIMEOUT_MS` | Bounded dashboard-to-Hermes request timeout; default 120000 |
| `BREADBOARD_HERMES_TOOL_SECRET` | Hermes-plugin-to-dashboard service secret |

Hermes child-only variables include `HERMES_HOME`, `HERMES_DESKTOP=1`,
`HERMES_SERVE_HEADLESS=1`, `BREADBOARD_INTERNAL_URL` and the existing
server-side ChatMock/OpenAI-compatible provider values. No new provider UI or
user reconfiguration is required.

Desktop config adds `agentRuntime`, `agentRuntimeFallback`,
`hermesSessionToken` and `hermesToolSecret`. New installs default to Hermes with
no fallback. Older configs are additively normalized and receive stable random
Hermes secrets.

## Tool authorization

Hermes is constructed with exactly one toolset: `breadboard`. It is not given
native shell, filesystem, browser, database or arbitrary MCP access. The
Breadboard plugin sends a durable Hermes task identity and a service
credential to loopback-only Breadboard routes.

Every tool call is mapped back to a Breadboard runtime session and revalidates:

1. authenticated user and owned conversation;
2. active Garden/surface and active run;
3. unexpired, unrevoked capability decision/token;
4. exact allowed tool and operation;
5. strict input schema and bounded payload;
6. canonical path/root, command, host, MCP server and MCP tool scope;
7. whether an exact single-use approval is required;
8. bounded execution, cancellation and sanitized audit/output.

The policy is deny-by-default. Knowledge mode cannot execute terminal commands.
Terminal commands use an explicit directory, filtered environment, approved
roots, time/output limits and child-process-tree cancellation. Destructive MCP
operations are denied outside scoped implementation mode.

The bundled tools cover terminal execution, authorized Garden retrieval and
proposals, artifact lifecycle, capability discovery/gaps, selected MCP calls
and the existing GBrain adapter boundary.

## Event translation

| Hermes gateway frame | Existing Breadboard normalized/SSE event |
| --- | --- |
| `message.start` | `session.status` (`busy`) |
| `message.delta` | `assistant.delta` |
| `thinking.delta`, `reasoning.delta` | append `reasoning.status` |
| `reasoning.available` | replace `reasoning.status` detail |
| `status.update` | `reasoning.status` label |
| `tool.start` | `tool.started` with safe summary only |
| `tool.complete` | `tool.completed` with success and safe summary |
| `approval.request` | `permission.requested` |
| `message.complete` | missing residual `assistant.delta`, then `assistant.completed` and terminal `session.status` |
| `error` | sanitized `error`, then failed `session.status` |
| Breadboard artifact tool event | existing `artifact.created` or `artifact.updated` |
| Stop/interruption | existing `cancelled`/stopped session flow |

Frames for another live session are ignored. Duplicate streamed completion
text is not re-emitted. Unknown/malformed frames do not leak raw payloads.

## Approval, stop and restoration

For a privileged request, Hermes pauses; Breadboard validates and persists the
exact pending operation; the existing permission UI emits an approval or
rejection; Breadboard checks ownership, expiry and reuse before resolving the
Hermes request. Rejection never invokes the tool. Refresh restores the pending
Breadboard request, not a browser-to-Hermes connection.

Stop first marks the Breadboard run as stopping, interrupts Hermes, aborts
active tools, terminates any active terminal process tree, persists the
terminal state and emits the existing stopped/cancelled contract. Duplicate
submissions are prevented by Breadboard run identity and the one-active-run
constraint.

Canonical messages and event sequence remain in Breadboard. Runtime IDs are
internal mapping fields. Session restoration uses the Breadboard transcript
and can create a replacement Hermes live session without losing the
conversation.

## Desktop lifecycle

Electron allocates a free Hermes port and starts the bundled CPython 3.13.9
with the pinned Hermes source using:

```text
python -m hermes_cli.main serve --isolated --host 127.0.0.1
       --port <private-port> --no-open
```

Hermes has a 120-second startup bound, a meaningful status health check,
hidden Windows process creation, an 8-second graceful shutdown and the
existing bounded `on-failure` restart policy. The service manager prevents
duplicate definitions and kills full child-process trees on exit. Hermes is
optional to overall application readiness so Gardens and unrelated features
remain usable while agent routes return a sanitized unavailable error.

The runtime is bundled; no global Python or Hermes installation is required.
The desktop path/diagnostic and renderer endpoint projections deliberately
omit the Hermes port and credentials.

## Verification

Commands executed:

```text
dashboard\node_modules\.bin\tsc.cmd --noEmit -p dashboard\tsconfig.json
npm --prefix dashboard test
npm --prefix desktop test
npm --prefix desktop run build:dashboard
npm --prefix desktop run smoke:hermes
npm --prefix desktop run verify:package
npm --prefix desktop run dist:win
uv run --frozen --extra dev python -m pytest
  tests/test_tui_gateway_server.py tests/tui_gateway/test_protocol.py -q
node desktop/scripts/smoke-test.mjs <packaged-exe> <isolated-data> <results>
node desktop/scripts/installed-smoke-test.mjs <installer> <evidence-dir>
```

Results:

- Dashboard TypeScript: pass.
- Dashboard suite: 1,327 passed, 0 failed, 15 skipped.
- Desktop suite: 77 passed, 0 failed.
- Next.js production dashboard build: pass.
- Focused Hermes gateway/protocol suite: 539 passed.
- Bundled Hermes runtime/authentication smoke: pass.
- Final package verification: pass, including bundled Hermes/Python and MCP
  dependency imports.
- Packaged `win-unpacked` application: 22/22 checks passed, including Hermes
  0.19.0 through the unchanged authenticated API, no renderer Hermes endpoint,
  restart persistence and no managed processes after both quits.
- Installed Windows smoke: 10/10 outer checks and 22/22 application checks
  passed. Install, first launch, restart, quit, uninstall, data preservation
  and restoration of the user's installation all exited successfully.

Installer:

```text
C:\Users\20252082\AppData\Local\breadboard-desktop-build\release\Breadboard-Setup-0.1.0-x64.exe
size:   667,064,041 bytes
sha256: 3f44dd1965ef44270e83175712a92ef57d3793b44b5e118c572a9d325b80a816
```

Evidence:

- packaged:
  `C:\Users\20252082\AppData\Local\breadboard-desktop-smoke\hermes-package-20260725-0206\results.json`
- installed:
  `C:\Users\20252082\AppData\Local\breadboard-desktop-smoke\installed-hermes-20260725-0240\installed-smoke-summary.json`
- installed inner application:
  `C:\Users\20252082\AppData\Local\breadboard-desktop-smoke\installed-hermes-20260725-0240\app-smoke-results.json`

## Maintained Hermes patch

The Hermes checkout must retain a small, source-gated gateway extension:

- `session.create` accepts `enabled_toolsets` and an ephemeral `system_prompt`
  only when `source == "breadboard"`;
- the immutable per-session toolset and prompt flow through local and compute
  host agent construction;
- later Breadboard prompts can refresh only that ephemeral session prompt;
- non-Breadboard clients cannot use these fields to widen their tool boundary;
- focused tests cover allowed and rejected source behavior.

The patch is 192 added/changed test and implementation lines across
`tui_gateway/server.py`, `tui_gateway/compute_host.py`,
`tests/test_tui_gateway_server.py` and `tests/tui_gateway/test_protocol.py`.
Packaging rejects a Hermes checkout whose upstream commit differs from the
pinned revision.

## Rollback

### Installed desktop

1. Quit Breadboard completely.
2. Open:
   `%APPDATA%\breadboard-desktop\Data\config\desktop-config.json`
3. Change only:

   ```json
   "agentRuntime": "openharness",
   "agentRuntimeFallback": null
   ```

4. Save valid JSON and restart Breadboard.

OpenHarness is still packaged and supervised. Existing conversations stay in
Breadboard and require no data conversion. To return to Hermes, set
`agentRuntime` back to `hermes` and restart.

### Development/server

Set `AGENT_RUNTIME=openharness` and leave
`AGENT_RUNTIME_FALLBACK=none`, then restart the dashboard/runtime processes.
Do not change the runtime during an active run.

## Remaining limitations

These items prevent describing every requested acceptance dimension as
independently proven, even though the packaged and installed acceptance tests
pass:

1. **Automated screenshot baselines are not present.** The repository has
   interaction/source contract tests for Garden Chat, Terminal, Quartz AI,
   Agents, Skills, Connections, Prompts, Artifacts, permissions, stop and
   restoration, but no Playwright/Puppeteer visual-baseline dependency or
   checked-in baseline set. Evidence: the full 1,342-test dashboard run has no
   screenshot runner. Exact next action: capture an approved pre-migration
   build of each required surface, add a browser screenshot harness, and compare
   the Hermes build at the same viewport/state. No intentional UI code or
   screenshot difference was introduced by this runtime migration.
2. **A real credentialed existing MCP connection was not available in the
   acceptance data.** Local stdio and remote HTTP/SSE proxy paths, allowlists,
   input limits, timeouts, audit and redaction are implemented and covered by
   contract/security tests, but OAuth browser authorization is intentionally
   not emulated. Exact next action: provide a non-production test MCP server and
   credential, connect it through the unchanged Connections UI, and exercise
   one allowed read plus one rejected mutation in the installed build.
3. **The entire upstream Hermes test tree did not finish inside the 15-minute
   bounded run.** It was terminated without a final aggregate result; no
   process was left running. The integration-relevant gateway/protocol subset
   passed 539 tests. Exact next action: run the upstream suite in CI with a
   longer timeout and archive its JUnit result.
4. **The installer is unsigned.** Authenticode reports `NotSigned`; this does
   not affect the successful install/runtime smoke but Windows may show a trust
   warning. Exact next action: sign the final installer and uninstaller with
   the project's Windows code-signing certificate and rerun installed smoke.
5. **GBrain was disabled in the acceptance config.** The packaged check records
   this as an intentional skip; the existing Breadboard GBrain boundary remains
   wired through authenticated tools. Exact next action: set `gbrainMode` to
   `preferred` with the test adapter available and rerun the packaged/installed
   smoke.

