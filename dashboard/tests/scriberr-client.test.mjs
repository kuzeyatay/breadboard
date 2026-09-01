import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ScriberrClient,
  normalizeScriberrJob,
  normalizeScriberrTranscriptPayload,
} from "../src/lib/scriberr/client.ts";
import { buildYtdlpMetadataArgs, parseYtdlpMetadata } from "../src/lib/scriberr/ytdlp.ts";
import { parseFfprobeOutput, assertProbeAcceptable } from "../src/lib/scriberr/ffprobe.ts";
import { parseYouTubeUrl } from "../src/lib/scriberr/youtube.ts";

// ── Scriberr response normalization ─────────────────────────────────────────

test("normalizeScriberrJob maps the Go model fields", () => {
  const job = normalizeScriberrJob({
    id: "abc",
    status: "processing",
    title: "My video",
    error_message: null,
    diarization: true,
    parameters: { model: "small", model_family: "whisper" },
  });
  assert.deepEqual(job, {
    id: "abc",
    status: "processing",
    title: "My video",
    errorMessage: null,
    diarization: true,
    model: "small",
    modelFamily: "whisper",
  });
});

test("normalizeScriberrJob rejects malformed payloads", () => {
  for (const payload of [null, {}, { id: "x", status: "weird" }, { status: "pending" }]) {
    assert.throws(() => normalizeScriberrJob(payload), (err) => err.code === "scriberr_rejected");
  }
});

test("transcript payload normalization keeps segments and language", () => {
  const payload = normalizeScriberrTranscriptPayload({
    available: true,
    transcript: {
      language: "en",
      model_used: "whisperx",
      segments: [
        { start: 0, end: 1.5, text: "hello", speaker: "SPEAKER_00" },
        { start: 1.5, end: 3, text: "world" },
      ],
    },
  });
  assert.equal(payload.available, true);
  assert.equal(payload.transcript.language, "en");
  assert.equal(payload.transcript.segments.length, 2);
  assert.equal(payload.transcript.segments[0].speaker, "SPEAKER_00");
  assert.equal(payload.transcript.segments[1].speaker, null);
});

test("word_segments survive normalization, because cuts are made on them", () => {
  // The video editor plans filler-word cuts and burned captions from these; the
  // phrase-level segments beside them are too coarse to cut on.
  const payload = normalizeScriberrTranscriptPayload({
    available: true,
    transcript: {
      language: "en",
      segments: [{ start: 0, end: 1.2, text: "so anyway" }],
      word_segments: [
        { start: 0.1, end: 0.4, word: "so", score: 0.9, speaker: "SPEAKER_00" },
        { start: 0.5, end: 1.2, word: "anyway", score: 0.8 },
        { start: "nonsense", end: 2, word: "dropped" },
        { start: 2, end: 2.4, word: "   " },
      ],
    },
  });
  assert.deepEqual(
    payload.transcript.words.map((word) => word.word),
    ["so", "anyway"],
  );
  assert.equal(payload.transcript.words[0].speaker, "SPEAKER_00");
  assert.equal(payload.transcript.words[1].speaker, null);
});

test("a backend without word timings normalizes to an empty word list", () => {
  const payload = normalizeScriberrTranscriptPayload({
    available: true,
    transcript: { segments: [{ start: 0, end: 1, text: "hello" }] },
  });
  assert.deepEqual(payload.transcript.words, []);
});

test("transcript payload reports unavailable transcripts without throwing", () => {
  const payload = normalizeScriberrTranscriptPayload({
    available: false,
    transcript: null,
    status: "processing",
  });
  assert.equal(payload.available, false);
  assert.equal(payload.transcript, null);
});

// ── Client auth + error mapping (mocked fetch) ──────────────────────────────

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("client sends X-API-Key when a token is configured", async () => {
  const calls = [];
  const client = new ScriberrClient({
    baseUrl: "http://scriberr.local",
    apiToken: "secret-key",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
      return jsonResponse({ id: "j1", status: "uploaded" });
    },
  });
  await client.getJobStatus("j1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["X-API-Key"], "secret-key");
  assert.equal(calls[0].url, "http://scriberr.local/api/v1/transcription/j1/status");
});

