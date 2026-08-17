import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  audioAnalysisCommandText,
  AUDIO_ANALYSIS_SKILL,
} from "../src/lib/hermes/audio-intent.ts";
import {
  audioAttachmentFormat,
  audioFormatLabel,
  isAudioAttachmentName,
  isAudioBlobId,
  AUDIO_ATTACHMENT_ACCEPT,
} from "../src/lib/audio-attachments.ts";
import {
  chatMessageAttachments,
  normalizeChatMessageAttachments,
  reusableChatAttachments,
} from "../src/lib/chat-attachments.ts";
import { collectUploads } from "../src/lib/conversations/uploads.ts";
import {
  analyzableTracks,
  hasAnalyzableAttachment,
  hasRecentAnalyzableAudio,
  mergeTracks,
  renderAudioAnalysisContext,
  selectTrack,
} from "../src/lib/audio-analyzer/tracks.ts";
import {
  parseAnalysisOptions,
  runAudioAnalysis,
  runAudioComparison,
  AudioAnalyzerError,
} from "../src/lib/audio-analyzer/service.ts";
import { readAudioAnalyzerConfig } from "../src/lib/audio-analyzer/config.ts";
import { audioAnalyzerInstalled, audioAnalyzerStatus } from "../src/lib/audio-analyzer/runtime.ts";
import {
  audioBlobPath,
  findAudioBlob,
  newAudioBlobId,
} from "../src/lib/conversations/audio-blob-store.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const attachment = (name, blobId = newAudioBlobId(), format = "wav") => ({
  type: "audio",
  name,
  blobId,
  format,
  sizeBytes: 1024,
});
const userMessage = (...attachments) => ({
  role: "user",
  metadata: JSON.stringify({ attachments }),
});

/**
 * A real 8-bar loop rather than a stub: A minor triad over a 120 BPM click, so
 * the assertions below are about what the analyzer measured and not about
 * whether a fixture parsed.
 */
function writeTestWav(filePath, { seconds = 6, sampleRate = 44100 } = {}) {
  const frames = seconds * sampleRate;
  const data = Buffer.alloc(frames * 4);
  for (let index = 0; index < frames; index += 1) {
    const time = index / sampleRate;
    const chord =
      (Math.sin(2 * Math.PI * 220 * time) +
        Math.sin(2 * Math.PI * 261.63 * time) +
        Math.sin(2 * Math.PI * 329.63 * time)) /
      3;
    const beatPhase = (time * 2) % 1;
    const click = beatPhase < 0.02 ? Math.sin(2 * Math.PI * 1000 * time) * Math.exp(-40 * beatPhase) : 0;
    const sample = Math.max(-1, Math.min(1, 0.25 * chord + 0.5 * click));
    const value = Math.round(sample * 30000);
    data.writeInt16LE(value, index * 4);
    data.writeInt16LE(Math.round(value * 0.9), index * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, data]));
  return filePath;
}

test("Audio Analysis is a ready prebuilt skill on both conversational surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === AUDIO_ANALYSIS_SKILL,
    );
    assert.ok(skill, `expected the skill on ${surface}`);
    assert.equal(skill.availability, "ready");
    assert.equal(skill.category, "Featured");
    assert.deepEqual(skill.capabilityContract?.requiredTools, ["audio_analyze"]);
  }

  // Quartz is the public frontend; it must never reach a local file this way.
  const quartz = listFirstPartySkills("quartz_ai").find(
    (candidate) => candidate.slug === AUDIO_ANALYSIS_SKILL,
  );
  assert.ok(quartz);
  assert.notEqual(quartz.availability, "ready");
});

test("both tools are authorized on the chat surfaces and on neither public one", () => {
  for (const tool of ["audio_analyze", "audio_compare"]) {
    assert.ok(allowedToolsForSurface("dashboard_terminal").includes(tool), tool);
    assert.ok(allowedToolsForSurface("garden_chat").includes(tool), tool);
    assert.ok(!allowedToolsForSurface("quartz_ai").includes(tool), tool);
    assert.ok(BROKERED_TOOLS.includes(tool), tool);
  }
});

