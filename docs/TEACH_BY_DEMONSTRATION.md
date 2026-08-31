# Teaching a workflow by demonstration

A workflow can be authored by showing Breadboard the task once, out loud, instead
of building it on the canvas. The result is an ordinary workflow: it lives in
Intelligence → Workflows, it is opened, edited, run, versioned and deleted from
there, and nothing about it involves the Skills page.

```
Demonstration
   │
   ├── semantic input events (what was clicked, typed, focused)
   ├── application / window context
   ├── keyframes around each action
   └── microphone narration
             │
             ▼
      one synchronised timeline
             │
             ▼
       workflow induction
             │
             ▼
    a Breadboard Workflow
             │
             ▼
    grounded re-execution
```

## The distinction the design turns on

A **demonstration** is evidence. It knows a click landed at a pixel, inside a
window that was that size, on that monitor, that afternoon. None of that survives
contact with a second run.

A **procedure** is what was learned from it: a generalised, re-groundable
description of the task. Replay executes the procedure. The demonstration only
ever explains it.

That is why a coordinate is recorded (it says *which control* was meant) and then
never used as an instruction. `renderTimelineForPrompt` strips coordinates before
the model sees the demonstration, `stripCoordinates` removes any the model writes
back anyway, and the compiled procedure says so in its own text.

## What voice is for

The actions say *what*. Only the narration says which values were incidental,
which checks were deliberate, and which click should never happen unattended.

```
00:04  ACTION: type "Alice" into edit labeled "Customer name"
       VOICE:  "The name changes every time."        → an input, not a constant

00:09  ACTION: click button labeled "Search"
       VOICE:  "Then I press Search."                → the step's intent

00:13  VOICE:  "…finished when the customer detail
                panel appears."                       → the success criterion

00:19  VOICE:  "Always ask me before pressing
                Send invoice."                        → an approval boundary
```

Narration is joined to actions on one clock (`lib/teach/timeline.ts`), with a
generous window either side — people say what they are *about* to do more often
than what they just did. Narration that lands on nothing is kept separately, and
is usually the goal or a rule.

Narration never silently overrides the actions. Where the two disagree, the
induction follows the actions and records the conflict as a question for the
review screen.

## Starting from chat

The Workflows tab in **Use a capability** offers both **Teach workflow** and
**New workflow**. Teaching opens the same first-class recording flow as the
Workflows page; it is not a separate chat-only recorder.

Selecting a learned workflow stages it in the composer. The staged sentence is
editable, so a run can say, for example, "do this workflow but change the name
entered to Mike." That instruction is bounded to the inputs already declared by
the compiled procedure. It cannot add steps, remove an approval boundary or
rewrite the procedure. If a shorthand name is ambiguous or a required input is
missing, the run does not start and names the inputs it still needs.

A chat-started run links to the live workflow view, where its event stream,
approval controls and Stop control remain available while it drives the desktop.

## Architecture

```
Workflows UI  (browser: microphone, consent, review, Run/Stop)
     │  authenticated Breadboard API
     ▼
/api/workflows/teach/…            /api/workflows/[id]/demonstration/…
     │                                   │
     ▼                                   ▼
teaching coordinator              replay coordinator
lib/teach/session-manager.ts      lib/teach/replay.ts
     │                                   │
     ├── DemonstrationCaptureBackend     └── WorkflowComputerBackend
     │      (lib/teach/backends.ts — one place picks the platform)
     ▼                                          ▼
  Windows capture backend               Windows computer backend
  lib/teach/windows-capture.ts          lib/teach/windows-computer.ts
                    │                          │
                    └──────────┬───────────────┘
                               ▼
                 scripts/teach/BreadboardTeach.cs
                 (one child process, `record` or `control`)
```

The browser never receives an OS-control primitive. Its whole vocabulary about a
session is start / pause / resume / finish / cancel, and about a run it is
approve / reject / stop. Everything that can move a pointer runs in a child
process the Breadboard server owns, started when needed and killed when done.

The microphone is the one capture the browser does hold, because it is the one
that must be requested from the person sitting in front of the machine.

### The Windows backend

Understudy's recorder is a macOS Swift script spawned as a child process.
Breadboard keeps that shape and supplies a Windows helper: one C# file
(`scripts/teach/BreadboardTeach.cs`) compiled by the .NET Framework compiler that
ships with Windows, cached under the data root by source hash. Nothing has to be
installed and no package feed is reached — which also pins the source to C# 5, a
constraint a test enforces.

