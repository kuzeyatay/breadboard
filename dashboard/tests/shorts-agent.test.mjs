// The Shorts agent: what a runnable request is, what the composer refuses, and
// that the two halves of the bridge agree on the protocol between them.
//
// This agent has no prompt anywhere in it — the request is a typed object and
// the chat message is rendered from it — so almost everything worth testing is
// in the validation boundary and the wiring, not in prose handling.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const read = (relative, root = dashboardRoot) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const {
  DEFAULT_SHORTS_REQUEST,
  MAX_SHORTS_CLIPS,
  SHORTS_AGENT_ID,
  SHORTS_AGENT_NAME,
  SHORTS_COMMAND,
  clampClipCount,
  isFetchableVideoUrl,
  parseShortsCommand,
  shortsRunLabel,
  shortsUserMessage,
  validateShortsRequest,
} = await import("../src/lib/shorts/identity.ts");

const url = (value = "https://www.youtube.com/watch?v=abc123") => ({ kind: "url", url: value });
const request = (overrides = {}) => ({
  source: url(),
  ...DEFAULT_SHORTS_REQUEST,
  ...overrides,
});

test("the command, id and name stay consistent with each other", () => {
  assert.equal(SHORTS_COMMAND, `/agents:${SHORTS_AGENT_ID}`);
  assert.equal(SHORTS_AGENT_ID, "shorts");
  assert.equal(SHORTS_AGENT_NAME, "Shorts");
});

test("a video link and an uploaded file are both runnable sources", () => {
  const link = validateShortsRequest(request());
  assert.ok(link.ok);
  assert.deepEqual(link.request.source, url());

  const upload = validateShortsRequest(
    request({
      source: { kind: "upload", uploadId: "a".repeat(32), filename: "talk.mp4" },
    }),
  );
  assert.ok(upload.ok);
  assert.equal(upload.request.source.kind, "upload");
  assert.equal(upload.request.source.filename, "talk.mp4");
});

test("a request with no video is refused, in words a person can act on", () => {
  const missing = validateShortsRequest(request({ source: { kind: "url", url: "" } }));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /paste a video link/i);

  const nothing = validateShortsRequest({});
  assert.equal(nothing.ok, false);
  assert.match(nothing.error, /choose a video/i);
});

test("only http and https links are fetchable — never a local path", () => {
  assert.ok(isFetchableVideoUrl("https://youtu.be/abc"));
  assert.ok(isFetchableVideoUrl("http://example.com/talk.mp4"));

  // yt-dlp reads file:// happily, which would turn the composer into a way to
  // make the server open any path it can reach. An upload is the supported way
  // to use a local video, and it goes through a route that owns the bytes.
  for (const bad of [
    "file:///C:/Users/someone/Videos/private.mp4",
    "C:\\Users\\someone\\Videos\\private.mp4",
    "/etc/passwd",
    "ftp://example.com/talk.mp4",
    "javascript:alert(1)",
    "not a url at all",
  ]) {
    assert.equal(isFetchableVideoUrl(bad), false, `${bad} was treated as fetchable`);
    const validated = validateShortsRequest(request({ source: { kind: "url", url: bad } }));
    assert.equal(validated.ok, false, `${bad} passed validation`);
  }
});

test("an upload id has to look like one — no path traversal through it", () => {
  for (const bad of ["../../secret", "a".repeat(31), "A".repeat(32), "", "a/b"]) {
    const validated = validateShortsRequest(
      request({ source: { kind: "upload", uploadId: bad, filename: "x.mp4" } }),
    );
    assert.equal(validated.ok, false, `${bad} passed as an upload id`);
  }
});

test("unknown or out-of-range options fall back rather than failing the run", () => {
  const validated = validateShortsRequest(
    request({ clipCount: 999, aspectRatio: "3:2", resolution: "4320" }),
  );
  assert.ok(validated.ok);
  assert.equal(validated.request.clipCount, MAX_SHORTS_CLIPS);
  assert.equal(validated.request.aspectRatio, "9:16");
  assert.equal(validated.request.resolution, "720");

  assert.equal(clampClipCount(0), 1);
  assert.equal(clampClipCount("4"), 4);
  assert.equal(clampClipCount("not a number"), 3);
});

