# Adding an agent

How a new runtime agent gets wired into Breadboard, and — more importantly — the
promises it has to keep once it is in. Read this before adding one; the ordering
below is the order to build in.

The rules here are not style preferences. Every one of them exists because
something broke when it was skipped, and most of them are enforced by a test that
walks **every** agent at once, so a new agent inherits the coverage for free and
fails loudly when it is half-wired.

---

## 0. Decide what the agent actually is

Breadboard hosts three different shapes, and picking the wrong one costs a rewrite.

| Shape | When | Example |
| --- | --- | --- |
| **Wrapped runtime** | The clone is a real program with its own loop | Trading Agent (Python LangGraph via a bridge), OpenWork, Socials Manager |
| **Breadboard-driven loop** | The clone is a skill, a prompt pack, or a pile of scripts with no runtime | Agent Reach, Career Ops, Deep Research |
| **Native compiler** | No clone at all; deterministic code owns the output and the model only reads intent | Hardware Blueprint, Parametric CAD |

Before writing anything, run the liveness test on the clone: does it have an
entry point you can execute, a loop that does not require a human, and a way to
report progress? If two of those are missing, you are writing shape 2, not shape 1.
See `docs/HYPERFRAMES_INTEGRATION.md` for the reasoning written out on a real case.

**ChatMock is the model layer.** Never add a second one. If the clone speaks
OpenAI-compatible HTTP, point its base URL at ChatMock's `/v1` and pass whatever
API-key variable it insists on. If it does not, drive the loop yourself.

---

## 1. Identity — `src/lib/<agent>/identity.ts`

One module owns the agent's name and its command. Everything else imports from it;
nothing hardcodes the string.

```ts
export const MY_AGENT_COMMAND = "/agents:my-agent";
export const MY_AGENT_AGENT_ID = "my-agent";   // kebab-case, matches the command
export const MY_AGENT_AGENT_NAME = "My Agent"; // Title Case, what a person reads
```

- The id is used by the settings catalog, the runtime-agent profile, the palette
  row's highlight key and the settings URL. Keep the three spellings consistent:
  `/agents:my-agent` → `my-agent` → `My Agent`.
- Export a `taskFrom<Agent>Command(text)` that returns the task with the token
  stripped, preserving any other slash tokens stacked in front of it so the
  capability resolver still sees them. Copy `lib/career-ops/identity.ts`.
- Export a `<agent>UserMessage(task)` that renders the user half of the turn.

**If the agent takes no prompt** (a form, not a sentence), the identity module owns
the request type and its validation instead, and the composer must refuse free
typing rather than accept text it will discard — see
`lib/tradingagents/identity.ts` and section 7.

---

## 2. Run manager — `src/lib/<agent>/run-manager.ts`

In-memory, one map of runs keyed by `runId`, stashed on `globalThis` so a dev-server
hot reload does not lose them.

```ts
export function startRun(input: StartRunInput): { runId: string; status: RunStatus }
export function getEventsSince(userId: number, runId: string, since = 0): Event[]
export function isTerminal(userId: number, runId: string): boolean
export function abortRun(userId: number, runId: string): boolean
```

Rules that matter:

- **`requireRun` checks `run.userId`.** A run id must never be readable by another
  account.
- **Events are append-only with a sequence number**, so the SSE route can replay
  from a cursor and a reconnecting card catches up instead of starting blank.
- **Terminal events carry the full result** (`run.completed` / `run.failed` /
  `run.aborted` with a `summary`). That summary becomes the saved message — see
  section 5. A card that only ever streamed its answer loses it on reload.
- **Cleanup is scheduled, not immediate**, and the timer is `unref()`ed. Give a
  long-running agent a retention window that outlasts a plausible tab switch.
- Never let a spawned process outlive its abort: kill the child in `abortRun`.

---

## 3. API routes — `src/app/api/<agent>/…`

The shape every agent uses:

