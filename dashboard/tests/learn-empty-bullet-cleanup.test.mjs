import test from "node:test"; import assert from "node:assert/strict";
import { removeEmptyBulletScaffolds, emptyBulletScaffoldLines } from "../src/lib/learn-utils.ts";
test("drops empty bullets but keeps math, rules and real bullets", () => {
  const md = "Intro\n- real point\n-\n- ...\n---\n$$\na\n-\nb\n$$\n- TBD\nEnd";
  const out = removeEmptyBulletScaffolds(md);
  assert.equal(out, "Intro\n- real point\n---\n$$\na\n-\nb\n$$\nEnd");
  assert.deepEqual(emptyBulletScaffoldLines(out), []);
});
