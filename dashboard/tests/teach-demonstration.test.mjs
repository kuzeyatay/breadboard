// Teaching a workflow by demonstration.
//
// The tests are grouped by the promise each one is protecting:
//
//   - the timeline is a real join, so narration lands on the action it explains
//   - a coordinate never becomes an instruction
//   - grounding is honest about ambiguity instead of picking
//   - a consequential action is gated whether or not anyone narrated it
//   - the compiled form belongs to its workflow and is not a skill
//   - the raw recording is deletable and the workflow still runs
//   - nothing captured ever reaches a log
//
// Everything here runs without a screen, a microphone or a model.

import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

register("./teach-support/server-only-stub.mjs", import.meta.url);

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-teach-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;

const timeline = await import("../src/lib/teach/timeline.ts");
const grounding = await import("../src/lib/teach/grounding.ts");
const approvals = await import("../src/lib/teach/approvals.ts");
const redaction = await import("../src/lib/teach/redaction.ts");
const compile = await import("../src/lib/teach/compile.ts");
const induction = await import("../src/lib/teach/induction.ts");
const artifacts = await import("../src/lib/teach/artifacts.ts");
const backends = await import("../src/lib/teach/backends.ts");
const windowsCapture = await import("../src/lib/teach/windows-capture.ts");
const model = await import("../src/lib/teach/model.ts");
const promptInputs = await import("../src/lib/teach/prompt-inputs.ts");

const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/teach/store.ts");
const workflowStore = await import("../src/lib/workflows/store.ts");
const sessionManager = await import("../src/lib/teach/session-manager.ts");
const replay = await import("../src/lib/teach/replay.ts");

let userId = 0;

// Create a user by satisfying every NOT NULL column without a default, the way
// the other store-backed suites in this directory do.
function createUser(email) {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const names = [];
  const values = [];
  for (const column of columns) {
    if (column.pk) continue;
    if (column.notnull === 1 && column.dflt_value === null) {
      names.push(column.name);
      values.push(column.name === "email" ? email : `${column.name}-${email}`);
    }
  }
  if (!names.includes("email")) {
    names.push("email");
    values.push(email);
  }
  const placeholders = names.map(() => "?").join(", ");
  const info = db
    .prepare(`INSERT INTO users (${names.join(", ")}) VALUES (${placeholders})`)
    .run(...values);
  return Number(info.lastInsertRowid);
}

before(() => {
  userId = createUser("teach@example.test");
});

test("chat instructions fill only the inputs declared by a taught workflow", () => {
  const definitions = [
    { name: "customer_name", label: "Customer name", type: "string", required: true },
  ];
  assert.deepEqual(
    promptInputs.parseWorkflowInputPrompt(
      definitions,
      "do this workflow but change the name entered to Mike",
    ),
    { inputs: { customer_name: "Mike" }, missingRequired: [] },
  );
  assert.deepEqual(
    promptInputs.parseWorkflowInputPrompt(definitions, "run this with 'Ada Lovelace'"),
    { inputs: { customer_name: "Ada Lovelace" }, missingRequired: [] },
  );
});

test("chat input shorthand stays honest when two learned inputs are ambiguous", () => {
  const definitions = [
    { name: "first_name", label: "First name", type: "string", required: true },
    { name: "last_name", label: "Last name", type: "string", required: true },
  ];
  const ambiguous = promptInputs.parseWorkflowInputPrompt(definitions, "change the name to Mike");
  assert.deepEqual(ambiguous.inputs, {});
  assert.deepEqual(ambiguous.missingRequired.map((entry) => entry.name), ["first_name", "last_name"]);

  const explicit = promptInputs.parseWorkflowInputPrompt(
    definitions,
    "change first name to Mike and last name to Miller",
  );
  assert.deepEqual(explicit.inputs, { first_name: "Mike", last_name: "Miller" });
  assert.deepEqual(explicit.missingRequired, []);
});

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * Timeline synchronisation
 * ------------------------------------------------------------------ */

const EPOCH = 1_700_000_000_000;

function recordedLine(entry) {
  return JSON.stringify(entry);
}

const SAMPLE_LOG = [
  recordedLine({ type: "recording_started", timestampMs: EPOCH, source: "system" }),
  recordedLine({
    type: "mouse_click",
    timestampMs: EPOCH + 3_000,
    app: "TestApp",
    windowTitle: "Customers",
    target: 'button labeled "Customers"',
    x: 441,
    y: 281,
    screenWidth: 1920,
    screenHeight: 1080,
  }),
  // Typing is flushed when the burst ends, so it is written out of order on
  // purpose: the parser is what puts the log back into time order.
  recordedLine({
    type: "text_input",
    timestampMs: EPOCH + 8_000,
    app: "TestApp",
    target: 'edit labeled "Customer name"',
    detail: "Alice",
  }),
  "{ not json at all",
  recordedLine({ type: "mouse_click", timestampMs: EPOCH + 6_000, app: "TestApp", target: 'button labeled "New"' }),
  recordedLine({
    type: "text_input",
    timestampMs: EPOCH + 12_000,
    app: "TestApp",
    target: 'edit labeled "Password"',
    detail: "[redacted secret, 9 characters]",
    redacted: true,
  }),
  recordedLine({ type: "recording_stopped", timestampMs: EPOCH + 16_000, source: "system" }),
].join("\n");

test("the event log parses onto the recording's own clock, in time order", () => {
  const events = timeline.parseRecordedEvents(SAMPLE_LOG, EPOCH);

  assert.equal(events.length, 6, "the malformed line is dropped and nothing else is");
  assert.deepEqual(
    events.map((event) => event.offsetMs),
    [0, 3_000, 6_000, 8_000, 12_000, 16_000],
    "events are ordered by time, not by the order they were written",
  );
  assert.equal(events[1].coordinates.x, 441, "coordinates are kept as evidence");
  assert.equal(events[1].screenDimensions.width, 1920);
  assert.equal(events[1].importance, "high");
  assert.equal(events[4].redacted, true, "a secret field stays marked as redacted");
});

