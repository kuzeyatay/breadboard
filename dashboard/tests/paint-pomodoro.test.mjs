import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const component = fs.readFileSync(
  fileURLToPath(
    new URL("../src/app/components/paint-pomodoro.tsx", import.meta.url),
  ),
  "utf8",
);

test("Paint Pomodoro uses session wording without a percentage label", () => {
  const labelStart = component.indexOf("const progressLabel");
  const labelEnd = component.indexOf("const timerHint", labelStart);
  const progressLabel = component.slice(labelStart, labelEnd);

  assert.match(progressLabel, /Painting revealed/);
  assert.match(progressLabel, /Session/);
  assert.doesNotMatch(progressLabel, /revealPercent|%/);
});

test("Paint Pomodoro can rewind or add thirty seconds", () => {
  assert.match(component, /adjustTimer\(-30\)/);
  assert.match(component, /adjustTimer\(30\)/);
  assert.match(component, /Rewind timer by 30 seconds/);
  assert.match(component, /Add 30 seconds to timer/);
  assert.match(
    component,
    /setSecondsLeft\(\(current\) => Math\.max\(0, current \+ deltaSeconds\)\)/,
  );
});
