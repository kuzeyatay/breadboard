import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

import { isClarificationAnswerMessage } from "../src/lib/steered-response.ts";

// Execute the actual row selectors without mounting the runtime or starting a
// research run. Testing the marker alone misses guards in the calling UI.
function selector(relativePath, name, dependencies) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      expression = node.initializer.arguments[0].getText(ast);
    } else if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      expression = node.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `Missing transcript selector: ${name}`);
  const { outputText } = ts.transpileModule(`const select = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return new Function(...Object.keys(dependencies), `${outputText}\nreturn select;`)(
    ...Object.values(dependencies),
  );
}

const runtimePath = "../src/app/components/hermes/agent-runtime-panel.tsx";
const answer = "Dopamine levels and effects in the morning";

for (const marker of [
  { clarificationAnswer: true },
  { clientMessageId: "clarify:restored-request" },
  { clarificationAnswer: true, courseCorrection: false },
  { clientMessageId: "clarify:live-request", clarificationAnswer: true, courseCorrection: true },
]) {
  test(`clarification replies stay out of both transcripts: ${JSON.stringify(marker)}`, () => {
    const messages = [
      { role: "user", clientMessageId: "research", content: "do max research of domain effects when its got in the morning" },
      { role: "assistant", clientMessageId: "research", content: "", pending: true },
      { role: "user", content: answer, ...marker },
      // Identical text sent as a normal follow-up is still a visible user turn.
      { role: "user", clientMessageId: "follow-up", content: answer },
    ];
    const original = structuredClone(messages);
    const inlinedCourseCorrections = selector(runtimePath, "inlinedCourseCorrections", {
      messages, isClarificationAnswerMessage,
    })();
    assert.equal(inlinedCourseCorrections.byAssistantIndex.size, 0);
    const rows = selector(runtimePath, "transcriptRows", {
      messages,
      inlinedCourseCorrections,
      supersededDelegationAssistants: new Set(),
      runInFlight: true,
      lastAssistantIndex: 1,
    })();
    assert.deepEqual(rows.map((row) => row.index), [0, 1, 3]);
    const gardenMessages = selector("../src/app/garden/garden-assistant.tsx", "visibleGardenChatMessages", {
      isClarificationAnswerMessage,
    })(messages);
    assert.deepEqual(gardenMessages, [messages[0], messages[1], messages[3]]);
    assert.deepEqual(messages, original, "the answer must remain available to the runtime");
  });
}

test("ordinary course corrections still appear within the assistant response", () => {
  const messages = [
    { role: "assistant", clientMessageId: "research", content: "Research so far" },
    {
      role: "user", clientMessageId: "steer:1", id: "steer-1", content: "Include sleep quality",
      courseCorrection: true, courseCorrectionTargetClientMessageId: "research", courseCorrectionOffset: 8,
    },
  ];
  const result = selector(runtimePath, "inlinedCourseCorrections", { messages, isClarificationAnswerMessage })();
  assert.deepEqual(result.byAssistantIndex.get(0), [{ id: "steer-1", content: "Include sleep quality", offset: 8 }]);
  assert.deepEqual([...result.hiddenMessageIndices], [1]);
});