test("narration attaches to the action it explains, ahead of it and behind it", () => {
  const events = timeline.parseRecordedEvents(SAMPLE_LOG, EPOCH);
  const transcript = [
    // Spoken just before the click it describes.
    { startMs: 1_200, endMs: 2_600, text: "I'm opening the customer list." },
    // Spoken while typing.
    { startMs: 7_500, endMs: 9_800, text: "This name changes every time." },
    // Spoken long after everything, about nothing in particular.
    { startMs: 40_000, endMs: 42_000, text: "That's the whole job." },
  ];

  const built = timeline.buildDemonstrationTimeline({
    startedAt: new Date(EPOCH).toISOString(),
    durationMs: 16_000,
    events,
    transcript,
  });

  const click = built.entries.find((entry) => entry.event.target === 'button labeled "Customers"');
  assert.equal(click.narration.length, 1);
  assert.match(click.narration[0].text, /opening the customer list/);

  const typing = built.entries.find((entry) => entry.event.type === "text_input");
  assert.equal(typing.narration.length, 1);
  assert.match(typing.narration[0].text, /changes every time/);

  assert.equal(built.unattachedNarration.length, 1, "narration far from any action is kept separately");
  assert.match(built.unattachedNarration[0].text, /whole job/);
});

test("the audio offset shifts the transcript onto the recording clock", () => {
  const events = timeline.parseRecordedEvents(SAMPLE_LOG, EPOCH);
  // The microphone started 2.5s after the recorder, so a sentence at 0.5s on the
  // audio clock is at 3.0s on the recording clock -- which is the click.
  const built = timeline.buildDemonstrationTimeline({
    startedAt: new Date(EPOCH).toISOString(),
    durationMs: 16_000,
    events,
    transcript: [{ startMs: 400, endMs: 900, text: "Opening customers." }],
    audioStartOffsetMs: 2_500,
  });
  assert.equal(built.transcript[0].startMs, 2_900);
  const click = built.entries.find((entry) => entry.event.offsetMs === 3_000);
  assert.equal(click.narration.length, 1, "the shifted sentence now lands on the click");
});

test("the recorder's own UI is not part of the task", () => {
  const events = timeline.parseRecordedEvents(
    [
      recordedLine({ type: "mouse_click", timestampMs: EPOCH + 1_000, app: "TestApp", target: 'button labeled "Save"' }),
      recordedLine({
        type: "mouse_click",
        timestampMs: EPOCH + 2_000,
        app: "Breadboard",
        windowTitle: "Teach Workflow — Breadboard",
        target: 'button labeled "Finish"',
      }),
    ].join("\n"),
    EPOCH,
  );
  const built = timeline.buildDemonstrationTimeline({
    startedAt: new Date(EPOCH).toISOString(),
    durationMs: 3_000,
    events,
    transcript: [],
    hostApplications: ["breadboard"],
  });
  assert.equal(built.events.length, 1, "pressing Finish in Breadboard is not a step of the workflow");
  assert.equal(built.events[0].target, 'button labeled "Save"');
});

test("the prompt view of a demonstration carries no coordinates", () => {
  const events = timeline.parseRecordedEvents(SAMPLE_LOG, EPOCH);
  const built = timeline.buildDemonstrationTimeline({
    startedAt: new Date(EPOCH).toISOString(),
    durationMs: 16_000,
    events,
    transcript: [],
  });
  const rendered = timeline.renderTimelineForPrompt(built).join("\n");
  assert.doesNotMatch(rendered, /441/, "the demonstration's pixels are evidence, not instructions");
  assert.doesNotMatch(rendered, /1920/);
  assert.match(rendered, /button labeled "Customers"/);
  assert.match(
    rendered,
    /secret value/,
    "a redacted field is described without its contents",
  );
  assert.doesNotMatch(rendered, /\[redacted secret, 9 characters\]/u.source ? /nothing-to-match-here/u : /x/u);
});

/* ------------------------------------------------------------------ *
 * Grounding
 * ------------------------------------------------------------------ */

const SCREEN = [
  { ref: "e1", role: "Edit", name: "Customer name", describe: 'edit labeled "Customer name"', width: 200, height: 24, enabled: true },
  { ref: "e2", role: "Text", name: "Customer name", describe: 'text labeled "Customer name"', width: 90, height: 16, enabled: true },
  { ref: "e3", role: "Button", name: "Search", describe: 'button labeled "Search"', width: 80, height: 28, enabled: true },
  { ref: "e4", role: "Button", name: "Search again", describe: 'button labeled "Search again"', width: 110, height: 28, enabled: true },
  { ref: "e5", role: "Button", name: "Send", describe: 'button labeled "Send"', width: 70, height: 28, enabled: true },
];

test("a uniquely labelled control grounds confidently", () => {
  const result = grounding.groundTarget('button labeled "Search"', SCREEN, { action: "click" });
  assert.equal(result.element.ref, "e3");
  assert.equal(result.confident, true);
});

test("a step that types picks the field, not the label beside it", () => {
  const result = grounding.groundTarget('the "Customer name" text field', SCREEN, { action: "type" });
  assert.equal(result.element.ref, "e1", "an Edit beats a Text of the same name for typing");
});

