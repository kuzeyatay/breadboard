import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorizedIndex,
  normalizeCitation,
  normalizeCitations,
} from "../src/lib/gbrain/citations.ts";

const AUTH = buildAuthorizedIndex([
  { sourceId: "gbrain-src-cluster-1", gardenId: "alice-garden", gardenName: "Alice" },
]);

test("a citation for an authorized source maps to its garden (no internal id, no absolute path)", () => {
  const mapped = normalizeCitation(
    { sourceId: "gbrain-src-cluster-1", pageId: "rails", title: "Rails", path: "electronics/rails.md", excerpt: "x", score: 0.5 },
    AUTH,
  );
  assert.ok(mapped);
  assert.equal(mapped.gardenId, "alice-garden");
  assert.equal(mapped.pageSlug, "rails");
  assert.equal(mapped.path, "/alice-garden/rails");
  // Internal source id and the raw filesystem-ish path must not leak.
  const serialized = JSON.stringify(mapped);
  assert.ok(!serialized.includes("gbrain-src-cluster-1"));
  assert.ok(!serialized.includes("electronics/rails.md"));
});

test("a citation for an UNAUTHORIZED source is dropped, not returned", () => {
  const mapped = normalizeCitation(
    { sourceId: "gbrain-src-cluster-999", pageId: "secret", title: "Bob secret" },
    AUTH,
  );
  assert.equal(mapped, null);
});

test("synthesis citations are filtered against the authorized mapping set", () => {
  const { citations, dropped } = normalizeCitations(
    [
      { sourceId: "gbrain-src-cluster-1", pageId: "a", title: "A" },
      { sourceId: "gbrain-src-cluster-2", pageId: "b", title: "B (other user)" },
      { sourceId: "gbrain-src-cluster-1", pageId: "c", title: "C" },
    ],
    AUTH,
  );
  assert.equal(citations.length, 2);
  assert.equal(dropped, 1);
  for (const c of citations) assert.equal(c.gardenId, "alice-garden");
});

test("no absolute path ever appears in a normalized citation", () => {
  const mapped = normalizeCitation(
    { sourceId: "gbrain-src-cluster-1", pageId: "p", title: "T", path: "C:/Users/secret/x.md" },
    AUTH,
  );
  assert.ok(mapped);
  assert.ok(!mapped.path.includes("C:/Users"));
});