- `record` installs `WH_MOUSE_LL` / `WH_KEYBOARD_LL`, resolves what was clicked
  through UI Automation, and writes semantic events plus keyframes.
- `control` exposes the live accessibility tree and acts on an element the caller
  names, resolving its coordinates at the moment of the action.

Other platforms get a backend that refuses with a reason. Teaching then shows as
unavailable and the rest of Breadboard, including every existing workflow, is
untouched.

## Grounding

`lib/teach/grounding.ts` scores live accessibility elements against a step's
written target and reports honestly when it is not sure. Two rules earn their
keep:

- A target that quotes a label is naming that label. An element sharing none of
  it is not the thing, however well its role fits — without this a step looking
  for the "Customer name" field grounds on the browser's address bar because both
  are editable.
- A best match that only narrowly beats the runner-up is *not confident*. Two
  things on screen match the description, and picking one silently is how a
  replay clicks the wrong row. Ambiguity escalates to the model, which chooses
  among the candidates actually on screen or declines.

## Approvals

Two sources, and the union always wins. Narration can create a boundary ("always
ask me before I click Submit"). A fixed policy in `lib/teach/approvals.ts` marks
the classically consequential actions — sending, submitting, buying, paying,
deleting, publishing, overwriting, destructive shell — whether or not anyone said
so, because a demonstration is one afternoon and a replay is unattended.

Policy can add boundaries. Nothing in the pipeline removes one.

## Privacy and retention

- Nothing is captured before **Start teaching** and capture ends at **Finish**.
- Text typed into a password or secret field is detected (UI Automation's
  `IsPassword`, plus the classic `ES_PASSWORD` style) and its contents are never
  written — the event records that a secret was entered and how long it was.
- Cancelling deletes the recording rather than archiving it.
- After a workflow is compiled, the raw demonstration is deleted by default. The
  workflow runs from its compiled form, so it keeps working; keeping the
  recording is an explicit choice on the review screen.
- Logging goes through `lib/teach/redaction.ts`. A log line may say what kind of
  thing happened and how much of it, never what it was.

## Storage

A learned workflow is a row in `workflows` — the same table the canvas uses —
with two additive columns saying how it was authored and holding its procedure.
Demonstrations, procedure versions and grounded runs hang off that row.

```
workflows                       + source, procedure, procedure_version
workflow_demonstrations           one teaching session
workflow_procedure_versions       every version; a re-teach adds, never overwrites
workflow_demonstration_runs       grounded runs, their events and approvals
```

On disk, under the dashboard data root:

```
runtime/teach/
  helper/                       the compiled capture helper, by source hash
  speech/                       the lazily-installed speech engine and its models
  sessions/<id>/recording/      events.jsonl, frames/, narration, transcript
  workflows/<id>/compiled/v<n>/ PROCEDURE.md, workflow.json, anchors.json, metadata.json
  workflows/<id>/runs/<runId>/  screenshots from one run
```

The compiled directory is an implementation detail of one workflow. It is not
registered in any skill catalog, cannot be edited or deleted on its own, and is
removed with the workflow.

## Resource behaviour

Nothing from this feature is resident. The capture helper runs only while
teaching, the control helper only during a run, and the speech model is loaded by
a one-shot Python process that exits when the transcript is written. The
transcript is persisted beside the recording, so re-analysing a demonstration
never transcribes twice.

The speech environment (`faster-whisper`, CPU, int8) is installed on first use —
a few minutes once, then seconds per demonstration. It decodes the browser's
WebM/Opus directly, so no ffmpeg is required.

## Crash recovery

A dashboard restart closes what it orphaned rather than resuming it. A teaching
session still marked `recording` is ended and its recording discarded; a run
still marked live is marked stopped. Picking up control of a machine nobody has
looked at since is not a safe default.

## Checks

```
npm test --prefix dashboard -- tests/teach-demonstration.test.mjs   # unit + storage
npm run --prefix dashboard smoke:teach-render                       # the screens render
npm run --prefix dashboard e2e:teach                                # the real acceptance run
```

`e2e:teach` drives the whole desktop for a couple of minutes: it records real
input hooks while real keystrokes land in a real browser, narrates with speech
synthesised to a real audio file and played while the demonstration happens,
transcribes it with the real local Whisper, induces with the real model gateway,
saves a workflow, and replays it with a different input against a window that has
been moved since. Do not run it while you are using the machine.
