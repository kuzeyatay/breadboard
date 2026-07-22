# OpenHarness integration

OpenHarness is Breadboard's knowledge-work assistant runtime. It is a shallow,
upstream-friendly fork of OpenCode plus Breadboard-owned configuration, agents,
tools, session adapters, policy, and UI routes. Coding is disabled by default;
it is a temporary task capability, not the assistant's identity.

It backs the live dashboard terminal, both live garden chat clients, and the
published Quartz page assistant. Learning-content generation remains on the
existing ChatMock/OpenAI-compatible pipeline: ingestion, extraction, mapping,
garden and Learning Spine generation, council/critic loops, deterministic repair,
semantic audit, finalization, publication, and embeddings do not use
OpenHarness.

The canonical cross-surface conversation, memory, authorization, compaction,
failure-recovery, and migration design is documented in
[`OPENHARNESS_CONVERSATION_MEMORY.md`](./OPENHARNESS_CONVERSATION_MEMORY.md).

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
it does not introduce parallel demo UIs. Names in the table above describe the
historical audit and are not the current product model.

## Knowledge-first capability policy

Every turn receives a deterministic, server-owned capability decision:

| Mode | Purpose | Mutation |
| --- | --- | --- |
| `knowledge` | Research, grounded Q&A, documents, writing, study, planning, web research, general skills, connections, and reviewable artifacts | No application/repository mutation, shell, Git writes, packages, builds, tests, or deployment |
| `technical_read` | Narrow source inspection for an explicit explain/inspect/diagnose request | Read/glob/grep only; no mutation or arbitrary shell |
| `scoped_implementation` | A concrete authenticated software change that cannot be completed without code | Only the approved root, tools, operations, conditional skills, and duration |

The model cannot grant a mode. Slash tokens, skill metadata, prompt text, and MCP
tool descriptions are removed from the escalation signal. Conceptual technical
questions, architecture summaries, comparisons, plans, and explicit “do not
change” requests stay in `knowledge` or read-only mode. High-impact actions such
as commit, push, deployment, branch changes, destructive migrations, secrets, or
publishing are not implied by implementation approval and require a separate
explicit-intent workflow.

The decision is recorded in `openharness_capability_decisions` with the requested
outcome, reason/source, authorized roots, tools, operations, selected conditional
skills/connections, timestamps, expiry/revocation, and a database audit id. The
runtime permission set is updated before dispatch. Completion, cancellation,
failure, expiry, or legacy migration revokes the decision and restores
knowledge-only runtime permissions. Skills and connections are intersected with
this allowlist and cannot widen it.

## Runtime architecture and trust boundary

