import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  MAX_RECORDING_BYTES,
  RECORDING_ACCEPT_ATTR,
  RECORDING_FILENAME_HEADER,
  RECORDING_SEGMENT_SECONDS,
  TRANSCRIBABLE_EXTENSIONS,
  VOICEBOX_AUDIO_EXTENSIONS,
  describeRecordingProgress,
  encodeRecordingEvent,
  formatRecordingSize,
  isTranscribableRecording,
  isVideoRecording,
  isVoiceboxReadable,
  joinTranscriptSegments,
  readRecordingEvents,
  recordingExtension,
} from "../src/lib/speech/recording-upload.ts";

const source = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const dictation = source("../src/app/components/speech-dictation-button.tsx");
const uploadRoute = source("../src/app/api/speech/transcribe-upload/route.ts");
const pipeline = source("../src/lib/speech/recording-transcription.ts");
const selectionMenu = source("../src/app/components/chat-text-selection-ui.tsx");

test("the picker offers recordings a phone or a laptop actually produces", () => {
  assert.ok(isTranscribableRecording("standup.m4a"));
  assert.ok(isTranscribableRecording("Lecture 3 — Fourier.MP4"));
  assert.ok(isTranscribableRecording("C:\\Users\\me\\Voice Memos\\note.wav"));
  // A name with dots in it keeps its real extension.
  assert.equal(recordingExtension("2026.07.19 talk.mov"), ".mov");
  assert.equal(recordingExtension("noextension"), "");

  assert.ok(!isTranscribableRecording("slides.pdf"));
  assert.ok(!isTranscribableRecording("notes.txt"));
  assert.ok(!isTranscribableRecording(""));

  // Wildcards catch what a phone offers; the explicit list catches what it
  // hands over with an empty or invented MIME type.
  assert.ok(RECORDING_ACCEPT_ATTR.includes("audio/*"));
  assert.ok(RECORDING_ACCEPT_ATTR.includes("video/*"));
  for (const extension of TRANSCRIBABLE_EXTENSIONS) {
    assert.ok(RECORDING_ACCEPT_ATTR.includes(extension), `${extension} is not offered`);
  }
});

test("only the containers Voicebox decodes itself may skip the converter", () => {
  for (const extension of VOICEBOX_AUDIO_EXTENSIONS) {
    assert.ok(isVoiceboxReadable(`memo${extension}`), `${extension} should pass through`);
  }
  assert.ok(!isVoiceboxReadable("clip.mp4"));
  assert.ok(!isVoiceboxReadable("clip.mkv"));
  assert.ok(isVideoRecording("clip.mp4"));
  assert.ok(!isVideoRecording("clip.mp3"));
});

test("parts are stitched back into one transcript, not concatenated blindly", () => {
  assert.equal(
    joinTranscriptSegments(["  So the first thing  ", "is the boundary condition."]),
    "So the first thing is the boundary condition.",
  );
  // A silent part contributes nothing rather than a double space.
  assert.equal(joinTranscriptSegments(["one", "   ", "two"]), "one two");
  assert.equal(joinTranscriptSegments([]), "");
  assert.equal(joinTranscriptSegments(["", ""]), "");
});

test("progress survives arriving one byte at a time", () => {
  const events = [
    { stage: "preparing" },
    { stage: "extracting" },
    { stage: "transcribing", part: 1, parts: 3 },
    { stage: "done", text: "line one\nline two" },
  ];
  const wire = events.map(encodeRecordingEvent).join("");

  // Whole stream at once.
  assert.deepEqual(readRecordingEvents(wire), { events, rest: "" });

  // Split anywhere: nothing is lost and nothing is seen twice.
  const seen = [];
  let buffer = "";
  for (const character of wire) {
    buffer += character;
    const parsed = readRecordingEvents(buffer);
    buffer = parsed.rest;
    seen.push(...parsed.events);
  }
  assert.deepEqual(seen, events);
  assert.equal(buffer, "");

  // A transcript containing newlines survives the line framing.
  assert.equal(seen.at(-1).text, "line one\nline two");
});

test("a garbled progress line costs a tick, never the transcript", () => {
  const parsed = readRecordingEvents('{"stage":"prep\n{"stage":"done","text":"hello"}\n');
  assert.deepEqual(parsed.events, [{ stage: "done", text: "hello" }]);
  assert.equal(parsed.rest, "");
  // A line still in flight is handed back rather than guessed at.
  assert.deepEqual(readRecordingEvents('{"stage":"done"'), {
    events: [],
    rest: '{"stage":"done"',
  });
});

test("every stage says something a person can read", () => {
  assert.match(describeRecordingProgress({ stage: "preparing" }), /recording/i);
  assert.match(describeRecordingProgress({ stage: "extracting" }), /audio/i);
  assert.equal(
    describeRecordingProgress({ stage: "transcribing", part: 2, parts: 7 }),
    "Transcribing part 2 of 7…",
  );
  // One part is not "part 1 of 1" — that reads like something went wrong.
  assert.equal(
    describeRecordingProgress({ stage: "transcribing", part: 1, parts: 1 }),
    "Transcribing…",
  );
  assert.match(describeRecordingProgress({ stage: "waiting-for-model", model: "small" }), /small/);
  assert.equal(describeRecordingProgress({ stage: "error", error: "No sound track." }), "No sound track.");

  assert.equal(formatRecordingSize(3 * 1024 * 1024 * 1024), "3.0 GB");
  assert.equal(formatRecordingSize(12 * 1024 * 1024), "12 MB");
  assert.equal(formatRecordingSize(900), "1 KB");
});

