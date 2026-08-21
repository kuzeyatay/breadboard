// The MatrAIx agent's own coverage.
//
// The shared suites already walk every agent for the promises that break
// silently — the run card surviving a reload, the abort table, the selection
// brief. What is left is what only this agent has:
//
//   * a command whose flags decide who answers, where a stored preference must
//     never beat a flag typed in the message;
//   * a questionnaire produced by a model, where the schema has to reject
//     exactly what the clone's own `SurveyQuestion` constructor would raise on,
//     since a raise inside the bridge is a study that never starts;
//   * a cohort that has to be reconciled against a persona pool nobody controls,
//     including the arithmetic that makes a stratified request impossible;
//   * a protocol boundary with a Python bridge, asserted from both sides rather
//     than trusted to a comment.
//
// The clone is read directly wherever this integration depends on it, so an
// upstream rename fails here rather than at the next run.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(here, "..");
const repositoryRoot = path.resolve(dashboard, "..");
const clone = path.join(repositoryRoot, "MatrAIx-Persona-8B");
const bridgeSource = fs.readFileSync(
  path.join(repositoryRoot, "scripts", "matraix-bridge.py"),
  "utf8",
);

const {
  MATRAIX_COMMAND,
  MATRAIX_AGENT_ID,
  MATRAIX_AGENT_NAME,
  MATRAIX_MAX_RESPONDENTS,
  MATRAIX_DEFAULT_RESPONDENTS,
  describeMatraixCohort,
  matraixUserMessage,
  parseMatraixRequest,
  taskFromMatraixCommand,
} = await import("../src/lib/matraix/identity.ts");

const { studyDraftSchema, parseWithSchema, MATRAIX_QUESTION_TYPES } = await import(
  "../src/lib/matraix/schemas.ts"
);

const { reconcileFilters, reconcileDimensions, renderDimensionMenu } = await import(
  "../src/lib/matraix/catalog.ts"
);

const { matraixDefaults } = await import("../src/lib/agent-settings/defaults.ts");
const { CONFIGURABLE_AGENTS } = await import("../src/lib/agent-settings/catalog.ts");

// ---------------------------------------------------------------------------
// the command
// ---------------------------------------------------------------------------

test("the command token is recognised and its three spellings agree", () => {
  assert.equal(MATRAIX_COMMAND, "/agents:matraix");
  assert.equal(MATRAIX_AGENT_ID, "matraix");
  assert.equal(MATRAIX_AGENT_NAME, "MatrAIx");
  assert.equal(MATRAIX_COMMAND, `/agents:${MATRAIX_AGENT_ID}`);
});

test("a bare token selects the agent without launching an empty study", () => {
  assert.equal(taskFromMatraixCommand("/agents:matraix"), "");
  assert.equal(taskFromMatraixCommand("/agents:MatrAIx  "), "");
  assert.equal(taskFromMatraixCommand("what would people pay"), null);
  assert.equal(taskFromMatraixCommand("/agents:matrix ask them"), null);
});

test("tokens stacked in front of the command survive for the capability resolver", () => {
  assert.equal(
    taskFromMatraixCommand("/skill:hallmark /agents:matraix would parents pay $4"),
    "/skill:hallmark would parents pay $4",
  );
  assert.equal(
    taskFromMatraixCommand("/agents:matraix /prompt:pricing would parents pay"),
    "/prompt:pricing would parents pay",
  );
});

test("the user half of the turn renders the command", () => {
  assert.equal(matraixUserMessage("test the price"), "/agents:matraix test the price");
  assert.equal(matraixUserMessage("  "), "/agents:matraix");
});

// ---------------------------------------------------------------------------
// the request
// ---------------------------------------------------------------------------

test("prose stays the brief and is not mistaken for a parameter", () => {
  const request = parseMatraixRequest("would parents of young kids pay 4 dollars a month");
  assert.equal(request.brief, "would parents of young kids pay 4 dollars a month");
  assert.equal(request.respondents, MATRAIX_DEFAULT_RESPONDENTS);
  assert.deepEqual(request.filters, {});
  assert.deepEqual(request.groupBy, []);
});

