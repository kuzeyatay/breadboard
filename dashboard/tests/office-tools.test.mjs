// OfficeCLI document authoring, wired as agent tools.
//
// Same two halves as the plan suite. The wiring half guards the failure this
// repo has hit before: a tool wired on the Breadboard side but never
// registered with the runtime, so the model is never offered it. The
// behaviour half exercises the command validation layer for real — it is the
// boundary that keeps every filesystem reference inside the workspace — and,
// when the pinned binary is provisioned, runs it end to end.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DOCUMENT_TOOLS,
  OFFICE_TOOLS,
  OFFICE_WRITE_TOOLS,
  allowedToolsForSurface,
} from "../src/lib/hermes/tool-scopes.ts";
import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  OfficeCliError,
  containWorkspacePath,
  resolveOfficeCli,
  tokenizeOfficeCommand,
  validateOfficeCommand,
} from "../src/lib/office/officecli.ts";
import { prepareOfficeExport, runOfficeCommand } from "../src/lib/office/agent-query.ts";
import { officeArtifactRequirement } from "../src/lib/hermes/office-artifact-requirement.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function makeWorkspace() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "office-tools-test-")));
}

// ── wiring ──────────────────────────────────────────────────────────────────

test("the family exposes exactly the intended tools", () => {
  assert.deepEqual([...OFFICE_TOOLS].sort(), ["office_export", "office_run"]);
  assert.deepEqual([...OFFICE_WRITE_TOOLS].sort(), ["office_export", "office_run"]);
});

test("Quartz AI never receives them; the authenticated surfaces do", () => {
  const quartz = allowedToolsForSurface("quartz_ai");
  for (const tool of OFFICE_TOOLS) {
    assert.ok(!quartz.includes(tool), `quartz_ai must not receive ${tool}`);
  }
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    const allowed = allowedToolsForSurface(surface);
    for (const tool of OFFICE_TOOLS) {
      assert.ok(allowed.includes(tool), `${surface} should receive ${tool}`);
    }
  }
});

test("every tool is brokered, so none can be inherited by default", () => {
  for (const tool of OFFICE_TOOLS) {
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

  for (const tool of OFFICE_TOOLS) {
    assert.ok(manifestEntries.includes(tool), `${tool} missing from plugin.yaml provides_tools`);
    assert.ok(plugin.includes(`"${tool}"`), `${tool} missing from _TOOLS in __init__.py`);
  }

  assert.ok(plugin.includes('"/api/hermes/tools/office"'), "office has no route in the plugin");
  assert.ok(
    fs.existsSync(
      path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "office", "route.ts"),
    ),
    "the route the plugin posts to must exist",
  );

  // An unrecognized route_kind falls through to a premortem-shaped payload the
  // route does not understand, which would fail only at call time.
  // Membership, not the exact set: other families join this branch over time,
  // and pinning the whole list makes an unrelated addition fail here.
  assert.match(
    plugin,
    /route_kind in \{[^}]*"office"[^}]*\}/,
    "office must produce the {tool, args} payload its route reads",
  );
});

test("the skill resolves ready on the authenticated surfaces, and not on Quartz", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listFirstPartySkills(surface).find((entry) => entry.slug === "office");
    assert.ok(skill, `office missing on ${surface}`);
    assert.equal(skill.availability, "ready", `office not ready on ${surface}`);
    assert.equal(skill.category, "Featured");
    assert.deepEqual(skill.capabilityContract?.requiredTools, [
      ...OFFICE_TOOLS,
      ...DOCUMENT_TOOLS,
    ]);
  }
  assert.equal(
    listFirstPartySkills("quartz_ai").some(
      (skill) => skill.slug === "office" && skill.availability === "ready",
    ),
    false,
    "office must not be ready on quartz_ai",
  );
});

test("the Office skill batches Word reports and treats export as completion", () => {
  const skill = fs.readFileSync(
    path.join(repoRoot, "hermes-skills", "prebuilt", "office", "SKILL.md"),
    "utf8",
  );
  assert.match(skill, /add all planned[\s\S]*in one batch/i);
  assert.match(skill, /Do not call `office_run` once per paragraph/i);
  assert.match(skill, /batch report\.docx --commands/);
  assert.match(skill, /complete only after `office_export` succeeds/i);
  assert.match(skill, /partial document[\s\S]*is not[\s\S]*deliverable/i);
});

