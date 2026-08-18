import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FACTCHECK_COMMANDS,
  FACTCHECK_REFERENCES,
  resolveFactcheckRuntime,
  runFactcheck,
  validateFactcheckArguments,
} from "../src/lib/hermes/factcheck-service.ts";
import { allowedToolsForSurface } from "../src/lib/hermes/tool-scopes.ts";
import {
  listApprovedSkills,
  listInstalledLocalSkills,
} from "../src/lib/hermes/skills.ts";
import { factcheckCommandText } from "../src/lib/hermes/factcheck-intent.ts";
import {
  BULLSHIT_SKILLS_SOURCE,
  localBullshitSkillsRepository,
  getLocalBullshitSkill,
  readLocalBullshitSkillFiles,
} from "../src/lib/hermes/bullshit-skills-source.ts";
import { LOCAL_SKILLS_SOURCES } from "../src/lib/hermes/local-skills-sources.ts";
import { buildSkill } from "../../scripts/build-bullshit-detector-skill.mjs";
import { canonicalizeReviewedText, reviewedTextPin } from "../src/lib/hermes/skills.ts";

/** The reviewed-text canonical form: line terminators folded, nothing else. */
const canonicalText = (value) =>
  canonicalizeReviewedText(Buffer.from(value, "utf8")).toString("utf8");

const repositoryRoot = new URL("../../", import.meta.url);
const cloneRoot = new URL("bullshit-detector/", repositoryRoot);
const skillPath = new URL(".agents/skills/bullshit-detector/SKILL.md", repositoryRoot);

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factcheck-test-"));
}

function validate(args, workspaceDirectory) {
  return validateFactcheckArguments({
    arguments: args,
    workspaceDirectory,
    cloneRoot: path.resolve(cloneRoot.pathname.replace(/^\//, "")),
  });
}

function refusal(args, workspaceDirectory) {
  try {
    validate(args, workspaceDirectory);
    return null;
  } catch (error) {
    return error.code;
  }
}

test("Bullshit Detector is a ready installed skill on authenticated chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const skill = listApprovedSkills(surface).find(
      (candidate) => candidate.slug === "bullshit-detector",
    );
    assert.ok(skill, `missing on ${surface}`);
    assert.equal(skill.availability, "ready");
    // The registry pins the SKILL.md hash, so editing the shipped guidance
    // without re-reviewing it disables the skill instead of shipping quietly.
    assert.equal(skill.enabled, true);
    assert.equal(skill.healthy, true);
    assert.deepEqual(skill.capabilityContract?.requiredTools, [
      "factcheck_run",
      "artifact_create",
      "artifact_render",
    ]);
  }
  assert.equal(
    listApprovedSkills("quartz_ai").some(
      (candidate) =>
        candidate.slug === "bullshit-detector" && candidate.availability === "ready",
    ),
    false,
    "the anonymous public surface must not get a tool that fetches arbitrary URLs",
  );
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    assert.equal(
      listInstalledLocalSkills(surface).some(
        (candidate) => candidate.slug === "bullshit-detector",
      ),
      true,
      `bullshit-detector must appear as an install on ${surface}`,
    );
  }
});

test("factcheck_run reaches both authenticated chat surfaces and never Quartz", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    assert.ok(
      allowedToolsForSurface(surface).includes("factcheck_run"),
      `factcheck_run missing on ${surface}`,
    );
  }
  assert.equal(allowedToolsForSurface("quartz_ai").includes("factcheck_run"), false);
});

test("the shipped SKILL.md is the clone's procedure plus a Breadboard preamble", () => {
  const shipped = fs.readFileSync(skillPath, "utf8");
  const clone = fs.readFileSync(
    new URL("skills/analysis/bullshit-detector/SKILL.md", cloneRoot),
    "utf8",
  );
  // Rebuilding from the clone must reproduce the shipped guidance. The
  // comparison is canonical rather than byte-exact because the reviewed root is
  // committed: git rewrites line terminators at checkout, so a byte comparison
  // here measures the checkout, not the drift (W23E-001). Every other
  // difference -- a word, a space, a blank line -- still fails this.
  assert.equal(
    canonicalText(shipped),
    canonicalText(buildSkill(clone)),
    "run `node scripts/build-bullshit-detector-skill.mjs` — the clone and the shipped skill have drifted",
  );
  // The preamble is what makes the upstream procedure runnable here, so its
  // pointers into the tool have to survive an edit of either side.
  for (const marker of ['"arguments":["fetch"', '"arguments":["reference","RUBRIC.md"]', "workspace_read"]) {
    assert.ok(shipped.includes(marker), `preamble lost ${marker}`);
  }
});