test("flags are read anywhere in the message and removed from the brief", () => {
  const request = parseMatraixRequest(
    "--personas 20 would people switch --filter age_bracket=25-34,35-44 --by life_stage --seed 7",
  );
  assert.equal(request.brief, "would people switch");
  assert.equal(request.respondents, 20);
  assert.equal(request.seed, 7);
  assert.deepEqual(request.filters, { age_bracket: ["25-34", "35-44"] });
  assert.deepEqual(request.groupBy, ["life_stage"]);
});

test("inline `--flag=value` is accepted alongside the spaced form", () => {
  const request = parseMatraixRequest('--personas=8 --filter="region=North America" price test');
  assert.equal(request.respondents, 8);
  assert.deepEqual(request.filters, { region: ["North America"] });
  assert.equal(request.brief, "price test");
});

test("a dimension value with a space survives, on either side of the quote", () => {
  // Most persona values are several words, so a filter that could not carry a
  // space would be unable to name most of the population.
  assert.deepEqual(
    parseMatraixRequest('x --filter "life_stage=Parent of young kids"').filters,
    { life_stage: ["Parent of young kids"] },
  );
  assert.deepEqual(
    parseMatraixRequest('x --filter life_stage="Early career,Mid-life"').filters,
    { life_stage: ["Early career", "Mid-life"] },
  );
  assert.equal(parseMatraixRequest('x --filter "region=MENA"').brief, "x");
});

test("a respondent count is clamped rather than trusted", () => {
  assert.equal(parseMatraixRequest("--personas 5000 x").respondents, MATRAIX_MAX_RESPONDENTS);
  assert.equal(parseMatraixRequest("--personas 0 x").respondents, 1);
  assert.equal(parseMatraixRequest("--personas many x").respondents, MATRAIX_DEFAULT_RESPONDENTS);
});

test("a malformed filter is dropped instead of becoming a dimension called nothing", () => {
  assert.deepEqual(parseMatraixRequest("--filter age_bracket x").filters, {});
  assert.deepEqual(parseMatraixRequest("--filter =25-34 x").filters, {});
  assert.deepEqual(parseMatraixRequest("--filter age_bracket= x").filters, {});
});

test("an unknown allocation falls back rather than reaching the clone", () => {
  assert.equal(parseMatraixRequest("--allocation sideways x").allocation, "equalTotal");
  assert.equal(parseMatraixRequest("--allocation perCell x").allocation, "perCell");
});

test("a flag typed in the message always beats the stored default", () => {
  const stored = { respondents: 30, seed: 99, allocation: "perCell", sources: ["gss"] };
  const untouched = parseMatraixRequest("price test", stored);
  assert.equal(untouched.respondents, 30);
  assert.equal(untouched.seed, 99);
  assert.equal(untouched.allocation, "perCell");
  assert.deepEqual(untouched.sources, ["gss"]);

  const overridden = parseMatraixRequest(
    "price test --personas 6 --seed 1 --allocation proportional",
    stored,
  );
  assert.equal(overridden.respondents, 6);
  assert.equal(overridden.seed, 1);
  assert.equal(overridden.allocation, "proportional");
});

test("the cohort line describes the request before any sampling has happened", () => {
  const request = parseMatraixRequest("--personas 9 --filter region=MENA --stratify life_stage x");
  const description = describeMatraixCohort(request);
  assert.match(description, /9 respondents/);
  assert.match(description, /region: MENA/);
  assert.match(description, /even across life_stage/);
});

// ---------------------------------------------------------------------------
// the settings translation
// ---------------------------------------------------------------------------

test("MatrAIx is in the settings catalog and every field names its inline flag", () => {
  const agent = CONFIGURABLE_AGENTS.find((entry) => entry.id === MATRAIX_AGENT_ID);
  assert.ok(agent, "MatrAIx has no settings entry");
  assert.equal(agent.command, MATRAIX_COMMAND);
  for (const field of agent.fields) {
    assert.ok(field.flag, `${field.key} has no overriding flag`);
    assert.ok(
      parseMatraixRequest(`x ${field.flag} value`).brief === "x",
      `${field.flag} is not a flag the parser recognises`,
    );
  }
});