test("an Office turn owes the requested ready artifact before it can complete", () => {
  assert.deepEqual(officeArtifactRequirement("Create a Word document"), {
    kind: "document",
    rendererId: "document-file",
    sourceSkill: "office",
    readyEventType: "artifact.completed",
  });
  assert.equal(
    officeArtifactRequirement("Make an Excel workbook").rendererId,
    "spreadsheet-file",
  );
  assert.equal(
    officeArtifactRequirement("Create a PowerPoint deck").rendererId,
    "presentation-file",
  );
  assert.equal(
    officeArtifactRequirement("Convert this PDF to a Word document").rendererId,
    "document-file",
    "the explicit output format wins over the mentioned input format",
  );
  assert.equal(
    officeArtifactRequirement("How do I inspect a Word document?"),
    null,
    "read-only Office questions do not owe a new artifact",
  );

  const turnService = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "conversations", "turn-service.ts"),
    "utf8",
  );
  const officeRoute = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "office", "route.ts"),
    "utf8",
  );
  const documentRoute = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "document", "route.ts"),
    "utf8",
  );
  const eventStream = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "hermes", "event-stream.ts"),
    "utf8",
  );
  assert.match(turnService, /officeSkillSelected[\s\S]*officeArtifactRequirement/);
  assert.match(turnService, /requiredArtifacts\.length > 0/);
  assert.match(officeRoute, /sourceSkill: "office"/);
  assert.match(documentRoute, /sourceSkill: "office"/);
  assert.match(eventStream, /requested Office file was not published as an artifact/);
});

test("the vendored OfficeCLI clone serves the Office catalog tab", () => {
  const skillsTree = path.join(repoRoot, "OfficeCLI", "skills");
  assert.ok(fs.existsSync(skillsTree), "OfficeCLI/skills must exist for the Office catalog tab");
  const packs = fs.readdirSync(skillsTree, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const expected of ["officecli", "officecli-pitch-deck", "officecli-financial-model", "morph-ppt"]) {
    assert.ok(packs.includes(expected), `${expected} missing from the vendored skills tree`);
  }
});

// ── behaviour: the command boundary ─────────────────────────────────────────

test("tokenizer groups quoted spans, including quotes opening mid-token", () => {
  assert.deepEqual(
    tokenizeOfficeCommand('add deck.pptx /slide[1] --prop text="Revenue grew 25%" --prop x=2cm'),
    ["add", "deck.pptx", "/slide[1]", "--prop", "text=Revenue grew 25%", "--prop", "x=2cm"],
  );
  assert.deepEqual(tokenizeOfficeCommand("set a.docx / --find 'draft copy' --replace final"), [
    "set", "a.docx", "/", "--find", "draft copy", "--replace", "final",
  ]);
  assert.throws(() => tokenizeOfficeCommand('create "report.docx'), OfficeCliError);
});

test("the document path is resolved into the workspace; element paths are untouched", () => {
  const workspace = makeWorkspace();
  const validated = validateOfficeCommand(
    'add report.docx /body --type paragraph --prop text="Summary"',
    workspace,
  );
  assert.equal(validated.subcommand, "add");
  assert.equal(validated.file, path.join(workspace, "report.docx"));
  assert.equal(validated.argv[1], path.join(workspace, "report.docx"));
  assert.equal(validated.argv[2], "/body", "element paths must never be treated as files");
});

test("a leading 'officecli' is tolerated", () => {
  const workspace = makeWorkspace();
  const validated = validateOfficeCommand("officecli create report.docx", workspace);
  assert.equal(validated.subcommand, "create");
});

test("paths cannot escape the workspace, by traversal or absolutely", () => {
  const workspace = makeWorkspace();
  assert.throws(
    () => validateOfficeCommand("create ../evil.docx", workspace),
    (error) => error instanceof OfficeCliError && error.code === "office_path_outside_workspace",
  );
  const outside = path.join(os.tmpdir(), "evil.docx");
  assert.throws(
    () => validateOfficeCommand(`create ${outside}`, workspace),
    (error) => error instanceof OfficeCliError && error.code === "office_path_outside_workspace",
  );
});

test("flag and prop values that name files are contained too", () => {
  const workspace = makeWorkspace();
  assert.throws(
    () => validateOfficeCommand("batch data.xlsx --input ../updates.json", workspace),
    (error) => error instanceof OfficeCliError && error.code === "office_path_outside_workspace",
  );
  assert.throws(
    () => validateOfficeCommand("add deck.pptx /slide[1] --type picture --prop src=../secret.png", workspace),
    (error) => error instanceof OfficeCliError && error.code === "office_path_outside_workspace",
  );
  assert.throws(
    () => validateOfficeCommand("add deck.pptx /slide[1] --type picture --prop src=https://example.com/x.png", workspace),
    (error) => error instanceof OfficeCliError && error.code === "office_path_remote",
  );
  const contained = validateOfficeCommand(
    "add deck.pptx /slide[1] --type picture --prop src=logo.png",
    workspace,
  );
  assert.equal(contained.argv.at(-1), `src=${path.join(workspace, "logo.png")}`);
  // Non-path props pass through untouched, even when their text looks path-like.
  const text = validateOfficeCommand(
    "add report.docx /body --type paragraph --prop text=../not-a-path",
    workspace,
  );
  assert.equal(text.argv.at(-1), "text=../not-a-path");
});

