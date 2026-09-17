import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  refreshFinalArtifactValidationReport,
  verifyFinalArtifactNoMutation,
} from "../src/lib/garden-finalize.ts";

test("finished-copy validation refreshes its report without editing lessons, plans or Notepad", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learn-rewrite-audit-"));
  try {
    const files = {
      "_index.md": "---\ntitle: Garden\n---\n# Garden\n",
      "learning/_index.md": "---\ntitle: Learning\n---\n# Learning\n\nAn edited introduction.\n",
      "notepad/notes.md": "My own notes must stay exactly as written.\n",
      ".breadboard/learning-unit-contract.json": "{\"learningUnits\":[],\"sourceArtifactAssignments\":[]}",
      ".breadboard/validation-report.md": "# Old report\nfinalStateFingerprint: 0000000000000000000000000000000000000000\nAccepted: yes\n",
    };
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    const options = { gardenDir: root, gardenSlug: "garden", updateRepairReport: false };
    assert.match(verifyFinalArtifactNoMutation(options).validationFailures.join("\n"), /report is stale/);
    refreshFinalArtifactValidationReport(options);
    const after = verifyFinalArtifactNoMutation(options);
    assert.deepEqual(after.mutatedFiles, []);
    assert.doesNotMatch(after.validationFailures.join("\n"), /report is stale|unexpected top-level: notepad/);
    // A refreshed report must still reject a real defect; refresh is not approval.
    assert.equal(after.accepted, false);
    assert.match(after.validationFailures.join("\n"), /sources\/_index.md missing/);
    assert.match(fs.readFileSync(path.join(root, ".breadboard/validation-report.md"), "utf8"), /Accepted: no/);
    for (const [relative, content] of Object.entries(files)) {
      if (relative.endsWith("validation-report.md")) continue;
      assert.equal(fs.readFileSync(path.join(root, relative), "utf8"), content, relative);
    }
    fs.mkdirSync(path.join(root, "unexpected-folder"));
    assert.match(verifyFinalArtifactNoMutation(options).validationFailures.join("\n"), /unexpected top-level: unexpected-folder/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("finished-copy audit and promotion use the same independently supplied review identity", () => {
  const source = fs.readFileSync(new URL("../src/lib/learn.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("learn.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "finishedLearnHumanizerValidation");
  assert.ok(declaration);
  const calls = [];
  const context = vm.createContext({
    refreshFinalArtifactValidationReport: (options) => calls.push(["refresh", options]),
    verifyFinalArtifactNoMutation: (options) => {
      calls.push(["verify", options]);
      return { accepted: false, validationFailures: ["real defect"], unresolvedRepairFailures: [], mutatedFiles: [] };
    },
  });
  vm.runInContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const expected = { phase: "planning", jobId: "saved-planning-job", learningMapId: "confirmed-map", model: "saved-model" };
  const result = context.finishedLearnHumanizerValidation("staging", "garden", expected, true);
  assert.equal(result.accepted, false);
  assert.deepEqual(Array.from(result.problems), ["real defect"]);
  assert.deepEqual(calls.map(([operation]) => operation), ["refresh", "verify"]);
  for (const [, options] of calls) {
    assert.equal(options.expectedVisualContractExecutabilityContext, expected);
    assert.equal(options.strictModelApprovedVisuals, true);
  }
  calls.length = 0;
  context.finishedLearnHumanizerValidation("incoming", "garden", expected);
  assert.deepEqual(calls.map(([operation]) => operation), ["verify"]);
  assert.equal(calls[0][1].updateRepairReport, false);
});