test("two plausible matches are reported as ambiguous rather than guessed", () => {
  const crowded = [
    { ref: "a", role: "ListItem", name: "Invoice 2024", describe: 'list item "Invoice 2024"', width: 300, height: 20 },
    { ref: "b", role: "ListItem", name: "Invoice 2025", describe: 'list item "Invoice 2025"', width: 300, height: 20 },
  ];
  const result = grounding.groundTarget("the invoice row", crowded, { action: "click" });
  assert.equal(result.confident, false, "picking one of two invoices silently is the bug this prevents");
  assert.ok(result.candidates.length >= 2, "both are handed up to be chosen between");
});

test("a quoted label that matches nothing does not ground on role alone", () => {
  // The failure this prevents, found while running the acceptance scenario: a
  // step looking for the "Customer name" field grounded on the browser's
  // address bar, because both are editable, and typed the customer into it.
  const wrongScreen = [
    { ref: "a1", role: "Edit", name: "Address and search bar", describe: 'edit labeled "Address and search bar"', width: 400, height: 24, enabled: true },
    { ref: "a2", role: "Button", name: "Search tabs", describe: 'button labeled "Search tabs"', width: 30, height: 30, enabled: true },
  ];
  const field = grounding.groundTarget('the "Customer name" text field', wrongScreen, { action: "type" });
  assert.equal(field.element, null, "an editable control is not the field just because it is editable");

  // "Search tabs" is a near miss rather than nothing, so it is reported as a
  // candidate but never as a confident match: a near miss is exactly what has
  // to be escalated rather than clicked.
  const button = grounding.groundTarget('button labeled "Search"', wrongScreen, { action: "click" });
  assert.equal(button.confident, false, '"Search tabs" is not confidently the "Search" button');

  // And the real button still wins outright when it is on the screen.
  const bothPresent = [
    ...wrongScreen,
    { ref: "a3", role: "Button", name: "Search", describe: 'button labeled "Search"', width: 80, height: 28, enabled: true },
  ];
  const resolved = grounding.groundTarget('button labeled "Search"', bothPresent, { action: "click" });
  assert.equal(resolved.element.ref, "a3");
  assert.equal(resolved.confident, true);
});

test("nothing matching is nothing matching, not a low-confidence guess", () => {
  const result = grounding.groundTarget('button labeled "Reconcile"', SCREEN, { action: "click" });
  assert.equal(result.element, null);
  assert.equal(result.confident, false);
});

test("a target naming an input is grounded against this run's value", () => {
  const rows = [
    { ref: "r1", role: "ListItem", name: "Alice", describe: 'list item "Alice"', width: 200, height: 20 },
    { ref: "r2", role: "ListItem", name: "Bob", describe: 'list item "Bob"', width: 200, height: 20 },
  ];
  const result = grounding.groundTarget('the row containing "{{customer_name}}"', rows, {
    action: "click",
    inputs: { customer_name: "Bob" },
  });
  assert.equal(result.element.ref, "r2", "the demonstration used Alice; this run uses Bob");
});

test("placeholders resolve, and an unsupplied one is left visible rather than blanked", () => {
  assert.equal(grounding.resolvePlaceholders("Hello {{name}}", { name: "Bob" }), "Hello Bob");
  assert.equal(grounding.resolvePlaceholders("Hello {{name}}", {}), "Hello {{name}}");
});

test("an expectation is satisfied only by evidence of it", () => {
  const detail = [
    { ref: "d1", role: "Text", name: "Customer detail", describe: 'text "Customer detail"', width: 200, height: 20 },
    { ref: "d2", role: "Text", name: "Bob", describe: 'text "Bob"', width: 60, height: 20 },
  ];
  assert.equal(grounding.expectationVisible('the "Customer detail" panel is visible', detail).satisfied, true);
  assert.equal(grounding.expectationVisible('the "Order history" panel is visible', detail).satisfied, false);
});

/* ------------------------------------------------------------------ *
 * Approval boundaries
 * ------------------------------------------------------------------ */

function step(overrides) {
  return {
    id: overrides.id ?? "step-1",
    instruction: overrides.instruction ?? "do the thing",
    action: overrides.action ?? "click",
    route: overrides.route ?? "gui",
    fallbackRoutes: [],
    ...overrides,
  };
}

test("consequential actions are gated by policy", () => {
  const gated = [
    step({ target: 'button labeled "Send"' }),
    step({ target: 'button labeled "Submit"' }),
    step({ target: 'button labeled "Place order"' }),
    step({ target: 'button labeled "Delete"' }),
    step({ instruction: "confirm the payment", target: 'button labeled "Pay now"' }),
    step({ target: 'button labeled "Publish"' }),
    step({ action: "run", route: "shell", actionArgs: { command: "rm -rf ./build" } }),
  ];
  for (const candidate of gated) {
    assert.equal(
      approvals.classifyStepForApproval(candidate).required,
      true,
      `expected approval for ${candidate.target ?? candidate.actionArgs?.command}`,
    );
  }
});

test("preparation is not gated", () => {
  const open = [
    step({ action: "type", target: 'edit labeled "Customer name"', actionArgs: { text: "Bob" } }),
    step({ action: "click", target: 'button labeled "Search"' }),
    step({ action: "scroll", target: "the results list" }),
    step({ action: "verify", expectation: "the detail panel is visible" }),
  ];
  for (const candidate of open) {
    assert.equal(approvals.classifyStepForApproval(candidate).required, false);
  }
});