test("server-mode and plugin subcommands are refused by name", () => {
  const workspace = makeWorkspace();
  for (const command of ["mcp claude", "watch deck.pptx", "goto deck.pptx /slide[1]", "plugins list", "mark a.docx /body"]) {
    assert.throws(
      () => validateOfficeCommand(command, workspace),
      (error) => error instanceof OfficeCliError && error.code === "office_command_denied",
      `${command} must be refused`,
    );
  }
  assert.throws(
    () => validateOfficeCommand("frobnicate a.docx", workspace),
    (error) => error instanceof OfficeCliError && error.code === "office_command_unknown",
  );
});

test("help needs no file", () => {
  const workspace = makeWorkspace();
  const validated = validateOfficeCommand("help docx paragraph", workspace);
  assert.equal(validated.file, null);
  assert.deepEqual(validated.argv, ["help", "docx", "paragraph"]);
});

test("containWorkspacePath rejects the workspace itself and empty paths", () => {
  const workspace = makeWorkspace();
  assert.throws(() => containWorkspacePath(workspace, ".", "The path"), OfficeCliError);
  assert.throws(() => containWorkspacePath(workspace, "", "The path"), OfficeCliError);
});

// ── behaviour: the real binary, when provisioned ────────────────────────────

const binary = resolveOfficeCli();

test("a document round-trips through the pinned binary", { skip: binary === null && "OfficeCLI is not provisioned (npm run setup:officecli)" }, async () => {
  const workspace = makeWorkspace();
  const created = await runOfficeCommand(workspace, { command: "create smoke.docx --json" });
  assert.equal(created.exitCode, 0, created.output);
  const added = await runOfficeCommand(workspace, {
    command: 'batch smoke.docx --commands \'[{"command":"add","parent":"/body","type":"paragraph","props":{"text":"Office tools smoke test"}}]\' --json',
  });
  assert.equal(added.exitCode, 0, added.output);
  const viewed = await runOfficeCommand(workspace, { command: "view smoke.docx text" });
  assert.match(viewed.output, /Office tools smoke test/);
  await runOfficeCommand(workspace, { command: "close smoke.docx" }).catch(() => undefined);
});

test("loaded OfficeCLI guidance ends with Breadboard's batching and export contract", { skip: binary === null && "OfficeCLI is not provisioned (npm run setup:officecli)" }, async () => {
  const workspace = makeWorkspace();
  const loaded = await runOfficeCommand(workspace, { command: "load_skill word" });
  assert.equal(loaded.exitCode, 0, loaded.output);
  assert.match(loaded.output, /\[Breadboard execution note\]/);
  assert.match(loaded.output, /group planned paragraphs, table rows/);
  assert.match(loaded.output, /incomplete until office_export returns the artifact/);
});

test("an export stages the file with an HTML snapshot and cleans up after itself", { skip: binary === null && "OfficeCLI is not provisioned (npm run setup:officecli)" }, async () => {
  const workspace = makeWorkspace();
  const created = await runOfficeCommand(workspace, { command: "create out.docx" });
  assert.equal(created.exitCode, 0, created.output);
  const staged = await prepareOfficeExport(workspace, { file: "out.docx", title: "Smoke export" });
  assert.equal(staged.kind, "document");
  assert.equal(staged.title, "Smoke export");
  assert.equal(staged.relativeFile, "out.docx");
  assert.ok(staged.previewFilePath, "a .docx export should carry an HTML snapshot");
  assert.ok(fs.existsSync(staged.previewFilePath));
  assert.match(fs.readFileSync(staged.previewFilePath, "utf8"), /<!DOCTYPE html>/i);
  const { inspectArtifactImport } = await import("../src/lib/hermes/artifact-import.ts");
  const profile = inspectArtifactImport(staged.filePath, "document");
  assert.equal(profile.rendererId, "document-file");
  assert.equal(profile.extension, ".docx");
  staged.cleanup();
  assert.ok(!fs.existsSync(staged.previewFilePath), "cleanup must remove the staged snapshot");
});
