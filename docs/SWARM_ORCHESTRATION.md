# Durable team execution

Implementation contract for the Sapper-inspired Breadboard integration.
The existing conversation is the coordinator. Master Agents constrain its
roster; Agency personas provide expertise; runtime specialists and their
internal teams retain their own identities. Native tools and saved workflows
remain usable without being renamed as agents.

## Required behavior

- Select direct tools, one specialist, parallel assignments, or durable team
  execution according to distinct deliverables, dependencies and expected gain.
  Honor explicit engine choices, Master Agent scopes and saved preferences.
- Use a conversation-owned task/evidence ledger with bounded plans, acceptance
  criteria, checkpoints, evidence provenance and dependency scheduling.
- Start accepted assignments from authenticated server code, preserving each
  specialist's validation, typed inputs, settings, artifact ownership and stop
  path. Preserve existing pickers until a validated equivalent exists.
- Use Runtime V2 as the sole process owner. Account for nested team work and
  model councils in the parent budget; serialize conflicting shared resources.
- Recover after reconnect/restart without duplicate execution. Fence competing
  coordinators; reconcile an uncertain launch with its actual runtime before
  retrying. Stop all descendants and prevent late completion from restarting work.
- Persist artifacts and verification evidence on their originating conversation.
  Keep task evidence separate from GBrain sources and confirmed personal memory.
- Integrate persona/native/workflow/chat assignments, Goal continuation, LoopX
  governance and authenticated delivery surfaces without widening authority.
- Show persistent team progress, assignments, budget, blockers and outputs in
  the existing conversation, including pause/stop and required decisions.

## Verification gates

Exercise policy with actual capability catalogs and scoped inputs. Exercise the
ledger and scheduler with real SQLite, competing owners, restart, dependencies,
partial failure, budget exhaustion, verification and cancellation. Exercise the
authenticated dispatch boundary and actual specialist adapters, not just schema
presence. Run browser coverage for persistent activity and controls. Run an
end-to-end research-to-artifact workflow and an isolated coding/verification
workflow. Report unavailable external runtimes honestly; a mocked provider is
not evidence that an installed specialist or desktop runtime works.

## Implemented contract

`agent_launch` remains the single launch tool. Its optional `team_action` is
`catalog`, `start`, `status`, `verify`, `retry`, `pause`, `resume`, or `stop`.
Ordinary specialist launches retain their existing request shape. The stable
plugin schema explains when the coordinator should select each path:

- Use direct tools for one bounded step and a single specialist for one job.
- Use a parallel team when at least two distinct deliverables can proceed
  independently and improve coverage or completion time.
- Use a durable team for dependencies, a distinct review assignment, or an
  operation that must survive a disconnected page.
- Require a reason and an expected benefit; reject duplicate briefs, cycles,
  out-of-scope inputs and a one-task plan. Do not recursively create teams.

The initiating conversation coordinates the team. The authenticated active
turn seals its user, conversation, model, effort, Garden, capabilities, Master
Agent selection, approval policy and attachments. Model arguments cannot
supply a different owner or widen that scope. Master rosters are rederived
from the actual catalog, rather than trusting a serialized list of agent IDs.

`src/lib/swarm/store.ts` owns the SQLite assignment, attempt, evidence,
verification, resource and event records. Transactional reservations and
fenced coordinator leases prevent competing pumps from starting the same
work. Stable Runtime V2 request IDs reconcile an accepted launch whose reply
was lost. An uncertain non-idempotent worker is not blindly replayed.

Worker completion changes an assignment to `verifying`. The coordinator must
check every original acceptance criterion against saved evidence from the
current attempt or its designated reviewer. Only accepted work unlocks its
dependents. Failed work needs a corrected brief before its bounded retry.
These checks establish provenance; they do not mechanically prove that a
model's assessment of a source or artifact is correct.

## Fit with Breadboard features