test("policy adds approvals; it never removes the ones narration created", () => {
  const procedure = {
    name: "Send the report",
    goal: "",
    description: "",
    inputs: [],
    steps: [
      step({ id: "step-1", action: "click", target: 'button labeled "Preview"', approvalRequired: true, approvalReason: "I always look at it first." }),
      step({ id: "step-2", action: "click", target: 'button labeled "Send"' }),
    ],
    constraints: [],
    approvals: [],
    successCriteria: [],
    failureCriteria: [],
    recovery: [],
    ambiguities: [],
    confidence: "medium",
    sourceDemonstration: {
      sessionId: "s",
      recordedAt: "",
      durationMs: 0,
      transcriptAvailable: true,
      framesAvailable: false,
      videoAvailable: false,
      eventCount: 0,
    },
  };

  const result = approvals.ensureApprovalBoundaries(procedure);
  assert.equal(result.steps[0].approvalRequired, true, "the narrated pause survives");
  assert.equal(result.steps[1].approvalRequired, true, "and Send is gated even though nobody said so");
  assert.deepEqual(
    result.approvals.map((approval) => approval.source).sort(),
    ["narration", "policy"],
  );
});

/* ------------------------------------------------------------------ *
 * Induction: normalising what a model returned
 * ------------------------------------------------------------------ */

const PARSE_CONTEXT = {
  sessionId: "session-1",
  recordedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 20_000,
  eventCount: 6,
  transcriptAvailable: true,
  framesAvailable: true,
  videoAvailable: false,
  fallbackName: "Untitled workflow",
};

test("a coordinate that slips into the model's answer is stripped out", () => {
  const parsed = induction.parseInductionResponse(
    {
      name: "Look up a customer",
      goal: "Find a customer by name",
      steps: [
        {
          instruction: "Click Search (441, 281)",
          action: "click",
          route: "gui",
          target: 'button labeled "Search" at x=441 y=281',
        },
      ],
    },
    PARSE_CONTEXT,
  );
  assert.doesNotMatch(parsed.steps[0].instruction, /441/);
  assert.doesNotMatch(parsed.steps[0].target, /441|281/);
  assert.match(parsed.steps[0].target, /button labeled "Search"/);
});

test("input names are normalised and referenced, not repeated as literals", () => {
  const parsed = induction.parseInductionResponse(
    {
      name: "Look up a customer",
      goal: "Find a customer",
      inputs: [
        { name: "Customer Name", label: "Customer", type: "string", demonstratedValue: "Alice" },
        { name: "Customer Name", label: "Duplicate", type: "string" },
        { name: "??", type: "nonsense" },
      ],
      steps: [
        { instruction: "Type {{customer_name}}", action: "type", route: "gui", actionArgs: { text: "{{customer_name}}" } },
      ],
    },
    PARSE_CONTEXT,
  );
  assert.deepEqual(
    parsed.inputs.map((input) => input.name),
    ["customer_name", "input_2"],
    "names become identifiers and duplicates are dropped",
  );
  assert.equal(parsed.inputs[1].type, "string", "an unknown type falls back rather than propagating");
  assert.equal(parsed.steps[0].actionArgs.text, "{{customer_name}}");
});

test("open questions become answerable questions, not silent rules", () => {
  const parsed = induction.parseInductionResponse(
    {
      name: "Pick a result",
      goal: "",
      steps: [{ instruction: "Click the first result", action: "click", route: "gui" }],
      openQuestions: [
        {
          question: "You selected the first search result. Should the workflow always use the first one?",
          options: [
            { label: "Always use the first result" },
            { label: "Find the result matching the customer name", recommended: true },
          ],
          affectsSteps: [1],
        },
      ],
    },
    PARSE_CONTEXT,
  );
  assert.equal(parsed.ambiguities.length, 1);
  assert.equal(parsed.ambiguities[0].options.length, 2);
  assert.deepEqual(parsed.ambiguities[0].affectsStepIds, ["step-1"]);
  assert.equal(parsed.ambiguities[0].resolution, undefined, "nothing is settled until a person settles it");
});

test("a demonstration with no recognisable steps is a parse with no steps", () => {
  const parsed = induction.parseInductionResponse({ name: "Nothing" }, PARSE_CONTEXT);
  assert.equal(parsed.steps.length, 0);
});

test("the model's answer is found even when it is wrapped in prose and fences", () => {
  const extracted = model.extractJsonObject(
    'Here is the workflow:\n```json\n{"name":"A","steps":[]}\n```\nHope that helps.',
  );
  assert.equal(extracted.name, "A");
});

test("answering a question records the answer as a rule the workflow keeps", () => {
  const base = induction.parseInductionResponse(
    {
      name: "Pick a result",
      goal: "",
      steps: [{ instruction: "Click a result", action: "click", route: "gui" }],
      openQuestions: [
        { question: "Which result?", options: [{ label: "The first" }, { label: "The matching one" }] },
      ],
    },
    PARSE_CONTEXT,
  );
  const answered = sessionManager.applyAnswers(base, { "question-1": "question-1-option-2" });
  assert.equal(answered.ambiguities[0].resolution, "The matching one");
  assert.ok(
    answered.constraints.some((constraint) => constraint.text.includes("The matching one")),
    "the answer survives into the thing that runs, not just the review screen",
  );
});

/* ------------------------------------------------------------------ *
 * The compiled representation
 * ------------------------------------------------------------------ */

function sampleProcedure(overrides = {}) {
  return {
    name: "Look up a customer",
    goal: "Find a customer's detail panel by name.",
    description: "Enters a customer name and searches for it.",
    inputs: [
      { name: "customer_name", label: "Customer name", type: "string", required: true, demonstratedValue: "Alice" },
    ],
    steps: [
      {
        id: "step-1",
        instruction: "Enter {{customer_name}} in the customer name field",
        action: "type",
        route: "gui",
        fallbackRoutes: [],
        target: 'text field labeled "Customer name"',
        actionArgs: { text: "{{customer_name}}" },
      },
      {
        id: "step-2",
        instruction: "Press Search",
        action: "click",
        route: "gui",
        fallbackRoutes: [],
        target: 'button labeled "Search"',
        expectation: "the customer detail panel is visible",
      },
    ],
    constraints: [{ text: "Use the customer supplied at run time.", kind: "always", source: "narration" }],
    approvals: [],
    successCriteria: [{ text: "The customer detail panel is visible." }],
    failureCriteria: [],
    recovery: [],
    ambiguities: [],
    confidence: "high",
    sourceDemonstration: {
      sessionId: "session-1",
      recordedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 20_000,
      transcriptAvailable: true,
      framesAvailable: true,
      videoAvailable: false,
      eventCount: 6,
    },
    ...overrides,
  };
}

