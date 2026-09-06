# Music Producer

Music Producer is a chat specialist that turns a musical brief into a real WAV
artifact using ACE-Step 1.5. Its agent ID is `music-producer`, command is
`/agents:music-producer`, external-run kind is `music_producer`, and transcript
field is `musicProducerRun`. Terminal and Garden use the same run card. Super
Agent can delegate creation and revision through the existing approval and
private continuation path. Music questions, playback, identification,
transcription and analysis-only requests keep their existing routes.

## Use and configuration

Select Music Producer in the composer or command hub, then open its settings.
The single panel contains provider connection/setup, optional Resonant and the
shared run defaults. The initial default is **one 60-second instrumental draft**;
explicit request values override saved defaults. No quality-revision loop or
multiple-candidate generation runs automatically.

For example:

```text
/agents:music-producer Create a 60-second instrumental ambient track with piano, no drums, around 80 BPM.
```

For an original vocal song, specify the language and subject. To keep supplied
lyrics literal at the planning boundary, use a final `Lyrics:` block:

```text
/agents:music-producer A gentle piano song --duration 60 --language tr
Lyrics:
Bir ses
Gökyüzünde
```

The block's text is copied into the request and associated Markdown artifact;
the backend's caption/lyric formatting and internal LM planning are disabled.
This preserves the supplied text, but does not prove the generated singer
performed every word accurately. No lyric transcription or listening-based
quality claim is made.

Supported flags are `--duration`, `--bpm`, `--seed`, `--language`,
`--instrumental`, `--source ARTIFACT_ID@VERSION`, `--arrange`, and the recovery
command described below. Natural language controls the same validated request.
Advanced authenticated callers can pass the domain fields in `options`; paths,
provider URLs, executable/argv/environment overrides and unrecognized fields
are not domain options.

### Managed ACE-Step

Managed setup currently targets the Windows Runtime distribution. Click
**Download and prepare ACE-Step** explicitly. The registered `managed-setup`
job downloads pinned source, installs dependencies in its own Python 3.11
environment using upstream `uv.lock`, and downloads turbo, VAE and
Qwen3-Embedding-0.6B assets. No additional conversational account is needed.
The downloaded model inventory is capped at 16 GiB; dependencies and caches
need additional disk space. The panel links the source and model licenses.

Setup progress/job identity survives a settings reload. Stop setup asks Runtime
to cancel its process tree. Repeating explicit setup repairs missing files at
the same revisions. Setup is not invoked by selection, health, connection
testing, a delegated request, or ordinary generation.

Mutable files are under the Runtime data root at
`runtime-v2/services/acestep/`, including `.venv`, `source/checkpoints`, cache,
temporary files, a per-install API key and `models-ready.json`. Nothing installs
into packaged program files or the repository's checked-in source. Normal
service startup uses offline flags and blocks the reviewed upstream model
download helpers; missing assets require explicit setup.

Hardware detection records CUDA/MPS availability, GPU name and VRAM when
available. This is evidence about the installation, not a promise of sufficient
memory or performance. The pinned backend selects its supported device and
offload configuration. Runtime admission failures retain
`BREADBOARD_RESOURCE_EXHAUSTED`; a reported GPU OOM becomes
`provider_out_of_memory`. No other agent's model is unloaded or reconfigured.

### External ACE-Step

Choose **External ACE-Step endpoint**, enter an explicit HTTP(S) origin, optional
API key, and a reviewed model (`acestep-v15-turbo`, `acestep-v15-sft` or
`acestep-v15-base`). Save and test the connection. Prompts, lyrics and reference
audio are transferred to that endpoint; the panel discloses this. There is no
automatic local-to-hosted fallback, port adoption, or task-supplied URL.

Keys remain server-side and are never returned by health/settings. A changed
setting affects new launches; each existing run retains its original provider
identity and receipt. The external server must implement the reviewed API;
discovered model names alone cannot prove an arbitrary fork's semantic parity.
Both modes use Runtime-owned finite collectors. A bare dashboard can configure
and inspect an external endpoint, but this implementation requires Runtime to
execute a music run and has no direct-spawn fallback.

## Supported operations and revisions

| Operation | Behavior | Artifact result |
| --- | --- | --- |
| Generate | One text-conditioned instrumental or original vocal song | New audio artifact |
| Variation | Full regeneration, with the selected version as lineage; no claim of waveform conditioning | New derivative artifact |
| Reference | Global style/reference conditioning using uploaded bytes | New derivative artifact |
| Cover | Whole-song source/structure conditioning | New version for an artifact source; new artifact for an upload |
| Repaint | Interval conditioning over a selected source | New version for an artifact source; new artifact for an upload |
| Arrange | Optional approved Resonant composition/mix/render | New derivative audio artifact |

