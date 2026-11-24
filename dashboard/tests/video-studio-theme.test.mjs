import test from "node:test";
import assert from "node:assert/strict";
import { retheme } from "../../timeline-studio/breadboard/serve.mjs";

test("the video editor's neon cyan is served in Breadboard's botanical green, alpha kept", () => {
  const out = retheme("a{color:#35ead9;border-color:#35ead952;background:rgba(53, 234, 217,.3)} b{color:#fff}");
  assert.doesNotMatch(out, /35ead9|53, 234, 217/i);
  assert.match(out, /border-color:#[0-9a-f]{6}52;/);
  assert.match(out, /rgba\(\d+, \d+, \d+,\.3\)/);
  assert.match(out, /color:#ffffff/, "neutrals stay neutral");
  const [, r, g, b] = out.match(/color:#(..)(..)(..);/).map(h => parseInt(h, 16));
  assert.ok(g > r && g > b, "the accent is green");
});
