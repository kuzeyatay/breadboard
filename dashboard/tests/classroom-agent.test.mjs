// Classroom: the parts of a lesson run that are decided before OpenMAIC is
// called, and the boundaries that fail silently when they drift.
//
// The first boundary is the clone. Breadboard drives OpenMAIC over three HTTP
// routes and reads a handful of fields off their answers; nothing would fail to
// compile if upstream renamed one, the run would just stop working. So this
// file reads the clone and asserts the routes and fields this integration
// stands on. The second is the event protocol: the run manager emits event
// names and the inline card subscribes to them by name, and a name emitted but
// not subscribed to is a card that quietly stops updating.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLASSROOM_AGENT_ID,
  CLASSROOM_COMMAND,
  classroomIdFromText,
  classroomOpenPath,
  classroomUserMessage,
  describeClassroomRequest,
  isClassroomId,
  parseClassroomRequest,
  taskFromClassroomCommand,
} from "../src/lib/classroom/identity.ts";
import { classroomDefaults } from "../src/lib/agent-settings/defaults.ts";
import { CONFIGURABLE_AGENTS } from "../src/lib/agent-settings/catalog.ts";
import { serviceEnvironment } from "../src/lib/classroom/service.ts";
import {
  applyImporterBuildFix,
  ensureClassroomDataLink,
  installEnvironment,
  writePnpmShims,
} from "../src/lib/classroom/setup.ts";
import {
  classroomSummary,
  materialFromAttachments,
} from "../src/lib/classroom/run-manager.ts";
import {
  EXTERNAL_AGENT_RUN_FIELD_BY_KIND,
  EXTERNAL_AGENT_RUN_KINDS,
  parseExternalAgentRun,
} from "../src/lib/conversations/external-agent-runs.ts";
import { RUNTIME_AGENT_PROFILES } from "../src/lib/hermes/capability-combinations.ts";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
const cloneRoot = path.join(dashboardRoot, "..", "openmaic");
const cloneSource = (relative) => fs.readFileSync(path.join(cloneRoot, relative), "utf8");
const cloneAvailable = fs.existsSync(path.join(cloneRoot, "package.json"));

test("the command parser recognises the token, keeps stacked tokens, and leaves prose alone", () => {
  assert.equal(taskFromClassroomCommand("hello"), null);
  assert.equal(taskFromClassroomCommand("/agents:classroom"), "");
  assert.equal(taskFromClassroomCommand("/agents:classroom   teach me Fourier series"), "teach me Fourier series");
  assert.equal(
    taskFromClassroomCommand("/study-guide /agents:classroom the French Revolution"),
    "/study-guide the French Revolution",
  );
  assert.equal(taskFromClassroomCommand("/AGENTS:CLASSROOM upper case"), "upper case");
  assert.equal(classroomUserMessage("  photosynthesis "), `${CLASSROOM_COMMAND} photosynthesis`);
  assert.equal(classroomUserMessage(""), CLASSROOM_COMMAND);
});

test("flags typed in the message win over stored defaults, and both spellings exist", () => {
  const stored = { tts: true, images: true, webSearch: true, agentMode: "generate" };
  const quiet = parseClassroomRequest("--no-tts --no-images --no-search --mode default the water cycle", stored);
  assert.deepEqual(quiet, {
    brief: "the water cycle",
    tts: false,
    images: false,
    webSearch: false,
    agentMode: "default",
  });
  const loud = parseClassroomRequest("the water cycle --tts --images --search --mode=generate");
  assert.deepEqual(loud, {
    brief: "the water cycle",
    tts: true,
    images: true,
    webSearch: true,
    agentMode: "generate",
  });
  // An unknown mode is prose, not a flag.
  assert.equal(parseClassroomRequest("--mode fast trig").brief, "--mode fast trig");
  assert.equal(parseClassroomRequest("a".repeat(30_000)).brief.length, 20_000);
});

test("the request description names what the lesson is made of", () => {
  assert.equal(describeClassroomRequest(parseClassroomRequest("x")), "slides, quizzes, simulations");
  assert.equal(
    describeClassroomRequest(parseClassroomRequest("x --tts --images --search --mode generate")),
    "narrated · illustrated · web-grounded · agent mode",
  );
});