| Feature | Integration |
| --- | --- |
| Master Agents | Constrain eligible runtime specialists; selecting a different Master cannot advance a team outside that new roster. |
| Agency personas | Run in temporary child conversations with the selected persona and a capability ceiling inherited from the parent. |
| Native tools | A worker receives its selected tool and the minimal supporting read tools, intersected with the parent's grants. |
| Saved workflows | Owned workflow IDs are validated and worker calls are restricted to that workflow. |
| Saved chats | Continue using `chat_send_message` and `chat_wait`, preserving the receiver's permissions and delivery behavior. Saved chats are not currently swarm-owned workers. |
| Composite specialists | Retain their own runtime identity and internal orchestration. They occupy the full scheduling wave unless an adapter provides a measured bound. |
| Garden and Terminal | Both show persistent team activity, assignments, budgets, decisions, evidence and pause/resume/stop controls. Public Quartz does not acquire team authority. |
| Attachments | Only server-resolved attachments from the originating turn can be assigned, and each specialist's existing acceptance rules still apply. |
| Artifacts | Runtime launches use the parent conversation's artifact scope. Child conversation artifacts are remapped to that parent with worker/attempt provenance and versioned evidence. |
| GBrain and personal memory | The original Garden scope remains available. Team evidence is separate; child workers cannot save findings as personal memory. |
| Goal mode | The team inherits the remaining token budget, contributes cumulative worker charges, and prevents a second automatic continuation from racing it. Goal stop/limits stop team work. |
| Task recovery and LoopX | Existing automatic recovery/ticks defer while the conversation has an active team. A team is finite work, not a new recurring service. |
| Stop and deletion | Main-chat Stop reaches team descendants; stopping an inline answer remains local. Deletion waits for worker termination before removing cancellation records. |
| Restart/reconnect | Startup and activity reads wake persisted assignments. The same conversation receives a deduplicated continuation when there is evidence to assess. |

The validated server-route registry currently contains 30 specialists: Codex,
OpenCode, Ruflo, Deep Research, Max Research, Get Doc, Agent Reach, OpenPlanter,
OpenScience, PRAXIST, Career Ops, OpenExecutive, Openwork, Deer Flow, Deep Tutor,
Meeting Notes, Stock Analyst, Vibe Trading, Trading Agent, Music Producer,
Inbox Zero, Socials Manager, Hardware Blueprint, Parametric CAD, Hyperframes,
OpenMontage, Resource2Skill, MatrAIx, Bolt Slides and MoneyPrinter.

Being registered does not guarantee an engine is installed or configured.
Its real route still validates settings, availability and typed input. Engines
without a durable server adapter, including interactive browser/cinema flows,
retain their existing launches. Manual file pickers are never replaced with a
generic brief. Model-generated `artifact`, `garden_source` and `repository`
input IDs are not admitted: the initial catalog supplies attachment references
only. Existing source/workspace tools remain available within their grants.

## Bounds and stop semantics

Defaults are 24 tasks, 4 concurrent assignments, 12 scheduling slots, 2 attempts
per task, 200,000 worker tokens and a 60-minute deadline. An agent may lower
these defaults. The plan must fit its token reservations before dispatch.
Conflicting repository/browser resources are serialized across teams for the
same user. Shared persona/native/workflow workspaces are conservatively
serialized; isolated checkouts are not created automatically.

Scheduling slots are admission weights, not an asserted count of every
subprocess a composite engine creates. Runtime V2 remains the process owner
and applies its own resource limits. Cumulative usage receipts are deduplicated;
missing or incomplete receipts consume the full assignment reservation.
Observed overruns stop further work. This is not a hard provider-side token
cutoff, and a provider can report an overrun after spending it. Coordinator
conversation usage follows existing conversation/Goal accounting.

Pause prevents new starts while observing work already running. Stop requests
cancellation, preserves resource locks until termination is observed, rejects
late publication and prevents queued dependents from starting. A runtime that
cannot be reached leaves a visible cancellation/recovery state. Chat deletion
returns a retryable conflict until that state is resolved. Worker conversation
records and frozen runtime payloads are removed with their owning conversation.

## Verification status (2026-11-08)

- Full dashboard TypeScript checking passed; the final frozen-source recheck
  is recorded in the handoff manifest.
- 104 Node tests passed in the final combined batch: policy, real SQLite
  recovery/admission, scheduler races, authenticated tool scope, actual search
  and research route integration, artifact publication, browser controls and
  existing launch/Stop/Goal/runtime/catalog/Garden deletion regressions.
- The new Python plugin callback test passed through the canonical Hermes
  runner. The existing chat coordination and subagent-identity tests also passed
  (five additional tests). Windows pytest used a dedicated workspace basetemp.
- Edge exercised the actual team component and API with real SQLite: approve,
  reload, pause, resume, narrow viewport and stop. Its harness isolates session
  authentication and scheduling and does not represent full-app visual review.
- Route integration uses the real handler validation, settings parsing and
  Runtime facade, with the external Runtime/provider simulated. Artifact tests
  use actual file storage, publication transactions and versioned evidence.

Installed specialist and full-app live verification remain pending the
coordinated build 38. Build 37's route probe returned HTML rather than the new
JSON API after an initial timeout. No live swarm assignments were submitted to
that build. No independent rebuild or restart was performed by this task.

The frozen file hashes, exact test commands/logs and remaining release checks
are in `dashboard/.swarm-verification/handoff.json`. This status must not be
interpreted as live proof for every registered specialist or provider.
