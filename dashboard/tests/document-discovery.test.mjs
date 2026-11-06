import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDocumentSearch } from "../src/lib/document-discovery.ts";

const filenames = [
  "Lecture7.8_Output stages with feedback.pdf",
  "Lecture7.5_Output stages.pdf",
  "Lecture6.6_Small signal.pdf",
  "Lecture 7.4 IC amp design simulations and advanced topics.pdf",
  "Lecture 7.3_Application of Miller theorem zeroes and poles.pdf",
];
function search(query) {
  const terms = normalizeDocumentSearch(query).trim().split(/\s+/).filter(Boolean);
  return filenames.filter(name => terms.every(term => normalizeDocumentSearch(name).includes(term)));
}

test("lecture7 finds spaced and unspaced filenames without changing their order", () => {
  const expected = [filenames[0], filenames[1], filenames[3], filenames[4]];
  for (const query of ["lecture7", "lecture 7", "LECTURE_7"]) {
    assert.deepEqual(search(query), expected);
  }
});

test("connected lecture numbers find the exact existing source", () => {
  assert.deepEqual(search("lecture7.3"), [filenames[4]]);
  assert.deepEqual(search("lecture7.4"), [filenames[3]]);
  assert.deepEqual(search("lecture 7.5"), [filenames[1]]);
  assert.deepEqual(search("lecture7 Miller"), [filenames[4]]);
});

test("search preserves empty queries and accent-insensitive matching", () => {
  assert.deepEqual(search(""), filenames);
  assert.equal(normalizeDocumentSearch("Lécture7.3"), "lecture 7.3");
});