test("stored settings translate field by field and fall back on junk", () => {
  assert.deepEqual(classroomDefaults({}), {
    tts: false,
    images: false,
    webSearch: false,
    agentMode: "default",
  });
  assert.deepEqual(classroomDefaults({ tts: true, agentMode: "generate", images: "yes" }), {
    tts: true,
    images: false,
    webSearch: false,
    agentMode: "generate",
  });
  assert.equal(classroomDefaults({ agentMode: "turbo" }).agentMode, "default");
  const entry = CONFIGURABLE_AGENTS.find((agent) => agent.id === CLASSROOM_AGENT_ID);
  assert.ok(entry, "Classroom has no settings catalog entry");
  assert.equal(entry.command, CLASSROOM_COMMAND);
  assert.deepEqual(
    entry.fields.map((field) => field.key).sort(),
    ["agentMode", "images", "tts", "webSearch"],
  );
  for (const field of entry.fields) assert.ok(field.flag, `${field.key} records no inline flag`);
});

test("a classroom link is Breadboard's own route and survives a round trip through a summary", () => {
  assert.equal(classroomOpenPath("abc_123"), "/api/classroom/classrooms/abc_123");
  assert.ok(isClassroomId("V1StGXR8_Z"));
  assert.ok(!isClassroomId("../etc"));
  assert.ok(!isClassroomId(""));
  const summary = classroomSummary({
    classroomId: "V1StGXR8_Z",
    scenesCount: 7,
    request: parseClassroomRequest("the Krebs cycle --tts"),
    artifactSaved: true,
  });
  assert.match(summary, /7 scenes, narrated/);
  assert.match(summary, /filed as an artifact/);
  assert.equal(classroomIdFromText(summary), "V1StGXR8_Z");
  assert.equal(classroomIdFromText("nothing here"), null);
});

