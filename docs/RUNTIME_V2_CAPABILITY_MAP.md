# Runtime V2 capability map

Status: source inventory complete; post-migration Electron parity is **NOT RUN**.

This map identifies the authoritative pre-migration contracts that Runtime V2
must preserve. It is not a migration-complete claim. The machine-readable
authority is `qa/runtime-v2/feature-parity.json`; the readable row index is
`qa/runtime-v2/FEATURE_PARITY_MATRIX.md`.

The `workflow:image-generation` row now records a narrower source fact:
managed ComfyUI has a verified Runtime V2 service adapter, but the central
RuntimeProcess switch and post-migration Electron workflow are still `NOT RUN`.
This does not claim the provider/edit/upload branches migrated, and it does not
count the separately detached ComfyUI setup installer as a Runtime V2 job.

## Inventory boundary

The current deterministic inventory contains 475 capability rows:

| Family | Count |
|---|---:|
| Runtime agents | 37 |
| Successfully loaded Agency personas | 264 |
| ARIS and Spotify first-party personas | 2 |
| First-party `SKILL.md` entries | 26 |
| Reviewed installed skills | 3 |
| Default prompts | 10 |
| Providers | 12 |
| Model selections/sentinel | 6 |
| Chat surfaces | 5 |
| Tool families | 32 |
| Attachment kinds | 6 |
| Artifact kinds | 16 |
| Connections and catalog contracts | 14 |
| Workflows | 21 |
| Approval contracts | 7 |
| Recovery contracts | 7 |
| Cross-registry policies | 7 |

The Agency loader successfully reads 264 personas and records one rejected
source diagnostic (`engineering/engineering-developer-tooling-engineer.md` has
malformed YAML frontmatter). Rejected files are diagnostics, not silently
inventoried agents. ARIS and Spotify are loaded through their dedicated
first-party loaders and do not duplicate Agency rows.

The source catalog also freezes a count/hash for all 518 Next route sources and
the authored desktop IPC sources. Dynamic user MCP rows are deliberately not
read from a real user database. Composio, retained Nango, and MCP are represented
by their schema/source hashes, featured counts, and dynamic limits.

## Stable capability IDs

IDs are namespaced so other Runtime V2 inventories can join without guessing:

- `runtime-agent:<profile-id>`
- `persona:agency:<slug>`, `persona:aris`, `persona:spotify`
- `skill:first-party:<slug>`, `skill:installed:<slug>`
- `prompt:default:<slug>`
- `provider:<provider-id>`, `model:<model-id>`
- `surface:<surface-id>`
- `tool-family:<family-id>`
- `attachment:<kind>`, `artifact:<kind>`
- `connection:<slug>`, `connection-catalog:<broker>`
- `workflow:<workflow-id>`
- `approval:<approval-id>`, `recovery:<recovery-id>`
- `registry:<contract-id>`

Runtime agent IDs deliberately match the execution inventory as
`runtime-agent:<profile-id>`.

## Authoritative registries

| Contract | Source authority |
|---|---|
| Surfaces | `dashboard/src/lib/hermes/config.ts` |
| Surface tool scopes | `dashboard/src/lib/hermes/tool-scopes.ts` |
| Runtime agents and selection flags | `dashboard/src/lib/hermes/capability-combinations.ts` |
| Agent briefs/grouping | `dashboard/src/lib/hermes/runtime-agent-briefs.ts` |
| External-run persistence/cancel mapping | `dashboard/src/lib/conversations/external-agent-runs.ts`, `external-agent-cancel.ts` |
| Slash commands/collision grammar | `dashboard/src/lib/hermes/commands.ts`, `direct-slash-commands.ts` |
| Agency personas and diagnostics | `dashboard/src/lib/hermes/agency-agents.ts`, `agency-agents/` |
| Skills | `dashboard/src/lib/hermes/skills.ts`, `hermes-skills/prebuilt/`, `.agents/skills/registry.json` |
| Default prompts | `dashboard/src/lib/hermes/prompts.ts` |
| Implicit routing | `dashboard/src/lib/conversations/turn-service.ts`, `dashboard/src/lib/hermes/garden-chat-adapter.ts` |
| Providers/models | `chatmock/chatmock/providers/catalog.py`, `dashboard/src/lib/ai-models.ts`, `dashboard/src/app/api/models/route.ts` |
| MCP/Connections | `dashboard/src/lib/hermes/mcp-connections.ts`, `dashboard/src/lib/composio/catalog.ts`, `dashboard/src/lib/nango/catalog.ts` |
| Attachments | `dashboard/src/lib/chat-attachments*.ts` and the document/audio/video/model attachment registries |
| Artifacts/renderers/events | `dashboard/src/lib/hermes/artifact-types.ts`, `artifact-renderers.ts`, `artifact-store.ts` |
| Task permissions/tokens | `dashboard/src/lib/hermes/task-plan.ts`, `capability-broker.ts`, `capability-token.ts` |
| Filesystem approval | `dashboard/src/lib/hermes/filesystem-paths.ts`, `filesystem-grants.ts` |
| Durable Hermes recovery | `dashboard/src/lib/hermes/run-store.ts`, `event-stream.ts`, `run-recovery.ts` |