```
<agent>/runs/route.ts                    POST  → start a run
<agent>/runs/[runId]/events/route.ts     GET   → SSE, replays from ?since=
<agent>/runs/[runId]/abort/route.ts      POST  → stop it
<agent>/health/route.ts                  GET   → is it usable, and why not   (optional)
<agent>/setup/route.ts                   POST  → steps only the user may authorize (optional)
```

- Every route starts with `requireUserId()`. No exceptions.
- The run route resolves ChatMock with `resolveChatmockBaseUrl(request)` — do not
  read the env var directly, or the desktop/host split breaks.
- The run route reads stored defaults with `agentSettingsFor(userId, AGENT_ID)`
  (section 6) and lets anything in the message win over them.
- Setup actions (installing dependencies, building a venv, storing a vendor key)
  belong here and are **only ever triggered by the user pressing a button**. A run
  must never install anything.
- Secrets go to a file-backed store outside the clone (see
  `lib/tradingagents/credentials.ts`), never into `brain.db`, and are never read
  back to the browser — health reports *whether* a key is set, never its value.

### The chat the run was launched from

An agent that is handed only its task cannot resolve a request that leans on the
conversation — "yes", "do the second one", "fix the bug you just described" — and
answers that it has nothing pending. So the run route reads the chat and the run
manager puts it in front of the prompt:

```ts
// route: the chat arrives in the body as conversationId / conversationPublicId
// / chatSessionId, and clientMessageId keeps the launching turn from being
// repeated back to the agent as its own context.
conversationContext: conversationContextFromBody(userId, body),

// run manager: compose where the prompt is actually built, so the `task` that
// labels the card stays the label.
promptWithContext(instruction, input.conversationContext)
```

Three rules:

- **Never fold it into the task.** `task`/`brief` is also the run label, the
  replay signature and often the input to a parser or safety check. Carry the
  chat in its own field and join it at the prompt.
- **It is best effort, never a precondition.** `contextConversationFromBody`
  returns `null` for a chat it cannot resolve and the run starts with a bare
  task, exactly as before.
- **A runtime that takes a structured request gets nothing.** Shorts,
  TradingAgents, Formsmith and Money Printer never send free text
  to a model on the user's behalf, so there is nowhere to put a conversation
  that would not corrupt the request. `tests/agent-conversation-context-coverage.test.mjs`
  names them, so excluding a new agent is a decision rather than an oversight.

If the runtime's prompt cannot take the block first — Deep Tutor retrieves over
the whole user message, so a transcript on top would decide the retrieval — use
`contextSection()` and place it after the person's own words.

---

## 4. Register the run kind — `src/lib/conversations/external-agent-runs.ts`

This is the file that makes a run card survive a reload. Four edits, all in one
place:

1. Add the kind to `EXTERNAL_AGENT_RUN_KINDS`.
2. Add its descriptor to the `ExternalAgentRun` union — `runId` plus the minimum
   the card needs to re-render (`task`, or a label; never the whole result).
3. Add a branch to `parseExternalAgentRun` that validates it and returns `null` on
   anything malformed. A bad row must not break an otherwise healthy transcript.
4. Add the kind → field entry to **`EXTERNAL_AGENT_RUN_FIELD_BY_KIND`**, and the
   field to `ExternalAgentRunFields`.

That last table is typed `satisfies Record<ExternalAgentRunKind, …>`, so a new kind
**will not compile** until it names its transcript field. That is deliberate: the
mapping used to be written out twice — once for reading, once in the Garden save
path — and Agent TARS and Parametric CAD were missing from the second copy. Their
runs happened, their messages were saved, and their cards vanished on the next
reload because nothing remembered which agent owned the turn. Never reintroduce a
hand-written list of `record.<field> && { kind: … }` branches anywhere.

### 4b. Say how the run is stopped — `external-agent-cancel.ts`

