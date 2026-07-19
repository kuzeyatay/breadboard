import test from "node:test";
import assert from "node:assert/strict";
import {
  planTask,
  requiresCodingOutcome,
  requestWithoutSelectors,
} from "../src/lib/openharness/task-plan.ts";

function plan(request, options = {}) {
  return planTask({ request, authenticated: true, ...options });
}

function caps(request, options) {
  return new Set(plan(request, options).requiredCapabilities);
}

/* ------------------------------------------------------------------ */
/* The non-negotiable rule: reading/moving code is not coding          */
/* ------------------------------------------------------------------ */

test("explaining a TypeScript file is a read, not coding", () => {
  const p = plan("Explain what this TypeScript file does: src/lib/auth.ts");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_read"));
  assert.ok(!p.requiredCapabilities.includes("coding"));
});

test("searching for importers is read and search, not coding", () => {
  const p = plan("Find every file that imports this module.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_read"));
});

test("running an existing test suite is command execution, not coding", () => {
  const p = plan("Run the existing test suite and explain the failures.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("command_execution"));
});

test("moving .ts files is a filesystem write, not coding", () => {
  const p = plan("Move these .ts files into an archive folder.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_write"));
  assert.ok(!p.requiredCapabilities.includes("coding"));
});

test("batch renaming images is a filesystem operation, not coding", () => {
  const p = plan("Rename all these images using their creation dates.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_write"));
});

test("renaming a symbol IS coding", () => {
  assert.equal(requiresCodingOutcome("Rename the parseHeader function to readHeader everywhere."), true);
});

/* ------------------------------------------------------------------ */
/* Coding is selected when the outcome is software                     */
/* ------------------------------------------------------------------ */

test("fixing failing tests is coding", () => {
  const p = plan("Fix the failing tests.");
  assert.equal(p.requiresCoding, true);
  assert.ok(p.requiredCapabilities.includes("coding"));
  assert.ok(p.requiredCapabilities.includes("command_execution"));
});

test("adding authentication is coding", () => {
  assert.equal(plan("Add authentication to this application.").requiresCoding, true);
});

test("creating a Python script is coding", () => {
  assert.equal(plan("Create a Python script that cleans this dataset.").requiresCoding, true);
});

test("refactoring a parser is coding", () => {
  assert.equal(plan("Refactor the parser module to use streaming.").requiresCoding, true);
});

/* ------------------------------------------------------------------ */
/* Filesystem outcomes                                                 */
/* ------------------------------------------------------------------ */

test("summarizing Documents is a filesystem read only", () => {
  const c = caps("Summarize the files in my Documents folder.");
  assert.ok(c.has("filesystem_read"));
  assert.ok(!c.has("filesystem_write"));
  assert.ok(!c.has("coding"));
});

test("organizing Downloads is filesystem read and write", () => {
  const c = caps("Organize my Downloads folder by file type.");
  assert.ok(c.has("filesystem_read"));
  assert.ok(c.has("filesystem_write"));
  assert.ok(!c.has("coding"));
});

test("deleting duplicates needs confirmation and a destructive capability", () => {
  const p = plan("Delete duplicate files after showing me the candidates.");
  assert.ok(p.requiredCapabilities.includes("destructive_filesystem"));
  assert.equal(p.requiresConfirmation, true);
  assert.equal(p.riskLevel, "high");
});

test("creating a folder is not coding", () => {
  const p = plan("Create a folder called Invoices in my Documents folder.");
  assert.equal(p.requiresCoding, false);
  assert.ok(p.requiredCapabilities.includes("filesystem_write"));
});

/* ------------------------------------------------------------------ */
/* Documents, media, web, garden                                       */
/* ------------------------------------------------------------------ */

test("summarizing a PDF is document processing", () => {
  assert.ok(caps("Summarize this PDF report for me.").has("document_processing"));
});

test("converting Markdown to PDF is document processing plus a write", () => {
  const c = caps("Convert these Markdown files to PDFs.");
  assert.ok(c.has("document_processing"));
  assert.ok(c.has("filesystem_write"));
  assert.ok(!c.has("coding"));
});

test("downloading and transcribing a video needs web, media and write", () => {
  const c = caps("Download this video and transcribe it.");
  assert.ok(c.has("web_research"));
  assert.ok(c.has("media_processing"));
  assert.ok(c.has("filesystem_write"));
  assert.ok(!c.has("coding"));
});

test("researching current information is web research", () => {
  assert.ok(caps("Search the web for the latest news on this topic.").has("web_research"));
});

test("research plus garden write selects both", () => {
  const c = caps("Research this topic and add the findings to my garden.");
  assert.ok(c.has("web_research"));
  assert.ok(c.has("garden_write"));
});

test("emailing a report requires confirmation and an external action", () => {
  const p = plan("Email this report to Alex.");
  assert.ok(p.requiredCapabilities.includes("application_action"));
  assert.equal(p.requiresConfirmation, true);
});

/* ------------------------------------------------------------------ */
/* Least privilege and isolation                                       */
/* ------------------------------------------------------------------ */

test("a conversational request gets no action capability", () => {
  const p = plan("What is the difference between AM and FM modulation?");
  assert.deepEqual(p.requiredCapabilities, ["conversation"]);
  assert.equal(p.riskLevel, "low");
});

test("an explicit no-mutation instruction suppresses coding", () => {
  assert.equal(
    plan("Explain the auth module but do not modify any code.").requiresCoding,
    false,
  );
});

test("isolated sessions never receive private capabilities", () => {
  const p = plan("Organize my Downloads folder and fix the failing tests.", {
    authenticated: false,
    isolated: true,
  });
  assert.equal(p.requiresCoding, false);
  for (const forbidden of [
    "filesystem_read",
    "filesystem_write",
    "destructive_filesystem",
    "coding",
    "command_execution",
    "memory",
  ]) {
    assert.ok(!p.requiredCapabilities.includes(forbidden), `${forbidden} must not be granted`);
  }
});

test("slash selectors cannot steer the plan", () => {
  assert.equal(requestWithoutSelectors("/skill:deploy  ship it"), "ship it");
  const p = plan("/mcp:github What is in my Documents folder?");
  assert.equal(p.requiresCoding, false);
});

test("plans expose their goal, outcome, steps and rationale", () => {
  const p = plan("Organize my Downloads folder by file type.");
  assert.ok(p.userGoal.length > 0);
  assert.ok(p.intendedOutcome.length > 0);
  assert.ok(p.steps.length >= 2);
  assert.ok(p.rationale.includes("filesystem"));
  assert.equal(p.planSource, "breadboard_task_planner_v1");
  assert.ok(p.steps.every((s, i) => s.index === i + 1));
});

test("resources are extracted for paths, urls and target formats", () => {
  const p = plan("Convert C:\\Users\\me\\notes\\draft.md to PDF and email it, see https://example.com/spec");
  const kinds = new Set(p.requiredResources.map((r) => r.kind));
  assert.ok(kinds.has("path"));
  assert.ok(kinds.has("url"));
  assert.ok(kinds.has("format"));
  assert.ok(p.requiredResources.some((r) => r.kind === "path" && r.absolute === true));
});