Every JSON row records the complete Phase 1 and mandatory-QA contract: identity,
name, category, visible/UI entry point, slash and implicit selection, route/IPC,
service/worker/provider/credential/software requirements, inputs, outputs,
artifacts, progress, streaming, cancellation, approval, follow-up, restart,
recovery, pre/post statuses, all evidence families, runtime path, result,
stopped-service semantics, fallback declarations, and anchored source hashes.

## Surface and routing boundary

The canonical surfaces are Dashboard Terminal, Garden Chat, and Quartz AI. The
inventory also records the legacy Garden compatibility adapter and temporary
chat behavior because both affect visible parity.

The Runtime V2 implicit route order is:

`premortem -> factcheck -> interactive visualizer -> agent loop -> Watch -> image-to-3D -> Spotify -> audio -> diagram -> GitHub Explorer -> humanize -> messaging -> Goal`

The legacy Garden adapter is separately frozen because it currently omits
Watch, Goal, and recent-attachment handling. That is a known source gap, not a
post-migration pass.

## Workflow coverage

The workflow rows cover source ingestion; document skill building/reading;
document editing/PDF conversion; image generation/edit/upload/search/image-to-3D;
audio analysis; Watch video analysis; parametric CAD; real browser automation;
coverage-driven research; semantic/GraphRAG and ColPali retrieval; Quartz
publishing; Scriberr, speech, and Meeting Notes transcription; durable memory;
artifact revisions; Garden mutations/import/export/publishing; and gadget
generation/action approval.

Attachment rows preserve exact accepted formats and bounds for text, images,
documents, audio, video, and 3D/CAD models. Artifact rows preserve all 16 kinds
and the renderer registry. A type, renderer, route, progress contract, cancel
path, approval path, or recovery path disappearing changes the source snapshot
and fails inventory parity.

## Approval and recovery boundary

Approval rows cover canonical filesystem grants, once/always/reject runtime
permissions, signed capability tokens, model-initiated agent launch, gadget
actions, sensitive browser actions, and Recall control.

Recovery rows distinguish durable contracts from known limitations. Hermes run
events, external transcript descriptors, Scriberr checkpoints, and turn/branch
state have durable source contracts. Browser runs, CAD live-run events, and
research coverage state remain in memory today. Runtime V2 must turn ambiguous
active attempts into `interrupted` or `uncertain`; it must not call them
recovered or retry them blindly.

## Known pre-migration gaps retained honestly

Quartz publication has crossed this boundary: Next now submits an authenticated
user-global `quartz-publish` job, and only a sealed disposable Runtime worker may
start the contained Quartz/esbuild tree. Its staged promotion and durable job
record cover cancellation and fresh-attempt recovery without changing the
existing mutation responses.

- The remaining Agent Browser runs/events/screenshots/approvals are process-memory state.
- CAD projects and revisions persist, but live CAD run events do not.
- Research coverage state is explicitly non-SQLite.
- Legacy and V2 implicit routing are duplicated and have drifted.
- Garden tool composition currently includes the Humanizer family twice.
- Agent rows in the Command Hub are hand-authored in addition to the profile
  registry, so UI order/visibility requires parity evidence.

These remain visible in the inventory. A migration cannot hide them, relabel
them PASS, or substitute a mock/fallback.

## Running the gate

Lightweight inventory/source validation only:

```bash
npm run qa:runtime-v2:parity -- --inventory-only
```

This mode regenerates the in-memory source snapshot, validates every required
field and source anchor, compares IDs/contracts/counts/hashes, and checks command,
selection, route, artifact, progress, cancellation, approval, recovery,
stopped-service, and mock/fallback drift. It does not launch Electron, services,
workers, builds, or compilers.

Mandatory parity gate:

```bash
npm run qa:runtime-v2:parity
```

The mandatory command intentionally fails now because every post-migration
status/result is `NOT RUN`. It may pass only after the normal user entry point
has inspected Electron evidence for selection, the real service/worker path,
output/artifact, cancellation/complete cleanup, and restart/recovery. A truthful
pre-existing external blocker may be `BLOCKED`; a newly blocked capability,
mock, canned response, lower-capability fallback, hidden stopped service, or
second-click cold start is a failure.

After an intentional registry change, regenerate the source inventory for
review with:

```bash
node qa/runtime-v2/registry-snapshot.mjs --write-artifacts
```

Do not regenerate the baseline merely to make an unexplained parity failure
disappear. Review the JSON/Markdown diff and preserve pre-migration evidence
before accepting a contract change.