test("unknown stored values fall back instead of reaching a run", () => {
  assert.deepEqual(matraixDefaults({}), {
    respondents: 12,
    seed: 42,
    allocation: "equalTotal",
    sources: [],
  });
  assert.equal(matraixDefaults({ allocation: "sideways" }).allocation, "equalTotal");
  assert.equal(matraixDefaults({ respondents: "many" }).respondents, 12);
  assert.deepEqual(matraixDefaults({ sources: ["gss", 7, ""] }).sources, ["gss"]);
});

// ---------------------------------------------------------------------------
// the questionnaire schema
// ---------------------------------------------------------------------------

function draft(overrides = {}) {
  return {
    title: "Pantry pricing",
    context:
      "Pantry plans a week of meals from what is already in the kitchen. Free for three meals a week, four dollars a month for unlimited.",
    questions: [
      {
        id: "q0",
        prompt: "What would you do after the free tier?",
        type: "single_choice",
        construct: "pay_intent",
        required: true,
        options: [
          { id: "stay_free", label: "Keep the free tier." },
          { id: "pay", label: "Pay the four dollars." },
        ],
      },
    ],
    ...overrides,
  };
}

test("a well-formed study passes and picks up its defaults", () => {
  const parsed = parseWithSchema(studyDraftSchema, draft(), "The study");
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.issues.join("; "));
  assert.equal(parsed.value.askRationale, true);
  assert.deepEqual(parsed.value.filters, {});
  assert.deepEqual(parsed.value.stratify, []);
});

test("the schema refuses exactly what the clone's survey constructor raises on", () => {
  const oneOption = parseWithSchema(
    studyDraftSchema,
    draft({
      questions: [{ ...draft().questions[0], options: [{ id: "only", label: "Only one." }] }],
    }),
    "The study",
  );
  assert.equal(oneOption.ok, false);
  assert.ok(oneOption.issues.some((issue) => /at least two options/.test(issue)));

  const invertedScale = parseWithSchema(
    studyDraftSchema,
    draft({
      questions: [
        {
          id: "q0",
          prompt: "How useful is it?",
          type: "likert",
          construct: "usefulness",
          required: true,
          options: [],
          minValue: 5,
          maxValue: 1,
        },
      ],
    }),
    "The study",
  );
  assert.equal(invertedScale.ok, false);
  assert.ok(invertedScale.issues.some((issue) => /minValue below maxValue/.test(issue)));
});

test("duplicate ids are refused, because a repeat silently overwrites an answer", () => {
  const question = draft().questions[0];
  const duplicateQuestions = parseWithSchema(
    studyDraftSchema,
    draft({ questions: [question, { ...question }] }),
    "The study",
  );
  assert.equal(duplicateQuestions.ok, false);
  assert.ok(duplicateQuestions.issues.some((issue) => /unique/.test(issue)));

  const duplicateOptions = parseWithSchema(
    studyDraftSchema,
    draft({
      questions: [
        {
          ...question,
          options: [
            { id: "same", label: "One." },
            { id: "same", label: "Two." },
          ],
        },
      ],
    }),
    "The study",
  );
  assert.equal(duplicateOptions.ok, false);
});

test("a study with no context is refused, since the context is the whole prompt", () => {
  const parsed = parseWithSchema(studyDraftSchema, draft({ context: "an app" }), "The study");
  assert.equal(parsed.ok, false);
});