test("attachments become OpenMAIC's material: text from documents, images as data URLs", () => {
  assert.equal(materialFromAttachments([]), null);
  assert.equal(materialFromAttachments([{ type: "video", name: "v", blobId: "b", format: "mp4" }]), null);
  const material = materialFromAttachments([
    { type: "document", name: "notes.pdf", blobId: "d1", format: "pdf", text: "Chapter one." },
    { type: "text", name: "pasted", text: "Some pasted text." },
    { type: "image", name: "fig.png", dataUrl: "data:image/png;base64,AAAA" },
  ]);
  assert.ok(material);
  assert.match(material.text, /## notes\.pdf\n\nChapter one\./);
  assert.match(material.text, /## pasted\n\nSome pasted text\./);
  assert.deepEqual(material.images, ["data:image/png;base64,AAAA"]);
});

test("the OpenMAIC server runs on ChatMock and inherits none of the dashboard's vendor keys", () => {
  const env = serviceEnvironment(
    { upstreamUrl: "http://127.0.0.1:8765/v1/", model: "cliproxy/claude-sonnet-5" },
    4031,
    {
      PATH: "/bin",
      ANTHROPIC_API_KEY: "leak",
      OPENAI_API_KEY: "dashboard-placeholder",
      CHATMOCK_API_KEY: "token",
      ACCESS_CODE: "secret",
      DATABASE_URL: "postgres://x",
    },
  );
  assert.equal(env.OPENAI_BASE_URL, "http://127.0.0.1:8765/v1");
  assert.equal(env.OPENAI_API_KEY, "token");
  assert.equal(env.DEFAULT_MODEL, "openai:cliproxy/claude-sonnet-5");
  assert.equal(env.OPENAI_MODELS, "cliproxy/claude-sonnet-5");
  assert.equal(env.OPENAI_COMPAT_USE_STREAMING_CHAT, "true");
  assert.equal(env.PORT, "4031");
  assert.equal(env.HOSTNAME, "127.0.0.1");
  assert.match(env.ALLOWED_FRAME_ANCESTORS, /127\.0\.0\.1:\*/);
  // The same allowance reaches the BUILD, where OpenMAIC actually reads it.
  const build = installEnvironment("C:/tools", { PATH: "/bin" });
  assert.equal(build.ALLOWED_FRAME_ANCESTORS, env.ALLOWED_FRAME_ANCESTORS);
  assert.match(build.PATH, /^C:\/tools[;:]\/bin$/);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ACCESS_CODE, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.PATH, "/bin");
});

test("setup's Windows build fix touches one option in the importer's rollup config, once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-setup-"));
  const config = path.join(root, "packages", "@openmaic", "importer", "rollup.config.js");
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, "const plugins = [\n  json(),\n  globals(),\n  builtins(),\n];\n");
  assert.equal(applyImporterBuildFix(root, "linux"), false);
  assert.match(fs.readFileSync(config, "utf8"), /globals\(\),/);
  assert.equal(applyImporterBuildFix(root, "win32"), true);
  assert.match(fs.readFileSync(config, "utf8"), /globals\(\{ baseDir: process\.cwd\(\) \}\),/);
  assert.equal(applyImporterBuildFix(root, "win32"), true);
  assert.equal(fs.readFileSync(config, "utf8").split("baseDir").length, 2);

  const tools = path.join(root, "tools");
  writePnpmShims(tools, "C:/node/corepack.js", "C:/node/node.exe");
  assert.match(fs.readFileSync(path.join(tools, "pnpm.cmd"), "utf8"), /"C:\/node\/node\.exe" "C:\/node\/corepack\.js" pnpm %\*/);
  assert.match(fs.readFileSync(path.join(tools, "pnpm"), "utf8"), /exec "C:\/node\/node\.exe" "C:\/node\/corepack\.js" pnpm "\$@"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the runtime copy's data directory is a link to storage a rebuild cannot delete", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classroom-data-"));
  const runtime = path.join(root, "runtime");
  const stable = path.join(root, "stable");
  const link = path.join(runtime, "data");
  // A real directory from before the link existed carries its files over.
  fs.mkdirSync(path.join(link, "classrooms"), { recursive: true });
  fs.writeFileSync(path.join(link, "classrooms", "abc.json"), "{}");
  ensureClassroomDataLink(link, stable);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(stable, "classrooms", "abc.json")));
  // Writing through the link lands in stable storage, and a second call is a no-op.
  fs.writeFileSync(path.join(link, "classrooms", "def.json"), "{}");
  assert.ok(fs.existsSync(path.join(stable, "classrooms", "def.json")));
  ensureClassroomDataLink(link, stable);
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  // Replacing the runtime and relinking keeps every classroom.
  fs.rmSync(runtime, { recursive: true, force: true });
  ensureClassroomDataLink(link, stable);
  assert.ok(fs.existsSync(path.join(link, "classrooms", "abc.json")));
  fs.rmSync(root, { recursive: true, force: true });
});

test("the run kind is registered everywhere a card has to come back from", () => {
  assert.ok(EXTERNAL_AGENT_RUN_KINDS.includes("classroom"));
  assert.equal(EXTERNAL_AGENT_RUN_FIELD_BY_KIND.classroom, "classroomRun");
  assert.deepEqual(parseExternalAgentRun({ kind: "classroom", runId: "r1", brief: "teach" }), {
    kind: "classroom",
    runId: "r1",
    brief: "teach",
  });
  assert.equal(parseExternalAgentRun({ kind: "classroom", runId: "r1" }), null);
  const profile = RUNTIME_AGENT_PROFILES.find((agent) => agent.id === CLASSROOM_AGENT_ID);
  assert.ok(profile);
  assert.equal(profile.command, CLASSROOM_COMMAND);
  assert.equal(profile.acceptsAttachments, true);
  assert.equal(profile.stacksCapabilities, false);
});

