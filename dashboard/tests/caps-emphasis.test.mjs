import assert from "node:assert/strict";
import test from "node:test";
import { capsEmphasisSection, shoutedSpans } from "../src/lib/hermes/caps-emphasis.ts";

test("shouted runs are lifted out; acronyms and code stay quiet", () => {
  assert.deepEqual(shoutedSpans("ok but DO NOT TOUCH THE TESTS again"), ["DO NOT TOUCH THE TESTS"]);
  assert.deepEqual(shoutedSpans("I SAID STOP!! please"), ["I SAID STOP!!"]);
  assert.deepEqual(shoutedSpans("use the API with HTML and CSS"), []);
  assert.deepEqual(shoutedSpans("call `MAX_RETRY_COUNT DEFAULT` there"), []);
  assert.deepEqual(shoutedSpans("NASA ESA"), []);
  assert.deepEqual(shoutedSpans("İSTANBUL ÇOK GÜZEL"), ["İSTANBUL ÇOK GÜZEL"]);
});

test("the section quotes the spans, or is absent", () => {
  const section = capsEmphasisSection({ userText: "WHY IS IT STILL BROKEN" });
  assert.match(section, /# caps_emphasis/);
  assert.match(section, /"WHY IS IT STILL BROKEN"/);
  assert.equal(capsEmphasisSection({ userText: "all calm here" }), null);
  assert.equal(capsEmphasisSection({ userText: undefined }), null);
});