test("the tools are registered everywhere the runtime actually reads", () => {
  const manifest = source("../hermes-agent/plugins/breadboard/plugin.yaml");
  const plugin = source("../hermes-agent/plugins/breadboard/__init__.py");
  const route = source("src/app/api/hermes/tools/audio/route.ts");
  const broker = source("src/lib/hermes/capability-broker.ts");

  assert.match(manifest, /^\s+- audio_analyze$/m);
  assert.match(manifest, /^\s+- audio_compare$/m);
  assert.match(plugin, /"audio_analyze",\s*\n\s*"\/api\/hermes\/tools\/audio",/);
  assert.match(plugin, /"audio_compare",\s*\n\s*"\/api\/hermes\/tools\/audio",/);
  // The route reads `body.action` and `body.args`, which is what the default
  // action-shaped payload branch produces for an unrecognized route kind.
  assert.match(plugin, /_AUDIO_REQUEST_TIMEOUT_SECONDS/);
  assert.match(plugin, /route_kind == "audio"/);
  assert.match(broker, /AUDIO_ANALYSIS_TOOLS/);
  assert.match(route, /selectedConditionalSkills\.includes\(AUDIO_ANALYSIS_SKILL\)/);
});

test("both turn pipelines select the skill and carry the context block", () => {
  // Wiring only the canonical chain is how a feature silently works on one
  // surface and not the other.
  const canonical = source("src/lib/conversations/turn-service.ts");
  const garden = source("src/lib/hermes/garden-chat-adapter.ts");
  for (const chain of [canonical, garden]) {
    assert.match(chain, /audioAnalysisCommandText\(/);
    assert.match(chain, /renderAudioAnalysisContext\(/);
    assert.match(chain, /audioSelection\.automatic/);
  }
});

test("agent mode off says it cannot hear the file instead of inventing one", () => {
  // That pipeline has no tools at all, so a song reaching it as nothing but a
  // filename is a song the model answers about from its title.
  assert.match(
    source("src/lib/conversations/direct-turn-service.ts"),
    /attachment\.type === "audio"[\s\S]{0,400}?You cannot hear this file/,
  );
});

test("a question about an attached track selects the skill", () => {
  const base = { surface: "garden_chat", authenticated: true, hasAudioAttachment: true };
  for (const text of [
    "what key is this in?",
    "analyze this song",
    "whats the bpm",
    "is my mix too muddy",
    "how loud is this for spotify",
    "where does the chorus start",
    "tell me about this track",
    "",
  ]) {
    const selection = audioAnalysisCommandText({ ...base, text });
    assert.equal(selection.automatic, true, JSON.stringify(text));
    assert.equal(selection.text, `/${AUDIO_ANALYSIS_SKILL} ${text}`);
  }
});

test("handling the file, or wanting its words, does not start an analysis", () => {
  const base = { surface: "garden_chat", authenticated: true, hasAudioAttachment: true };
  for (const text of [
    "just save this to the garden",
    "upload this for me",
    "send this to my phone",
    "transcribe this",
    "what does he say at the start",
    "give me a transcript of this voice memo",
    "add captions",
  ]) {
    assert.equal(audioAnalysisCommandText({ ...base, text }).automatic, false, text);
  }
});

test("the selection needs a track, an authenticated private surface, and no explicit command", () => {
  const text = "what key is this in?";
  assert.equal(
    audioAnalysisCommandText({
      text,
      surface: "garden_chat",
      authenticated: true,
      hasAudioAttachment: false,
    }).automatic,
    false,
  );
  // A follow-up arrives with no attachment of its own; the earlier track counts,
  // but only when the words are still about the music.
  assert.equal(
    audioAnalysisCommandText({
      text: "and how does the chorus compare?",
      surface: "garden_chat",
      authenticated: true,
      hasAudioAttachment: false,
      hasRecentAudioAttachment: true,
    }).automatic,
    true,
  );
  assert.equal(
    audioAnalysisCommandText({
      text: "thanks, that's all",
      surface: "garden_chat",
      authenticated: true,
      hasAudioAttachment: false,
      hasRecentAudioAttachment: true,
    }).automatic,
    false,
  );
  assert.equal(
    audioAnalysisCommandText({
      text,
      surface: "quartz_ai",
      authenticated: true,
      hasAudioAttachment: true,
    }).automatic,
    false,
  );
  assert.equal(
    audioAnalysisCommandText({
      text,
      surface: "garden_chat",
      authenticated: false,
      hasAudioAttachment: true,
    }).automatic,
    false,
  );
  const explicit = audioAnalysisCommandText({
    text: "/watch something",
    surface: "dashboard_terminal",
    authenticated: true,
    hasAudioAttachment: true,
  });
  assert.equal(explicit.automatic, false);
  assert.equal(explicit.text, "/watch something");
});

test("audio filenames resolve to the formats Symphonia decodes", () => {
  assert.equal(audioAttachmentFormat("Song.MP3"), "mp3");
  assert.equal(audioAttachmentFormat("mix v2.flac"), "flac");
  assert.equal(audioAttachmentFormat("c:/music/bounce.m4a"), "m4a");
  assert.equal(audioAttachmentFormat("notes.txt"), null);
  assert.equal(audioAttachmentFormat("clip.mp4"), null, "a video is not an audio attachment");
  assert.equal(isAudioAttachmentName("loop.wav"), true);
  assert.equal(audioFormatLabel("mp3"), "MP3");
  assert.ok(AUDIO_ATTACHMENT_ACCEPT.includes(".mp3"));
  assert.ok(isAudioBlobId(newAudioBlobId()));
  assert.equal(isAudioBlobId("vid_00000000000000000000000000000000"), false);
});

test("an audio attachment survives the whole message round trip", () => {
  const blobId = newAudioBlobId();
  const composer = [attachment("bounce.wav", blobId)];

  const stored = chatMessageAttachments(composer);
  assert.deepEqual(stored, [
    { type: "audio", name: "bounce.wav", blobId, format: "wav", sizeBytes: 1024 },
  ]);
  // Re-read from transcript metadata, and reusable for a regenerated turn.
  assert.deepEqual(normalizeChatMessageAttachments(stored), stored);
  assert.deepEqual(reusableChatAttachments(stored), composer);
  // And accepted by the send routes, which validate the pointer rather than the
  // bytes. Asserted from source because that module imports next/server, which
  // does not load under node:test.
  assert.match(
    source("src/lib/chat-attachments-request.ts"),
    /attachment\.type === "audio"[\s\S]*isAudioBlobId\(attachment\.blobId\)/,
  );

  // A blob id of the wrong shape degrades to a plain filename rather than
  // becoming a pointer to nothing.
  assert.deepEqual(
    chatMessageAttachments([{ ...attachment("bad.wav"), blobId: "aud_nope" }]),
    [{ type: "file", name: "bad.wav", sizeBytes: 1024 }],
  );

  const uploads = collectUploads([
    {
      message_id: 7,
      metadata: JSON.stringify({ attachments: stored }),
      created_at: "2026-08-12T10:00:00Z",
      conversation_public_id: "conv",
      conversation_title: "Mix notes",
      surface: "garden_chat",
    },
  ]);
  assert.equal(uploads[0].kind, "audio");
  assert.equal(uploads[0].hasContent, true);
  assert.equal(uploads[0].previewAvailable, true);
});

test("tracks resolve out of the conversation, newest first and deduplicated", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  process.env.BREADBOARD_CHAT_AUDIO_DIR = root;
  t.after(() => {
    delete process.env.BREADBOARD_CHAT_AUDIO_DIR;
  });

  const userId = 1;
  const present = newAudioBlobId();
  writeTestWav(audioBlobPath({ userId, blobId: present, format: "wav" }), { seconds: 1 });
  const missing = newAudioBlobId();

  assert.ok(findAudioBlob({ userId, blobId: present }));
  assert.equal(findAudioBlob({ userId, blobId: missing }), null);
  // A blob belonging to somebody else reads as missing, not as forbidden.
  assert.equal(findAudioBlob({ userId: 2, blobId: present }), null);

  const tracks = analyzableTracks(userId, [
    userMessage(attachment("reference.wav", present)),
    { role: "assistant", metadata: null },
    userMessage(attachment("my-mix.wav", missing)),
    userMessage(),
  ]);
  assert.deepEqual(tracks.map((track) => track.name), ["my-mix.wav", "reference.wav"]);
  assert.equal(tracks[0].carriedForward, true, "no track came with the newest message");
  assert.equal(tracks[0].path, null, "a stored file that is gone resolves to no path");
  assert.ok(tracks[1].path?.endsWith(`${present}.wav`));

  assert.equal(hasAnalyzableAttachment([attachment("x.wav")]), true);
  assert.equal(hasAnalyzableAttachment([{ type: "text", name: "a.txt", text: "hi" }]), false);
  assert.equal(hasRecentAnalyzableAudio([userMessage(attachment("x.wav"))]), true);
  assert.equal(hasRecentAnalyzableAudio([{ role: "user", metadata: null }]), false);

  // Naming is forgiving, because the model quotes a filename back at us.
  assert.equal(selectTrack(tracks, undefined).name, "my-mix.wav");
  assert.equal(selectTrack(tracks, "REFERENCE.WAV").name, "reference.wav");
  assert.equal(selectTrack(tracks, "reference").name, "reference.wav");
  assert.equal(selectTrack(tracks, "kick.aiff"), null);

  const context = renderAudioAnalysisContext(mergeTracks(tracks, tracks));
  assert.match(context, /\[Attached audio — real analysis available\]/);
  assert.match(context, /audio_analyze track: reference\.wav/);
  // The one whose file is gone must not be offered as an argument.
  assert.ok(!context.includes("audio_analyze track: my-mix.wav"));
  assert.match(context, /could not be opened/);
  assert.equal((context.match(/reference\.wav/g) ?? []).length, 2, "deduplicated by name");
});

test("analysis options are bounded here rather than in the route", () => {
  const defaults = parseAnalysisOptions({});
  assert.equal(defaults.analysis, "full");
  assert.equal(defaults.resolution, null);

  assert.equal(parseAnalysisOptions({ analysis: "RHYTHM" }).analysis, "rhythm");
  assert.equal(parseAnalysisOptions({ resolution: "High" }).resolution, "high");
  assert.equal(parseAnalysisOptions({ resolution: 4 }).resolution, "4");
  // Snake case too: the underlying MCP server names its arguments that way and
  // a model that has seen both should not lose the argument.
  assert.equal(parseAnalysisOptions({ start_time: "12.5" }).startTime, 12.5);

  for (const args of [
    { analysis: "everything" },
    { resolution: "enormous" },
    { startTime: 30, endTime: 10 },
    { startTime: -1 },
    { minBpm: 200, maxBpm: 100 },
    { minBpm: 5 },
  ]) {
    assert.throws(
      () => parseAnalysisOptions(args),
      (error) =>
        error instanceof AudioAnalyzerError &&
        error.code === "audio_analyzer_invalid_arguments",
      JSON.stringify(args),
    );
  }
});

test("the analyzer binary is provisioned and answers a handshake", async () => {
  const config = readAudioAnalyzerConfig();
  assert.equal(
    audioAnalyzerInstalled(),
    true,
    `expected the analyzer at ${config.serverExecutable}; run \`npm run setup:audio-analyzer\``,
  );
  const status = await audioAnalyzerStatus();
  assert.equal(status.state, "ready", status.detail);
});

test("a real analysis measures the file rather than guessing at it", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-audio-run-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const track = writeTestWav(path.join(root, "loop.wav"));

  const full = await runAudioAnalysis({ path: track, options: parseAnalysisOptions({}) });
  // An A minor triad at 120 BPM, which is what the fixture actually is.
  assert.match(full.report, /Estimated key: A minor/);
  assert.match(full.report, /Tempo: 120/);
  assert.match(full.report, /Duration: 6\.00 sec/);

  // A window, and a narrower analysis, both reach the same server.
  const section = await runAudioAnalysis({
    path: track,
    options: parseAnalysisOptions({ analysis: "rhythm", startTime: 1, endTime: 3, resolution: "low" }),
  });
  assert.match(section.report, /Tempo/);

  const info = await runAudioAnalysis({ path: track, options: parseAnalysisOptions({ analysis: "info" }) });
  assert.match(info.report, /44100/);

  const other = writeTestWav(path.join(root, "quiet.wav"), { seconds: 4 });
  const compared = await runAudioComparison({ pathA: track, pathB: other });
  assert.match(compared.report, /loop\.wav|Track A/i);

  // A file the decoder cannot read fails as an unreadable file, not as a crash.
  const bogus = path.join(root, "not-audio.wav");
  fs.writeFileSync(bogus, "this is not a waveform");
  await assert.rejects(
    runAudioAnalysis({ path: bogus, options: parseAnalysisOptions({}) }),
    (error) => error instanceof AudioAnalyzerError,
  );
  await assert.rejects(
    runAudioAnalysis({ path: path.join(root, "gone.wav"), options: parseAnalysisOptions({}) }),
    (error) => error instanceof AudioAnalyzerError && error.code === "audio_analyzer_file_missing",
  );
});
