# OpenHarness integration

OpenHarness is Breadboard's interactive agent runtime. It is a shallow,
upstream-friendly fork of OpenCode plus Breadboard-owned configuration, agents,
tools, session adapters, and UI routes.

It backs the live dashboard terminal, both live garden chat clients, and the
published Quartz page assistant. Learning-content generation remains on the
existing ChatMock/OpenAI-compatible pipeline: ingestion, extraction, mapping,
garden and Learning Spine generation, council/critic loops, deterministic repair,
semantic audit, finalization, publication, and embeddings do not use
OpenHarness.

## Phase 1 audit: paths that existed before this integration

The initial repository audit found these real runtime paths:

| Surface | Initial live path | Gap found |
| --- | --- | --- |
| Dashboard terminal | `dashboard-agent-terminal.tsx` health-checked OpenHarness, otherwise rendered `KnowledgeTerminal` -> `/api/knowledge-chat` | The fallback was silent and session restoration was absent. |
| Garden workspace chat | `gardens/[clusterSlug]/workspace-client.tsx` -> `/api/chat` -> ChatMock | It did not use OpenHarness. |
| Garden assistant | `garden/garden-assistant.tsx` -> `/api/chat` -> ChatMock | `garden-assistant-switch.tsx` existed but was not the mounted chat path. |
| Quartz page AI | Quartz browser -> dashboard `/api/quartz-ai/chat` and `/events` -> OpenHarness | Page text was proxied, but Graph View state was not connected and Stop did not abort server execution. |
| Provider config | `openharness-config/opencode.json` | ChatMock URL/model values were static. |
| OpenHarness fork | `openharness/` | The only core divergence was the `openharness` bin alias; Breadboard behavior lived outside the fork. |
| Skill discovery | `dashboard/src/lib/openharness/skills.ts` | It used a placeholder registry and could fabricate a manifest after download failure. |

The current implementation replaces those gaps in the existing mounted paths;
it does not introduce parallel demo UIs.

## Runtime architecture and trust boundary

```text
Browser UI
  -> Breadboard dashboard backend
       authentication and garden/page authorization
       runtime-mode decision
       session/workspace/agent selection
       capability-token and permission enforcement
       event normalization and audit persistence
  -> OpenHarness on 127.0.0.1:4096
       agent loop, provider access, tools, runtime sessions
  -> ChatMock OpenAI-compatible provider on 127.0.0.1:8765/v1
```

The browser never receives the OpenHarness base URL, Basic Auth credentials,
provider key, workspace path, capability token, or instance-wide event stream.
It sends only Breadboard session ids to authenticated dashboard routes. The
dashboard resolves the OpenHarness session and filters events by that authorized
record.

| Service | Default port | Role |
| --- | ---: | --- |
| Dashboard | 3000 | Application boundary and only OpenHarness client |
| Quartz | 8081 | Published static site; calls dashboard proxy routes only |
| ChatMock | 8765 | Local OpenAI-compatible model provider |
| OpenHarness | 4096 | Loopback, password-protected interactive runtime |

## Routing modes

`OPENHARNESS_MODE` is the explicit migration switch:

- `required` (default): all three interactive surfaces require OpenHarness.
  Unavailability is a visible error. No direct ChatMock fallback occurs.
- `preferred`: OpenHarness is attempted first. Garden chat may use the retained
  direct ChatMock adapter only after an explicit runtime failure; the response,
  UI, and audit log identify the fallback. The terminal also labels its legacy
  fallback. Quartz reports an error rather than bypassing the dashboard proxy.
- `legacy`: intentionally uses the prior terminal/garden behavior and does not
  start OpenHarness in the root launcher.

`OPENHARNESS_ENABLED=false` remains a compatibility alias for `legacy` only when
`OPENHARNESS_MODE` is unset. This prevents a hidden default-disable switch from
silently bypassing the runtime.

## Provider configuration

`openharness-config/opencode.json` defines the `chatmock` provider using
environment substitutions:

- `CHATMOCK_BASE_URL` (default `http://127.0.0.1:8765/v1`)
- `CHATMOCK_API_KEY` (local default `local`)
- `CHATMOCK_MODEL` (local default `gpt-5`)

OpenHarness owns the model call for interactive surfaces. Direct ChatMock calls
remain only in the learning pipeline, diagnostics, explicit `legacy` mode, and
the visible/audited `preferred` garden fallback.

The authenticated `GET /api/openharness/health` endpoint returns a secret-free
combined view of ChatMock health, OpenHarness health, provider visibility,
dashboard mode, and the configured terminal/garden/Quartz/scout agents.

