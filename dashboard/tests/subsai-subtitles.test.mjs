// Subtitles via the cloned subsai.
//
// Two things carry the risk here.
//
// The first is telling apart the two things people call "subtitles": burning
// them into the picture (an edit) and producing a file (an artifact). Getting
// that wrong means either re-encoding a video when someone wanted a file, or
// handing over a file when they wanted the video changed.
//
// The second is the conversion. subsai speaks pysubs2 and the video editor
// speaks ElevenLabs Scribe's JSON, and the only reason a local Whisper can
// stand in for a hosted API is that one word-level subtitle file converts
// exactly into the other. If that conversion drifts, captions land on the wrong
// syllable after a cut and nothing else notices.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const read = (relative, root = dashboardRoot) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const { SUBTITLE_FORMATS, subtitleFilename, subtitleIntent } = await import(
  "../src/lib/subsai/identity.ts"
);
const { parseSrt, scribeTranscriptFromWords } = await import(
  "../src/lib/subsai/transcribe.ts"
);

// --- which kind of subtitles ------------------------------------------------

test("putting them on the video is an edit", () => {
  for (const message of [
    "add subtitles",
    "add captions to this",
    "burn in the subtitles",
    "hardcode the captions",
    "i want captions on screen",
    "give me the video with subtitles",
  ]) {
    const intent = subtitleIntent(message);
    assert.equal(intent.subtitles, true, message);
    assert.equal(intent.delivery, "burn", message);
  }
});

test("asking for a file is not an edit", () => {
  for (const [message, format] of [
    ["give me an srt for this", "srt"],
    ["export the subtitles as vtt", "vtt"],
    ["i need a subtitle file", null],
    ["can you make a sidecar subtitle track", null],
  ]) {
    const intent = subtitleIntent(message);
    assert.equal(intent.subtitles, true, message);
    assert.equal(intent.delivery, "file", message);
    if (format) assert.equal(intent.format, format, message);
  }
});

test("a bare request means the video, which is the recoverable direction", () => {
  // "Add subtitles" means "on the video" to most people, and burning produces a
  // transcript — so asking for the file afterwards costs nothing, while the
  // reverse would mean re-transcribing.
  const intent = subtitleIntent("subtitle this");
  assert.equal(intent.subtitles, true);
  assert.equal(intent.delivery, "burn");
});

test("burn wins when both are asked for", () => {
  const intent = subtitleIntent("add subtitles to the video and give me the srt too");
  assert.equal(intent.delivery, "burn");
});

test("messages that are not about subtitles are left alone", () => {
  for (const message of [
    "",
    "cut the dead air",
    "what happens in this video?",
    "make it vertical",
    "summarise the transcript for me",
  ]) {
    assert.equal(subtitleIntent(message).subtitles, false, message);
  }
});

test("a subtitle file is named after its video", () => {
  assert.equal(subtitleFilename("Loki Official Clip.mp4", "srt"), "loki-official-clip.srt");
  assert.equal(subtitleFilename("", "vtt"), "subtitles.vtt");
  for (const format of SUBTITLE_FORMATS) {
    assert.ok(subtitleFilename("talk.mp4", format).endsWith(`.${format}`));
  }
});

// --- the conversion that makes a local engine interchangeable ---------------

const WORD_SRT = [
  "1",
  "00:00:00,120 --> 00:00:00,480",
  "Ninety",
  "",
  "2",
  "00:00:00,480 --> 00:00:00,900",
  "percent",
  "",
  "3",
  "00:00:02,400 --> 00:00:02,760",
  "wasted.",
  "",
].join("\n");

test("SubRip parses, including the comma decimal separator", () => {
  const cues = parseSrt(WORD_SRT);
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[0], { start: 0.12, end: 0.48, text: "Ninety" });
  assert.equal(cues[2].start, 2.4);
});

test("a malformed block is skipped, never fatal", () => {
  const cues = parseSrt(`${WORD_SRT}\n\n4\nnot a timestamp\norphan\n`);
  assert.equal(cues.length, 3);
});

