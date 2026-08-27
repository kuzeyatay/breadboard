// watermarks-remover, wired as agent tools.
//
// Two halves, like the Office suite. The wiring half guards the failure this
// repo has hit before: a tool wired on the Breadboard side but never registered
// with the runtime, so the model is never offered it. The behaviour half runs
// the vendored Python for real — containment, the text round-trip, the file
// round-trip and the audit — because the whole point of this integration is
// that the scripts actually execute, and a mocked test would prove nothing
// about the one thing that can break.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import {
  WATERMARK_TOOLS,
  WATERMARK_WRITE_TOOLS,
  allowedToolsForSurface,
} from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  WatermarkError,
  containWorkspacePath,
  cloneRoot,
  scriptsAvailable,
} from "../src/lib/watermarks/scripts.ts";
import {
  auditWorkspace,
  cleanSource,
  inspectSource,
  resolveSource,
  watermarkWorkspaceFor,
} from "../src/lib/watermarks/agent-query.ts";
import { selectAttachment } from "../src/lib/watermarks/attachments.ts";
import { createWatermarkRuntimeFixture } from "./helpers/watermark-runtime-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const runtime = createWatermarkRuntimeFixture();
after(() => runtime.cleanup());

function makeWorkspace() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "watermark-tools-test-")));
}

/** A zero-width space and a word joiner — two carriers the cleaner removes. */
const MARKED_TEXT = "Hello​world, this⁠is a draft.\n";

// ── wiring ──────────────────────────────────────────────────────────────────

test("the family exposes exactly the intended tools", () => {
  assert.deepEqual([...WATERMARK_TOOLS].sort(), [
    "watermark_audit",
    "watermark_clean",
    "watermark_inspect",
  ]);
  assert.deepEqual([...WATERMARK_WRITE_TOOLS], ["watermark_clean"]);
});

test("Quartz AI never receives them; the authenticated surfaces do", () => {
  const quartz = allowedToolsForSurface("quartz_ai");
  for (const tool of WATERMARK_TOOLS) {
    assert.ok(!quartz.includes(tool), `quartz_ai must not receive ${tool}`);
  }
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const allowed = allowedToolsForSurface(surface);
    for (const tool of WATERMARK_TOOLS) {
      assert.ok(allowed.includes(tool), `${surface} should receive ${tool}`);
    }
  }
});

test("every tool is brokered, so none can be inherited by default", () => {
  for (const tool of WATERMARK_TOOLS) {
    assert.ok(BROKERED_TOOLS.includes(tool), `${tool} must be in BROKERED_TOOLS`);
  }
});

test("every tool is registered with the runtime, in all three places", () => {
  const manifest = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "plugin.yaml"),
    "utf8",
  );
  const plugin = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "__init__.py"),
    "utf8",
  );
  const manifestEntries = manifest
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());

  for (const tool of WATERMARK_TOOLS) {
    assert.ok(manifestEntries.includes(tool), `${tool} missing from plugin.yaml provides_tools`);
    assert.ok(plugin.includes(`"${tool}"`), `${tool} missing from _TOOLS in __init__.py`);
  }

  assert.ok(plugin.includes('"/api/hermes/tools/watermarks"'), "watermarks has no route in the plugin");
  assert.ok(
    fs.existsSync(
      path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "watermarks", "route.ts"),
    ),
    "the route the plugin posts to must exist",
  );

  // An unrecognized route_kind falls through to a premortem-shaped payload the
  // route does not understand, which would fail only at call time. Membership,
  // not the exact set: other families join this branch over time.
  assert.match(
    plugin,
    /route_kind in \{[^}]*"watermarks"[^}]*\}/,
    "watermarks must produce the {tool, args} payload its route reads",
  );
});

test("the plugin timeout outlasts the script's own ceiling", () => {
  const plugin = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "__init__.py"),
    "utf8",
  );
  const declared = /_WATERMARKS_REQUEST_TIMEOUT_SECONDS = (\d+)/.exec(plugin);
  assert.ok(declared, "the plugin must declare a watermarks timeout");
  // The scripts stop themselves at 120s; a shorter socket timeout would turn a
  // clean give-up into an unexplained transport error.
  assert.ok(Number(declared[1]) > 120, "the plugin timeout must outlast the 120s script ceiling");
  assert.match(plugin, /route_kind == "watermarks"/, "the timeout must be selected by route_kind");
});

test("the skill resolves ready on the authenticated surfaces, and not on Quartz", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find((entry) => entry.slug === "remove-ai-marks");
    assert.ok(skill, `remove-ai-marks missing on ${surface}`);
    assert.equal(skill.availability, "ready", `remove-ai-marks not ready on ${surface}`);
    assert.equal(skill.category, "Featured");
    assert.deepEqual(skill.capabilityContract?.requiredTools, [...WATERMARK_TOOLS]);
  }
  assert.equal(
    listFirstPartySkills("quartz_ai").some(
      (skill) => skill.slug === "remove-ai-marks" && skill.availability === "ready",
    ),
    false,
    "remove-ai-marks must not be ready on quartz_ai",
  );
});

