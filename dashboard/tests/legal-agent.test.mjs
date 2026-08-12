// The Legal Agent's own coverage.
//
// The shared suites already walk every agent for the two promises that break
// silently (a card that survives a reload, artifacts bound to one chat). What
// is left is what only this agent has: a command parser that must not eat
// prose, settings that must not leak the UI's vocabulary into a run, a
// workspace that must not let an attachment escape it, and a protocol whose two
// halves are written in different languages and can drift apart without either
// side failing to compile.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(here, "..");
const repositoryRoot = path.resolve(dashboard, "..");

const {
  LEGAL_COMMAND,
  LEGAL_AGENT_ID,
  LEGAL_AGENT_NAME,
  LEGAL_SKILL_IDS,
  DEFAULT_MAX_TURNS,
  legalRunLabel,
  legalUserMessage,
  parseLegalRequest,
  taskFromLegalCommand,
} = await import("../src/lib/legal/identity.ts");

const { DEFAULT_LEGAL_SETTINGS, legalSettingsFrom, requestDefaultsFrom } = await import(
  "../src/lib/legal/settings.ts"
);

const bridgeSource = fs.readFileSync(
  path.join(repositoryRoot, "scripts", "legal-bridge.py"),
  "utf8",
);

// ── The command ──────────────────────────────────────────────────────

test("the token is recognised, and prose after it is the assignment", () => {
  assert.equal(LEGAL_COMMAND, `/agents:${LEGAL_AGENT_ID}`);
  assert.equal(LEGAL_AGENT_NAME, "Legal Agent");
  assert.equal(
    taskFromLegalCommand("/agents:legal review the attached SPA"),
    "review the attached SPA",
  );
  // A bare token selects the agent rather than starting an empty run.
  assert.equal(taskFromLegalCommand("/agents:legal"), "");
  assert.equal(taskFromLegalCommand("  /agents:legal   check this  "), "check this");
  assert.equal(taskFromLegalCommand("/AGENTS:LEGAL check this"), "check this");
  // Not this agent's message.
  assert.equal(taskFromLegalCommand("review the attached SPA"), null);
  assert.equal(taskFromLegalCommand("/agents:legally-blonde do a thing"), null);
  assert.equal(legalUserMessage("draft an NDA"), "/agents:legal draft an NDA");
  assert.equal(legalUserMessage("   "), "/agents:legal");
});

test("a stacked token stays in the assignment instead of being eaten", () => {
  // The resolver has to still see it, so it can refuse the combination rather
  // than this agent silently swallowing the other capability.
  assert.equal(
    taskFromLegalCommand("/agents:legal /my-skill review this"),
    "/my-skill review this",
  );
});

// ── The flags ────────────────────────────────────────────────────────

test("flags shape the run and everything else stays the assignment", () => {
  const request = parseLegalRequest(
    "review the SPA --turns 25 --effort high --skills docx,xlsx --no-shell",
  );
  assert.equal(request.task, "review the SPA");
  assert.equal(request.maxTurns, 25);
  assert.equal(request.effort, "high");
  assert.deepEqual(request.skills, ["docx", "xlsx"]);
  assert.equal(request.allowShell, false);
});

test("legal prose full of dashes is not mistaken for flags", () => {
  // This is the failure that matters: a legal instruction is prose, and prose
  // contains dashes, hyphenated terms and em-dashed asides.
  const prose =
    "Check the earn-out — the seller-friendly cap in clause 7.2 — against the term sheet; note any non-compete issues.";
  const request = parseLegalRequest(prose);
  assert.equal(request.task, prose);
  assert.equal(request.maxTurns, DEFAULT_MAX_TURNS);
  assert.deepEqual(request.skills, [...LEGAL_SKILL_IDS]);
  assert.equal(request.allowShell, true);
  assert.equal(request.effort, null);
});

