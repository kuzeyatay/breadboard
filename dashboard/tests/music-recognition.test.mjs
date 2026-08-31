import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { newAudioBlobId } from "../src/lib/conversations/audio-blob-store.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  MUSIC_RECOGNITION_SKILL,
  renderMusicRecognitionContext,
  resolveMusicRecognitionTrack,
} from "../src/lib/music-recognition/context.ts";
import { MusicRecognitionError } from "../src/lib/music-recognition/errors.ts";
import {
  MAX_MUSIC_RECOGNITION_BYTES,
  normalizedAudioType,
  validateMusicRecognitionAudio,
} from "../src/lib/music-recognition/input.ts";
import { recognizeMusic } from "../src/lib/music-recognition/index.ts";
import { recognizeWithAudD } from "../src/lib/music-recognition/providers/audd.ts";
import {
  SHAZAM_PROVIDER_ORIGIN,
  recognizeWithShazam,
} from "../src/lib/music-recognition/providers/shazam.ts";
import {
  consumeMusicRecognitionRateLimit,
  resetMusicRecognitionRateLimitsForTests,
} from "../src/lib/music-recognition/rate-limit.ts";

function source(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function wavBlob() {
  return new Blob([new Uint8Array([82, 73, 70, 70])], { type: "audio/wav" });
}

test("AudD matches are normalized without synthesizing confidence", async () => {
  let request;
  const result = await recognizeWithAudD(wavBlob(), "sample.wav", {
    env: { AUDD_API_TOKEN: "server-secret" },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse({
        status: "success",
        result: {
          title: "Weird Fishes/Arpeggi",
          artist: "Radiohead",
          album: "In Rainbows",
          release_date: "2007-10-10",
          timecode: "00:42",
          song_link: "https://song.link/example",
          spotify: {
            external_urls: { spotify: "https://open.spotify.com/track/example" },
            external_ids: { isrc: "GBSTK0700001" },
            album: { images: [{ url: "https://i.scdn.co/image/example" }] },
          },
          apple_music: { url: "javascript:alert(1)" },
        },
      });
    },
  });

  assert.equal(request.url, "https://api.audd.io/");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body.get("api_token"), "server-secret");
  assert.deepEqual(result, {
    match: {
      title: "Weird Fishes/Arpeggi",
      artist: "Radiohead",
      album: "In Rainbows",
      releaseDate: "2007-10-10",
      label: undefined,
      timecode: "00:42",
      isrc: "GBSTK0700001",
      provider: "audd",
      artwork: "https://i.scdn.co/image/example",
      links: {
        song: "https://song.link/example",
        spotify: "https://open.spotify.com/track/example",
        appleMusic: undefined,
      },
    },
  });
  assert.equal("confidence" in result.match, false);
});

test("AudD no-match, provider errors, missing configuration, and timeout stay distinct", async () => {
  const noMatch = await recognizeWithAudD(wavBlob(), "sample.wav", {
    env: { AUDD_API_TOKEN: "token" },
    fetchImpl: async () => jsonResponse({ status: "success", result: null }),
  });
  assert.deepEqual(noMatch, { match: null });

  await assert.rejects(
    recognizeWithAudD(wavBlob(), "sample.wav", {
      env: { AUDD_API_TOKEN: "token" },
      fetchImpl: async () =>
        jsonResponse({ status: "error", error: { error_message: "quota exhausted" } }),
    }),
    (error) =>
      error instanceof MusicRecognitionError &&
      error.code === "music_provider_error" &&
      /quota exhausted/.test(error.message),
  );
  await assert.rejects(
    recognizeWithAudD(wavBlob(), "sample.wav", { env: {} }),
    (error) =>
      error instanceof MusicRecognitionError &&
      error.code === "music_recognition_not_configured" &&
      /AUDD_API_TOKEN/.test(error.message),
  );

  const waitsForAbort = (_url, init) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(init.signal.reason ?? new DOMException("Aborted", "AbortError"));
      if (init.signal.aborted) abort();
      else init.signal.addEventListener("abort", abort, { once: true });
    });
  await assert.rejects(
    recognizeWithAudD(wavBlob(), "sample.wav", {
      env: { AUDD_API_TOKEN: "token" },
      fetchImpl: waitsForAbort,
      timeoutMs: 5,
    }),
    (error) =>
      error instanceof MusicRecognitionError && error.code === "music_provider_timeout",
  );
});

