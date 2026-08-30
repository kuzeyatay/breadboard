import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const composer = fs.readFileSync(
  new URL("../src/app/components/assistant-composer.tsx", import.meta.url),
  "utf8",
);

test("Intelligence switches match the recessed profile-page switch treatment", () => {
  const start = composer.indexOf("Rewrite naturally");
  const end = composer.indexOf("<UsageLimitsPopover", start);
  const switches = composer.slice(start, end);

  assert.ok(start >= 0 && end > start, "missing the Intelligence switch group");
  assert.equal(switches.match(/role="switch"/g)?.length, 6);
  assert.doesNotMatch(switches, /neu-surface-raised absolute left-0\.5/);
  assert.equal(
    switches.match(/neu-inset relative h-6 w-11 shrink-0 rounded-full/g)?.length,
    6,
  );
  assert.equal(
    switches.match(
      /absolute left-0\.5 top-0\.5 h-5 w-5 rounded-full bg-\[var\(--paper-raised\)\] shadow transition-transform/g,
    )?.length,
    6,
  );
  assert.doesNotMatch(switches, /rounded-full bg-white transition-transform/);
});
