import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-learn-humanizer-db-"));
const gardenRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-learn-humanizer-garden-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const { default: db } = await import("../src/lib/db.ts");
const settings = await import("../src/lib/hermes/runtime-store.ts");
const {
  humanizeFinishedLearnBuild,
  readLearnHumanizerVersionState,
  restoreLearnAiCopy,
} = await import("../src/lib/learn-humanizer.ts");

const AIISH =
  "It is important to note that this solution serves as a testament to the " +
  "transformative power of innovation, and that it represents a groundbreaking " +
  "step forward in the rapidly evolving landscape of local knowledge software " +
  "for teams of every conceivable size and shape.";
const NATURAL =
  "This local knowledge tool helps teams organize and use their shared work. " +
  "It keeps the process straightforward, so people can find what they need and move on.";
const PAGE = `---\ntitle: Lesson\n---\n# Lesson\n\n${AIISH}\n`;

let server;
let requestCount = 0;

before(async () => {
  server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requestCount += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const rewrittenText = String(body.text ?? "").replace(AIISH, NATURAL);
      const payload = JSON.stringify({
        requestId: body.requestId,
        status: "complete",
        modelId: "test-humanizer",
        modelRevision: "test",
        device: "cpu",
        dtype: "float32",
        originalText: body.text,
        rewrittenText,
        chunks: { total: 1, rewritten: 1, reverted: 0 },
        preservation: { passed: true, warnings: [] },
        timingMs: { load: 0, inference: 1, total: 1 },
      });
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      response.end(payload);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.HUMANIZER_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.HUMANIZER_SERVICE_SECRET = "learn-humanizer-test-secret";
});

after(() => {
  server?.close();
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.rmSync(gardenRoot, { recursive: true, force: true });
});

beforeEach(() => {
  requestCount = 0;
  fs.rmSync(gardenRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(gardenRoot, "learning", "01 Intro"), { recursive: true });
  fs.mkdirSync(path.join(gardenRoot, ".breadboard", "planning"), { recursive: true });
  fs.writeFileSync(path.join(gardenRoot, "learning", "01 Intro", "Lesson.md"), PAGE);
  fs.writeFileSync(
    path.join(gardenRoot, ".breadboard", "planning", "Source Map.md"),
    PAGE,
  );
  db.exec("DELETE FROM hermes_user_settings; DELETE FROM users;");
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
});

test("Learn does nothing when Rewrite naturally is off", async () => {
  let validated = false;
  const outcome = await humanizeFinishedLearnBuild({
    userId: 1,
    gardenDir: gardenRoot,
    validate: () => {
      validated = true;
      return { accepted: true };
    },
  });

  assert.equal(outcome.requested, false);
  assert.equal(outcome.reason, "preference_off");
  assert.equal(requestCount, 0);
  assert.equal(validated, false);
  assert.equal(
    fs.readFileSync(path.join(gardenRoot, "learning", "01 Intro", "Lesson.md"), "utf8"),
    PAGE,
  );
});

test("Learn humanizes only finished learner Markdown and validates before adoption", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  let validatedText = "";
  const outcome = await humanizeFinishedLearnBuild({
    userId: 1,
    gardenDir: gardenRoot,
    validate: () => {
      validatedText = fs.readFileSync(
        path.join(gardenRoot, "learning", "01 Intro", "Lesson.md"),
        "utf8",
      );
      return { accepted: true };
    },
  });

  assert.equal(outcome.adopted, true);
  assert.equal(outcome.adoptedFiles, 1);
  assert.match(validatedText, /helps teams organize/);
  assert.equal(requestCount, 1);
  assert.equal(
    fs.readFileSync(
      path.join(gardenRoot, ".breadboard", "planning", "Source Map.md"),
      "utf8",
    ),
    PAGE,
    "internal planning artifacts must never be rewritten",
  );
});

test("Learn restores every original byte when final verification rejects a rewrite", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  const outcome = await humanizeFinishedLearnBuild({
    userId: 1,
    gardenDir: gardenRoot,
    validate: () => ({ accepted: false, problems: ["strict check failed"] }),
  });

  assert.equal(outcome.adopted, false);
  assert.equal(outcome.reason, "validation_failed");
  assert.deepEqual(outcome.validationProblems, ["strict check failed"]);
  assert.equal(
    fs.readFileSync(path.join(gardenRoot, "learning", "01 Intro", "Lesson.md"), "utf8"),
    PAGE,
  );
});

test("a completed humanized Learn version can switch back to its saved AI copy", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  const versionId = "learning_test_version";
  const humanized = await humanizeFinishedLearnBuild({
    userId: 1,
    gardenDir: gardenRoot,
    versionId,
    validate: () => ({ accepted: true }),
  });

  assert.equal(humanized.adopted, true);
  assert.equal(
    readLearnHumanizerVersionState(gardenRoot, versionId).activeCopy,
    "humanized",
  );
  assert.match(
    fs.readFileSync(path.join(gardenRoot, "learning", "01 Intro", "Lesson.md"), "utf8"),
    /helps teams organize/,
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        gardenRoot,
        ".breadboard",
        "humanizer",
        versionId,
        "ai",
        "learning",
        "01 Intro",
        "Lesson.md",
      ),
      "utf8",
    ),
    PAGE,
  );

  const restored = restoreLearnAiCopy({
    gardenDir: gardenRoot,
    versionId,
    validate: () => ({ accepted: true }),
  });

  assert.equal(restored.restored, true);
  assert.equal(
    fs.readFileSync(path.join(gardenRoot, "learning", "01 Intro", "Lesson.md"), "utf8"),
    PAGE,
  );
  assert.deepEqual(
    readLearnHumanizerVersionState(gardenRoot, versionId),
    {
      schemaVersion: 1,
      versionId,
      requested: false,
      activeCopy: "ai",
      status: "ai",
      reason: "restored",
      updatedAt: readLearnHumanizerVersionState(gardenRoot, versionId).updatedAt,
    },
  );
});

test("a rejected AI-copy restore leaves the completed humanized copy intact", async () => {
  settings.setHermesUserSettings(1, { humanizerAuto: true });
  const versionId = "learning_rejected_restore";
  await humanizeFinishedLearnBuild({
    userId: 1,
    gardenDir: gardenRoot,
    versionId,
    validate: () => ({ accepted: true }),
  });
  const humanizedPage = fs.readFileSync(
    path.join(gardenRoot, "learning", "01 Intro", "Lesson.md"),
    "utf8",
  );

  const restored = restoreLearnAiCopy({
    gardenDir: gardenRoot,
    versionId,
    validate: () => ({ accepted: false, problems: ["AI copy rejected"] }),
  });

  assert.equal(restored.restored, false);
  assert.equal(restored.reason, "validation_failed");
  assert.deepEqual(restored.validationProblems, ["AI copy rejected"]);
  assert.equal(
    fs.readFileSync(path.join(gardenRoot, "learning", "01 Intro", "Lesson.md"), "utf8"),
    humanizedPage,
  );
  assert.equal(
    readLearnHumanizerVersionState(gardenRoot, versionId).activeCopy,
    "humanized",
  );
});
