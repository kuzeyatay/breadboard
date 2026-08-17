import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { slashQueryAt, slashQueryReplacementRange } from "../src/lib/hermes/slash-query.ts";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("the token under the caret is found even when a sentence follows it", () => {
  // The reported bug: editing the capability of a sentence that already has a
  // body found nothing, so the picker never opened.
  const text = "/agents can you tell me how memory works?";
  assert.deepEqual(slashQueryAt(text, 4), { query: "agents", start: 0, end: 7 });
  assert.deepEqual(slashQueryAt(text, 7), { query: "agents", start: 0, end: 7 });
  assert.equal(slashQueryAt(text, 0)?.query, "agents");
  // A second selector in a leading run is still a selector.
  assert.deepEqual(slashQueryAt("/agents:opencode /ski build it", 20), {
    query: "ski",
    start: 17,
    end: 21,
  });
  // A lone token, which is the case that always worked.
  assert.deepEqual(slashQueryAt("/ag", 3), { query: "ag", start: 0, end: 3 });
  assert.equal(slashQueryAt("/", 1)?.query, "");
});

test("a slash that is not a capability selector leaves the picker shut", () => {
  assert.equal(slashQueryAt("summarize /notes for me", 14), null); // mid-sentence
  assert.equal(slashQueryAt("/agents can you", 12), null); // caret in the body
  assert.equal(slashQueryAt("read about and/or", 17), null); // no token boundary
  assert.equal(slashQueryAt("", 0), null);
});

test("choosing a capability overwrites the edited token and its one space", () => {
  assert.deepEqual(slashQueryReplacementRange("/agents can you tell me", 4), {
    start: 0,
    end: 8,
  });
  // Nothing to swallow at the end of the box.
  assert.deepEqual(slashQueryReplacementRange("/agen", 5), { start: 0, end: 5 });
  // A newline is structure, not spacing.
  assert.deepEqual(slashQueryReplacementRange("/agents\nthen this", 3), {
    start: 0,
    end: 7,
  });
  assert.equal(slashQueryReplacementRange("plain text", 4), null);
});

test("both composers open the picker from the caret and filter on that token", () => {
  const composer = source("../src/app/components/assistant-composer.tsx");
  const scheduled = source("../src/app/components/hermes/terminal-scheduled-panel.tsx");
  const menu = source("../src/app/components/hermes/slash-command-menu.tsx");

  for (const box of [composer, scheduled]) {
    assert.match(box, /slashQueryAt\(next, event\.target\.selectionStart\)/);
    assert.match(box, /slashQueryReplacementRange\(/);
    // The whole-box test is what missed a token with a sentence after it.
    assert.doesNotMatch(box, /\/\^\\\/\[\^\\s\]\*\$\//);
  }
  assert.match(composer, /query=\{slashQuery\}/);
  assert.match(scheduled, /query=\{slashQuery\}/);
  // The menu is told the query rather than re-deriving it from the sentence.
  assert.match(menu, /query: string;/);
  assert.doesNotMatch(menu, /value\.slice\(1\)/);
});