test("caller cancellation is not reported as a provider timeout", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    recognizeWithAudD(wavBlob(), "sample.wav", {
      env: { AUDD_API_TOKEN: "token" },
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        if (init.signal.aborted) throw new DOMException("Aborted", "AbortError");
        return jsonResponse({ status: "success", result: null });
      },
    }),
    (error) =>
      error instanceof MusicRecognitionError && error.code === "music_recognition_cancelled",
  );
});

test("the no-key Shazam provider sends a local fingerprint and normalizes a match", async () => {
  let request;
  const result = await recognizeWithShazam(wavBlob(), {
    fingerprintImpl: (bytes) => {
      assert.deepEqual([...bytes], [82, 73, 70, 70]);
      return [{ uri: "data:audio/vnd.shazam.sig;base64,local-fingerprint", samplems: 12_000 }];
    },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return jsonResponse({
        matches: [{ offset: 42.2 }],
        track: {
          title: "Weird Fishes/Arpeggi",
          subtitle: "Radiohead",
          url: "https://www.shazam.com/track/example",
          images: { coverarthq: "https://is1-ssl.mzstatic.com/image/example" },
          hub: {
            providers: [
              { type: "SPOTIFY", actions: [{ uri: "spotify:track:abc123" }] },
            ],
            options: [
              { actions: [{ uri: "https://music.apple.com/nl/album/example" }] },
            ],
          },
          sections: [
            {
              type: "SONG",
              metadata: [
                { title: "Album", text: "In Rainbows" },
                { title: "Released", text: "2007" },
                { title: "Label", text: "XL Recordings" },
                { title: "ISRC", text: "GBSTK0700001" },
              ],
            },
          ],
        },
      });
    },
  });

  assert.match(String(request.url), new RegExp(`^${SHAZAM_PROVIDER_ORIGIN}`));
  assert.equal(request.init.method, "POST");
  const sent = JSON.parse(request.init.body);
  assert.deepEqual(sent.signature, {
    uri: "data:audio/vnd.shazam.sig;base64,local-fingerprint",
    samplems: 12_000,
  });
  assert.equal(request.init.body.includes("RIFF"), false);
  assert.deepEqual(result, {
    match: {
      title: "Weird Fishes/Arpeggi",
      artist: "Radiohead",
      album: "In Rainbows",
      releaseDate: "2007",
      label: "XL Recordings",
      timecode: "0:42",
      isrc: "GBSTK0700001",
      provider: "shazam",
      artwork: "https://is1-ssl.mzstatic.com/image/example",
      links: {
        song: "https://www.shazam.com/track/example",
        spotify: "https://open.spotify.com/track/abc123",
        appleMusic: "https://music.apple.com/nl/album/example",
      },
    },
  });
});

test("Shazam is the default no-key provider and keeps no-match distinct", async () => {
  let calls = 0;
  const result = await recognizeMusic(
    { audio: wavBlob(), filename: "sample.wav" },
    {
      env: {},
      shazamFingerprintImpl: () => [
        { uri: "data:audio/vnd.shazam.sig;base64,test", samplems: 4_000 },
      ],
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ matches: [] });
      },
    },
  );
  assert.deepEqual(result, { match: null });
  assert.equal(calls, 1);
});

test("provider selection and audio validation are bounded", async () => {
  assert.equal(normalizedAudioType("audio/webm;codecs=opus"), "audio/webm");
  validateMusicRecognitionAudio({ size: 100, type: "audio/webm;codecs=opus" });
  assert.throws(
    () => validateMusicRecognitionAudio({ size: 100, type: "text/plain" }),
    (error) => error instanceof MusicRecognitionError && error.status === 415,
  );
  assert.throws(
    () => validateMusicRecognitionAudio({ size: MAX_MUSIC_RECOGNITION_BYTES + 1, type: "audio/wav" }),
    (error) => error instanceof MusicRecognitionError && error.status === 413,
  );
  await assert.rejects(
    recognizeMusic(
      { audio: wavBlob() },
      { env: { MUSIC_RECOGNITION_PROVIDER: "unknown" } },
    ),
    (error) => error instanceof MusicRecognitionError && error.code === "unsupported_music_provider",
  );
});