Add the kind to `EXTERNAL_AGENT_ABORT_BY_KIND`, pointing at the same stop your
abort route calls (`abortRun`, or whatever yours is named). It is a dynamic
`import()` so a chat delete does not load every agent stack.

This is the table deleting a chat uses. The transcript row is the only thing
that remembers a run belongs to a chat, so a delete stops every running run
*before* the cascade takes those rows — a kind missing here would leave a real
process running with nothing left that could ever reach it. Like
`FIELD_BY_KIND`, it is `satisfies Record<ExternalAgentRunKind, …>`: a new kind
will not compile until it says how it is stopped.

---

## 5. The inline run card — `src/app/components/hermes/inline-<agent>-run.tsx`

The card is the agent's whole UI. It has to work in three states: streaming, saved,
and *saved but the run is long gone*.

```tsx
export default function InlineMyAgentRun({
  runId, task, persistedContent = "", persistedOutcome, onTerminal, onRetry,
})
```

Non-negotiables, each enforced by `tests/external-agent-persistence.test.mjs`:

- **Do not stream a finished turn.** Guard the effect with
  `if (persistedOutcome && persistedOutcome !== "running") return;` (or the
  `&& persistedContent` variant). A finished run is gone from the manager's memory,
  and its endpoint answers with an error.
- **Close on error.** `source.onerror = () => source.close()`. `EventSource`
  reconnects on error *by default, forever* — Agent TARS and Agent Browser each
  shipped a card that hammered a dead endpoint once per restored turn.
- **Render `persistedContent`.** Seed your result/failure state from it, or a
  reloaded turn renders empty.
- **Report the terminal result exactly once** through `onTerminal`, guarded by a
  ref, and call `notifyTaskCompleted(task)` on success.
- Use the shared card classes (`bb-agent-run-card`, `-header`, `-title`, `-label`,
  `-led`, `-row`, `-action`, `-text`) and `AssistantResponseMeta` +
  `AssistantMessageActions`. Do not invent a second card style.
- A user-started run renders its card normally. A Super Agent delegation is a
  private worker: keep its observer mounted so streaming, permissions, terminal
  state, and artifacts still work, but hide the worker card. Persist the Super
  Agent's text as the real message and the worker output as
  `externalAgentResult`; the result returns through the hidden continuation so
  the Super Agent summarizes it. Artifacts remain visible on the owning message.

---

## 6. Settings — only if there is something worth deciding in advance

**One agent, one settings button, one panel.** An agent with a page *and* a dialog
is a bug.

- **Run defaults** go in `CONFIGURABLE_AGENTS` in
  `src/lib/agent-settings/catalog.ts`: id, name, command, summary, `appliesWhen`,
  and typed fields (`select`, `toggle`, `number`, `text`, `multiselect`,
  `dimensions`). Each field records the inline flag that overrides it, because the
  rule is **a flag in the message always beats a stored default**. Adding an option
  later is one entry in that file and nothing else.
- Agents whose every run is shaped entirely by the prompt get **no entry**. A page
  of controls that change nothing is worse than no page.