test("the microphone offers its options in the same clothes as the highlight menu", () => {
  // Same card: paper-raised, hairline border, rounded, the shared drop shadow.
  const highlightCard =
    /rounded-xl border border-\[var\(--line\)\] bg-\[var\(--paper-raised\)\] p-1 shadow-\[0_12px_34px_rgba\(45,48,40,0\.2\)\]/;
  assert.match(selectionMenu, highlightCard);
  assert.match(dictation, highlightCard);
  assert.match(dictation, /role="menu"/);
  assert.match(dictation, /aria-haspopup="menu"/);
  assert.match(dictation, /aria-expanded=\{menuOpen\}/);

  // The three ways to use the voice model.
  assert.match(dictation, /title="Dictate live"/);
  assert.match(dictation, /title="Transcribe a recording"/);
  assert.match(dictation, /title="Talk to the assistant"/);
  // Voice mode is only offered where the host can hold a conversation.
  assert.match(dictation, /\{onOpenVoiceMode \? \([\s\S]{0,400}?title="Talk to the assistant"/);

  // Dismissed the way the highlight menu is, and the shell wraps the button so
  // tapping the microphone again toggles instead of closing twice.
  assert.match(dictation, /document\.addEventListener\("pointerdown", closeOnOutsidePointer\)/);
  assert.match(dictation, /event\.key === "Escape"/);
  assert.match(dictation, /shellRef\.current\?\.contains\(event\.target as Node\)/);
  assert.match(dictation, /<div ref=\{shellRef\}/);
});

test("a chosen recording is streamed, not loaded into the tab", () => {
  assert.match(dictation, /accept=\{RECORDING_ACCEPT_ATTR\}/);
  // The File itself is the body: no arrayBuffer(), no FormData, nothing that
  // would put a two-gigabyte lecture in this tab's heap.
  assert.match(dictation, /body: file,/);
  assert.doesNotMatch(dictation, /file\.arrayBuffer\(\)/);
  // The name rides in a header because the body is the file itself, and both
  // sides read that header name from the same constant.
  assert.equal(RECORDING_FILENAME_HEADER, "x-recording-filename");
  assert.match(dictation, /\[RECORDING_FILENAME_HEADER\]: encodeURIComponent\(file\.name\)/);
  assert.match(uploadRoute, /request\.headers\.get\(RECORDING_FILENAME_HEADER\)/);
  // Picking the same file twice in a row has to fire again.
  assert.match(dictation, /event\.target\.value = "";/);
  // The wait is cancellable and reports where it is.
  assert.match(dictation, /uploadAbortRef\.current\?\.abort\(\)/);
  assert.match(dictation, /describeRecordingProgress/);
  assert.match(dictation, /setUploadStatus/);
  // A file transcript lands in the composer the same way dictation's does.
  assert.match(dictation, /replaceDictationPreview\(valueRef\.current, "", transcript\)/);
});

test("the route streams progress and never parses the upload as a form", () => {
  assert.match(uploadRoute, /export async function POST/);
  assert.match(uploadRoute, /storeUploadedRecording\(request\.body, filename\)/);
  assert.doesNotMatch(uploadRoute, /request\.formData\(\)/);
  assert.match(uploadRoute, /application\/x-ndjson/);
  assert.match(uploadRoute, /new ReadableStream/);
  // Speech being off, an unreadable file and an oversized one are real status
  // codes, decided before a byte of the body is read.
  assert.match(uploadRoute, /throw new RouteError\(409/);
  assert.match(uploadRoute, /throw new RouteError\(415/);
  assert.match(uploadRoute, /throw new RouteError\(413/);
  // A failure after the headers are gone can only be an event.
  assert.match(uploadRoute, /send\(\{\s*stage: "error"/);
  assert.match(uploadRoute, /await discardRecording\(workspace\.directory\)/);
  assert.match(uploadRoute, /signal: request\.signal/);
});

test("long recordings are cut into parts the local model can chew", () => {
  assert.equal(RECORDING_SEGMENT_SECONDS, 300);
  assert.equal(MAX_RECORDING_BYTES, 2 * 1024 * 1024 * 1024);

  // Mono 16 kHz PCM is what Whisper wants; -vn drops the picture so a video
  // costs no more than the audio inside it.
  assert.match(pipeline, /"-vn"/);
  assert.match(pipeline, /"-ac", "1"/);
  assert.match(pipeline, /"-ar", "16000"/);
  assert.match(pipeline, /"-f", "segment"/);
  assert.match(pipeline, /"-segment_time", String\(RECORDING_SEGMENT_SECONDS\)/);
  // Segmenting needs no duration probe: the parts on disk are the count.
  assert.doesNotMatch(pipeline, /ffprobe/);

  // The upload is written through, never buffered whole.
  assert.match(pipeline, /createWriteStream/);
  assert.match(pipeline, /written > MAX_RECORDING_BYTES/);
  assert.match(pipeline, /RouteError\(413/);

  // Voicebox answers 202 while it downloads a model — the same wait dictation
  // does, bounded so a broken download cannot hang the request forever.
  assert.match(pipeline, /response\.status === 202/);
  assert.match(pipeline, /MODEL_DOWNLOAD_WAIT_MS/);
  assert.match(pipeline, /stage: "waiting-for-model"/);

  // Without ffmpeg the plain audio containers still work, and everything else
  // says why instead of handing Voicebox a video.
  assert.match(pipeline, /isVoiceboxReadable\(filename\)/);
  assert.match(pipeline, /No ffmpeg was found/);

  // The temporary workspace goes away whatever happens.
  assert.match(pipeline, /export async function discardRecording/);
  assert.match(pipeline, /recursive: true, force: true/);
});
