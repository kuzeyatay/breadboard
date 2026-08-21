// Automatic rewriting, against a real database and a fake sidecar.
//
// The switch makes rewriting a standing instruction, which moves the risk. So
// the things worth pinning are the preservation gates: it only runs for a user
// who asked, it never fails the write it is decorating, and it leaves the text
// alone whenever the rewriter cannot vouch for the result.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-humanizer-auto-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const settings = await import("../src/lib/hermes/runtime-store.ts");
const auto = await import("../src/lib/humanizer/auto-server.ts");

const LONG_ENOUGH =
  "It is important to note that this solution serves as a testament to the " +
  "transformative power of innovation, and that it represents a groundbreaking " +
  "step forward in the rapidly evolving landscape of local knowledge software " +
  "for teams of every conceivable size and shape.";

let server;
let respond = () => ({ status: 200, body: {} });
const seen = [];

before(async () => {
  server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      seen.push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      const answer = respond();
      const payload = JSON.stringify(answer.body);
      response.writeHead(answer.status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      response.end(payload);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.HUMANIZER_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.HUMANIZER_SERVICE_SECRET = "auto-test-secret";
});

after(() => {
  server?.close();
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  seen.length = 0;
  db.exec("DELETE FROM hermes_user_settings; DELETE FROM users;");
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

function rewriteBody(overrides = {}) {
  return {
    requestId: "auto-1",
    status: "complete",
    modelId: "cive202/humanize-ai-text-bart-large",
    modelRevision: "main",
    device: "cpu",
    dtype: "float32",
    originalText: LONG_ENOUGH,
    rewrittenText: "A short, plainer version of the same paragraph goes here instead.",
    chunks: { total: 2, rewritten: 2, reverted: 0 },
    preservation: { passed: true, warnings: [] },
    timingMs: { load: 0, inference: 10, total: 12 },
    ...overrides,
  };
}

test("the preference defaults to off, so nothing is rewritten unasked", async () => {
  assert.equal(settings.getHermesUserSettings(1).humanizerAuto, false);
  assert.equal(auto.humanizerAutoEnabled(1), false);
  const result = await auto.humanizeStoredText(1, LONG_ENOUGH, "artifact");
  assert.equal(result.humanized, false);
  assert.equal(result.text, LONG_ENOUGH);
  assert.equal(seen.length, 0, "the sidecar must not be called at all");
});

test("with the preference on, the text is rewritten", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  respond = () => ({ status: 200, body: rewriteBody() });
  const result = await auto.humanizeStoredText(1, LONG_ENOUGH, "artifact");
  assert.equal(result.humanized, true);
  assert.match(result.text, /plainer version/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, LONG_ENOUGH);
});

test("the preference survives a round trip through the settings store", () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  assert.equal(settings.getHermesUserSettings(1).humanizerAuto, true);
  // Setting something unrelated must not clear it.
  settings.setHermesUserSettings(1, { reasoningEffort: "low" });
  assert.equal(settings.getHermesUserSettings(1).humanizerAuto, true);
  settings.setHermesUserSettings(1, { humanizerAuto: false });
  assert.equal(settings.getHermesUserSettings(1).humanizerAuto, false);
});

test("a preservation failure leaves the text exactly as it was", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  respond = () => ({
    status: 200,
    body: rewriteBody({
      status: "preservation_failed",
      preservation: { passed: false, warnings: [] },
    }),
  });
  const result = await auto.humanizeStoredText(1, LONG_ENOUGH, "garden_note");
  assert.equal(result.humanized, false);
  assert.equal(result.text, LONG_ENOUGH);
});

test("an unavailable or busy rewriter never fails the write", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  for (const answer of [
    { status: 503, body: { error: "humanizer_busy" } },
    { status: 409, body: { error: "humanizer_model_not_installed" } },
    { status: 500, body: { error: "humanizer_service_error" } },
  ]) {
    respond = () => answer;
    const result = await auto.humanizeStoredText(1, LONG_ENOUGH, "artifact");
    assert.equal(result.humanized, false, JSON.stringify(answer));
    assert.equal(result.text, LONG_ENOUGH);
  }
  // And with nothing listening at all.
  const url = process.env.HUMANIZER_SERVICE_URL;
  process.env.HUMANIZER_SERVICE_URL = "http://127.0.0.1:1";
  try {
    const result = await auto.humanizeStoredText(1, LONG_ENOUGH, "artifact");
    assert.equal(result.humanized, false);
    assert.equal(result.text, LONG_ENOUGH);
  } finally {
    process.env.HUMANIZER_SERVICE_URL = url;
  }
});

test("short and very long text is left alone without calling the service", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  respond = () => ({ status: 200, body: rewriteBody() });

  const short = "Too short to bother with.";
  assert.equal((await auto.humanizeStoredText(1, short, "artifact")).text, short);

  // Long enough to hold the single inference lock for minutes.
  const huge = LONG_ENOUGH.repeat(200);
  assert.equal((await auto.humanizeStoredText(1, huge, "artifact")).text, huge);
  assert.equal(seen.length, 0, "neither should have reached the sidecar");
});

test("an unchanged rewrite is not treated as a rewrite", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  respond = () => ({ status: 200, body: rewriteBody({ rewrittenText: LONG_ENOUGH }) });
  const result = await auto.humanizeStoredText(1, LONG_ENOUGH, "artifact");
  assert.equal(result.humanized, false);
  assert.equal(result.text, LONG_ENOUGH);
});

test("turning the humanizer off entirely outranks the preference", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  process.env.HUMANIZER_MODE = "disabled";
  try {
    assert.equal(auto.humanizerAutoEnabled(1), false);
    const result = await auto.humanizeStoredText(1, LONG_ENOUGH, "artifact");
    assert.equal(result.humanized, false);
    assert.equal(seen.length, 0);
  } finally {
    delete process.env.HUMANIZER_MODE;
  }
});