## Sessions, events, and cancellation

Breadboard is the durable user-visible record. Additive database objects include:

- `openharness_runtime_sessions`: surface, Breadboard binding, OpenHarness id,
  agent, garden/page scope, workspace key, metadata, and runtime status.
- `openharness_messages`: durable terminal and Quartz transcripts.
- `openharness_proposals`: typed note/page-revision/visualization proposals.
- `openharness_skill_audit`: skill search, quarantine, review, promotion, and
  rejection records.
- `openharness_audit_events`: agent selection, tool use, permission decisions,
  fallbacks, errors, cancellations, and capability lifecycle events.
- Additive runtime/tool/permission/proposal fields on garden chat messages.

OpenHarness emits a server-wide SSE stream. The gateway filters it to the
authorized session and normalizes it as `assistant.delta`,
`assistant.completed`, `reasoning.status`, `tool.started`, `tool.completed`,
`permission.requested`, `session.status`, and `error`.

The terminal restores its latest surface session after refresh. Garden chats are
bound to their existing `chatSessionId`, so a restored Breadboard conversation
reuses its OpenHarness runtime record. Stop sends a browser abort and a
server-side OpenHarness abort. Quartz uses `/api/quartz-ai/abort` for the same
behavior.

## Agent profiles and generalization

Agents are external configuration under `openharness-config/agent/`:

- `breadboard-terminal`: repository engineering agent. Read/search/status/diff
  and focused verification are available; edits, broad shell, installs, network,
  commits, and migrations require permission; destructive deletes and force push
  are denied.
- `breadboard-garden`: garden-grounded assistant with only curated `garden_*`
  tools. No generic file, shell, git, web, task, or skill access.
- `breadboard-quartz`: page/map assistant with the same isolation and
  proposal-only write behavior.
- `breadboard-document`: repository-free document analysis with no shell, edit,
  web, task, or skill access. This is the concrete non-coding/non-repository
  generalization proof.
- `breadboard-capability-scout`: discovery-only subagent limited to
  `capability_search`; it cannot edit, execute shell, browse arbitrarily, install,
  or delegate again.

The fork is generalized through upstream agent/tool/provider configuration, not
through a large rewrite of OpenCode internals. The only intentional core fork
change remains the additional executable alias. This keeps upstream merges
practical while supporting coding and non-coding profiles.

## Garden tools and proposals

`openharness-config/tool/garden.ts` exposes scoped search, page/source retrieval,
graph-neighbor, Learning Spine, content inventory, event, validation, and typed
proposal tools. Every call reads a short-lived capability token from the
server-created session workspace and calls the internal dashboard endpoint. The
token pins the session, garden, and tool allowlist; a model-supplied garden id
cannot broaden it.

Write-like actions create reviewable note, page-revision, or visualization
proposals. They never edit published Markdown directly.

## Quartz page and Graph View context

Quartz JavaScript calls only dashboard routes. On each turn it sends the current
page slug, bounded visible page text, selected text, and the latest bounded Graph
View packet. `graph.inline.ts` emits `breadboard:graph-context` on graph load,
selection, hover, filter/depth change, and viewport change.

The dashboard re-authorizes the garden/page and rebuilds trusted server-side page
context. Graph input is normalized to the current garden and capped before the
agent sees it: selected/visible nodes, relation types, depth, viewport, and a
small neighboring concept set. Unrelated gardens and arbitrary client content are
discarded. Page-only, selected-text, and graph-node queries therefore receive
different bounded context packets.

Anonymous use requires a public, chat-enabled garden, is rate-limited, and is
bound to an opaque browser token. Private gardens require an authenticated owner.

## Real skill discovery, review, and promotion

The `find-skills` behavior uses the official Skills CLI pinned by
`SKILLS_CLI_PACKAGE` (default `skills@1.5.9`):

1. `skills find <query>` returns real repository/package identifiers. Unavailable
   descriptions or permissions remain unknown; Breadboard does not invent them.
2. A user-authorized install runs `skills add <repo> --skill <name> --copy --yes`
   in an isolated temporary staging directory.
3. The exact result is copied to `openharness-skills/quarantine/`. It is inactive
   and cannot be loaded as an approved skill.
4. Breadboard records source URL and lock metadata, every file SHA-256, scripts,
   URLs, derived permission risks, timestamp, target agents, and review status.
5. Promotion re-hashes every file, rejects post-review mutation, requires
   `SKILL.md`, copies only the reviewed version to `.agents/skills/`, and updates
   the approved registry. Rejection deletes only the quarantined copy.