test("the reviewed registry pins the shipped SKILL.md by hash", () => {
  const registry = JSON.parse(
    fs.readFileSync(new URL(".agents/skills/registry.json", repositoryRoot), "utf8"),
  );
  const entry = registry.skills["bullshit-detector"];
  assert.ok(entry, "bullshit-detector is not in the reviewed registry");
  // The pin declares its scheme. `text-v1` authenticates the reviewed text, so
  // the same reviewed commit verifies whichever line terminators the checkout
  // wrote; a bare hex pin would still mean raw bytes.
  const pin = reviewedTextPin(fs.readFileSync(skillPath));
  assert.match(pin, /^text-v1:[0-9a-f]{64}$/);
  assert.equal(entry.localHash, pin);
  assert.equal(entry.fileHashes["SKILL.md"], pin);
  assert.equal(entry.reviewState, "approved");
  assert.equal(entry.classification.classification, "eligible_general");
});

test("the command allowlist refuses everything outside it", () => {
  const workspace = temporaryWorkspace();
  assert.equal(refusal(["shell", "whoami"], workspace), "factcheck_command_denied");
  assert.equal(refusal(["fetch"], workspace), "factcheck_invalid_arguments");
  assert.equal(
    refusal(["retractions", "report.md", "--json"], workspace),
    "factcheck_flag_denied",
    "retractions takes no flags",
  );
  assert.equal(
    refusal(["tally", "report.md", "--output=/etc/passwd"], workspace),
    "factcheck_flag_denied",
  );
  assert.equal(
    refusal(["fetch", "--json", "https://example.com"], workspace),
    "factcheck_invalid_arguments",
    "the subject must precede the flags, or a flag becomes the fetched source",
  );
  // Every command the schema advertises must actually resolve.
  for (const command of FACTCHECK_COMMANDS) {
    const subject = command === "reference" ? "RUBRIC.md" : "subject.md";
    assert.notEqual(
      refusal([command, subject], workspace),
      "factcheck_command_denied",
      `${command} is advertised but denied`,
    );
  }
});

test("fetch reaches http(s) and nothing else; paths stay inside the workspace", () => {
  const workspace = temporaryWorkspace();
  assert.equal(
    validate(["fetch", "https://example.com/a"], workspace).scriptArguments[0],
    "https://example.com/a",
  );
  for (const source of [
    "file:///etc/passwd",
    "data:text/plain,hi",
    "ftp://example.com/x",
  ]) {
    assert.equal(refusal(["fetch", source], workspace), "factcheck_source_denied", source);
  }
  for (const escape of ["../secrets.md", "../../etc/passwd", path.resolve(workspace, "..", "x.md")]) {
    assert.equal(refusal(["tally", escape], workspace), "factcheck_path_denied", escape);
  }
  // A contained path is handed to the script relative to its working directory,
  // so the host's directory layout never reaches a published report.
  assert.equal(
    validate(["tally", "reports/bs.md"], workspace).scriptArguments[0],
    "reports/bs.md",
  );
});

test("reference serves the pack's bundled guidance and only that", () => {
  const workspace = temporaryWorkspace();
  for (const name of FACTCHECK_REFERENCES) {
    const resolved = validate(["reference", name], workspace);
    assert.equal(resolved.kind, "reference");
    assert.ok(fs.existsSync(resolved.scriptPath), `${name} is missing from the clone`);
  }
  for (const name of ["SKILL.md", "../../../README.md", "scripts/tally.py"]) {
    assert.equal(refusal(["reference", name], workspace), "factcheck_command_denied", name);
  }
});

