import { test } from "node:test";
import assert from "node:assert/strict";
import { browserPageBackgroundColor } from "../src/main/browser-theme";

test("external pages get a neutral pre-paint canvas without injected theme CSS", () => {
  assert.equal(browserPageBackgroundColor("light"), "#ffffff");
  assert.equal(browserPageBackgroundColor("dark"), "#0b0c0a");
});