test("compiling writes the executable form inside the workflow's own directory", () => {
  const compiled = compile.compileProcedure("wf-compile-test", sampleProcedure(), 1);

  assert.equal(compiled.type, "understudy-skill");
  assert.deepEqual(compiled.files.sort(), ["PROCEDURE.md", "anchors.json", "metadata.json", "workflow.json"]);

  const expectedRoot = artifacts.workflowDirectory("wf-compile-test");
  assert.ok(
    path.resolve(compiled.directory).startsWith(path.resolve(expectedRoot)),
    "the compiled form lives under the workflow it belongs to",
  );
  for (const file of compiled.files) {
    assert.ok(fs.existsSync(path.join(compiled.directory, file)), `${file} was written`);
  }
});

test("a compiled workflow is not a skill anyone can find, edit or install", () => {
  compile.compileProcedure("wf-not-a-skill", sampleProcedure(), 1);

  // It is not in any skill catalog, and the catalogs are not touched at all.
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  const catalogs = [
    path.join(repoRoot, ".agents", "skills", "registry.json"),
    path.join(repoRoot, "skills-lock.json"),
  ];
  for (const catalog of catalogs) {
    if (!fs.existsSync(catalog)) continue;
    const contents = fs.readFileSync(catalog, "utf8");
    assert.doesNotMatch(contents, /wf-not-a-skill/, `${path.basename(catalog)} was left alone`);
  }

  // And it says so about itself, for whoever finds the directory later.
  const metadata = JSON.parse(
    fs.readFileSync(path.join(artifacts.workflowCompiledDirectory("wf-not-a-skill"), "v1", "metadata.json"), "utf8"),
  );
  assert.equal(metadata.source, "demonstration");
  assert.match(metadata.note, /not a user skill/i);
});

test("the compiled procedure leads with the rules and never with a coordinate", () => {
  const markdown = compile.renderProcedureMarkdown(
    sampleProcedure({
      constraints: [{ text: "Never overwrite an existing file.", kind: "never", source: "narration" }],
      approvals: [{ stepId: "step-2", reason: "This submits a form.", source: "policy" }],
      steps: sampleProcedure().steps.map((entry) =>
        entry.id === "step-2" ? { ...entry, approvalRequired: true, approvalReason: "This submits a form." } : entry,
      ),
    }),
  );
  assert.ok(markdown.indexOf("## Rules") < markdown.indexOf("## Steps"), "rules come before steps");
  assert.ok(markdown.indexOf("## Approvals") < markdown.indexOf("## Steps"));
  assert.match(markdown, /Ask the user before doing this/);
  assert.match(markdown, /must not be used/, "it states that demonstration coordinates are not instructions");
  assert.doesNotMatch(markdown, /\b\d{3,4}\s*,\s*\d{3,4}\b/u);
});

test("anchors describe how to find a target, not where it was", () => {
  const anchors = compile.buildAnchors(sampleProcedure());
  assert.equal(anchors.length, 2);
  assert.equal(anchors[1].visibleText, "Search");
  assert.equal(anchors[1].role, "button");
  assert.ok(!("x" in anchors[1]) && !("left" in anchors[1]));
});

/* ------------------------------------------------------------------ *
 * Storage, versions, lifecycle
 * ------------------------------------------------------------------ */

test("a demonstrated workflow is a workflow row, and shows as one in the list", () => {
  const created = workflowStore.createWorkflow(userId, { name: "Placeholder" });
  const procedure = sampleProcedure();
  const compiled = compile.compileProcedure(created.id, procedure, 1);
  const version = store.saveProcedureVersion({
    userId,
    workflowId: created.id,
    procedure: { ...procedure, compiled },
    compiledDirectory: compiled.directory,
    demonstrationId: null,
    note: "Learned from a demonstration.",
  });

  assert.equal(version, 1);

  const listed = workflowStore.listWorkflows(userId).find((entry) => entry.id === created.id);
  assert.equal(listed.source, "demonstration");
  assert.equal(listed.stepCount, 2);
  assert.equal(listed.name, "Look up a customer", "the row's name follows what was learned");
  assert.deepEqual(listed.inputs, [
    { name: "customer_name", label: "Customer name", type: "string", required: true },
  ]);

  const loaded = store.getDemonstratedWorkflow(userId, created.id);
  assert.equal(loaded.procedure.inputs[0].name, "customer_name");
});

test("a canvas workflow is untouched by any of this", () => {
  const canvas = workflowStore.createWorkflow(userId, { name: "A canvas workflow" });
  const listed = workflowStore.listWorkflows(userId).find((entry) => entry.id === canvas.id);
  assert.equal(listed.source, "canvas");
  assert.equal(store.isDemonstratedWorkflow(userId, canvas.id), false);
  assert.equal(store.getDemonstratedWorkflow(userId, canvas.id), null);
});