test("a fact-check ask selects the skill; an ordinary one does not", () => {
  const select = (text, priorMessages) =>
    factcheckCommandText({
      text,
      surface: "garden_chat",
      authenticated: true,
      priorMessages,
    });
  for (const text of [
    "is this bullshit? https://youtube.com/watch?v=abc",
    "fact-check this video",
    "can you debunk https://example.com/post",
    "what's the BS score on this",
    "is this true? https://example.com/article",
    "how much of this holds up — https://example.com/x",
  ]) {
    assert.equal(select(text).automatic, true, `should have selected: ${text}`);
    assert.ok(select(text).text.startsWith("/bullshit-detector "));
  }
  for (const text of [
    "summarize https://example.com/article",
    "is this true",
    "check my code for bugs",
    "/premortem the launch",
    "what did you say earlier",
  ]) {
    assert.equal(select(text).automatic, false, `should not have selected: ${text}`);
    assert.equal(select(text).text, text);
  }
  // A follow-up to a report this conversation produced stays in the skill.
  assert.equal(
    select("why is claim 4 misleading?", [
      { role: "assistant", content: "BS score: 6/10. 12 claims, 3 misleading. See the claims table above." },
    ]).automatic,
    true,
  );
  // Anonymous and public surfaces never auto-select it.
  assert.equal(
    factcheckCommandText({
      text: "is this bullshit? https://example.com",
      surface: "quartz_ai",
      authenticated: false,
    }).automatic,
    false,
  );
});

test("the whole pack is mirrored into the catalog as a reviewed local source", () => {
  assert.ok(localBullshitSkillsRepository(), "the bullshit-detector clone is not on disk");
  assert.ok(
    LOCAL_SKILLS_SOURCES.some((entry) => entry.source === BULLSHIT_SKILLS_SOURCE),
    "the pack is not registered with the reviewed-local-source aggregator",
  );
  for (const slug of [
    "bullshit-detector",
    "summarize",
    "explain",
    "fetch-content",
    "coverage-check",
  ]) {
    const id = `${BULLSHIT_SKILLS_SOURCE}/${slug}`;
    const skill = getLocalBullshitSkill(id);
    assert.ok(skill, `${slug} did not ingest`);
    assert.equal(skill.detail.slug, slug);
    assert.ok(readLocalBullshitSkillFiles(id).files["SKILL.md"], `${slug} has no SKILL.md`);
  }
  // `skills/in-progress` holds a bare script rather than a skill, and shipping
  // it as one would advertise a capability that does not exist.
  assert.equal(getLocalBullshitSkill(`${BULLSHIT_SKILLS_SOURCE}/transcribe`), null);
});

test("the pack rides the All tab rather than claiming a filter of its own", () => {
  // Five skills, one of which already ships as a first-party install, is not a
  // tab's worth of catalog. Registering with the shared aggregator is what puts
  // them under "All"; the route and the panel stay untouched.
  const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  assert.match(
    read("../src/lib/hermes/local-skills-sources.ts"),
    /synchronize: synchronizeLocalBullshitSkillsCatalog/,
  );
  assert.doesNotMatch(read("../src/app/api/hermes/skills/route.ts"), /bullshit/i);
  assert.doesNotMatch(
    read("../src/app/components/hermes/skills-catalog-panel.tsx"),
    /bullshit/i,
  );
});

test("the scripts run and their output is contained in the workspace", async (t) => {
  const runtime = resolveFactcheckRuntime();
  if (!runtime) {
    t.skip("no uv or python on this machine");
    return;
  }
  const workspace = temporaryWorkspace();

  // `reference` is the one command that touches no network and no interpreter.
  const rubric = await runFactcheck({
    arguments: ["reference", "RUBRIC.md"],
    workspaceDirectory: workspace,
  });
  assert.equal(rubric.exitCode, 0);
  assert.ok(rubric.preview.includes("Source hierarchy"));
  assert.ok(rubric.outputPath.startsWith("factcheck/"));
  assert.ok(fs.existsSync(path.join(workspace, rubric.outputPath)));

  // The local-file path exercises the interpreter, the fence, and the promise
  // that the full output is always on disk even when the preview is clipped.
  fs.writeFileSync(path.join(workspace, "note.md"), "# Note\n\nAcme grew 400% last year.\n");
  const fetched = await runFactcheck({
    arguments: ["fetch", "note.md"],
    workspaceDirectory: workspace,
  });
  assert.equal(fetched.exitCode, 0);
  assert.ok(fetched.preview.includes("<untrusted-content"));
  assert.ok(fetched.preview.includes("Acme grew 400% last year."));
  assert.equal(
    fs.readFileSync(path.join(workspace, fetched.outputPath), "utf8").length,
    fetched.outputBytes,
  );
  // The script echoes its input, so an absolute host path here would end up in
  // a published report.
  assert.equal(fetched.preview.includes(workspace), false);
});
