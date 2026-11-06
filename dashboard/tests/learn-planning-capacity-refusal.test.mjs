// A capacity refusal must be reported as itself, not as a schema error.
//
// telecom-1, 2026-09-22: the Source Map exceeded what one chatgpt.com response
// could emit. All three attempts came back empty or as prose, and the run died
// reporting "sources must be an array" - which sends an operator after a prompt
// bug instead of the transport limit that actually stopped it.
import test from "node:test";
import assert from "node:assert/strict";

import { planningCapacityRefusal } from "../src/lib/learn-planning-capacity.ts";

test("the real refusals from the failed run are recognised", () => {
  const observed = [
    'I can see the pasted content contains a Breadboard source-map generation request. That artifact is much larger than can fit in a single chat response. I can provide it in multiple consecutive messages.',
    '{"sources":[],"figures":[],"missingOrUnclear":["The supplied source-map input exceeds the available response capacity for a complete expanded projection."]}',
  ];
  for (const raw of observed) {
    const evidence = planningCapacityRefusal(raw);
    assert.ok(evidence, `should be recognised: ${raw.slice(0, 60)}`);
    assert.ok(evidence.length > 0);
  }
});

test("it reports the model's own sentence as the evidence", () => {
  const evidence = planningCapacityRefusal(
    "Here is my answer. That artifact is much larger than can fit in a single chat response. Tell me how to proceed.",
  );
  assert.match(evidence, /much larger than can fit in a single chat response/);
  assert.doesNotMatch(evidence, /Tell me how to proceed/);
});

test("an ordinary schema failure is not misread as a capacity refusal", () => {
  // These must keep the existing "remained invalid" message.
  for (const raw of [
    '{"sources":{},"figures":[]}',
    '{"units":[{"unitId":"SU1","teachable":true}]}',
    "I cannot find the lecture decks in the supplied material.",
    "",
  ]) {
    assert.equal(planningCapacityRefusal(raw), null, `should not match: ${raw.slice(0, 40)}`);
  }
});

test("paraphrased refusals from the second run are recognised too", () => {
  // The first marker list was copied verbatim from one run and missed the
  // very next one. These are the real 2026-09-22 web responses.
  const observed = [
    "I can process the pasted request, but the requested Source Map JSON requires reproducing a very large registry. The pasted material exceeds the practical response size limit for a single message, so I cannot return the complete artifact in one response without truncation. I can generate it in multiple sequential JSON chunks.",
    '{"error":"The supplied request requires generating a complete validated Source Map JSON object. The pasted material available in this chat is truncated before the full source catalog and cannot support producing a complete non-fabricated JSON object."}',
  ];
  for (const raw of observed) {
    assert.ok(planningCapacityRefusal(raw), `should be recognised: ${raw.slice(0, 70)}`);
  }
});

test("content refusals and ordinary shape errors still are not capacity refusals", () => {
  for (const raw of [
    "I cannot find the lecture decks in the supplied material.",
    "I can build the 13-unit M1 study run, but the material only contains the study guide.",
    '{"sources":{},"figures":[]}',
    "",
  ]) {
    assert.equal(planningCapacityRefusal(raw), null, `should not match: ${raw.slice(0, 50)}`);
  }
});