test("the question types are the clone's four, spelled its way", () => {
  const types = fs.readFileSync(
    path.join(clone, "application", "playground", "backend", "service", "survey_types.py"),
    "utf8",
  );
  const declared = /QUESTION_TYPES = \{([^}]+)\}/.exec(types);
  assert.ok(declared, "the clone no longer declares QUESTION_TYPES");
  const upstream = [...declared[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual([...MATRAIX_QUESTION_TYPES].sort(), upstream);
});

// ---------------------------------------------------------------------------
// the cohort, reconciled against a pool nobody controls
// ---------------------------------------------------------------------------

const catalog = {
  pool: "persona/datasets/matraix-persona-dev-sample",
  count: 200,
  dimensionCount: 1290,
  sourceCounts: { wiki: 29 },
  dimensions: [
    {
      id: "age_bracket",
      personas: 165,
      values: [
        { value: "25-34", personas: 35 },
        { value: "35-44", personas: 20 },
      ],
    },
    {
      id: "life_stage",
      personas: 133,
      values: [
        { value: "Early career", personas: 33 },
        { value: "Mid-life", personas: 27 },
        { value: "Retirement", personas: 27 },
      ],
    },
  ],
};

test("a filter the pool cannot satisfy is dropped and reported, not silently widened", () => {
  const reconciled = reconcileFilters(catalog, {
    age_bracket: ["25-34", "99-100"],
    invented_dimension: ["anything"],
  });
  assert.deepEqual(reconciled.filters, { age_bracket: ["25-34"] });
  assert.equal(reconciled.dropped.length, 2);
  assert.ok(reconciled.dropped.some((note) => /invented_dimension/.test(note)));
  assert.ok(reconciled.dropped.some((note) => /99-100/.test(note)));
});

test("a dimension that would leave no personas at all drops the whole filter", () => {
  const reconciled = reconcileFilters(catalog, { age_bracket: ["99-100"] });
  assert.deepEqual(reconciled.filters, {});
  assert.equal(reconciled.dropped.length, 1);
});

test("group-by and stratify dimensions are checked the same way", () => {
  const reconciled = reconcileDimensions(catalog, ["life_stage", "not_a_dimension"]);
  assert.deepEqual(reconciled.dimensions, ["life_stage"]);
  assert.equal(reconciled.dropped.length, 1);
});

test("with no catalog nothing is dropped, so an unreadable pool is not a silent edit", () => {
  const filters = { age_bracket: ["25-34"] };
  assert.deepEqual(reconcileFilters(null, filters).filters, filters);
  assert.deepEqual(reconcileDimensions(null, ["life_stage"]).dimensions, ["life_stage"]);
});

test("the dimension menu offered to the model is bounded", () => {
  const menu = renderDimensionMenu(catalog, 1);
  assert.equal(menu.split("\n").length, 1);
  assert.match(menu, /age_bracket \(165 personas\)/);
});

// ---------------------------------------------------------------------------
// the protocol boundary
// ---------------------------------------------------------------------------

test("both sides of the bridge protocol name the same events", async () => {
  const runManager = fs.readFileSync(
    path.join(dashboard, "src", "lib", "matraix", "run-manager.ts"),
    "utf8",
  );
  const emitted = new Set(
    [...bridgeSource.matchAll(/\bemit\(\s*"([a-z.]+)"/g)].map((match) => match[1]),
  );
  assert.ok(emitted.size >= 6, "the bridge emits almost nothing");
  for (const event of emitted) {
    if (event === "check.ok" || event === "catalog") continue;
    assert.ok(
      runManager.includes(`"${event}"`),
      `the bridge emits ${event} and the run manager never mentions it`,
    );
  }
});

test("the card listens for every event the run manager emits", () => {
  const runManager = fs.readFileSync(
    path.join(dashboard, "src", "lib", "matraix", "run-manager.ts"),
    "utf8",
  );
  const card = fs.readFileSync(
    path.join(dashboard, "src", "app", "components", "hermes", "inline-matraix-run.tsx"),
    "utf8",
  );
  const listened = new Set(
    [...(/const EVENTS = \[([\s\S]*?)\];/.exec(card)?.[1] ?? "").matchAll(/"([a-z.]+)"/g)].map(
      (match) => match[1],
    ),
  );
  for (const match of runManager.matchAll(/\bemit\(\s*run,\s*"([a-z.]+)"/g)) {
    assert.ok(listened.has(match[1]), `the card never subscribes to ${match[1]}`);
  }
});

test("the card guards a finished turn, closes on error, and renders saved content", () => {
  const card = fs.readFileSync(
    path.join(dashboard, "src", "app", "components", "hermes", "inline-matraix-run.tsx"),
    "utf8",
  );
  assert.match(card, /if \(replaying\) return;/);
  assert.match(card, /source\.onerror = \(\) => source\.close\(\)/);
  assert.match(card, /persistedContent/);
  assert.match(card, /reported\.current/);
});

// ---------------------------------------------------------------------------
// what the integration reads out of the clone
// ---------------------------------------------------------------------------

test("the clone still exposes every entry point the bridge imports", () => {
  const modules = {
    "packages/playground/src/playground/inprocess/survey_eval.py": [
      "class InprocessSurveyEvalRunner",
      "def build_survey_task_prompt",
    ],
    "application/playground/backend/service/persona_pool_service.py": [
      "def sample_pool",
      "def filter_pool",
      "def get_catalog",
      "DEFAULT_PERSONA_POOL",
    ],
    "src/matraix/job_results.py": [
      "def collect_job_results",
      "def format_json_report",
      "def format_csv_report",
      "def format_text_report",
    ],
    "src/matraix/launch_env.py": ["def required_pythonpath_entries"],
  };
  for (const [relative, symbols] of Object.entries(modules)) {
    const source = fs.readFileSync(path.join(clone, relative), "utf8");
    for (const symbol of symbols) {
      assert.ok(source.includes(symbol), `${relative} no longer declares ${symbol}`);
    }
  }
});

test("the questionnaire id stays namespaced, so it cannot borrow a real task's text", () => {
  const runManager = fs.readFileSync(
    path.join(dashboard, "src", "lib", "matraix", "run-manager.ts"),
    "utf8",
  );
  assert.match(runManager, /instrumentId: `bb_/);
  // The clone resolves a questionnaire id to a task folder by scanning these
  // prefixes; `bb_` ids reach neither, which is what makes the fallback render
  // our own instrument instead of somebody else's survey.
  const loader = fs.readFileSync(
    path.join(clone, "packages", "playground", "src", "playground", "survey_task_content.py"),
    "utf8",
  );
  assert.match(loader, /startswith\("survey_"\)/);
  assert.match(loader, /startswith\("example-survey_"\)/);
});

test("the persona model is prefixed so the clone routes it to the configured endpoint", () => {
  const runManager = fs.readFileSync(
    path.join(dashboard, "src", "lib", "matraix", "run-manager.ts"),
    "utf8",
  );
  assert.match(runManager, /personaModel: `openai\/\$\{input\.model\}`/);
  // Without the prefix the clone's client treats a bare id as an Anthropic
  // model and asks api.anthropic.com for a key nobody set.
  const client = fs.readFileSync(
    path.join(clone, "packages", "playground", "src", "playground", "model_client.py"),
    "utf8",
  );
  assert.match(client, /value\.startswith\("openai\/"\)/);
  assert.match(client, /return AnthropicJSONClient\(value, temperature=temperature\)/);
});

test("the study never writes inside the clone", () => {
  const workspace = fs.readFileSync(
    path.join(dashboard, "src", "lib", "matraix", "workspace.ts"),
    "utf8",
  );
  assert.match(workspace, /matraixWorkspaceRoot/);
  assert.doesNotMatch(bridgeSource, /application\s*\/\s*tasks.*write_text/);
  // Every write in the bridge is under the workspace it was handed.
  for (const match of bridgeSource.matchAll(/\(([a-z_]+)\s*\/\s*"[^"]+"\)\.write_text/g)) {
    assert.ok(
      ["output", "job_dir", "responses_dir", "task_dir", "trial_dir", "trial_output"].includes(
        match[1],
      ),
      `the bridge writes into ${match[1]}, which is not a workspace directory`,
    );
  }
});
