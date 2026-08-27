import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const identity = await import("../src/lib/meeting-notes/identity.ts");
const notes = await import("../src/lib/meeting-notes/notes.ts");
const report = await import("../src/lib/meeting-notes/report.ts");
const uploads = await import("../src/lib/meeting-notes/uploads.ts");
const defaults = await import("../src/lib/agent-settings/defaults.ts");
const catalog = await import("../src/lib/agent-settings/catalog.ts");
const combinations = await import("../src/lib/hermes/capability-combinations.ts");
const externalRuns = await import("../src/lib/conversations/external-agent-runs.ts");

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

test("Meeting Notes has one canonical slash command, spelled consistently", () => {
  assert.equal(identity.MEETING_NOTES_COMMAND, "/agents:meeting-notes");
  assert.equal(identity.MEETING_NOTES_AGENT_ID, "meeting-notes");
  assert.equal(identity.MEETING_NOTES_AGENT_NAME, "Meeting Notes");
  assert.equal(
    identity.MEETING_NOTES_COMMAND,
    `/agents:${identity.MEETING_NOTES_AGENT_ID}`,
  );
});

test("the token is recognised, and prose never becomes one", () => {
  assert.equal(
    identity.taskFromMeetingNotesCommand("/agents:meeting-notes write up the standup"),
    "write up the standup",
  );
  // Case and leading whitespace are how people actually type.
  assert.equal(
    identity.taskFromMeetingNotesCommand("  /AGENTS:MEETING-NOTES  summarise it"),
    "summarise it",
  );
  // A bare token is a complete request — "the recording in this chat" — so it
  // must return the empty task rather than null.
  assert.equal(identity.taskFromMeetingNotesCommand("/agents:meeting-notes"), "");
  assert.equal(identity.taskFromMeetingNotesCommand("transcribe this meeting"), null);
  assert.equal(identity.taskFromMeetingNotesCommand("/agents:get-doc something"), null);
});

test("stacked tokens survive so the capability resolver still sees them", () => {
  assert.equal(
    identity.taskFromMeetingNotesCommand("/my-skill /agents:meeting-notes write it up"),
    "/my-skill write it up",
  );
});

test("the user message round-trips through the command", () => {
  const task = "focus on what engineering committed to";
  assert.equal(
    identity.taskFromMeetingNotesCommand(identity.meetingNotesUserMessage(task)),
    task,
  );
  assert.equal(identity.meetingNotesUserMessage(""), identity.MEETING_NOTES_COMMAND);
});

// ---------------------------------------------------------------------------
// Flags beat stored defaults
// ---------------------------------------------------------------------------

test("a flag typed in the message always wins over a stored default", () => {
  const stored = { language: "en", speakers: true, transcriptOnly: false };

  const spoken = identity.parseMeetingNotesPrompt("write it up --lang nl", stored);
  assert.equal(spoken.language, "nl");
  assert.equal(spoken.prompt, "write it up");

  const quiet = identity.parseMeetingNotesPrompt("--no-speakers just the decisions", stored);
  assert.equal(quiet.speakers, false);
  assert.equal(quiet.prompt, "just the decisions");

  const raw = identity.parseMeetingNotesPrompt("--transcript-only", stored);
  assert.equal(raw.transcriptOnly, true);
  assert.equal(raw.prompt, "");
});

test("what the message does not say is filled in from the stored defaults", () => {
  const parsed = identity.parseMeetingNotesPrompt("write it up", {
    language: "de",
    speakers: false,
    transcriptOnly: true,
  });
  assert.equal(parsed.language, "de");
  assert.equal(parsed.speakers, false);
  assert.equal(parsed.transcriptOnly, true);
});

test("prose that merely mentions a flag word is left alone", () => {
  const parsed = identity.parseMeetingNotesPrompt(
    "note who the speakers were and what language was used",
    identity.MEETING_NOTES_FALLBACK_DEFAULTS,
  );
  assert.equal(parsed.prompt, "note who the speakers were and what language was used");
  assert.equal(parsed.language, null);
});

test("settings translate into the run's shape, and unknown values fall back", () => {
  const agent = catalog.findConfigurableAgent("meeting-notes");
  assert.ok(agent, "Meeting Notes must be in the settings catalog");
  assert.equal(agent.command, identity.MEETING_NOTES_COMMAND);

  const shipped = defaults.meetingNotesDefaults(catalog.agentSettingDefaults(agent));
  assert.deepEqual(shipped, { language: null, speakers: true, transcriptOnly: false });

  // "English" is not a language code, and an empty box means "detect it".
  assert.equal(defaults.meetingNotesDefaults({ language: "English" }).language, null);
  assert.equal(defaults.meetingNotesDefaults({ language: "" }).language, null);
  assert.equal(defaults.meetingNotesDefaults({ language: "NL" }).language, "nl");
  assert.equal(defaults.meetingNotesDefaults({ speakers: "yes" }).speakers, true);
});

