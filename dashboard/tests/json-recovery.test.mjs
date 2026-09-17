import test from "node:test";
import assert from "node:assert/strict";
import { dropMismatchedJsonClosers, recoverJsonValue } from "../src/lib/learn-utils.ts";

test("mismatched closers are dropped, strings and legal nesting are untouched", () => {
  // Live 2026-09-16: the web chat model wrote `}]} }},{` for `}]}},{` on three
  // consecutive visual-contract executability reviews.
  const raw = '{"reviews":[{"unitId":"U23","checks":{"evidence":[{"quote":"a; b"}]} }},{"unitId":"U24"}]}';
  assert.equal(
    dropMismatchedJsonClosers(raw),
    '{"reviews":[{"unitId":"U23","checks":{"evidence":[{"quote":"a; b"}]} },{"unitId":"U24"}]}',
  );
  const braces = '{"text":"} ] \\" }","list":[[1],[2]]}';
  assert.equal(dropMismatchedJsonClosers(braces), braces);
  assert.equal(dropMismatchedJsonClosers('{"a":1}}'), '{"a":1}');
});

test("recoverJsonValue accepts strict JSON, prose-wrapped JSON, and brace-surplus JSON, but not garbage", () => {
  assert.deepEqual(recoverJsonValue('{"a":[1]}'), { a: [1] });
  assert.deepEqual(recoverJsonValue('I checked each contract.\n\n{"a":[1]}'), { a: [1] });
  const surplus = '{"reviews":[{"unitId":"U23","checks":{"evidence":[{"quote":"guard"}]} }},{"unitId":"U24"}]}';
  assert.deepEqual(recoverJsonValue(surplus), {
    reviews: [{ unitId: "U23", checks: { evidence: [{ quote: "guard" }] } }, { unitId: "U24" }],
  });
  assert.equal(recoverJsonValue("null"), null);
  assert.equal(recoverJsonValue('{"a":'), null);
  assert.equal(recoverJsonValue("no json here"), null);
});