test("word cues become the transcript shape the editor already reads", () => {
  const transcript = scribeTranscriptFromWords(parseSrt(WORD_SRT));
  const words = transcript.words.filter((word) => word.type === "word");
  assert.equal(words.length, 3);
  assert.deepEqual(
    words.map((word) => word.text),
    ["Ninety", "percent", "wasted."],
  );
  assert.equal(words[0].start, 0.12);
  assert.equal(transcript.text, "Ninety percent wasted.");

  // The silences between words are what the clone's packer breaks phrases on.
  // Without them every take reads as one unbroken run and the cut has no
  // boundaries to land on.
  const spacing = transcript.words.filter((word) => word.type === "spacing");
  assert.equal(spacing.length, 1, "the 1.5s gap should be one spacing entry");
  assert.equal(spacing[0].start, 0.9);
  assert.equal(spacing[0].end, 2.4);
});

test("every word carries the fields the clone's helpers read", () => {
  const transcript = scribeTranscriptFromWords(parseSrt(WORD_SRT));
  for (const word of transcript.words) {
    for (const field of ["type", "text", "start", "end", "speaker_id"]) {
      assert.ok(field in word, `a word is missing ${field}`);
    }
  }
});

// --- wiring -----------------------------------------------------------------

test("the editor reaches subsai through the shared speech resolver", () => {
  // Speech has two local engines — Scriberr when its service is up, this venv
  // otherwise — and which one ran must be invisible downstream: same file, same
  // path, same shape, so the packer and the caption builder cannot tell.
  const transcript = read("src/lib/video-use/transcript.ts");
  assert.match(transcript, /resolveSpeechEngine\(\)/);
  assert.match(transcript, /writeWordTranscript\(/);
  assert.match(transcript, /destination: input\.session\.transcriptPath/);

  const speech = read("src/lib/video-use/speech.ts");
  assert.match(speech, /subsAiInstalled/, "subsai is the fallback engine");
  assert.match(speech, /"scriberr" \| "subsai"/);
});

test("nothing installs behind a run", () => {
  // The environment is gigabytes; it is only ever built from a button.
  const setup = read("src/lib/subsai/setup.ts");
  assert.match(setup, /export async function buildEnvironment/);
  const runtime = read("src/lib/subsai/runtime.ts");
  assert.doesNotMatch(runtime, /uv pip install|buildEnvironment/);
  const route = read("src/app/api/video-use/setup/route.ts");
  assert.match(route, /action === "build_subtitles"/);
  assert.match(route, /requireUserId\(\)/);
  // And health stays cheap: file checks, never a spawn on a hot path.
  assert.doesNotMatch(
    runtime.slice(runtime.indexOf("export function subsAiHealth")),
    /spawnSync/,
  );
});

test("only the backend that is actually used gets installed", () => {
  // configs.py wraps every backend import in try/except and registers what
  // loaded, so one backend is a working checkout. Installing the clone's full
  // requirements would pull whisperX and stable-ts from git for capabilities
  // nothing here asks for.
  const configs = read("subsai/src/subsai/configs.py", repositoryRoot);
  assert.match(configs, /except ImportError/);
  const setup = read("src/lib/subsai/setup.ts");
  assert.match(setup, /"faster-whisper",/);
  assert.match(setup, /"--no-deps"/, "the clone's own requirements union is not installed");
  // Scoped to what is actually installed — the comments above it name the
  // backends being left out, and should not read as if they were included.
  const installArgs = setup.slice(setup.indexOf('"pip", "install",'), setup.indexOf('"tqdm",'));
  assert.doesNotMatch(installArgs, /whisperx|stable-ts|pywhispercpp|transformers/i);
});

test("the clone is present and still exposes what this drives", () => {
  for (const relative of [
    "subsai/src/subsai/cli.py",
    "subsai/src/subsai/configs.py",
    "subsai/src/subsai/models/faster_whisper_model.py",
  ]) {
    assert.ok(fs.existsSync(path.join(repositoryRoot, relative)), `${relative} is missing`);
  }
  // The word-level path this depends on: one subtitle event per word.
  const faster = read("subsai/src/subsai/models/faster_whisper_model.py", repositoryRoot);
  assert.match(faster, /word_timestamps/);
  assert.match(faster, /for word in segment\.words/);
});
