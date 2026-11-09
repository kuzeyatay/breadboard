# Embedded website APIs

Breadboard includes [API Anything](https://github.com/goodnight000/api-anything)
0.4.0 at revision `985ae8f65f4c4918f24080bd7dbaf51fe92e6bf6`. The source snapshot
is in `api-anything/`, with its MIT license. The embedded catalog currently
contains 114 sites and 323 operations; users need no separate service, account,
API key or install to use its public operations.

## Agent behavior

For a website task, agents discover an installed API with `find_sites`, inspect
its exact operation and argument schema using `describe_site`, then call
`call_operation`. Matching APIs take priority over browser navigation. An
unavailable runtime, missing operation, authentication failure, blocked request,
or changed website returns a structured browser fallback. The agent continues
through its existing browser tools and permissions. Visual inspection and tasks
about a particular open tab can use the browser directly.

Rate limits, rejected actions and cancellation do not authorize a browser retry.
An uncertain write returns `verifyBeforeRetry`; the agent must check whether the
change happened before trying it again. Website responses are untrusted data.

The single contract is `dashboard/scripts/api-anything-contract.mjs`:

- Main chat, Garden, voice, Terminal and persona agents inherit it through the
  unified tool registry and the authenticated `mcp_call` route.
- Agent Browser, Agent Reach and Career Ops expose the same runtime as the
  `api_anything` function. Agent Browser starts its browser only when needed.
- Codex, OpenCode, Ruflo, DeepTutor, HyperFrames and OpenMontage receive the
  embedded stdio MCP server.
- OpenWork, OpenScience and DeerFlow receive the same MCP tools with an empty,
  process-local public session. Their shared upstream services cannot access a
  Breadboard user's private API Anything sites or cookies.

Fixed-purpose workflows keep their existing domain-specific execution paths.
Restricted public Quartz AI retains its existing tool boundary. The integration
does not grant browser access to a workflow that did not have it.

## Runtime and account scope

The adapter uses API Anything's host API (`hostSites`, `hostSite`, `planCall`,
`callPlanned`) in a finite worker, with `maxTier: 1`. HTTP calls run locally in
Breadboard. API Anything never launches a second browser, silently learns a new
API, logs in, publishes a spec or contacts a registry through this adapter.
Existing Breadboard browser control handles fallback.

Each authenticated user's state lives at
`<BREADBOARD_DATA_DIR>/runtime-v2/api-anything/user-<id>/`. Worker-local
environments isolate sessions, cooldowns and write ledgers. Tool arguments
cannot select another account or state directory. Calls have a 25-second budget,
bounded results and cancellation; API failures do not break unrelated tools.

Main chat and Agent Browser retain native write approval. The host stores the
exact pending plan privately, binds it to account/run/arguments for five minutes,
and checks its fingerprint again on execution. Standalone MCP and specialist
loops without an approval handshake direct writes to the existing browser
approval flow. They cannot approve their own API writes. All bundled operations
in this snapshot are read-only.

Custom specs and sessions can be managed separately with upstream's CLI using
the same user-specific `API_ANYTHING_HOME`. See upstream `docs/HOST.md` and
`README.md`; this does not import cookies from Breadboard's browser automatically.

## Build and installation

The committed `api-anything/breadboard/host.mjs` bundles the host and its HTTP
dependencies. `runtime.json` records upstream revision and source/bundle hashes;
`THIRD_PARTY_NOTICES.txt` retains the bundled dependency licenses. Normal dev and
desktop packaging validate the cached bundle without installing upstream
dependencies. Packaged applications include the bundle, site catalog, license,
notices and Breadboard adapter scripts.

After changing upstream code, rebuild with:

```powershell
npm --prefix api-anything ci --ignore-scripts
npm --prefix dashboard run build:api-anything
```

To disable the API path for troubleshooting, set
`BREADBOARD_API_ANYTHING_ENABLED=0` before starting Breadboard. Browser control
continues to work. Connections settings displays runtime availability and the
catalog counts, with a retry control after a failure.

## Verification

From `dashboard/`:

```powershell
node --experimental-strip-types --test tests/api-anything.test.mjs tests/api-anything-routes.test.mjs tests/api-anything-ui.test.mjs tests/runtime-v2-agent-browser-worker.test.mjs
```

These tests run the real embedded host against local HTTP endpoints, including
account isolation, bounded timeouts, cancellation, write approval and readback,
changed-plan refusal, stdio MCP, public-service isolation and a staged desktop
layout without upstream dependencies. Route tests exercise signed capabilities
and native approval responses. Browser tests cover settings, mobile layout,
API-only execution and continuation through the existing browser tool.