test("the packaging step stages the scripts the tools resolve at runtime", () => {
  const packaging = fs.readFileSync(
    path.join(repoRoot, "desktop", "scripts", "prepare-app-resources.mjs"),
    "utf8",
  );
  // Without this the shipped app reports "scripts are not installed" while the
  // dev repo, which has the clone beside it, looks fine.
  assert.match(packaging, /watermarks-remover/, "the packaged app must stage the vendored scripts");
});

test("the vendored clone is present and pinned", () => {
  assert.ok(scriptsAvailable(), `the watermarks-remover scripts must exist under ${cloneRoot()}`);
  const pin = path.join(cloneRoot(), "BREADBOARD_UPSTREAM_COMMIT");
  assert.ok(fs.existsSync(pin), "the clone must record the upstream commit it is pinned to");
  assert.match(fs.readFileSync(pin, "utf8").trim(), /^[0-9a-f]{40}$/, "the pin must be a full commit sha");
});

// ── behaviour: the workspace boundary ────────────────────────────────────────

test("paths that escape the workspace are refused", () => {
  const workspace = makeWorkspace();
  for (const escape of ["../secrets.md", "../../etc/passwd", "a/../../b.md"]) {
    assert.throws(
      () => containWorkspacePath(workspace, escape, "The file path"),
      (error) => error instanceof WatermarkError && error.code === "watermarks_path_outside_workspace",
      `${escape} must be refused`,
    );
  }
});

test("an absolute path inside the workspace resolves; one outside does not", () => {
  const workspace = makeWorkspace();
  assert.equal(
    containWorkspacePath(workspace, path.join(workspace, "draft.md"), "The file path"),
    path.join(workspace, "draft.md"),
  );
  assert.throws(
    () => containWorkspacePath(workspace, path.join(os.tmpdir(), "elsewhere.md"), "The file path"),
    (error) => error instanceof WatermarkError && error.code === "watermarks_path_outside_workspace",
  );
});

test("the capability token's own directory is unreachable", () => {
  const workspace = makeWorkspace();
  assert.throws(
    () => containWorkspacePath(workspace, ".breadboard/capability.json", "The file path"),
    (error) => error instanceof WatermarkError && error.code === "watermarks_path_reserved",
  );
});

test("a URL is refused rather than treated as a filename", () => {
  const workspace = makeWorkspace();
  assert.throws(
    () => containWorkspacePath(workspace, "https://example.com/photo.png", "The file path"),
    (error) => error instanceof WatermarkError && error.code === "watermarks_path_remote",
  );
});

test("exactly one source is required, and two are refused", () => {
  const workspace = makeWorkspace();
  assert.throws(
    () => resolveSource(workspace, {}, []),
    (error) => error instanceof WatermarkError && error.code === "watermarks_source_required",
  );
  // Silently picking one is how a user gets back a cleaned copy of the wrong file.
  assert.throws(
    () => resolveSource(workspace, { text: "hi", file: "draft.md" }, []),
    (error) => error instanceof WatermarkError && error.code === "watermarks_source_ambiguous",
  );
});

test("an attachment is matched by name, case and extension forgivingly", () => {
  const attachments = [
    { name: "Photo.PNG", kind: "image", filename: "Photo.png", carriedForward: false, stage: () => {} },
  ];
  assert.equal(selectAttachment(attachments, "photo.png").name, "Photo.PNG");
  assert.equal(selectAttachment(attachments, "Photo").name, "Photo.PNG");
  assert.throws(
    () => selectAttachment(attachments, "other.png"),
    (error) => error instanceof WatermarkError && error.code === "watermarks_attachment_not_found",
  );
  assert.throws(
    () => selectAttachment([], "photo.png"),
    (error) => error instanceof WatermarkError && error.code === "watermarks_no_attachment",
  );
});

test("the workspace falls back to a per-conversation directory", () => {
  const workspace = makeWorkspace();
  assert.equal(watermarkWorkspaceFor({ active_directory: workspace, conversation_id: 1 }), workspace);
  assert.throws(
    () => watermarkWorkspaceFor({ active_directory: null, conversation_id: null }),
    (error) => error instanceof WatermarkError && error.code === "watermarks_workspace_required",
  );
});

// ── behaviour: the scripts themselves ────────────────────────────────────────

test("inline text: inspect names the codepoints, clean removes them", async () => {
  const workspace = makeWorkspace();

  const inspected = await inspectSource(workspace, { text: MARKED_TEXT }, [], runtime.execution);
  assert.equal(inspected.marksFound, true);
  assert.equal(inspected.sourceKind, "text");
  assert.equal(inspected.report.suspicious_total, 2);
  const labels = inspected.report.hits.map((hit) => hit.codepoint).sort();
  assert.deepEqual(labels, ["U+200B", "U+2060"]);

  const cleaned = await cleanSource(workspace, { text: MARKED_TEXT }, [], runtime.execution);
  assert.equal(cleaned.changed, true);
  assert.equal(cleaned.cleanedText, "Helloworld, thisis a draft.\n");
  assert.equal(cleaned.report.removed_count, 2);

  // Cleaning is idempotent, and a clean input is reported as unchanged rather
  // than as a second round of removals.
  const again = await inspectSource(workspace, { text: cleaned.cleanedText }, [], runtime.execution);
  assert.equal(again.marksFound, false);
});

