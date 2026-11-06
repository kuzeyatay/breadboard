import test from "node:test";
import assert from "node:assert/strict";
import { noteDepthError, noteProseWordCount } from "../src/lib/hermes/note-depth.ts";

test("lesson depth counts prose while ignoring frontmatter, math, code, headings, and link destinations", () => {
  const body = `---
title: Metadata is not teaching
---
# Nor is this title
The vector points outward.
$$
A_x + A_y + A_z = 42
$$
Inline $x + y$ explains direction.
\`\`\`js
const unrelated = 'many tokens here';
\`\`\`
~~~
More code is not explanatory prose.
~~~
Read [the explanation](https://example.test/long-destination).
> [!warning]
> Preserve direction.
`;
  assert.equal(noteProseWordCount(body), 12);
  assert.match(noteDepthError(body, 1400), /12 explanatory prose words/);
  assert.equal(noteDepthError(body, 12), null);
});

test("ordinary notes and section guides do not inherit lesson length requirements", () => {
  assert.equal(noteDepthError("A brief section guide.", undefined), null);
  for (const minimum of [0, -1, 1.5, "1400", null, NaN, Infinity]) {
    assert.match(noteDepthError("Some text", minimum), /positive integer/);
  }
});
