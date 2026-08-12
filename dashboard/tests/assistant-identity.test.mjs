import test from "node:test";
import assert from "node:assert/strict";
import {
  BREAD_ASSISTANT_IDENTITY,
  breadSystemPrompt,
} from "../src/lib/assistant-identity.ts";
import { withCouncil } from "../src/lib/council.ts";

test("Bread is the canonical assistant identity and runtime names stay separate", () => {
  assert.match(BREAD_ASSISTANT_IDENTITY, /^You are Bread, the Breadboard assistant\./);
  assert.match(BREAD_ASSISTANT_IDENTITY, /Hermes is the agent runtime, not your name/);
  assert.match(BREAD_ASSISTANT_IDENTITY, /report the authoritative resolved model separately/);
});

test("every Council instructions prompt receives Bread's identity exactly once", () => {
  const request = withCouncil(
    { model: "default", instructions: "Answer from the supplied garden." },
    { taskType: "page_assistant_answer" },
  );
  assert.equal(
    request.instructions,
    breadSystemPrompt("Answer from the supplied garden."),
  );
  assert.equal(
    request.instructions.match(/You are Bread, the Breadboard assistant\./g)?.length,
    1,
  );
});

test("every Council chat prompt receives Bread's identity without mutating the caller", () => {
  const messages = [
    { role: "system", content: "Return only JSON." },
    { role: "user", content: "Classify this." },
  ];
  const request = withCouncil(
    { model: "default", messages },
    { taskType: "classification" },
  );

  assert.equal(messages[0].content, "Return only JSON.");
  assert.equal(request.messages[0].content, breadSystemPrompt("Return only JSON."));
  assert.equal(request.messages[1].content, "Classify this.");
});