test("an unusable flag value leaves the default rather than breaking the run", () => {
  const request = parseLegalRequest("review this --effort turbo --skills pdf,rtf");
  assert.equal(request.effort, null, "an unknown effort falls back to the chat's");
  assert.deepEqual(request.skills, [...LEGAL_SKILL_IDS], "unknown skills change nothing");
  assert.equal(request.task, "review this");
});

test("turn counts are clamped rather than trusted", () => {
  assert.equal(parseLegalRequest("x --turns 999").maxTurns, 200);
  assert.equal(parseLegalRequest("x --turns 1").maxTurns, 5);
  assert.equal(parseLegalRequest("x -t 30").maxTurns, 30);
});

test("`--effort max` is the word a person types for the provider's xhigh", () => {
  assert.equal(parseLegalRequest("x --effort max").effort, "xhigh");
});

test("a flag in the message beats a stored default", () => {
  const stored = legalSettingsFrom({
    maxTurns: 90,
    effort: "low",
    skills: ["docx"],
    allowShell: false,
  });
  const defaults = requestDefaultsFrom(stored);

  // No flag: the stored values are what the run uses.
  const plain = parseLegalRequest("review this", defaults);
  assert.equal(plain.maxTurns, 90);
  assert.equal(plain.effort, "low");
  assert.deepEqual(plain.skills, ["docx"]);
  assert.equal(plain.allowShell, false);

  // A flag: it wins, and only for the field it names.
  const flagged = parseLegalRequest("review this --turns 12 --shell", defaults);
  assert.equal(flagged.maxTurns, 12);
  assert.equal(flagged.allowShell, true);
  assert.equal(flagged.effort, "low", "an unflagged field keeps the stored value");
});

// ── Settings ─────────────────────────────────────────────────────────

test("stored settings are read defensively and never leak the UI's vocabulary", () => {
  assert.deepEqual(legalSettingsFrom(null), DEFAULT_LEGAL_SETTINGS);
  // "" is how the settings panel spells "follow the chat"; a run must see null.
  assert.equal(legalSettingsFrom({ effort: "" }).effort, null);
  assert.equal(legalSettingsFrom({ effort: "nonsense" }).effort, null);
  assert.equal(legalSettingsFrom({ effort: "max" }).effort, "xhigh");
  // Numbers arrive as strings from a form field.
  assert.equal(legalSettingsFrom({ maxTurns: "45" }).maxTurns, 45);
  assert.equal(legalSettingsFrom({ maxTurns: 5_000 }).maxTurns, 200);
  assert.equal(legalSettingsFrom({ shellTimeout: 1 }).shellTimeout, 10);
  // An empty selection is a real choice — "markdown only" — not a missing one.
  assert.deepEqual(legalSettingsFrom({ skills: [] }).skills, []);
  assert.deepEqual(legalSettingsFrom({ skills: ["docx", "nope"] }).skills, ["docx"]);
  assert.deepEqual(legalSettingsFrom({}).skills, [...LEGAL_SKILL_IDS]);
  assert.equal(legalSettingsFrom({}).allowShell, true);
  assert.equal(legalSettingsFrom({ allowShell: false }).allowShell, false);
});

test("the settings catalog entry matches the agent's own identity", async () => {
  const { findConfigurableAgent } = await import("../src/lib/agent-settings/catalog.ts");
  const entry = findConfigurableAgent(LEGAL_AGENT_ID);
  assert.ok(entry, "the Legal Agent must have run defaults");
  assert.equal(entry.command, LEGAL_COMMAND);
  assert.equal(entry.name, LEGAL_AGENT_NAME);
  // Every field the runtime reads has to exist in the panel, or a stored value
  // silently stops reaching the run.
  const keys = entry.fields.map((field) => field.key).sort();
  assert.deepEqual(keys, ["allowShell", "effort", "maxTurns", "shellTimeout", "skills"]);
  const skills = entry.fields.find((field) => field.key === "skills");
  assert.deepEqual(
    skills.options.map((option) => option.value),
    [...LEGAL_SKILL_IDS],
    "the panel must offer exactly the skills the harness has",
  );
});