// ---------------------------------------------------------------------------
// Where the meeting comes from
// ---------------------------------------------------------------------------

test("every source field the launchers send is read by the parser", () => {
  assert.deepEqual(identity.parseMeetingSource({ uploadId: "mrec_x", filename: "call.webm" }), {
    kind: "upload",
    uploadId: "mrec_x",
    filename: "call.webm",
  });
  assert.deepEqual(identity.parseMeetingSource({ artifactId: "art_1" }), {
    kind: "artifact",
    artifactId: "art_1",
  });
  assert.deepEqual(identity.parseMeetingSource({ blobId: "vid_1", filename: "a.mp4" }), {
    kind: "attachment",
    blobId: "vid_1",
    filename: "a.mp4",
  });
  assert.deepEqual(identity.parseMeetingSource({ transcript: " hello " }), {
    kind: "transcript",
    text: "hello",
  });
});

test("a request naming nothing becomes auto, which is what makes delegation work", () => {
  // A Super Agent brief is a sentence and can never carry a file. If this were
  // an error instead of `auto`, the agent could not be launched by a model at
  // all — which is exactly why it is allowed to be model-launchable.
  assert.deepEqual(identity.parseMeetingSource({}), { kind: "auto" });
  assert.deepEqual(identity.parseMeetingSource(undefined), { kind: "auto" });
  const profile = combinations.runtimeAgentById("meeting-notes");
  assert.ok(profile);
  assert.equal(profile.launchableByModel, true);
});

test("Meeting Notes takes attachments and takes the whole turn", () => {
  const profile = combinations.runtimeAgentById("meeting-notes");
  assert.equal(profile.command, identity.MEETING_NOTES_COMMAND);
  assert.equal(profile.acceptsAttachments, true);
  assert.equal(profile.stacksCapabilities, false);
  assert.deepEqual([...profile.surfaces], ["dashboard_terminal", "garden_chat"]);

  // Attaching the recording must not be refused by the composer.
  assert.equal(
    combinations.findCapabilityConflict({
      text: "/agents:meeting-notes write it up",
      surface: "dashboard_terminal",
      attachmentCount: 1,
    }),
    null,
  );
  // Two agents in one message is still a conflict.
  const clash = combinations.findCapabilityConflict({
    text: "/agents:meeting-notes /agents:get-doc go",
    surface: "dashboard_terminal",
  });
  assert.equal(clash?.code, "conflicting_runtime_agents");
});

test("upload ids are validated wherever one arrives", () => {
  assert.equal(identity.isMeetingUploadId(`mrec_${"a".repeat(32)}`), true);
  assert.equal(identity.isMeetingUploadId("mrec_short"), false);
  assert.equal(identity.isMeetingUploadId("../../etc/passwd"), false);
  assert.equal(identity.isMeetingUploadId(null), false);
});

test("a filename from the browser never reaches a path", () => {
  assert.equal(uploads.meetingUploadExtension("call.webm"), "webm");
  assert.equal(uploads.meetingUploadExtension("MEETING.M4A"), "m4a");
  // Traversal, an unknown container, and a name with no extension all collapse
  // to the same inert default rather than being trusted.
  assert.equal(uploads.meetingUploadExtension("../../evil.sh"), "bin");
  assert.equal(uploads.meetingUploadExtension("recording"), "bin");
  assert.equal(uploads.meetingUploadExtension("a.exe"), "bin");
});