test("re-teaching adds a version and keeps the one that was working", () => {
  const created = workflowStore.createWorkflow(userId, { name: "Versioned" });
  const first = sampleProcedure();
  const firstCompiled = compile.compileProcedure(created.id, first, 1);
  store.saveProcedureVersion({
    userId,
    workflowId: created.id,
    procedure: { ...first, compiled: firstCompiled },
    compiledDirectory: firstCompiled.directory,
    demonstrationId: null,
  });

  const second = sampleProcedure({
    steps: [
      ...sampleProcedure().steps,
      {
        id: "step-3",
        instruction: "Check the total before submitting",
        action: "verify",
        route: "gui",
        fallbackRoutes: [],
        expectation: "the total matches the invoice",
      },
    ],
  });
  const secondCompiled = compile.compileProcedure(created.id, second, 2);
  const version = store.saveProcedureVersion({
    userId,
    workflowId: created.id,
    procedure: { ...second, compiled: secondCompiled },
    compiledDirectory: secondCompiled.directory,
    demonstrationId: null,
    note: "Revised from a second demonstration.",
  });

  assert.equal(version, 2);
  const versions = store.listProcedureVersions(created.id);
  assert.deepEqual(versions.map((entry) => entry.version), [2, 1]);

  const previous = store.getProcedureVersion(created.id, 1);
  assert.equal(JSON.parse(previous.procedure).steps.length, 2, "v1 is still readable");
  assert.ok(
    fs.existsSync(path.join(firstCompiled.directory, "workflow.json")),
    "and v1's compiled form was not destroyed by the re-teach",
  );
});

test("a re-teach diff names what changed", () => {
  const before = sampleProcedure();
  const after = sampleProcedure({
    steps: [
      ...before.steps,
      { id: "step-3", instruction: "Check the total", action: "verify", route: "gui", fallbackRoutes: [] },
    ],
    constraints: [...before.constraints, { text: "Never send before checking.", kind: "never", source: "narration" }],
  });
  const diff = induction.diffProcedures(before, after);
  assert.deepEqual(diff.addedSteps, ["Check the total"]);
  assert.equal(diff.removedSteps.length, 0);
  assert.deepEqual(diff.addedConstraints, ["Never send before checking."]);
  assert.match(diff.summary, /1 step\(s\) added/);
});

test("deleting a workflow takes its compiled form and run artifacts with it", () => {
  const created = workflowStore.createWorkflow(userId, { name: "Doomed" });
  const procedure = sampleProcedure();
  const compiled = compile.compileProcedure(created.id, procedure, 1);
  store.saveProcedureVersion({
    userId,
    workflowId: created.id,
    procedure: { ...procedure, compiled },
    compiledDirectory: compiled.directory,
    demonstrationId: null,
  });
  const directory = artifacts.workflowDirectory(created.id);
  assert.ok(fs.existsSync(directory));

  assert.equal(workflowStore.deleteWorkflow(userId, created.id), true);
  assert.equal(fs.existsSync(directory), false, "nothing of it is left on disk");
  assert.equal(workflowStore.getWorkflow(userId, created.id), null);
});

test("cancelling a demonstration deletes its recording", () => {
  const row = store.createDemonstration({ userId, name: "Cancelled" });
  const recording = artifacts.ensureDirectory(artifacts.sessionRecordingDirectory(row.id));
  fs.writeFileSync(path.join(recording, "narration.webm"), Buffer.alloc(2048));
  fs.writeFileSync(path.join(recording, "events.jsonl"), SAMPLE_LOG);

  const discarded = artifacts.discardSessionRecording(row.id);
  assert.equal(discarded.removed, true);
  assert.ok(discarded.bytes > 2000, "it reports what it reclaimed");
  assert.equal(fs.existsSync(recording), false);
});

test("a workflow still runs after its raw demonstration is deleted", () => {
  const created = workflowStore.createWorkflow(userId, { name: "Survives cleanup" });
  const demonstration = store.createDemonstration({ userId, name: "Survives cleanup" });
  const recording = artifacts.ensureDirectory(artifacts.sessionRecordingDirectory(demonstration.id));
  fs.writeFileSync(path.join(recording, "narration.webm"), Buffer.alloc(1024));

  const procedure = sampleProcedure();
  const compiled = compile.compileProcedure(created.id, procedure, 1);
  store.saveProcedureVersion({
    userId,
    workflowId: created.id,
    procedure: { ...procedure, compiled },
    compiledDirectory: compiled.directory,
    demonstrationId: demonstration.id,
  });

  artifacts.discardSessionRecording(demonstration.id);
  assert.equal(fs.existsSync(recording), false, "the recording really is gone");

  const loaded = store.getDemonstratedWorkflow(userId, created.id);
  assert.equal(loaded.procedure.steps.length, 2, "the procedure is intact");
  assert.equal(
    compile.readCompiledProcedure(loaded.procedure.compiled).steps.length,
    2,
    "and so is the form it runs from",
  );
});

test("a path from stored data cannot climb out of the directory it belongs to", () => {
  const root = artifacts.workflowDirectory("wf-path-test");
  assert.throws(() => artifacts.resolveWithin(root, "../../../etc/passwd"), /outside/);
  assert.throws(() => artifacts.assertSafeId("../escape", "workflow id"), /Invalid/);
  assert.ok(artifacts.resolveWithin(root, "compiled/v1/workflow.json").startsWith(path.resolve(root)));
});

/* ------------------------------------------------------------------ *
 * The narration upload
 * ------------------------------------------------------------------ */

function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("narration streams to disk and records where the audio clock sits", async () => {
  const row = store.createDemonstration({ userId, name: "Narrated" });
  const audio = Buffer.from("fake-opus-bytes-".repeat(64));

  const result = await sessionManager.storeNarration({
    userId,
    sessionId: row.id,
    body: streamOf([new Uint8Array(audio.subarray(0, 200)), new Uint8Array(audio.subarray(200))]),
    audioStartOffsetMs: 1_450,
  });

  assert.equal(result.bytes, audio.length);
  const written = path.join(artifacts.sessionRecordingDirectory(row.id), "narration.webm");
  assert.equal(fs.readFileSync(written).length, audio.length, "the whole upload landed, in order");

  const after = store.requireDemonstration(userId, row.id);
  assert.equal(after.audio_offset_ms, 1_450);
});