test("client logs in with username/password and retries once on 401", async () => {
  const calls = [];
  let issuedTokens = 0;
  const client = new ScriberrClient({
    baseUrl: "http://scriberr.local",
    username: "kuzey",
    password: "pw",
    fetchImpl: async (url, init) => {
      const target = String(url);
      calls.push({ target, auth: init.headers.Authorization });
      if (target.endsWith("/api/v1/auth/login")) {
        issuedTokens += 1;
        return jsonResponse({ token: `tok-${issuedTokens}`, user: { id: 1 } });
      }
      // First data call with tok-1 is rejected (expired), tok-2 succeeds.
      if (init.headers.Authorization === "Bearer tok-1") {
        return jsonResponse({ error: "Invalid token" }, 401);
      }
      return jsonResponse({ id: "j1", status: "completed" });
    },
  });
  const job = await client.getJobStatus("j1");
  assert.equal(job.status, "completed");
  assert.equal(issuedTokens, 2);
});

test("client bootstraps the private local Scriberr account on first use", async () => {
  const calls = [];
  const client = new ScriberrClient({
    baseUrl: "http://scriberr.local",
    username: "breadboard",
    password: "a-stable-private-password-123",
    fetchImpl: async (url, init) => {
      const target = String(url);
      calls.push({ target, method: init.method, body: init.body });
      if (target.endsWith("/api/v1/auth/login")) {
        return jsonResponse({ error: "invalid credentials" }, 401);
      }
      if (target.endsWith("/api/v1/auth/registration-status")) {
        return jsonResponse({ registration_enabled: true });
      }
      if (target.endsWith("/api/v1/auth/register")) {
        return jsonResponse({ token: "new-local-token", user: { id: 1 } }, 201);
      }
      assert.equal(init.headers.Authorization, "Bearer new-local-token");
      return jsonResponse({ id: "j1", status: "completed" });
    },
  });

  const job = await client.getJobStatus("j1");
  assert.equal(job.status, "completed");
  assert.deepEqual(
    calls.map((call) => call.target.replace("http://scriberr.local", "")),
    [
      "/api/v1/auth/login",
      "/api/v1/auth/registration-status",
      "/api/v1/auth/register",
      "/api/v1/transcription/j1/status",
    ],
  );
  assert.match(calls[2].body, /"confirmPassword":"a-stable-private-password-123"/);
});