test("a staged recording is only findable by the account that uploaded it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-meeting-uploads-"));
  try {
    const stored = await uploads.writeMeetingUpload({
      userId: 1,
      body: new Blob([new Uint8Array([1, 2, 3, 4])]).stream(),
      filename: "call.webm",
      root,
    });
    assert.match(stored.uploadId, /^mrec_[a-f0-9]{32}$/);
    assert.equal(stored.byteSize, 4);
    assert.ok(uploads.findMeetingUpload({ userId: 1, uploadId: stored.uploadId, root }));
    // Another account asking for the same id gets the same answer as for an id
    // that never existed.
    assert.equal(
      uploads.findMeetingUpload({ userId: 2, uploadId: stored.uploadId, root }),
      null,
    );
    uploads.removeMeetingUpload({ userId: 1, uploadId: stored.uploadId, root });
    assert.equal(
      uploads.findMeetingUpload({ userId: 1, uploadId: stored.uploadId, root }),
      null,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The ported pipeline
// ---------------------------------------------------------------------------

test("chunking matches the clone: window of chunk_size, stepping by size minus overlap", () => {
  const text = "x".repeat(12_000);
  const chunks = notes.chunkTranscript(text, 5_000, 1_000);
  // Step is 4000, so windows start at 0, 4000 and 8000.
  assert.deepEqual(chunks.map((chunk) => chunk.length), [5_000, 5_000, 4_000]);
  // Consecutive windows really do overlap by 1000 characters, which is what
  // stops a decision that straddles a boundary from being lost by both.
  assert.equal(chunks[0].slice(4_000), chunks[1].slice(0, 1_000));
});

test("an overlap at or beyond the chunk size cannot loop forever", () => {
  // The clone shrinks the overlap rather than stepping by zero. Without this
  // guard a request with overlap >= chunk_size never terminates.
  const chunks = notes.chunkTranscript("y".repeat(3_000), 1_000, 1_000);
  assert.ok(chunks.length > 0);
  assert.ok(chunks.length < 100);
});

test("a short transcript is still one chunk", () => {
  assert.deepEqual(notes.chunkTranscript("a meeting happened"), ["a meeting happened"]);
});

test("the schema is the clone's, and a wrong block type does not cost the chunk", () => {
  const parsed = notes.parseChunkSummary(
    {
      MeetingName: "Weekly sync",
      People: { title: "People", blocks: [{ id: "1", type: "bullet", content: "Ada (Eng)", color: "" }] },
      SessionSummary: { title: "Session Summary", blocks: [{ id: "2", type: "nonsense", content: "Talked.", color: "gray" }] },
      CriticalDeadlines: { title: "Critical Deadlines", blocks: [] },
      KeyItemsDecisions: { title: "Key Items & Decisions", blocks: [] },
      ImmediateActionItems: { title: "Immediate Action Items", blocks: [] },
      NextSteps: { title: "Next Steps", blocks: [] },
      MeetingNotes: { meeting_name: "Weekly sync", sections: [] },
    },
    0,
  );
  assert.equal(parsed.MeetingName, "Weekly sync");
  assert.equal(parsed.People.blocks[0].content, "Ada (Eng)");
  // An unrecognised type becomes the neutral one; the note itself survives.
  assert.equal(parsed.SessionSummary.blocks[0].type, "text");
  assert.equal(parsed.SessionSummary.blocks[0].color, "gray");
  // A colour outside the clone's two-value palette collapses to the default.
  const odd = notes.parseChunkSummary(
    { People: { title: "People", blocks: [{ content: "Bo", type: "text", color: "hotpink" }] } },
    0,
  );
  assert.equal(odd.People.blocks[0].color, "");
});

test("an answer that is not the schema is refused with a reason the retry can use", () => {
  assert.throws(() => notes.parseChunkSummary("not an object", 0), notes.SchemaError);
  assert.throws(() => notes.parseChunkSummary({ nothing: true }, 0), (error) => {
    assert.ok(error instanceof notes.SchemaError);
    // The message is fed back on the retry, so it has to name what is missing.
    assert.match(error.message, /SessionSummary/);
    return true;
  });
});

test("aggregation folds chunks the way the clone's aggregator does", () => {
  const chunk = (name, decision) => notes.parseChunkSummary(
    {
      MeetingName: name,
      People: { title: "People", blocks: [{ content: "Ada (Eng)", type: "bullet", color: "" }] },
      SessionSummary: { title: "Session Summary", blocks: [] },
      CriticalDeadlines: { title: "Critical Deadlines", blocks: [] },
      KeyItemsDecisions: {
        title: "Key Items & Decisions",
        blocks: [{ content: decision, type: "bullet", color: "" }],
      },
      ImmediateActionItems: { title: "Immediate Action Items", blocks: [] },
      NextSteps: { title: "Next Steps", blocks: [] },
      MeetingNotes: { meeting_name: name, sections: [] },
    },
    0,
  );

  const summary = notes.aggregateChunkSummaries([
    chunk("Weekly sync", "Ship on Friday"),
    chunk("Weekly sync — engineering", "Freeze the schema"),
  ]);

  // The last chunk that names the meeting wins.
  assert.equal(summary.meetingName, "Weekly sync — engineering");
  // Blocks concatenate across chunks, in order.
  const decisions = summary.sections.find((s) => s.title === "Key Items & Decisions");
  assert.deepEqual(decisions.blocks.map((b) => b.content), ["Ship on Friday", "Freeze the schema"]);
  // Every section is mirrored into MeetingNotes under the same title, merged
  // rather than duplicated.
  const mirrored = summary.notes.sections.filter((s) => s.title === "Key Items & Decisions");
  assert.equal(mirrored.length, 1);
  assert.deepEqual(mirrored[0].blocks.map((b) => b.content), ["Ship on Friday", "Freeze the schema"]);
  // The six sections keep the clone's order and titles.
  assert.deepEqual(
    summary.sections.map((s) => s.title),
    ["People", "Session Summary", "Critical Deadlines", "Key Items & Decisions", "Immediate Action Items", "Next Steps"],
  );
});

test("chunk overlap does not put the same note in twice", () => {
  // Chunks overlap by design, so the same sentence really is described twice.
  // The clone's plain extend files it twice; this must not.
  const identical = () => notes.parseChunkSummary(
    {
      MeetingName: "Sync",
      People: { title: "People", blocks: [] },
      SessionSummary: { title: "Session Summary", blocks: [] },
      CriticalDeadlines: { title: "Critical Deadlines", blocks: [] },
      KeyItemsDecisions: { title: "Key Items & Decisions", blocks: [] },
      ImmediateActionItems: {
        title: "Immediate Action Items",
        blocks: [{ content: "Ada to send the deck", type: "bullet", color: "" }],
      },
      NextSteps: { title: "Next Steps", blocks: [] },
      MeetingNotes: { meeting_name: "Sync", sections: [] },
    },
    0,
  );
  const summary = notes.aggregateChunkSummaries([identical(), identical(), identical()]);
  const actions = summary.sections.find((s) => s.title === "Immediate Action Items");
  assert.deepEqual(actions.blocks.map((b) => b.content), ["Ada to send the deck"]);

  // A differently worded action is not a duplicate and must survive.
  const other = notes.parseChunkSummary(
    {
      ImmediateActionItems: {
        title: "Immediate Action Items",
        blocks: [{ content: "Bo to book the room", type: "bullet", color: "" }],
      },
      People: { title: "People", blocks: [] },
      SessionSummary: { title: "Session Summary", blocks: [] },
      CriticalDeadlines: { title: "Critical Deadlines", blocks: [] },
      KeyItemsDecisions: { title: "Key Items & Decisions", blocks: [] },
      NextSteps: { title: "Next Steps", blocks: [] },
      MeetingNotes: { meeting_name: "Sync", sections: [] },
    },
    0,
  );
  const both = notes.aggregateChunkSummaries([identical(), other]);
  assert.equal(
    both.sections.find((s) => s.title === "Immediate Action Items").blocks.length,
    2,
  );
});

test("JSON survives a fence and ChatMock's inline reasoning block", () => {
  assert.deepEqual(notes.extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(notes.extractJson('<think>weighing it up</think>\n{"a":2}'), { a: 2 });
  assert.deepEqual(notes.extractJson("<think>never closed {\"a\":9}"), null);
  assert.equal(notes.extractJson("no json at all"), null);
});

test("the notes render as markdown that matches the block vocabulary", () => {
  const summary = notes.aggregateChunkSummaries([
    notes.parseChunkSummary(
      {
        MeetingName: "Weekly sync",
        People: { title: "People", blocks: [{ content: "Ada (Eng)", type: "bullet", color: "" }] },
        SessionSummary: { title: "Session Summary", blocks: [{ content: "We talked.", type: "text", color: "" }] },
        CriticalDeadlines: { title: "Critical Deadlines", blocks: [] },
        KeyItemsDecisions: { title: "Key Items & Decisions", blocks: [] },
        ImmediateActionItems: { title: "Immediate Action Items", blocks: [] },
        NextSteps: { title: "Next Steps", blocks: [] },
        MeetingNotes: { meeting_name: "Weekly sync", sections: [] },
      },
      0,
    ),
  ]);
  const markdown = notes.renderMeetingNotesMarkdown(summary);
  assert.match(markdown, /^# Weekly sync/);
  assert.match(markdown, /## People/);
  assert.match(markdown, /- Ada \(Eng\)/);
  assert.match(markdown, /We talked\./);
  // An empty section is not printed as an empty heading.
  assert.doesNotMatch(markdown, /## Critical Deadlines/);
  assert.equal(notes.isEmptySummary(notes.aggregateChunkSummaries([])), true);
  assert.equal(notes.isEmptySummary(summary), false);
});

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

test("speaker turns merge consecutive segments and get readable labels", () => {
  const rendered = report.renderSpeakerTurns(
    [
      { start: 0, end: 2, text: "Morning.", speaker: "SPEAKER_00" },
      { start: 2, end: 5, text: "Shall we start?", speaker: "SPEAKER_00" },
      { start: 5, end: 9, text: "Yes.", speaker: "SPEAKER_01" },
      { start: 9, end: 9, text: "   ", speaker: "SPEAKER_01" },
    ],
    true,
  );
  // Forty subtitle-sized segments would cost the notes pass far more tokens on
  // the same words, so one speaker's run is one line.
  assert.equal(rendered.text, "[0:00] Speaker 1: Morning. Shall we start?\n[0:05] Speaker 2: Yes.");
  assert.deepEqual(rendered.speakers, ["Speaker 1", "Speaker 2"]);
});

test("without diarization the transcript carries no attributions at all", () => {
  const rendered = report.renderSpeakerTurns(
    [
      { start: 0, end: 2, text: "Morning.", speaker: "SPEAKER_00" },
      { start: 2, end: 4, text: "Yes.", speaker: "SPEAKER_01" },
    ],
    false,
  );
  // An invented attribution is worse than none: with speakers off, the turns
  // merge into one run and no name is printed.
  assert.doesNotMatch(rendered.text, /Speaker/);
  assert.deepEqual(rendered.speakers, []);
});

test("a real name from the diarizer is kept rather than renumbered", () => {
  const rendered = report.renderSpeakerTurns(
    [{ start: 61, end: 65, text: "Hello.", speaker: "Ada Lovelace" }],
    true,
  );
  assert.equal(rendered.text, "[1:01] Ada Lovelace: Hello.");
});

// ---------------------------------------------------------------------------
// What the finished turn says
// ---------------------------------------------------------------------------

test("the saved message carries the notes themselves, not a pointer to them", () => {
  const written = report.summarizeRun({
    markdown: "# Weekly sync\n\n## People\n- Ada (Eng)",
    transcript: { engine: "scriberr", speakers: ["Speaker 1", "Speaker 2"], text: "", language: null, durationSeconds: null },
    notesArtifactId: "art_notes",
    transcriptArtifactId: "art_transcript",
    sourceLabel: "call.webm",
    failedChunks: 0,
    chunks: 3,
    artifactProblem: null,
  });
  assert.match(written, /^# Weekly sync/);
  assert.match(written, /- Ada \(Eng\)/);
  assert.match(written, /separating 2 speakers/);
  assert.match(written, /art_notes/);
  assert.match(written, /art_transcript/);
});

test("a run that lost its attributions or its artifacts says so out loud", () => {
  const noSpeakers = report.summarizeRun({
    markdown: "# Sync",
    transcript: { engine: "voicebox", speakers: [], text: "", language: null, durationSeconds: null },
    notesArtifactId: null,
    transcriptArtifactId: null,
    sourceLabel: "call.webm",
    failedChunks: 0,
    chunks: 1,
    artifactProblem: "The notes could not be filed as an artifact in this chat, so they are only in this message.",
  });
  assert.match(noSpeakers, /cannot tell speakers apart/);
  // Silently dropping the file is the one unacceptable outcome.
  assert.match(noSpeakers, /could not be filed as an artifact/);

  const gappy = report.summarizeRun({
    markdown: "# Sync",
    transcript: null,
    notesArtifactId: "art_1",
    transcriptArtifactId: null,
    sourceLabel: "a transcript you provided",
    failedChunks: 2,
    chunks: 9,
    artifactProblem: null,
  });
  assert.match(gappy, /2 of 9 sections/);
});

// ---------------------------------------------------------------------------
// Wiring the shared tests cannot see
// ---------------------------------------------------------------------------

test("the run kind, the transcript field and the agent id agree", () => {
  assert.ok(externalRuns.EXTERNAL_AGENT_RUN_KINDS.includes("meeting_notes"));
  assert.equal(
    externalRuns.EXTERNAL_AGENT_RUN_FIELD_BY_KIND.meeting_notes,
    "meetingNotesRun",
  );
  const restored = externalRuns.parseExternalAgentRun({
    kind: "meeting_notes",
    runId: "mnrun_abc",
    task: "write it up",
  });
  assert.deepEqual(restored, { kind: "meeting_notes", runId: "mnrun_abc", task: "write it up" });
  // A bare command is a complete request, so an empty task must round-trip too.
  assert.deepEqual(
    externalRuns.parseExternalAgentRun({ kind: "meeting_notes", runId: "mnrun_abc", task: "" }),
    { kind: "meeting_notes", runId: "mnrun_abc", task: "" },
  );
  // A malformed row must not break an otherwise healthy transcript.
  assert.equal(
    externalRuns.parseExternalAgentRun({ kind: "meeting_notes", runId: "mnrun_abc", task: 7 }),
    null,
  );
  assert.equal(externalRuns.parseExternalAgentRun({ kind: "meeting_notes" }), null);
});

test("the card guards its stream, delegates cleanup, and renders what was saved", () => {
  const card = source("src/app/components/hermes/inline-meeting-notes-run.tsx");
  // A finished run is gone from the manager's memory and its endpoint errors.
  assert.match(card, /if \(replaying\) return;/);
  // EventSource reconnects on error by default, forever. The shared owner
  // bounds recovery and route teardown closes the source plus any live probe.
  assert.match(
    card,
    /import \{ closeAgentRunStream, resolveAgentRunStreamError \} from "@\/lib\/agent-run-stream";/,
  );
  assert.match(
    card,
    /source\.onerror = \(\) => \{\s*resolveAgentRunStreamError\(\{\s*source,\s*base,/,
  );
  assert.match(card, /return \(\) => closeAgentRunStream\(source\);/);
  assert.match(card, /persistedContent/);
});

test("both chat surfaces can start a run, and both can be told to by a model", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("src/app/gardens/[clusterSlug]/workspace-client.tsx");
  for (const [name, text] of [["terminal", terminal], ["garden", garden]]) {
    assert.match(text, /taskFromMeetingNotesCommand/, `${name} must dispatch the command`);
    assert.match(text, /api\/meeting-notes\/runs/, `${name} must start a run`);
    assert.match(text, /kind: "meeting_notes"|meetingNotesRun: \{/, `${name} must persist the descriptor`);
    assert.match(text, /case "meeting-notes"/, `${name} must accept a delegated launch`);
  }
});

test("the descriptor is persisted at launch, so a run that finishes offscreen comes back", () => {
  const terminal = source("src/app/components/hermes/dashboard-agent-terminal.tsx");
  // The run id reaches appendExternalAgentTurn in the same try block that
  // started the run, not in a completion handler.
  assert.match(
    terminal,
    /run: \{ kind: "meeting_notes", runId: String\(data\.run\.runId\), task \}/,
  );
});

test("the upload route streams the body and never parses it as a form", () => {
  const route = source("src/app/api/meeting-notes/uploads/route.ts");
  assert.match(route, /requireUserId/);
  assert.match(route, /request\.body/);
  assert.doesNotMatch(route, /formData\(\)/);
});

test("every route requires a signed-in user", () => {
  for (const relative of [
    "src/app/api/meeting-notes/runs/route.ts",
    "src/app/api/meeting-notes/runs/[runId]/events/route.ts",
    "src/app/api/meeting-notes/runs/[runId]/abort/route.ts",
    "src/app/api/meeting-notes/health/route.ts",
    "src/app/api/meeting-notes/uploads/route.ts",
  ]) {
    assert.match(source(relative), /requireUserId\(\)/, `${relative} must require a user`);
  }
});

test("the run route resolves ChatMock rather than reading the env var itself", () => {
  const route = source("src/app/api/meeting-notes/runs/route.ts");
  assert.match(route, /resolveChatmockBaseUrl\(request\)/);
  // A run must belong to a conversation, or its artifacts have nowhere to go.
  assert.match(route, /conversation_required/);
});

test("stopping a run really stops the work, not just the card", () => {
  const facade = source("src/lib/meeting-notes/runtime-run-manager.ts");
  const worker = source("src/lib/meeting-notes/runtime-worker-run-manager.ts");
  // Rust cancellation addresses the authenticated durable mapping; the worker
  // relays the stop into transcription, ffmpeg, Scriberr and model calls.
  assert.match(facade, /abortOuterAgentRun\("meeting-notes", userId, runId\)/);
  assert.match(worker, /run\.controller\.abort\(\)/);
  assert.match(worker, /signal: run\.controller\.signal/);
  assert.match(worker, /run\.userId !== userId/);
});