Sources must already belong to the launching conversation. Upload a WAV in that
chat before asking for a reference or revision; this first version does not
advertise same-turn attachment forwarding. The resolver inspects up to 200
recent messages and offers a bounded list of recent sources. It never selects
another chat's latest output. Use `--source ID@VERSION` or a card's revision
action to pin an exact generated source. The selected history version also
controls playback, download, artifact viewing and revision prompts.
Revising a historical version appends a new version with that selected source
recorded in its lineage; existing versions remain playable.

“Make another variation” means regeneration. “Make this version darker” normally
uses cover conditioning. “Replace 20–35 seconds with a stronger chorus” uses
repaint. If a precise region must stay unchanged, request preservation outside
the interval: the collector requires matching duration, channels, sample rate
and PCM format, then copies only the selected interval into the original WAV.
Tests verify byte equality outside that interval. A mismatch fails rather than
silently publishing whole-track regeneration as a surgical edit. Splice edges
are not crossfaded; an edit may need a subsequent musical revision.

Prior versions remain intact. A concurrent change to the selected current
version rejects a stale revision. Downloads use the pinned version. Lyrics are
associated Markdown artifacts with the audio ID/version and language. No audio
or base64 is put into conversation JSON.

Cover, variation and repaint retrieve the selected generated version's original
lyrics and vocal language directly from its metadata by default, even if chat
history has been clipped. Rewriting/removal requires that intent in the request;
an explicit new `Lyrics:` block replaces the text. A repaint with no explicit
duration uses the selected WAV's measured duration before validating its interval.

## Execution and durability

The authenticated run route resolves the selected conversational model through
ChatMock, shared agent defaults and launch-time context. It captures the user,
conversation, surface/Garden, runtime session and stable assistant message
before submission. Context is composed separately from the task label.

The route records a durable launch descriptor, then submits the registered
`music-producer-run` / `outer-music-producer-node` job. Native state owns the
worker lifetime; SQLite stores the domain request, launch binding, frozen
provider identity, task receipt, collection/provider states and publication
identity. Work continues independently of the browser. Native checkpoints
produce sequenced SSE events; reconnect uses a cursor and never submits a
generation. Restored terminal cards use persisted content without opening SSE.

The managed service has one concurrent lease, a 30-minute lease bound, a
five-minute startup deadline, a 60-second idle shutdown and no automatic
restart. Its Runtime-owned entrypoint binds loopback with per-install bearer
authentication. The collector retains its lease through final retrieval and
releases it on terminal paths. A persistent generation receipt gate prevents
an interrupted collector from admitting overlapping GPU work.

Browser submission identity is derived from user, conversation and
`clientMessageId`. Duplicate submissions reuse the original descriptor; changed
content with the same identity conflicts. Imports recover by run identity
across all artifact versions. This is Breadboard-boundary idempotency, not a
claim of upstream exactly-once submission.

### Stop, interruption and retry

ACE-Step has no reviewed per-task GPU cancellation endpoint. **Stop stops
collection**; the card says provider computation may continue. External
inference remains externally owned. A managed collector releases its lease,
and Runtime's idle policy subsequently stops the owned provider tree. The UI
does not claim GPU interruption merely because fetch/polling was aborted.

When a submission may have succeeded but no receipt was persisted, the launch
is **uncertain** and re-entry never resubmits automatically. Check the provider
before explicitly requesting another draft. With a retained receipt and no
committed output, collect it without generating again by sending:

```text
/agents:music-producer --resume music_RUN_ID
```

Use the exact ID shown in the interrupted run's recovery message and the same
conversation. The original collector must be terminal. The provider must still
retain the task/result; managed idle shutdown may have discarded in-memory
receipts. A fresh request is explicit new work and may generate a second track.

If a stopped managed provider has a stale generation lock, settings exposes
**Reset stopped provider’s generation lock**. The server checks the owning
user, terminal collector and Runtime's stopped state, and refuses to clear a
changed lock. It neither kills an active generation nor clears another user's
receipt. Ownership is checked against the retained launch/native job, so this
recovery remains possible after deleting the presentation conversation. If
native job state is unavailable, reset fails closed.

Cancellation is checked before submission, during polling/retrieval and inside
the final artifact transaction. Conversation deletion invokes the central
external-agent cancellation registry through existing deletion routes. A late
collector also verifies the conversation still exists. Already committed valid
audio survives later collection failure; incomplete temporary WAV files are
removed.

## Validation, measurements and bounds