Quarantine also caps file count, individual file size, and total size. Manifest
name mismatches cannot be promoted. Third-party promotions are attached only to
`breadboard-terminal`; every other checked-in profile denies dynamic skills.

The terminal can emit a structured capability gap and ask the isolated scout to
search. Search/install/promotion are separate, auditable actions. A promotion
linked to a parent task emits a continuation event so the original terminal task
can resume; garden and Quartz agents cannot invoke this path.

The terminal's **Review skills** panel is the human control point: it shows real
search metadata, quarantine risks, source/lock identity, scripts, URLs, every
file hash, and permission checkboxes before the approve/reject action. Approval
uses the latest gap recorded for that authorized terminal session and submits a
continuation turn back to the same session.

## Startup and environment

Copy `.env.example`, `dashboard/.env.example`, and `openharness/.env.example` as
needed. Important variables are:

| Variable | Purpose |
| --- | --- |
| `OPENHARNESS_MODE` | `required`, `preferred`, or `legacy` |
| `OPENHARNESS_BASE_URL` | Dashboard-to-runtime URL |
| `OPENHARNESS_USERNAME`, `OPENHARNESS_PASSWORD` | OpenHarness Basic Auth |
| `OPENHARNESS_ROOT` | Server-controlled runtime workspaces |
| `OPENHARNESS_CAPABILITY_SECRET` | HMAC secret; production should not reuse local defaults |
| `OPENHARNESS_*_AGENT` | Agent name per surface |
| `CHATMOCK_BASE_URL`, `CHATMOCK_API_KEY`, `CHATMOCK_MODEL` | OpenHarness provider wiring |
| `BREADBOARD_INTERNAL_URL` | Internal callback URL for scoped tools |
| `BREADBOARD_DASHBOARD_URL` | Dashboard URL embedded into the Quartz build |
| `QUARTZ_AI_ALLOWED_ORIGINS` | Additional permitted Quartz origins |
| `OPENHARNESS_SKILLS_QUARANTINE`, `OPENHARNESS_SKILLS_APPROVED` | Skill lifecycle roots |
| `SKILLS_CLI_PACKAGE` | Pinned official discovery CLI package |

From the repository root:

```sh
npm run dev
```

The ordered launcher starts and health-checks ChatMock, then starts and checks
OpenHarness plus its ChatMock provider, then starts Quartz and the dashboard. In
`required` mode it fails fast instead of starting a half-working interactive
stack; in `preferred` mode it logs the runtime failure and continues so the
dashboard can expose its fallback state. `start.bat` delegates to this same
launcher. OpenHarness requires Bun; run `bun install` in `openharness/` on first
setup.

Focused launchers remain available as `npm run dev:chatmock`, `dev:openharness`,
`dev:quartz`, and `dev:dashboard`.

## Route inventory

```text
/api/openharness/health
/api/openharness/agents
/api/openharness/models
/api/openharness/sessions
/api/openharness/sessions/[sessionId]/messages|events|abort
/api/openharness/permissions/[requestId]
/api/openharness/tools/garden
/api/openharness/tools/capabilities
/api/openharness/skills/search|install|promote  (promote accepts promote/reject decisions)
/api/gardens/[gardenId]/proposals
/api/gardens/[gardenId]/proposals/[proposalId]
/api/quartz-ai/chat|events|abort
```

Browser-facing routes enforce Breadboard authentication or the explicit public
Quartz policy, ownership/scope checks, size limits, and secret-free errors.
Internal tool routes require narrow HMAC capability tokens.

## Verification and limitations

Focused tests cover gateway authentication, agent restrictions, session-event
isolation, auth boundaries, migrations, cancellation wiring, mode semantics,
live-route selection, Quartz context bounding, official CLI parsing, quarantine
hashes, tamper rejection, and exact promotion. A live Skills ecosystem test is
opt-in with `OPENHARNESS_LIVE_SKILLS_TEST=1` so the default suite is deterministic.

The approved skill registry is local filesystem state; production deployments
must back it up or use a controlled artifact promotion process. Quarantine risk
classification is review assistance, not a sandbox or proof that third-party code
is safe. OpenHarness remains loopback-oriented and should be placed behind a
supervisor and strong credentials in production.

## Upstream upgrade strategy

Pull the upstream OpenCode branch, reconcile the executable alias if its package
manifest changed, run `bun install`, and rerun the Breadboard focused tests. Most
integration behavior stays in `openharness-config/` and dashboard adapters, which
keeps core fork conflicts small.