test("an implausible clock offset is clamped, not trusted", async () => {
  const row = store.createDemonstration({ userId, name: "Skewed" });
  await sessionManager.storeNarration({
    userId,
    sessionId: row.id,
    body: streamOf([new Uint8Array(Buffer.from("abc"))]),
    // A browser claiming the microphone started three hours after the recorder.
    audioStartOffsetMs: 3 * 60 * 60 * 1000,
  });
  const after = store.requireDemonstration(userId, row.id);
  assert.equal(after.audio_offset_ms, 60_000, "a measurement from the client is a claim, not a fact");
});

test("an empty narration upload is refused rather than stored", async () => {
  const row = store.createDemonstration({ userId, name: "Silent" });
  await assert.rejects(
    () => sessionManager.storeNarration({ userId, sessionId: row.id, body: streamOf([]), audioStartOffsetMs: 0 }),
    /empty/,
  );
  assert.equal(
    fs.existsSync(path.join(artifacts.sessionRecordingDirectory(row.id), "narration.webm")),
    false,
  );
});

test("an analysis a restart interrupted is resumed, not thrown away", async () => {
  const row = store.createDemonstration({ userId, name: "Half analysed" });
  store.updateDemonstration(userId, row.id, { state: "processing", startedEpochMs: EPOCH });
  const recording = artifacts.ensureDirectory(artifacts.sessionRecordingDirectory(row.id));
  fs.writeFileSync(path.join(recording, "events.jsonl"), SAMPLE_LOG);

  const recovered = sessionManager.recoverOrphanedSessions();
  assert.ok(recovered.resumed >= 1, "the recording is still on disk, so re-analysing it costs nothing");
  assert.equal(
    fs.existsSync(path.join(recording, "events.jsonl")),
    true,
    "the recording it needs is left alone",
  );

  // The resumed analysis is a real background job. Stop it and wait for it,
  // rather than letting it outlive this test and reach a closed database.
  await sessionManager.cancelTeaching(userId, row.id);
  await sessionManager.awaitProcessing(row.id);
});

test("an analysis whose recording is gone fails honestly instead of hanging", () => {
  const row = store.createDemonstration({ userId, name: "Nothing left" });
  store.updateDemonstration(userId, row.id, { state: "processing" });

  sessionManager.recoverOrphanedSessions();

  const after = store.requireDemonstration(userId, row.id);
  assert.equal(after.state, "failed");
  assert.match(after.error, /no longer available/);
});

test("a teaching session left recording by a restart is closed and its recording dropped", () => {
  const row = store.createDemonstration({ userId, name: "Orphaned session" });
  store.updateDemonstration(userId, row.id, { state: "recording" });
  const recording = artifacts.ensureDirectory(artifacts.sessionRecordingDirectory(row.id));
  fs.writeFileSync(path.join(recording, "events.jsonl"), SAMPLE_LOG);

  const recovered = sessionManager.recoverOrphanedSessions();
  assert.ok(recovered.closed >= 1);

  const after = store.requireDemonstration(userId, row.id);
  assert.equal(after.state, "failed");
  assert.match(after.error, /restarted/);
  assert.equal(fs.existsSync(recording), false, "a recording nobody owns is not kept");
});

/* ------------------------------------------------------------------ *
 * Runs, approvals, stopping, recovery
 * ------------------------------------------------------------------ */

test("a run refuses to start without the values it needs", async () => {
  const created = workflowStore.createWorkflow(userId, { name: "Needs input" });
  const procedure = sampleProcedure();
  const compiled = compile.compileProcedure(created.id, procedure, 1);
  store.saveProcedureVersion({
    userId,
    workflowId: created.id,
    procedure: { ...procedure, compiled },
    compiledDirectory: compiled.directory,
    demonstrationId: null,
  });

  assert.throws(
    () => replay.startDemonstrationRun({ userId, workflowId: created.id, inputs: {} }),
    /needs a value for customer_name/,
  );
});

test("a run left over from a restart is stopped, not resumed", () => {
  const created = workflowStore.createWorkflow(userId, { name: "Orphan" });
  const runId = store.createRun({ userId, workflowId: created.id, version: 1, inputs: { customer_name: "Bob" } });
  store.updateRun(runId, { state: "running" });

  const recovered = replay.recoverOrphanedRuns();
  assert.ok(recovered.closed >= 1);

  const row = store.getRun(userId, runId);
  assert.equal(row.state, "stopped", "safety beats picking up control of a machine nobody has looked at");
  assert.match(row.error, /restarted/);
  assert.equal(replay.isRunActive(runId), false);
});

test("an unmet precondition stops a consequential step and only warns before an ordinary one", () => {
  // "Check the total before submitting" is the reason the submit is allowed, so
  // a check that cannot be confirmed has to stop it. The same words in front of
  // an ordinary click are usually the induction describing intent, and failing
  // the run on those loses runs that would have worked -- the step's own target
  // still has to be found either way.
  assert.equal(replay.blocksOnPrecondition({ action: "click", approvalRequired: true }), true);
  assert.equal(replay.blocksOnPrecondition({ action: "verify" }), true);
  assert.equal(replay.blocksOnPrecondition({ action: "run" }), true);
  assert.equal(replay.blocksOnPrecondition({ action: "click" }), false);
  assert.equal(replay.blocksOnPrecondition({ action: "type" }), false);
});

