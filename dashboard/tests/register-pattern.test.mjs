import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../src/app/auth/register/page.tsx", import.meta.url),
  "utf8",
);

test("the username HTML pattern is valid under browser v-mode semantics", () => {
  const match = source.match(/pattern="([^"]+)"/);
  assert.ok(match, "expected the registration username pattern");
  const expression = new RegExp(`^(?:${match[1]})$`, "v");

  assert.equal(expression.test("qa-user_17"), true);
  assert.equal(expression.test("qa user"), false);
  assert.equal(expression.test("qa@example"), false);
});