test("client maps network failure to scriberr_unavailable", async () => {
  const client = new ScriberrClient({
    baseUrl: "http://scriberr.local",
    apiToken: "k",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(client.getJobStatus("j1"), (err) => err.code === "scriberr_unavailable");
});

test("client maps 401/403 to scriberr_auth_failed", async () => {
  const client = new ScriberrClient({
    baseUrl: "http://scriberr.local",
    apiToken: "bad",
    fetchImpl: async () => jsonResponse({ error: "Invalid API key" }, 401),
  });
  await assert.rejects(client.getJobStatus("j1"), (err) => err.code === "scriberr_auth_failed");
});

test("client maps yt-dlp failures to youtube_download_failed without leaking details", async () => {
  const client = new ScriberrClient({
    baseUrl: "http://scriberr.local",
    apiToken: "k",
    fetchImpl: async () =>
      jsonResponse(
        {
          error: "Failed to download YouTube audio: exit status 1",
          details: "yt-dlp stderr with local paths C:\\private\\stuff",
        },
        500,
      ),
  });
  await assert.rejects(
    client.downloadYouTube({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", timeoutMs: 5000 }),
    (err) => err.code === "youtube_download_failed" && !err.userMessage.includes("C:\\private"),
  );
});

test("startTranscription forwards the bounded WhisperX batch size", async () => {
  const calls = [];
  const client = new ScriberrClient({
    baseUrl: "http://scriberr.local",
    apiToken: "k",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return jsonResponse({ id: "j1", status: "pending" });
    },
  });

  await client.startTranscription("j1", {
    modelFamily: "whisper",
    model: "small.en",
    batchSize: 4,
    language: "en",
  });

  assert.equal(calls[0].url, "http://scriberr.local/api/v1/transcription/j1/start");
  assert.deepEqual(calls[0].body, {
    model_family: "whisper",
    model: "small.en",
    batch_size: 4,
    diarize: false,
    language: "en",
  });
});

test("killJob tolerates 'not running' and missing jobs", async () => {
  for (const status of [200, 400, 404]) {
    const client = new ScriberrClient({
      baseUrl: "http://scriberr.local",
      apiToken: "k",
      fetchImpl: async () => jsonResponse({ message: "x" }, status),
    });
    await client.killJob("j1");
  }
});

// ── yt-dlp argument construction + metadata parsing ─────────────────────────

test("yt-dlp args are a fixed allowlist with --no-playlist and -- separator", () => {
  const args = buildYtdlpMetadataArgs("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.deepEqual(args, [
    "--dump-single-json",
    "--no-playlist",
    "--skip-download",
    "--no-warnings",
    "--",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ]);
});

test("yt-dlp metadata parsing extracts preview fields and rejects playlists", () => {
  const parsed = parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ");
  const metadata = parseYtdlpMetadata(
    {
      id: "dQw4w9WgXcQ",
      title: "Example",
      channel: "Example Channel",
      duration: 321.7,
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg",
      upload_date: "20240110",
    },
    parsed,
  );
  assert.equal(metadata.title, "Example");
  assert.equal(metadata.channel, "Example Channel");
  assert.equal(metadata.durationSeconds, 322);
  assert.equal(metadata.uploadDate, "20240110");
  assert.throws(
    () => parseYtdlpMetadata({ _type: "playlist", entries: [] }, parsed),
    (err) => err.code === "youtube_playlist",
  );
});

// ── ffprobe parsing + policy ────────────────────────────────────────────────

test("ffprobe output parsing detects audio/video streams and duration", () => {
  const probe = parseFfprobeOutput({
    format: { format_name: "mov,mp4,m4a", duration: "125.4", size: "1048576" },
    streams: [
      { codec_type: "video", codec_name: "h264" },
      { codec_type: "audio", codec_name: "aac" },
    ],
  });
  assert.equal(probe.hasAudio, true);
  assert.equal(probe.hasVideo, true);
  assert.deepEqual(probe.codecs, ["h264", "aac"]);
  assert.equal(probe.durationSeconds, 125.4);
  assert.equal(probe.sizeBytes, 1048576);
});

test("probe policy rejects missing audio and over-duration media", () => {
  const noAudio = parseFfprobeOutput({
    format: {},
    streams: [{ codec_type: "video", codec_name: "h264" }],
  });
  assert.throws(
    () => assertProbeAcceptable(noAudio, { maxDurationSeconds: 100 }),
    (err) => err.code === "media_no_audio",
  );
  const tooLong = parseFfprobeOutput({
    format: { duration: "7200" },
    streams: [{ codec_type: "audio", codec_name: "aac" }],
  });
  assert.throws(
    () => assertProbeAcceptable(tooLong, { maxDurationSeconds: 3600 }),
    (err) => err.code === "media_too_long",
  );
});

// ── Audio upload (the video editor's entry point) ────────────────────────────

test("uploadAudio posts to the audio endpoint, not the video one", async () => {
  // The video editor has already extracted 16kHz mono for its silence map, so
  // it hands Scriberr the audio rather than re-uploading the whole video.
  const scratch = path.join(os.tmpdir(), `scriberr-upload-${process.pid}.wav`);
  fs.writeFileSync(scratch, Buffer.from("RIFF----WAVE"));
  try {
    const calls = [];
    const client = new ScriberrClient({
      baseUrl: "http://scriberr.local",
      apiToken: "secret-key",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: init.body });
        return jsonResponse({ id: "j9", status: "uploaded" });
      },
    });
    const job = await client.uploadAudio({
      filePath: scratch,
      filename: "source.wav",
      title: "Video Use edit",
    });
    assert.equal(job.id, "j9");
    assert.equal(calls[0].url, "http://scriberr.local/api/v1/transcription/upload");
    assert.ok(calls[0].body instanceof FormData);
    assert.ok(calls[0].body.get("audio"), "the field Scriberr reads is `audio`");
    assert.equal(calls[0].body.get("title"), "Video Use edit");
  } finally {
    fs.rmSync(scratch, { force: true });
  }
});

test("uploading media that is not there fails before any request", async () => {
  const client = new ScriberrClient({
    baseUrl: "http://scriberr.local",
    apiToken: "secret-key",
    fetchImpl: async () => {
      throw new Error("no request should have been made");
    },
  });
  await assert.rejects(
    () => client.uploadAudio({ filePath: path.join(os.tmpdir(), "absent.wav"), filename: "a.wav" }),
    (error) => error.code === "media_missing",
  );
});