```text
Browser UI
  -> Breadboard dashboard backend
       authentication and garden/page authorization
       capability-mode decision
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
- `CHATMOCK_MODEL` (local default `gpt-5.6-sol`)

OpenHarness owns the model call for interactive surfaces. Direct ChatMock calls
remain only in the learning pipeline, diagnostics, explicit `legacy` mode, and
the visible/audited `preferred` garden fallback.

The authenticated `GET /api/openharness/health` endpoint returns a secret-free
combined view of ChatMock health, OpenHarness health, provider visibility,
dashboard mode, and the configured terminal/garden/Quartz/scout agents.

## Sessions, events, and cancellation

Breadboard is the durable user-visible record. Authenticated Terminal, Garden
Chat, and Quartz requests share one opaque conversation API and one unified turn
service. A conversation owns one primary OpenHarness runtime; its active surface,
garden, and page are replaced on every request and are not ownership boundaries.
Additive database objects include:

- `conversations`: surface-independent, user-owned chats with opaque public ids.
- `conversation_messages`: canonical, idempotent, ordered transcripts with
  pending/complete/failed/aborted lifecycle state.
- `conversation_memory_state`: rolling summary, structured working state,
  compaction cursor, and version.
- `durable_memories`: scoped, ranked, candidate/confirmed/superseded cross-chat
  memory records.

- `openharness_runtime_sessions`: surface, Breadboard binding, OpenHarness id,
  conversation binding, replaceable garden/page context, authorized garden set,
  workspace key, metadata, and runtime status.
- `openharness_messages`: retained compatibility transcripts for legacy and
  anonymous runtime paths.
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

The dashboard Assistant restores its latest owned conversation after refresh.
The same opaque conversation id can move across authenticated surfaces and reuse
its runtime. Stop sends a browser abort and a server-side OpenHarness abort.
Quartz uses `/api/quartz-ai/abort` for the same behavior. Anonymous Quartz remains
on an isolated browser-token-bound runtime and cannot attach to private memory.

## Migration and compatibility

Stored conversations are preserved. When an old `breadboard-terminal` or
`breadboard-workbench` session loads, Breadboard maps it to
`breadboard-assistant`, revokes any active decision, resets the mode and runtime
rules to `knowledge`, and records the migration. A historical full-filesystem
setting is changed to restricted; its previous root is retained only as inactive
metadata and cannot become authority without a new task decision.

Old namespaced slash tokens remain parser-compatible, while only clean tokens are
generated. Legacy prompt-library entries are imported to server persistence with
the browser copy retained for recovery. Existing MCP records and audit history
are additive and preserved. Existing skills are reclassified at load; coding
skills are unavailable to knowledge/public surfaces and newly promoted coding
skills use the conditional store. No migration restores broad permissions.

## Agent profiles and prompt composition

Agents are external configuration under `openharness-config/agent/`:

- `breadboard-assistant` is the canonical authenticated assistant. Its base
  configuration denies repository and coding operations.
- `breadboard-terminal` and `breadboard-workbench` are restricted compatibility
  aliases only. New sessions never select them.
- `breadboard-garden` uses curated garden reads and typed proposals; it has no
  general application-repository access.
- `breadboard-quartz` uses bounded server-trusted page/graph context and
  proposal-only writes. Public Quartz is always knowledge-only and receives no
  private memory, private connections, conditional coding skills, files, or code
  tools.
- `breadboard-document` focuses on reading, extraction, comparison, rewriting,
  and artifacts without repository, Git, shell, or package permissions.
- `breadboard-capability-scout` can discover candidates but cannot install,
  mutate, execute shell, or delegate.

The system prompt is composed server-side from
`openharness-config/system/assistant.md`, the relevant surface prompt, a factual
capability-decision block, and—only in an approved implementation turn—
`system/scoped-implementation.md`. It explicitly covers identity, hierarchy,
truthfulness, knowledge work, tools, connections, skills, memory, evidence,
proposals, coding gate, permissions, errors, and completion. GBrain is not
considered integrated merely because its source was cloned; memory is claimed
only after a configured, healthy adapter returns a durable result.

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

## Capability palette, tokens, connections, and prompts

The real mounted composers use a shared capability picker. Clicking the
accessible **Open capabilities** button or typing `/` into an empty composer
opens an anchored desktop palette or a mobile bottom sheet. It has one search
field and Skills, Connections, and Prompts tabs, keyboard navigation, focus
restoration, loading/empty/retry states, and no filesystem, path, runtime-health,
memory, environment-variable, or provider diagnostic footer.

Rows insert clean tokens such as `/research-synthesis`, `/google-drive`, and
`/study-guide`, followed by a space; selection never sends the message. A typed
server registry resolves stable IDs, kinds, surfaces, modes, and deterministic
collisions. Legacy `/skill:`, `/mcp:`, and `/prompt:` tokens remain compatible,
but neither a token nor prompt text can activate implementation mode.

Connection and prompt management use separate palette detail views. Remote MCP
prefers OAuth. Local MCP requires explicit execution approval and rejects
credential-looking arguments; secret values are never included in stored/public
metadata. Connections remain subordinate to the active mode. Prompts are stored
server-side with create/edit/delete and legacy-library import support.

## Real skill discovery, classification, review, and promotion

Discovery uses a provider abstraction in this order: a configured supported
skills.sh catalog API, the official Skills CLI pinned by `SKILLS_CLI_PACKAGE`,
then a last-known cache for temporary failure. Search is query-based, debounced,
and paginated. It does not scrape undocumented HTML, eagerly load the complete
catalog, or fabricate candidates, descriptions, permissions, or popularity.

1. Search returns real provider/package metadata and an honest provider/stale
   status.
2. An authorized install runs the official CLI in an isolated staging directory.
3. The exact result enters `openharness-skills/quarantine/` and remains inactive.
4. Breadboard records source/lock metadata, hashes, scripts, URLs, permissions,
   classification evidence, timestamp, and review state.
5. Promotion re-hashes every file and rejects mutation/name mismatches. General
   skills enter the approved store; implementation skills enter
   `openharness-skills/conditional/`. Rejection removes quarantine only.

Classification considers provider metadata, description, repository, requested
tools, and reviewed `SKILL.md` content. The persisted states are
`eligible_general`, `eligible_coding_conditional`, `blocked_security`,
`blocked_incompatible`, `needs_review`, and `unknown`. Unknown/ambiguous skills
do not silently become trusted; blocked items cannot promote. Conditional skills
stay hidden from knowledge search/invocation and, after approval, still require a
relevant authenticated `scoped_implementation` task. A skill can only reduce the
active tool set.

The palette's review detail shows real source identity, hashes, scripts, URLs,
risk signals, classification evidence, compatible modes/surfaces, and requested
permissions. Existing coding skills are reclassified, disabled by default,
hidden from general suggestions, and retained in audit history.

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
| `OPENHARNESS_SKILLS_QUARANTINE`, `OPENHARNESS_SKILLS_APPROVED`, `OPENHARNESS_SKILLS_CONDITIONAL` | Inactive review, general, and task-conditional skill roots |
| `SKILLS_CATALOG_API_URL`, `SKILLS_CATALOG_API_TOKEN` | Optional supported skills.sh catalog API |
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
/api/openharness/commands
/api/openharness/mcp-connections
/api/openharness/prompts
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

Focused tests cover the server capability gate, default-deny agents, palette and
token regressions, runtime permission intersection, session migration/revocation,
Garden/Quartz boundaries, gateway authentication, official API/CLI/cache catalog
behavior, classification, quarantine hashes, tamper rejection, exact promotion,
MCP safety, and prompt/token authorization. A live Skills ecosystem test is
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