test("inline text keeps its line endings", async () => {
  const workspace = makeWorkspace();
  // The scripts' stdout path rewrites \n to \r\n on Windows, so the cleaner
  // routes through a file. This is the assertion that catches a regression to
  // stdout: prose the user pastes back must not silently change line endings.
  const cleaned = await cleanSource(workspace, { text: "one​\ntwo\nthree\n" }, [], runtime.execution);
  assert.equal(cleaned.cleanedText, "one\ntwo\nthree\n");
  assert.ok(!cleaned.cleanedText.includes("\r"), "line endings must survive unchanged");
});

test("a workspace file is cleaned to a new copy, leaving the original intact", async () => {
  const workspace = makeWorkspace();
  const original = path.join(workspace, "draft.md");
  fs.writeFileSync(original, MARKED_TEXT);

  const cleaned = await cleanSource(workspace, { file: "draft.md" }, [], runtime.execution);
  assert.equal(cleaned.outputFile, "draft.cleaned.md");
  assert.equal(cleaned.changed, true);
  assert.equal(cleaned.artifactKind, undefined, "markdown has no file-artifact kind");
  assert.equal(fs.readFileSync(original, "utf8"), MARKED_TEXT, "the original must be untouched");
  assert.equal(fs.readFileSync(path.join(workspace, "draft.cleaned.md"), "utf8"), "Helloworld, thisis a draft.\n");
});

test("the cleaned copy may not overwrite its own source", async () => {
  const workspace = makeWorkspace();
  fs.writeFileSync(path.join(workspace, "draft.md"), MARKED_TEXT);
  await assert.rejects(
    cleanSource(workspace, { file: "draft.md", output: "draft.md" }, [], runtime.execution),
    (error) => error instanceof WatermarkError && error.code === "watermarks_output_conflict",
  );
});

test("a missing file says so instead of failing inside Python", async () => {
  const workspace = makeWorkspace();
  await assert.rejects(
    inspectSource(workspace, { file: "nope.md" }, [], runtime.execution),
    (error) => error instanceof WatermarkError && error.code === "watermarks_file_not_found",
  );
});

test("a PNG's metadata is inspected and stripped, and it exports as an image artifact", async () => {
  const workspace = makeWorkspace();
  // A minimal PNG carrying a tEXt chunk that names a generator — the shape of
  // the AI metadata this tool exists to remove.
  const png = path.join(workspace, "shot.png");
  fs.writeFileSync(png, buildPngWithTextChunk("Software", "Made with Firefly generative AI"));

  const inspected = await inspectSource(workspace, { file: "shot.png" }, [], runtime.execution);
  assert.equal(inspected.report.kind, "image");

  const cleaned = await cleanSource(workspace, { file: "shot.png" }, [], runtime.execution);
  assert.equal(cleaned.outputFile, "shot.cleaned.png");
  assert.equal(cleaned.artifactKind, "image", "a cleaned PNG must be deliverable as an artifact");
  assert.equal(cleaned.artifactFilename, "shot.cleaned.png");
  const bytes = fs.readFileSync(path.join(workspace, "shot.cleaned.png"));
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "still a PNG");
  assert.ok(!bytes.includes(Buffer.from("Firefly")), "the generator string must be gone");
});

test("the audit sweeps the workspace and skips its own staging directory", async () => {
  const workspace = makeWorkspace();
  fs.writeFileSync(path.join(workspace, "marked.md"), MARKED_TEXT);
  fs.writeFileSync(path.join(workspace, "plain.md"), "Nothing hidden here.\n");
  fs.mkdirSync(path.join(workspace, ".watermarks"));
  fs.writeFileSync(path.join(workspace, ".watermarks", "scratch.md"), MARKED_TEXT);

  const audited = await auditWorkspace(workspace, {}, runtime.execution);
  assert.equal(audited.directory, ".");
  const serialized = JSON.stringify(audited.report);
  assert.match(serialized, /marked\.md/, "the audit must reach real workspace files");
  assert.ok(!serialized.includes("scratch.md"), "the audit must not report its own scratch files");
});

test("the audit refuses a directory outside the workspace", async () => {
  const workspace = makeWorkspace();
  await assert.rejects(
    auditWorkspace(workspace, { directory: ".." }, runtime.execution),
    (error) => error instanceof WatermarkError && error.code === "watermarks_path_outside_workspace",
  );
});

/** A 1x1 PNG with one tEXt chunk, built by hand so the test needs no fixtures. */
function buildPngWithTextChunk(keyword, value) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from(`${keyword}\0${value}`, "latin1")),
    // zlib stream for a single zero byte scanline, precomputed.
    chunk("IDAT", Buffer.from("789c626000000000ffff030000060005", "hex")),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