test("rate limits reject bursts and reset at the next window", () => {
  resetMusicRecognitionRateLimitsForTests();
  consumeMusicRecognitionRateLimit("user:1", { limit: 2, windowMs: 1_000, now: 10 });
  consumeMusicRecognitionRateLimit("user:1", { limit: 2, windowMs: 1_000, now: 11 });
  assert.throws(
    () => consumeMusicRecognitionRateLimit("user:1", { limit: 2, windowMs: 1_000, now: 12 }),
    (error) => error instanceof MusicRecognitionError && error.status === 429,
  );
  consumeMusicRecognitionRateLimit("user:1", { limit: 2, windowMs: 1_000, now: 1_011 });
});

test("tool references resolve only from the conversation-provided track list", () => {
  const allowed = newAudioBlobId();
  const foreign = newAudioBlobId();
  const tracks = [
    {
      name: "sample.wav",
      blobId: allowed,
      path: "C:/owned/sample.wav",
      format: "wav",
      formatLabel: "WAV",
      sizeBytes: 500,
      carriedForward: false,
    },
  ];
  assert.equal(resolveMusicRecognitionTrack(tracks, { blobId: allowed }).blobId, allowed);
  assert.equal(resolveMusicRecognitionTrack(tracks, { attachmentId: "sample.wav" }).blobId, allowed);
  for (const args of [
    { blobId: foreign },
    { blobId: allowed, attachmentId: "sample.wav" },
    {},
  ]) {
    assert.throws(() => resolveMusicRecognitionTrack(tracks, args), MusicRecognitionError);
  }
  const context = renderMusicRecognitionContext(tracks);
  assert.match(context, new RegExp(`music_recognize blobId: ${allowed}`));
  assert.doesNotMatch(context, /base64|C:\/owned/u);
});

test("Recognize Music is a ready skill with a brokered private-surface tool", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find(
      (candidate) => candidate.slug === MUSIC_RECOGNITION_SKILL,
    );
    assert.ok(skill, surface);
    assert.equal(skill.availability, "ready");
    assert.deepEqual(skill.capabilityContract?.requiredTools, ["music_recognize"]);
    assert.ok(allowedToolsForSurface(surface).includes("music_recognize"));
  }
  assert.ok(!allowedToolsForSurface("quartz_ai").includes("music_recognize"));
  assert.ok(BROKERED_TOOLS.includes("music_recognize"));
});

test("the tool, skill context, protected route, and microphone UI are wired end to end", () => {
  const manifest = source("../hermes-agent/plugins/breadboard/plugin.yaml");
  const plugin = source("../hermes-agent/plugins/breadboard/__init__.py");
  const route = source("src/app/api/hermes/tools/music-recognition/route.ts");
  const directRoute = source("src/app/api/music-recognition/recognize/route.ts");
  const composer = source("src/app/components/assistant-composer.tsx");
  const microphone = source("src/app/components/speech-dictation-button.tsx");
  const button = source("src/app/components/music-recognition-button.tsx");
  const canonical = source("src/lib/conversations/turn-service.ts");
  const garden = source("src/lib/hermes/garden-chat-adapter.ts");

  assert.match(manifest, /^\s+- music_recognize$/m);
  assert.match(plugin, /"music_recognize",\s*\n\s*"\/api\/hermes\/tools\/music-recognition",/);
  assert.match(route, /capabilityForInternalToolRequest/);
  assert.match(route, /selectedConditionalSkills\.includes\(MUSIC_RECOGNITION_SKILL\)/);
  assert.match(route, /listRecentConversationMessages/);
  assert.doesNotMatch(route, /args\.(?:path|url)|console\.(?:log|error)/);
  assert.match(directRoute, /requireUserId\(\)/);
  assert.match(directRoute, /consumeMusicRecognitionRateLimit/);
  assert.match(directRoute, /persistDirectMusicRecognition/);
  assert.match(composer, /runtimeSessionId=\{capabilitySessionId\}/);
  assert.match(microphone, /<MusicRecognitionButton/);
  assert.match(button, /MUSIC_CAPTURE_DURATION_MS = 12_000/);
  assert.match(button, /echoCancellation: false/);
  assert.match(button, /noiseSuppression: false/);
  assert.match(button, /autoGainControl: false/);
  assert.match(button, /streamRef\.current\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(button, /requestAbortRef\.current\?\.abort\(\)/);
  assert.match(button, /Listening…/);
  assert.match(button, /Recognizing…/);
  assert.match(button, /No match found/);
  assert.match(button, /Recognition unavailable/);
  for (const pipeline of [canonical, garden]) {
    assert.match(pipeline, /renderMusicRecognitionContext/);
    assert.match(pipeline, /MUSIC_RECOGNITION_SKILL/);
  }
});