test("the card subscribes to every event the run manager emits", () => {
  const manager = source("src/lib/classroom/run-manager.ts");
  const card = source("src/app/components/hermes/inline-classroom-run.tsx");
  const emitted = new Set(
    [...manager.matchAll(/emit\(run, "([a-z.]+)"/g)].map((match) => match[1]),
  );
  // `finish` emits run.completed / run.failed through a ternary.
  emitted.add("run.completed");
  emitted.add("run.failed");
  const subscribed = new Set([...card.matchAll(/^\s+"([a-z.]+)",$/gm)].map((match) => match[1]));
  for (const type of emitted) {
    assert.ok(subscribed.has(type), `the card never subscribes to ${type}`);
  }
  // A reopened card must not stream, must close on error, and must read what was saved.
  assert.match(card, /if \(replaying\) return;/);
  assert.match(card, /source\.onerror = \(\) => source\.close\(\);/);
  assert.match(card, /persistedContent/);
});

test("the routes keep the shape every agent's routes share", () => {
  const runs = source("src/app/api/classroom/runs/route.ts");
  assert.match(runs, /requireUserId\(\)/);
  assert.match(runs, /resolveChatmockBaseUrl\(request\)/);
  assert.match(runs, /agentSettingsFor\(userId, CLASSROOM_AGENT_ID\)/);
  assert.match(runs, /conversationContext: conversationContextFromBody\(userId, body\)/);
  assert.match(runs, /await startRun\(/);
  assert.match(source("src/app/api/classroom/runs/[runId]/events/route.ts"), /outerAgentEventsResponse/);
  assert.match(source("src/app/api/classroom/runs/[runId]/abort/route.ts"), /await abortRun\(/);
  // Setup is a button, never a run.
  assert.doesNotMatch(source("src/lib/classroom/run-manager.ts"), /startClassroomSetup/);
});

test(
  "the clone still exposes the routes and fields this integration stands on",
  { skip: cloneAvailable ? false : "openmaic/ is not cloned here" },
  () => {
    const start = cloneSource("app/api/generate-classroom/route.ts");
    assert.match(start, /rawBody\.requirement/);
    assert.match(start, /rawBody\.pdfContent/);
    assert.match(start, /enableTTS/);
    assert.match(start, /enableImageGeneration/);
    assert.match(start, /enableWebSearch/);
    assert.match(start, /agentMode/);
    assert.match(start, /jobId,/);
    assert.match(start, /pollIntervalMs/);
    const poll = cloneSource("app/api/generate-classroom/[jobId]/route.ts");
    for (const field of ["status", "step", "progress", "message", "scenesGenerated", "totalScenes", "result", "error", "done"]) {
      assert.match(poll, new RegExp(`\\b${field}\\b`), `job poll no longer reports ${field}`);
    }
    const store = cloneSource("lib/server/classroom-job-store.ts");
    assert.match(store, /classroomId: string;/);
    assert.match(store, /scenesCount: number;/);
    const storage = cloneSource("lib/server/classroom-storage.ts");
    assert.match(storage, /\/classroom\/\$\{data\.id\}/);
    assert.match(storage, /path\.join\(process\.cwd\(\), 'data', 'classrooms'\)/);
    const read = cloneSource("app/api/classroom/route.ts");
    assert.match(read, /searchParams\.get\('id'\)/);
    // The model layer: OpenAI-compatible base URL and the streaming-chat switch.
    const env = cloneSource(".env.example");
    for (const name of ["OPENAI_BASE_URL", "OPENAI_MODELS", "OPENAI_COMPAT_USE_STREAMING_CHAT", "DEFAULT_MODEL", "ALLOWED_FRAME_ANCESTORS"]) {
      assert.match(env + cloneSource("next.config.ts"), new RegExp(name), `${name} is no longer read by the clone`);
    }
    // The Windows build fix still has something to fix.
    assert.match(cloneSource("packages/@openmaic/importer/rollup.config.js"), /\bglobals\(\)/);
    // Every step the clone can report has a label on the card, so a new step
    // shows as words rather than as its identifier.
    const union = cloneSource("lib/server/classroom-generation.ts").match(
      /export type ClassroomGenerationStep =([\s\S]*?);/,
    );
    assert.ok(union, "the clone no longer declares ClassroomGenerationStep");
    const steps = [...union[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    assert.ok(steps.length >= 5);
    const card = source("src/app/components/hermes/inline-classroom-run.tsx");
    const labels = card.match(/const STEP_LABEL: Record<string, string> = \{([\s\S]*?)\};/);
    assert.ok(labels);
    for (const step of steps) {
      assert.match(labels[1], new RegExp(`^\\s+${step}: "`, "m"), `the card has no label for ${step}`);
    }
  },
);