// ── The label saved with the turn ────────────────────────────────────

test("the run label is one line and bounded, not the whole instruction", () => {
  assert.equal(legalRunLabel({ task: "Review the SPA\nthen draft a memo" }), "Review the SPA");
  assert.equal(legalRunLabel({ task: "" }), "Legal assignment");
  const long = legalRunLabel({ task: "a".repeat(500) });
  assert.ok(long.length <= 120, `a label of ${long.length} characters is not a label`);
  assert.ok(long.endsWith("…"));
});

// ── The workspace ────────────────────────────────────────────────────

test("attachments become documents, and nothing escapes the workspace", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "legal-workspace-test-"));
  process.env.LEGAL_AGENT_STATE_DIR = stateDir;
  try {
    const { prepareWorkspace, readOutputFile } = await import("../src/lib/legal/workspace.ts");
    const workspace = prepareWorkspace({
      runId: "legal_test",
      attachments: [
        // An extracted Word file must not keep the .docx name: the harness
        // dispatches its reader on the extension and would hand markdown to
        // pandoc.
        { type: "text", name: "mutual-nda.docx", text: "# NDA\n\nClause 1." },
        { type: "text", name: "notes.md", text: "already markdown" },
        { type: "text", name: "mutual-nda.pdf", text: "same stem, different file" },
        // A path in the name must not become a path on disk.
        { type: "text", name: "../../escape.txt", text: "nope" },
        { type: "video", name: "hearing.mp4", blobId: "x", format: "mp4" },
      ],
    });

    assert.deepEqual(workspace.documents, [
      "mutual-nda-docx.md",
      "notes.md",
      "mutual-nda-pdf.md",
      "escape.txt",
    ]);
    assert.equal(workspace.skipped.length, 1);
    assert.match(workspace.skipped[0], /hearing\.mp4 is not a document/);

    for (const name of workspace.documents) {
      const written = path.resolve(workspace.documentsDir, name);
      assert.ok(
        written.startsWith(path.resolve(workspace.documentsDir) + path.sep),
        `${name} escaped the documents directory`,
      );
      assert.ok(fs.existsSync(written));
    }

    // Reading back is scoped to the output directory, whatever is asked for.
    fs.writeFileSync(path.join(workspace.outputDir, "response.md"), "done");
    assert.equal(readOutputFile(workspace.outputDir, "response.md").toString(), "done");
    assert.equal(readOutputFile(workspace.outputDir, "../documents/notes.md"), null);
    assert.equal(readOutputFile(workspace.outputDir, "../../../../etc/passwd"), null);
  } finally {
    delete process.env.LEGAL_AGENT_STATE_DIR;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

// ── The protocol boundary ────────────────────────────────────────────

test("both sides of the bridge agree on the event names", () => {
  const managerSource = fs.readFileSync(
    path.join(dashboard, "src", "lib", "legal", "run-manager.ts"),
    "utf8",
  );
  // The bridge is Python and the manager is TypeScript: nothing but this test
  // fails if one of them renames an event.
  const emitted = new Set(
    [...bridgeSource.matchAll(/emit\(\s*"([a-z_.]+)"/g)].map((match) => match[1]),
  );
  const handled = new Set(
    [...managerSource.matchAll(/type === "([a-z_.]+)"/g)].map((match) => match[1]),
  );
  assert.deepEqual(
    [...emitted].sort(),
    ["completed", "failed", "started", "text", "tool", "turn", "usage"],
  );
  for (const name of emitted) {
    assert.ok(handled.has(name), `the run manager ignores the bridge's "${name}" event`);
  }
  for (const name of handled) {
    assert.ok(emitted.has(name), `the run manager handles "${name}", which nothing emits`);
  }
});

test("the job the manager sends is the job the bridge reads", () => {
  const managerSource = fs.readFileSync(
    path.join(dashboard, "src", "lib", "legal", "run-manager.ts"),
    "utf8",
  );
  const job = managerSource.slice(
    managerSource.indexOf("const job = {"),
    managerSource.indexOf("const child = spawn("),
  );
  const sent = [...job.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((match) => match[1]);
  assert.ok(sent.length >= 10, "the job should carry the whole run shape");
  for (const key of sent) {
    assert.ok(
      bridgeSource.includes(`job["${key}"]`) || bridgeSource.includes(`job.get("${key}"`),
      `the bridge never reads the job's "${key}"`,
    );
  }
});

test("the harness's six tools are the six the card knows how to label", () => {
  const cardSource = fs.readFileSync(
    path.join(dashboard, "src", "app", "components", "hermes", "inline-legal-run.tsx"),
    "utf8",
  );
  // The bridge labels a call by reading the argument each tool actually takes.
  for (const tool of ["bash", "read", "write", "edit", "glob", "grep"]) {
    assert.ok(
      bridgeSource.includes(`"${tool}"`),
      `the bridge cannot describe a ${tool} call`,
    );
  }
  assert.match(cardSource, /bash, read, write, edit, glob, grep/);
});

test("the shell resolves `python` and `python3` to the run's own interpreter", () => {
  // Observed live before this existed: a venv's Scripts directory has no
  // python3.exe, so under Git Bash `python3` reached the Windows Store stub,
  // which prints "Python was not found" and exits non-zero. Every skill manual
  // tells the agent to run a script with `python`, so the run lost two turns
  // recovering from it.
  assert.match(bridgeSource, /def _install_python_shims/);
  assert.match(bridgeSource, /for name in \("python", "python3"\)/);
  // The shims have to be ahead of whatever the machine already has on PATH.
  assert.match(bridgeSource, /prefix = \[str\(_install_python_shims\(workspace_dir\)\), \*_path_prefix\(\)\]/);
  // And inside the run's workspace, never in the clone's environment.
  assert.match(bridgeSource, /bin_dir = workspace_dir \/ "\.bin"/);
});

test("withholding the shell withholds the tool, not just the permission", () => {
  // A model that is offered `bash` and refused at call time plans around a tool
  // it cannot use. The tool list is filtered instead, and the skill manuals —
  // which are entirely about scripts run through bash — are left out with it.
  assert.match(bridgeSource, /allow_shell or tool\["name"\] != "bash"/);
  assert.match(bridgeSource, /_HOST_WORKSPACE_NOTE if allow_shell else _NO_SHELL_NOTE/);
  assert.match(bridgeSource, /if allow_shell:\n\s+for name in skills:/);
});

test("Breadboard's own files stay outside the clone", () => {
  // A file of ours inside harvey-labs/ is a conflict on the clone's next pull.
  assert.ok(fs.existsSync(path.join(repositoryRoot, "scripts", "legal-bridge.py")));
  assert.ok(!fs.existsSync(path.join(repositoryRoot, "harvey-labs", "legal-bridge.py")));
});

test("host mode and the runtime probe name the same shell", async () => {
  // Both sides exclude the WSL launcher, which starts a Linux shell that cannot
  // see the Windows workspace at the path it would be given. If one side drops
  // that exclusion, a run's `bash` tool silently starts failing.
  const { findShell } = await import("../src/lib/legal/runtime.ts");
  assert.equal(typeof findShell, "function");
  assert.match(bridgeSource, /system32/);
  const runtimeSource = fs.readFileSync(
    path.join(dashboard, "src", "lib", "legal", "runtime.ts"),
    "utf8",
  );
  assert.match(runtimeSource, /system32/);
  assert.ok(bridgeSource.includes("LEGAL_AGENT_BASH"));
  assert.ok(runtimeSource.includes("LEGAL_AGENT_BASH"));
});