The ACE-Step adapter maps fields explicitly, requests batch size one, validates
the application envelope as well as HTTP status, and parses bounded JSON-string
results. It uses `POST /release_task`, `POST /query_result`, `GET /v1/models` and
same-origin `/v1/audio` output URLs. Redirects and foreign origins are rejected.
Reference and source WAV bytes use multipart `reference_audio` / `src_audio`;
client-machine paths are never sent as provider paths.

Requests are limited to 10–600 seconds and 30–300 BPM. Turbo supports up to 20
inference steps in this mapping; the base/sft limit is 200. Guidance is exposed
only for the reviewed base model. WAV is the sole master/export format. Source
and result limits are 256 MiB, mono/stereo, 8–192 kHz, PCM16/24/32 or float32;
decoded outputs must be nonempty and at most 601 seconds. Compressed WAV, RF64,
other codecs, extension, stems, voice cloning, training and publishing are not
implemented.

The bounded WAV decoder measures actual duration, sample peak, RMS and clipped
sample count. The existing Runtime audio analyzer is used when available for
LUFS and useful tempo/key estimates. Its absence does not discard valid audio.
The summary distinguishes requested and measured duration and marks unavailable
analysis. Conditioning and objective estimates do not guarantee exact BPM,
key, duration, lyric accuracy or artistic quality.

The existing `audio_analyze` / `audio_compare` tool accepts
`artifact:ID@VERSION` for same-conversation generated audio, in addition to
attached filenames. Capability-token, active session/run and Audio Analysis
skill checks remain in place. There is no model-controlled `path` parameter.

## Optional Resonant arrangement

Install Resonant separately, connect it in Connected Apps using an explicitly
approved local MCP launch profile, and authorize a stable absolute workspace
with `--root`. Save that connection's slug in Music Producer settings. The
panel reports approved-workspace status without starting the server. Add
`--arrange` to request bounded composition/mixing; absence of a connection only
disables arrangement and leaves ACE-Step available.

The adapter uses the existing Runtime MCP broker, discovers actual tool schemas
and calls `get_capabilities` first. It creates a blank scoped project, inspects
its revision and supplies host-owned `path`/`expectedRevision` on mutations.
Revision conflicts trigger reinspection and failure, not an automatic overwrite.
Allowed operations cover WAV import, clip notes/duplication, arrangement, track
mix, automation, validation, analysis and WAV rendering. Budgets are ten planning
steps, 36 MCP calls, 512 KiB per response, 100 MB imports and 512 rendered beats.
The initial arrangement mode supports instrumental 4/4 material, not vocal
synthesis or ACE-Step-specific seeds/inference settings.

Projects live under `breadboard-music/CONVERSATION_ID/RUN_ID/` inside the approved
workspace. Input copies and Resonant's referenced asset library are durable, so
reopening does not depend on a deleted job directory. Only the validated final
WAV enters Breadboard's artifact flow. No portable project artifact is claimed.
Provider start/install/generate, voice, capture, training and publishing tools
are excluded even if the MCP server advertises them. Interrupted MCP work may
continue; inspect the retained project before explicitly starting another run.

## Upstream review and licenses

No MusicAgent orchestration, ACE-Step skills or Resonant implementation is
vendored into the core. These are reviewed integration boundaries:

- [ACE-Step source and API](https://github.com/ace-step/ACE-Step-1.5/tree/ca1e85fe9430179831e6bc6be790c332190a3866),
  revision `ca1e85fe9430179831e6bc6be790c332190a3866`, MIT. Setup retains LICENSE,
  README and package notices.
- [ACE-Step model repository](https://huggingface.co/ACE-Step/Ace-Step1.5/tree/19671f406d603126926c1b7e2adc169acbcade22),
  revision `19671f406d603126926c1b7e2adc169acbcade22`; retain its model card and
  component notices with the selected assets.
- [Resonant agentic contract](https://github.com/calesthio/Resonant/blob/6ffe24328dce838b261c8ab5e0586bfa08e31b4f/docs/agentic-mode.md),
  revision `6ffe24328dce838b261c8ab5e0586bfa08e31b4f`, AGPL-3.0. It remains
  separately installed optional software. A process boundary is not a blanket
  resolution of licensing obligations.

## Verification and troubleshooting

Run the focused Node suites from `dashboard/`:

```sh
node --experimental-strip-types --test tests/music-producer-protocol.test.mjs tests/music-producer-runs.test.mjs tests/music-producer-resonant.test.mjs tests/music-producer-runtime.test.mjs tests/music-producer-ui.test.mjs
```

The protocol fixture serves real deterministic PCM WAV bytes over the reviewed
HTTP/envelope/multipart contract. It is test-only and never a production
fallback. The MCP test double verifies scope/revision/tool limits. Browser tests
execute the actual Music Producer card JSX from Terminal and Garden, with
unrelated shell components stubbed; they are not full installed-app walkthroughs.
They verify playback, selected versions, editing, restoration, cursor replay,
single terminal callbacks and explicit/durable setup behavior.

The relevant shared checks include capability combinations, external-agent
persistence/history/pending turns, Garden launch coverage, conversation context,
runtime briefs, managed setup and outer-agent Runtime cutover/failures. Native
protocol/core/supervisor tests validate the checked-in manifests, endpoint
ordering, sealed environments and authoritative process owner. Desktop staging
includes the worker source closure and both fixed Python scripts.

For compilation/lint use the existing dashboard TypeScript and ESLint commands,
and from the repository root:

```sh
cargo test --manifest-path native/Cargo.toml -p breadboard-runtime-protocol -p breadboard-runtime-core -p breadboard-runtime-supervisor
```

Live GPU generation, live Resonant and a packaged-desktop generation/revision/
reopen/cancellation walkthrough have **not been run** in this checkout: no
authorized prepared music backend was available. No large models were installed
for verification. Passing fixtures or native compilation does not verify an
installed inference backend. The actual command results and unrelated checkout
failures are recorded below.

### Checkout verification receipt (2026-09-05)

| Check actually run | Result |
| --- | --- |
| Five focused Music Producer suites above | 34 passed; real test WAVs and Edge browser fixtures |
| Those suites plus ten relevant shared dashboard suites | 149/150 passed; the existing empty-activity test expects a `Thought` label that the current shared component does not render |
| Native protocol, core and supervisor command above | Passed, including manifest and authoritative process-owner integration coverage |
| Desktop TypeScript: `node node_modules/typescript/bin/tsc -p tsconfig.tests.json` | Passed |
| Desktop service definitions, Runtime process and startup timeout suites | 63/64 passed; the existing ChatMock reload test expects four files, while the unrelated voice changes supply six |
| Dashboard application-scoped TypeScript check | Passed; temporary config includes `next-env.d.ts`, `src/**/*.ts`, `src/**/*.tsx` and GenOffice ambient declarations, excluding vendor directory discovery and live Runtime toolchain checkouts |
| ESLint on new Music Producer/ACE-Step modules, routes, components and tests | Passed |
| ESLint on touched shared dashboard files | Two existing React ref errors in `agent-runtime-panel.tsx`, plus existing warnings; no Music Producer errors |
| Default dashboard `tsc --noEmit -p tsconfig.json` | Failed on unrelated checked-out Runtime toolchain/vendor projects included by its broad file glob; the initial 4 GiB attempt exhausted the Node heap, and the 8 GiB attempt reported those type errors |
| `git diff --check` | Passed |
| Live GPU / live Resonant / packaged desktop walkthrough | Not run; no prepared music backend was available, and no model installation was authorized for testing |

The extended dashboard command adds these files to the five focused suites:
`capability-combinations`, `external-agent-persistence`, `external-agent-history`,
`external-agent-pending-turn`, `garden-workspace-external-agents`,
`agent-conversation-context-coverage`, `runtime-agent-briefs`,
`runtime-v2-managed-setup-worker`, `outer-agent-runtime-v2-cutover`, and
`outer-agent-runtime-failures`, each under `tests/` with `.test.mjs`.
The desktop test command, run from `desktop/`, was:

```sh
node --test dist-tests/tests/service-definitions.test.js dist-tests/tests/runtime-process.test.js dist-tests/tests/runtime-startup-timeout.test.js
```

The app-scoped TypeScript command was
`node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit -p .tmp-music-tsconfig.json`.
Raw verification output and the temporary scope definition are retained locally
in `.tmp-music-review/` and `dashboard/.tmp-music-tsconfig.json`; neither is a
production dependency. Unrelated source and test expectations were preserved.

Common failures:

- **Missing models:** use explicit setup/repair; health does not download them.
- **Prepared but stopped:** generate to request a cold start. **Unavailable**
  means Runtime/provider status could not be established.
- **Busy/draining:** wait for the existing task or managed idle shutdown. A
  reconnect checks the same run; Retry creates new work.
- **Resource blocked/OOM:** reduce duration or free capacity; retry explicitly.
- **Unsupported model/format:** choose a reviewed model and PCM/float WAV source.
- **Precise edit mismatch:** select the correct version/duration; no implicit
  resampling or whole-track replacement is used to conceal the mismatch.
- **Resonant unavailable:** approve the local profile/workspace or use ordinary
  ACE-Step generation. Profile changes after launch require a new explicit run.
