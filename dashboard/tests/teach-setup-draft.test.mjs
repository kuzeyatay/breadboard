import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  clearTeachSetupDraft,
  readTeachSetupDraft,
  writeTeachSetupDraft,
} from "../src/lib/teach/setup-draft.ts";

const setupUi = fs.readFileSync(
  new URL("../src/app/workflows/teach/teach-workflow.tsx", import.meta.url),
  "utf8",
);

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("teach setup survives leaving and returning to the workflows page", () => {
  const storage = fakeStorage();
  const draft = {
    name: "File the weekly expense report",
    objective: "Download the invoices and enter each total",
    microphoneId: "preferred-microphone",
    reteachWorkflowId: null,
  };

  writeTeachSetupDraft(storage, draft);
  assert.deepEqual(readTeachSetupDraft(storage), draft);
});

test("a re-teach draft remembers which workflow it belongs to", () => {
  const storage = fakeStorage();
  const draft = {
    name: "File expenses",
    objective: "Teach the corrected approval step",
    microphoneId: "",
    reteachWorkflowId: "workflow-123",
    reteachName: "File expenses",
  };

  writeTeachSetupDraft(storage, draft);
  assert.deepEqual(readTeachSetupDraft(storage), draft);
});

test("cancel or successful start consumes the teach setup draft", () => {
  const storage = fakeStorage();
  writeTeachSetupDraft(storage, {
    name: "Temporary draft",
    objective: "",
    microphoneId: "",
    reteachWorkflowId: null,
  });

  clearTeachSetupDraft(storage);
  assert.equal(readTeachSetupDraft(storage), null);
});

test("broken browser storage never becomes a setup draft", () => {
  assert.equal(readTeachSetupDraft(fakeStorage({
    "breadboard:teach-workflow-setup-draft:v1": "not json",
  })), null);
});

test("the setup asks for automation guidance, not a preview of the demonstration", () => {
  assert.match(setupUi, /What should Breadboard know about this automation\? \(optional\)/);
  assert.match(setupUi, /Write the summary yourself and reply with it/);
  assert.match(setupUi, /should do differently from the way you demonstrate it/);
  assert.doesNotMatch(setupUi, /What are you about to do\?/);
});
