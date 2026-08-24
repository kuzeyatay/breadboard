import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  InvalidLearnRouteBodyError,
  LearnExpectedModelConflictError,
  isLearnRouteConflict,
  parseExplicitLearnPlanSelection,
  readLearnRouteJsonObject,
  requireExpectedLearnModel,
} from "../src/lib/learn-route-errors.ts";

function jsonRequest(body) {
  return new Request("http://breadboard.test/api/gardens/generic/learn/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

test("Learn mutation bodies reject empty or truncated JSON instead of applying defaults", async () => {
  for (const body of ["", '{"includedSourceIds":["source-a"]']) {
    await assert.rejects(
      readLearnRouteJsonObject(jsonRequest(body)),
      (error) =>
        error instanceof InvalidLearnRouteBodyError &&
        /complete JSON object request body/.test(error.message),
    );
  }
});

test("Learn mutation bodies reject non-object JSON", async () => {
  for (const body of ["null", "[]", '"source-a"', "false"]) {
    await assert.rejects(
      readLearnRouteJsonObject(jsonRequest(body)),
      (error) =>
        error instanceof InvalidLearnRouteBodyError &&
        /JSON object/.test(error.message),
    );
  }
});

test("Learn mutation bodies preserve an explicit generic source and syllabus binding", async () => {
  const body = {
    sourceOnly: true,
    includedSourceIds: ["source-a"],
    syllabusSourceId: "guide-a",
    includeSourceSnapshots: false,
  };
  assert.deepEqual(
    await readLearnRouteJsonObject(jsonRequest(JSON.stringify(body))),
    body,
  );
});

test("Learn planning preserves an explicit nullable syllabus and normalizes source IDs", () => {
  assert.deepEqual(
    parseExplicitLearnPlanSelection({
      includedSourceIds: [" source-a ", "source-b"],
      syllabusSourceId: null,
    }),
    {
      includedSourceIds: ["source-a", "source-b"],
      syllabusSourceId: null,
    },
  );
  assert.deepEqual(
    parseExplicitLearnPlanSelection({
      includedSourceIds: ["source-a"],
      syllabusSourceId: " guide-a ",
    }),
    {
      includedSourceIds: ["source-a"],
      syllabusSourceId: "guide-a",
    },
  );
});

test("Learn planning rejects omitted, empty, mixed, duplicate, or wrong-type selections", () => {
  const invalidBodies = [
    {},
    { includedSourceIds: ["source-a"] },
    { syllabusSourceId: null },
    { includedSourceIds: [], syllabusSourceId: null },
    { includedSourceIds: "source-a", syllabusSourceId: null },
    { includedSourceIds: [""], syllabusSourceId: null },
    { includedSourceIds: ["source-a", 42], syllabusSourceId: null },
    { includedSourceIds: ["source-a", "source-a"], syllabusSourceId: null },
    { includedSourceIds: [" source-a ", "source-a"], syllabusSourceId: null },
    { includedSourceIds: ["source-a"], syllabusSourceId: "" },
    { includedSourceIds: ["source-a"], syllabusSourceId: 42 },
  ];

  for (const body of invalidBodies) {
    assert.throws(
      () => parseExplicitLearnPlanSelection(body),
      (error) => error instanceof InvalidLearnRouteBodyError,
      JSON.stringify(body),
    );
  }
});

test("Learn planning rejects a syllabus that is also teaching material", () => {
  assert.throws(
    () =>
      parseExplicitLearnPlanSelection({
        includedSourceIds: ["source-a", " guide-a "],
        syllabusSourceId: "guide-a",
      }),
    (error) =>
      error instanceof InvalidLearnRouteBodyError &&
      /cannot also be included as teaching source material/.test(error.message),
  );
});

test("Learn confirmation accepts the exact reviewed model without mutating its body", () => {
  const body = { learningMapId: "map-a", expectedModel: " gpt-current " };
  const before = structuredClone(body);
  assert.equal(requireExpectedLearnModel(body, "gpt-current"), "gpt-current");
  assert.deepEqual(body, before);
});

test("Learn confirmation fails closed when expectedModel is omitted", () => {
  assert.throws(
    () => requireExpectedLearnModel({ learningMapId: "map-a" }, "gpt-current"),
    (error) => error instanceof InvalidLearnRouteBodyError,
  );
});

test("Learn confirmation rejects a changed model as a route conflict before mutation", () => {
  let mutationReached = false;
  assert.throws(
    () => {
      requireExpectedLearnModel(
        { learningMapId: "map-a", expectedModel: "gpt-reviewed" },
        "gpt-current",
      );
      mutationReached = true;
    },
    (error) =>
      error instanceof LearnExpectedModelConflictError &&
      isLearnRouteConflict(error) &&
      error.requiresReplan === false,
  );
  assert.equal(mutationReached, false);
});

test("Learn generation marks model drift as requiring replacement planning", () => {
  assert.throws(
    () =>
      requireExpectedLearnModel(
        { confirmedLearningMapId: "map-generic", expectedModel: "model-planned" },
        "model-current",
        { requiresReplanOnConflict: true },
      ),
    (error) =>
      error instanceof LearnExpectedModelConflictError &&
      isLearnRouteConflict(error) &&
      error.requiresReplan === true,
  );
});

test("Learn confirmation rejects malformed expectedModel tokens", () => {
  for (const expectedModel of [undefined, null, "", "   ", 42, []]) {
    assert.throws(
      () => requireExpectedLearnModel({ expectedModel }, "gpt-current"),
      (error) => error instanceof InvalidLearnRouteBodyError,
      JSON.stringify(expectedModel),
    );
  }
});

test("the Learn plan route uses the explicit selection parser before handoff", () => {
  const source = fs.readFileSync(
    new URL(
      "../src/app/api/gardens/[gardenId]/learn/plan/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /parseExplicitLearnPlanSelection\(body\)/);
  assert.match(
    source,
    /error instanceof InvalidLearnRouteBodyError[\s\S]*?\{ status: 400 \}/,
  );
  assert.doesNotMatch(source, /body\.includedSourceIds\.filter/);
});

test("every Learn JSON mutation uses the fail-closed body reader", () => {
  const routeNames = [
    "cancel",
    "clear",
    "confirm",
    "generate",
    "humanizer",
    "pause",
    "plan",
    "rebuild",
    "regenerate",
    "resume",
    "syllabus/generate",
  ];
  for (const routeName of routeNames) {
    const source = fs.readFileSync(
      new URL(
        `../src/app/api/gardens/[gardenId]/learn/${routeName}/route.ts`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /readLearnRouteJsonObject\(request\)/, routeName);
    assert.match(source, /InvalidLearnRouteBodyError/, routeName);
    assert.doesNotMatch(
      source,
      /request\.json\(\)\.catch\(\(\) => \(\{\}\)\)/,
      routeName,
    );
  }
});