- Translate stored values into your run's shape in `src/lib/agent-settings/
  defaults.ts` (or a `settingsFrom(values)` in your own lib), so the UI vocabulary
  ("auto", `0` for "let the run decide") never leaks into the runtime.
- **Agents with no setup of their own** need no component: the generic
  `agent-settings-dialog.tsx` renders their defaults.
- **Agents that need setup** (an environment to build, accounts to connect, keys to
  paste) keep their own dialog, and render `<AgentRunDefaults agentId={AGENT_ID} />`
  **inside it**. Pass the id constant, never the literal string — a hardcoded id
  silently stops matching the catalog the moment the agent is renamed.

---

## 7. Chat wiring

Three surfaces, and the agent must behave the same in each.

**Composer** (`assistant-composer.tsx`) — add `myAgentAgent`, `onSelectMyAgent`,
`onClearMyAgent`. The chip shows the command and clears the agent. If the agent
takes no prompt, replace the textarea with its request form, disable dictation, and
route the send button to the form's submit — do not leave a message field open that
silently discards what the person typed.

**Command hub** (`command-hub.tsx`) — a palette row with the command, one plain
sentence about what the agent does for the person using it (not how it works), a
`FavoriteBox` keyed `agent:<id>`, and — if it has settings — an
`<AgentSettingsButton name="My Agent" onOpen={…} />`.

**Terminal** (`dashboard-agent-terminal.tsx`) and **Garden** (`workspace-client.tsx`):

- `selectMyAgent()` checks health first and clears every other runtime agent —
  one agent owns the conversation at a time.
- `launchMyAgentRun()` previews the turn, POSTs the run, then persists it with
  `session.appendExternalAgentTurn({ …, run: { kind: "my_agent", runId, task } })`
  (Terminal) or `commitExternalAgentTurn(…, { myAgentRun: { runId, task }, externalAgentOutcome: "running" })` (Garden).
  **Persist the descriptor at launch, not at completion** — a run that finishes
  while the tab is closed still has to come back.
- Render the card for `message.myAgentRun` in `agent-runtime-panel.tsx` and for
  `msg.myAgentRun` in the Garden's message loop.
- Keep queued and selecting delegations active until the private observer
  mounts. Health checks can take seconds before an individual launcher's flag
  rises; exposing a completed-message action row during that gap makes the
  hand-off visibly flicker.
- Permission controls inside a run card must subscribe to the shared YOLO mode,
  just like Hermes permissions and the agent-launch queue. A hidden delegated
  observer cannot wait for an approval UI the user is intentionally never shown.
- Add the launching flag to `externalRunLaunching` and the id to
  `activeRuntimeAgentId`.

**Runtime profile** (`src/lib/hermes/capability-combinations.ts`) — add
`profile("my-agent", MY_AGENT_COMMAND, "My Agent")`. Without it, capability-conflict
detection does not know the agent exists and a stacked skill or attachment is
silently swallowed. Set `stacksCapabilities` / `acceptsAttachments` only if the run
route really resolves capability tokens / really forwards files; a test checks the
flags against the route's source.

**Selection brief** (`src/lib/hermes/runtime-agent-briefs.ts`) — add an entry
keyed by the same id: a `group`, one sentence of `does` saying what the agent
reaches, and — for anything a model may launch — one of `choose` saying when it
wins and the nearest wrong reason to pick it. This is the only description a
super-agent turn ever sees. Without it the agent reaches the model as a bare
name, which in practice means it is launched on topic match or never launched at
all, and `tests/runtime-agent-briefs.test.mjs` fails rather than letting that
ship. If the new agent shares a domain with an existing one, say in both entries
how the two differ — that is the distinction the chooser cannot infer. Omit
`choose` when `launchableByModel` is false: advice toward a call the route
refuses is worse than no advice.

---

## 8. Artifacts — they belong to the chat that made them

If the agent produces something a person will open later (a document, an image, a
model, a video, a PDF), it is an artifact, and it is bound to **one conversation**.

- Open a context at launch with a helper modelled on
  `lib/get-doc/artifact.ts` → `openGetDocArtifactContext`. It resolves the
  conversation from the `conversationPublicId` **carried from the launching chat**,
  finds its runtime session, begins a run, and locates the assistant turn with
  `findExternalAgentAssistantMessage` so the artifact sits under the right message.
- Pass `conversationPublicId` through the run route. Capture it at launch — never
  look up "the current chat" later, because by then the person may be somewhere
  else.
- Create through `createArtifact({ userId, conversationId, clusterId, surface, … })`.
  It refuses a conversation the user does not own; do not work around that.
- `clusterId` is the garden only when `surface === "garden_chat"`, otherwise `null`.
- Never list artifacts unscoped. `listArtifactsForUser` throws without a
  conversation, garden, or surface scope, so a missing scope fails loudly instead of
  quietly showing another chat's work. The panel and the inline cards both pass
  `conversationId`.
- If the context cannot be opened, say so plainly in the run's output. Silently
  dropping the file is the one unacceptable outcome.

---

## 9. Tests

Two levels, both required.

**Shared coverage — free, but only if you did section 4.**
`tests/external-agent-persistence.test.mjs` walks every kind in the registry and
checks: the descriptor round-trips, the field is discoverable on the assistant turn
(and *not* on the user half), the Garden save path covers it by construction, both
surfaces render a card, and every card guards its stream, closes on error and reads
its saved content. Add your kind to the registry and this runs against you.

**Your own file — `tests/<agent>-agent.test.mjs`.** Cover:

- the command parser: the token is recognised, a bare token selects the agent,
  stacked tokens survive, and prose does not become a parameter;
- input validation, including the refusals (bad ids, path traversal, future dates,
  empty selections) with the message each produces;
- the settings translation, including that unknown values fall back to defaults;
- the composed result that gets saved with the turn;
- the protocol boundary, if you have one — assert both sides agree on the event
  names rather than trusting a comment.

**Also update** the `RUN_ROUTES` map in `tests/capability-combinations.test.mjs`,
which asserts every runtime profile has a run route and that its flags match what
that route actually does.

Then run: `npm test`, `npx tsc --noEmit -p tsconfig.json`, `npx eslint <your files>`.

---

## 10. Verify it for real

Structural tests do not prove an agent runs. Before calling it done:

1. Execute the actual runtime end to end at least once. If a live model is
   unavailable (rate limit, missing key), stand up a stub that speaks the same
   protocol and prove the pipeline — then **say clearly which parts are stub-verified
   and which are not**.
2. Delete whatever the verification wrote. A stub-generated report left in the
   user's results directory, or a fake decision in an agent's memory log, will
   poison the next real run.
3. For UI, render it and look. `renderToStaticMarkup` plus the app's compiled
   stylesheet in headless Edge measures a layout properly; reasoning about
   flexbox does not.

---

## Checklist

```
[ ] lib/<agent>/identity.ts        command, id, name, parser, user message
[ ] lib/<agent>/run-manager.ts     per-user runs, sequenced events, abort kills the child
[ ] api/<agent>/runs + events + abort   (+ health/setup if it needs preparing)
[ ] external-agent-runs.ts         kind, descriptor, parser branch, FIELD_BY_KIND entry
[ ] external-agent-cancel.ts       ABORT_BY_KIND entry, so deleting the chat kills the run
[ ] inline-<agent>-run.tsx         guarded stream, onerror close, renders persistedContent
[ ] agent-runtime-panel.tsx        card for message.<field>
[ ] workspace-client.tsx           card for msg.<field>, select + launch + clears
[ ] dashboard-agent-terminal.tsx   select + launch + clears + launching flag
[ ] assistant-composer.tsx         chip, select, clear
[ ] command-hub.tsx                palette row (+ settings button)
[ ] capability-combinations.ts     runtime profile
[ ] runtime-agent-briefs.ts        what it does + when to choose it, for super agent
[ ] agent-settings/catalog.ts      run defaults, if there are any
[ ] artifacts                      conversationPublicId from launch → createArtifact
[ ] conversation context           route passes conversationContextFromBody, manager composes it
[ ] tests/<agent>-agent.test.mjs   + RUN_ROUTES entry
[ ] a real run, then clean up after it
```

## Worked examples

- **Wrapped Python runtime, no prompt, own settings panel** —
  `lib/tradingagents/`, `scripts/tradingagents-bridge.py`
- **Breadboard-driven loop over a clone's scripts** — `lib/career-ops/`,
  `docs/AGENT_REACH.md`
- **Native compiler with a rich artifact** — `lib/hardware/`, `lib/cad/`
- **Wrapped service with Docker underneath** — `lib/socials-manager/`