test("a half-typed language code is refused rather than passed to Whisper", () => {
  const bad = validateShortsRequest(request({ language: "e" }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /two-letter/i);

  const empty = validateShortsRequest(request({ language: "" }));
  assert.ok(empty.ok);
  assert.equal(empty.request.language, "");

  const good = validateShortsRequest(request({ language: "NL" }));
  assert.ok(good.ok);
  assert.equal(good.request.language, "nl");
});

test("the user half of the turn is rendered from the request, never parsed into one", () => {
  const message = shortsUserMessage({
    source: url("https://youtu.be/abc"),
    clipCount: 3,
    aspectRatio: "9:16",
    resolution: "720",
    language: "",
  });
  assert.ok(message.startsWith(`${SHORTS_COMMAND} `));
  assert.match(message, /3 clips/);
  assert.match(message, /9:16/);
  assert.match(message, /720p/);

  // An uploaded file is named by its filename; there is no link to show and no
  // path that should ever appear in a transcript.
  const uploaded = shortsUserMessage({
    source: { kind: "upload", uploadId: "b".repeat(32), filename: "keynote.mp4" },
    clipCount: 1,
    aspectRatio: "1:1",
    resolution: "1080",
    language: "",
  });
  assert.match(uploaded, /keynote\.mp4/);
  assert.match(uploaded, /1 clip\b/);
  assert.doesNotMatch(uploaded, /1080p/);
  assert.doesNotMatch(uploaded, /b{32}/);
});

test("the run label is short enough to sit in a conversation list", () => {
  const label = shortsRunLabel({
    source: url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    clipCount: 3,
    aspectRatio: "9:16",
    resolution: "720",
    language: "",
  });
  assert.doesNotMatch(label, /^https?:\/\//);
  assert.match(label, /3 × 9:16/);
});

test("a typed command pre-fills the form and never becomes a prompt", () => {
  assert.equal(parseShortsCommand("make me some clips"), null);
  assert.equal(parseShortsCommand("/agents:vimax a film"), null);

  const bare = parseShortsCommand(SHORTS_COMMAND);
  assert.ok(bare);
  assert.deepEqual(bare.partial, {});

  const full = parseShortsCommand(
    `${SHORTS_COMMAND} https://youtu.be/abc123 · 5 clips · 1:1 · 1080p`,
  );
  assert.ok(full);
  assert.deepEqual(full.partial.source, { kind: "url", url: "https://youtu.be/abc123" });
  assert.equal(full.partial.clipCount, 5);
  assert.equal(full.partial.aspectRatio, "1:1");
  assert.equal(full.partial.resolution, "1080");

  // Prose around the token is dropped, not carried: this agent has nowhere to
  // put a sentence, and a silently forwarded one would be read as nothing.
  const prose = parseShortsCommand(`${SHORTS_COMMAND} please make it funny and viral`);
  assert.ok(prose);
  assert.equal(prose.partial.source, undefined);
  assert.equal(prose.partial.clipCount, undefined);

  // A stacked capability token in front still selects the agent, so the
  // conflict check downstream sees the same message the user sent.
  const stacked = parseShortsCommand(`/my-skill ${SHORTS_COMMAND} https://youtu.be/x`);
  assert.ok(stacked);
});

test("a local path typed into the command is not turned into a source", () => {
  const attempt = parseShortsCommand(`${SHORTS_COMMAND} file:///C:/Users/me/private.mp4`);
  assert.ok(attempt);
  assert.equal(attempt.partial.source, undefined);
});

test("stored defaults translate into the request's own vocabulary", async () => {
  const { shortsDefaults } = await import("../src/lib/agent-settings/defaults.ts");
  const { findConfigurableAgent, agentSettingDefaults } = await import(
    "../src/lib/agent-settings/catalog.ts"
  );

  const agent = findConfigurableAgent(SHORTS_AGENT_ID);
  assert.ok(agent, "Shorts has no settings entry");
  assert.equal(agent.command, SHORTS_COMMAND);

  const shipped = shortsDefaults(agentSettingDefaults(agent));
  assert.deepEqual(shipped, {
    clipCount: 3,
    aspectRatio: "9:16",
    resolution: "720",
    whisperModel: "base",
    language: "",
  });

  // Anything unrecognised falls back rather than reaching a run: a stored
  // value is not a promise that the option still exists.
  assert.deepEqual(
    shortsDefaults({ clips: "many", aspectRatio: "3:2", whisperModel: "huge", language: "e" }),
    {
      clipCount: 3,
      aspectRatio: "9:16",
      resolution: "720",
      whisperModel: "base",
      language: "",
    },
  );
});

test("both sides of the bridge agree on the events they exchange", () => {
  const bridge = read("scripts/shorts-bridge.py", repositoryRoot);
  const manager = read("src/lib/shorts/run-manager.ts");
  const card = read("src/app/components/hermes/inline-shorts-run.tsx");

  // What the bridge emits, and what the manager translates.
  for (const emitted of ["stage", "source", "transcript", "highlights", "clip", "completed", "failed"]) {
    assert.match(
      bridge,
      new RegExp(`emit\\(\\s*"${emitted}"`),
      `the bridge never emits ${emitted}`,
    );
    assert.match(
      manager,
      new RegExp(`type === "${emitted}"`),
      `the run manager ignores the bridge's ${emitted} event`,
    );
  }

  // What the manager publishes, and what the card listens for.
  for (const published of [
    "run.started",
    "stage.updated",
    "transcript.ready",
    "highlights.ready",
    "clip.cut",
    "run.completed",
    "run.failed",
    "run.aborted",
  ]) {
    assert.ok(manager.includes(`"${published}"`), `the run manager never emits ${published}`);
    assert.ok(card.includes(`"${published}"`), `the card never handles ${published}`);
  }

  // The stage keys the card lamps have to be the ones the bridge names, or the
  // list sits on "pending" for a run that is working.
  for (const stage of ["download", "transcribe", "highlights", "clip"]) {
    assert.match(bridge, new RegExp(`stage\\("${stage}"`), `the bridge never reports ${stage}`);
    assert.match(card, new RegExp(`key: "${stage}"`), `the card has no ${stage} stage`);
  }
});

test("the run reaches ChatMock and never a second model layer", () => {
  const manager = read("src/lib/shorts/run-manager.ts");
  const route = read("src/app/api/shorts/runs/route.ts");
  assert.match(route, /resolveChatmockBaseUrl\(request\)/);
  // The clone's own OpenAI client reads these, which is what lets it run on
  // Breadboard's models without editing the checkout.
  assert.match(manager, /OPENAI_BASE_URL:/);
  assert.match(manager, /OPENAI_API_KEY: input\.apiKey/);
  assert.match(manager, /LLM_PROVIDER: "openai"/);
  assert.match(manager, /startOuterAgentRun/);
  assert.match(manager, /kind: "shorts"/);
  // MuAPI is the clone's paid default; nothing here may reach for it.
  assert.doesNotMatch(manager, /MUAPI/i);
});

test("a run installs nothing — only the setup route can", () => {
  const manager = read("src/lib/shorts/run-manager.ts");
  assert.doesNotMatch(manager, /pip install|uv (?:pip|venv)/);
  const setup = read("src/lib/shorts/setup.ts");
  const worker = read("scripts/runtime-v2-managed-setup-executor.mjs");
  assert.doesNotMatch(setup, /node:child_process|\bspawn\s*\(|runCommand/);
  assert.match(worker, /requirements-local\.txt/);
});

test("the upload store keeps one user's videos out of another's reach", async () => {
  const { resolveUpload } = await import("../src/lib/shorts/uploads.ts");
  const uploads = read("src/lib/shorts/uploads.ts");
  // The user id is part of the path, so the lookup only ever looks in the
  // caller's own directory — an id that leaks still resolves to nothing.
  assert.match(uploads, /userRoot\(userId\)/);
  assert.equal(resolveUpload(999_999, "../../etc/passwd"), null);
  assert.equal(resolveUpload(999_999, "c".repeat(32)), null);
});
