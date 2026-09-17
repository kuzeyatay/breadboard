import assert from "node:assert/strict";
import test from "node:test";

import {
  documentValidator,
  matchesValidator,
  parseRangeHeader,
  rangeIsStillValid,
} from "../src/lib/http-range.ts";

const SIZE = 1_000;

test("a viewer asking for one slice gets exactly that slice", () => {
  assert.deepEqual(parseRangeHeader("bytes=0-499", SIZE), {
    kind: "range",
    range: { start: 0, end: 499 },
  });
  assert.deepEqual(parseRangeHeader("bytes=500-999", SIZE), {
    kind: "range",
    range: { start: 500, end: 999 },
  });
});

test("an open-ended range runs to the last byte", () => {
  assert.deepEqual(parseRangeHeader("bytes=900-", SIZE), {
    kind: "range",
    range: { start: 900, end: 999 },
  });
});

test("a suffix range counts back from the end, as PDF.js does for the trailer", () => {
  assert.deepEqual(parseRangeHeader("bytes=-100", SIZE), {
    kind: "range",
    range: { start: 900, end: 999 },
  });
  // A suffix longer than the document is the whole document, not an error.
  assert.deepEqual(parseRangeHeader("bytes=-4000", SIZE), {
    kind: "range",
    range: { start: 0, end: 999 },
  });
});

test("an end past the last byte is clamped rather than refused", () => {
  assert.deepEqual(parseRangeHeader("bytes=800-5000", SIZE), {
    kind: "range",
    range: { start: 800, end: 999 },
  });
});

test("a range that starts past the end is unsatisfiable", () => {
  assert.deepEqual(parseRangeHeader("bytes=1000-1200", SIZE), { kind: "unsatisfiable" });
  assert.deepEqual(parseRangeHeader("bytes=-0", SIZE), { kind: "unsatisfiable" });
  assert.deepEqual(parseRangeHeader("bytes=0-100", 0), { kind: "unsatisfiable" });
});

test("a malformed or unsupported header serves the whole document", () => {
  for (const header of [
    null,
    "",
    "items=0-10",
    "bytes=abc-def",
    "bytes=",
    "bytes=-",
    "bytes=500-100",
    // Multiple ranges would need a multipart body; the whole document is a
    // correct answer and PDF.js never asks for more than one at a time.
    "bytes=0-99,200-299",
  ]) {
    assert.deepEqual(
      parseRangeHeader(header, SIZE),
      { kind: "whole" },
      `header ${JSON.stringify(header)} must not produce a partial response`,
    );
  }
});

test("a validator changes when the bytes change and not otherwise", () => {
  const first = documentValidator({ size: 100, modifiedAtMs: 1_700_000_000_000 });
  const same = documentValidator({ size: 100, modifiedAtMs: 1_700_000_000_000 });
  const resized = documentValidator({ size: 101, modifiedAtMs: 1_700_000_000_000 });
  const rewritten = documentValidator({ size: 100, modifiedAtMs: 1_700_000_001_000 });
  const edited = documentValidator({
    size: 100,
    modifiedAtMs: 1_700_000_000_000,
    revision: "db",
  });
  assert.equal(first, same);
  assert.notEqual(first, resized);
  assert.notEqual(first, rewritten);
  assert.notEqual(
    first,
    edited,
    "a locally edited document must never share a validator with the stored one",
  );
  assert.match(first, /^"[0-9a-f]+-[0-9a-f]+"$/u);
});

test("a client holding the current version revalidates instead of downloading", () => {
  const validator = documentValidator({ size: 10, modifiedAtMs: 5_000 });
  assert.equal(matchesValidator(validator, validator), true);
  assert.equal(matchesValidator(`W/${validator}`, validator), true);
  assert.equal(matchesValidator("*", validator), true);
  assert.equal(matchesValidator(`"other", ${validator}`, validator), true);
  assert.equal(matchesValidator('"other"', validator), false);
  assert.equal(matchesValidator(null, validator), false);
});

test("a resumed range is refused when the document changed underneath it", () => {
  const validator = documentValidator({ size: 10, modifiedAtMs: 5_000 });
  assert.equal(rangeIsStillValid(null, validator), true);
  assert.equal(rangeIsStillValid(validator, validator), true);
  assert.equal(
    rangeIsStillValid('"stale"', validator),
    false,
    "a stale If-Range must fall back to the whole document, not splice versions",
  );
});