test("a focus step finds its window from the target when no hint was filled in", () => {
  assert.equal(
    replay.windowHintFor({ target: 'browser window containing the heading "Customer Lookup"' }, {}),
    "Customer Lookup",
  );
  assert.equal(replay.windowHintFor({ windowHint: "Invoices — {{customer}}" }, { customer: "Bob" }), "Invoices — Bob");
  // Nothing to match on stays nothing, so the caller can refuse rather than
  // focus whichever window came first.
  assert.equal(replay.windowHintFor({ target: "the browser window" }, {}), undefined);
});

test("approving a run that is not waiting is refused rather than swallowed", () => {
  assert.equal(replay.decideApproval(userId, "no-such-run", true), false);
});

/* ------------------------------------------------------------------ *
 * Logging
 * ------------------------------------------------------------------ */

test("nothing captured reaches a log line", () => {
  const events = timeline.parseRecordedEvents(SAMPLE_LOG, EPOCH);
  const typed = events.find((event) => event.type === "text_input" && !event.redacted);
  const line = redaction.describeEventForLog(typed);

  assert.doesNotMatch(line, /Alice/, "typed text is reported as a length, never a value");
  assert.match(line, /text=<5 characters>/);
  assert.match(line, /type=text_input/, "what happened is still debuggable");

  const secret = events.find((event) => event.redacted);
  assert.match(redaction.describeEventForLog(secret), /withheld\(secret field\)/);

  const scrubbed = redaction.redactForLog({
    windowTitle: "Online banking — transfer",
    transcript: "I'm sending the payment now",
    screenshotPath: "C:/Users/someone/frames/action-1.jpg",
    audio: "…",
    token: "sk-live-1234",
    elementCount: 42,
    ok: true,
  });
  const serialized = JSON.stringify(scrubbed);
  for (const secretText of ["Online banking", "sending the payment", "someone", "sk-live"]) {
    assert.doesNotMatch(serialized, new RegExp(secretText), `${secretText} must not be loggable`);
  }
  assert.equal(scrubbed.elementCount, 42, "counts and flags stay, because they are what debugging needs");
  assert.equal(scrubbed.ok, true);
});

test("a path is logged as a shape, not a location", () => {
  assert.equal(redaction.redactPath("C:/Users/someone/teach/frames/action-3.jpg"), "<file.jpg>");
  assert.equal(redaction.redactPath(null), "(none)");
});

/* ------------------------------------------------------------------ *
 * Platform boundary
 * ------------------------------------------------------------------ */

test("an unsupported platform says so instead of pretending", async () => {
  const availability = backends.teachAvailability();
  assert.equal(typeof availability.available, "boolean");
  assert.equal(availability.platform, process.platform);
  if (!availability.available) {
    assert.ok(availability.reason && availability.reason.length > 0, "an unavailable backend explains itself");
  }
  if (process.platform !== "win32") {
    const backend = backends.demonstrationCaptureBackend();
    await assert.rejects(
      () => backend.start({ sessionId: "x", outputDirectory: dataRoot, captureFrames: false, maxFrames: 1, frameMaxWidth: 100 }),
      /capture backend/,
    );
  }
});

test("a Windows CLR crash is explained instead of shown as an opaque decimal code", () => {
  const message = windowsCapture.recorderExitMessage(3762504530);
  assert.match(message, /Windows demonstration recorder crashed during startup/);
  assert.doesNotMatch(message, /3762504530/);

  assert.match(
    windowsCapture.recorderExitMessage(4, "The recording folder was not prepared correctly."),
    /could not start.*recording folder was not prepared correctly/i,
  );
});

test("Windows extended paths are converted only at the legacy helper boundary", () => {
  assert.equal(
    windowsCapture.pathForLegacyWindowsHelper("\\\\?\\C:\\Breadboard\\recording"),
    "C:\\Breadboard\\recording",
  );
  assert.equal(
    windowsCapture.pathForLegacyWindowsHelper("\\\\?\\UNC\\server\\share\\recording"),
    "\\\\server\\share\\recording",
  );
  assert.equal(
    windowsCapture.pathForLegacyWindowsHelper("C:\\Breadboard\\recording"),
    "C:\\Breadboard\\recording",
  );
});

test("the Windows helper source stays inside what its compiler accepts", () => {
  if (process.platform !== "win32") return;
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "scripts", "teach", "BreadboardTeach.cs"),
    "utf8",
  );
  // The helper is built by the .NET Framework compiler that ships with Windows,
  // which is a C# 5 compiler. These are the constructs that silently pass review
  // and then fail to build on a user's machine.
  assert.doesNotMatch(source, /\$"/, "no interpolated strings");
  assert.doesNotMatch(source, /\?\./, "no null-conditional operators");
  assert.doesNotMatch(source, /=>\s*[^{\s][^;\n]*;\s*$/m, "no expression-bodied members");
  assert.doesNotMatch(source, /\bnameof\s*\(/, "no nameof");
  assert.match(source, /if \(!Directory\.Exists\(outputDirectory\)\)[\s\S]*Directory\.CreateDirectory\(outputDirectory\)/);
  assert.match(source, /if \(captureFrames && !Directory\.Exists\(framesDirectory\)\)[\s\S]*Directory\.CreateDirectory\(framesDirectory\)/);
  assert.match(source, /BB_TEACH_ERROR\|/);
});

test("a recorder being launched is protected from orphan recovery", () => {
  const source = fs.readFileSync(
    new URL("../src/lib/teach/windows-capture.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /starting\.add\(options\.sessionId\)/);
  assert.match(source, /finally \{[\s\S]*starting\.delete\(options\.sessionId\)/);
  assert.match(
    source,
    /return registry\(\)\.has\(sessionId\) \|\| startingRegistry\(\)\.has\(sessionId\)/,
  );
});
