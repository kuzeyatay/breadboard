import test from "node:test";
import assert from "node:assert/strict";

import {
  gardenDocumentHref,
  gardenDocumentNoteSlug,
} from "../src/lib/garden-document-route.ts";

test("source document links preserve their published sources path", () => {
  const document = {
    slug: "firefly-brief",
    relPath: "sources/firefly-brief.md",
    type: "source-document",
  };

  assert.equal(gardenDocumentNoteSlug(document), "sources/firefly-brief");
  assert.equal(
    gardenDocumentHref("critical-garden", document),
    "/garden/critical-garden?note=sources%2Ffirefly-brief",
  );
});

test("legacy source records without relPath still open below sources", () => {
  assert.equal(
    gardenDocumentNoteSlug({
      slug: "legacy-reader",
      type: "source-document",
    }),
    "sources/legacy-reader",
  );
});

test("ordinary and nested notes continue to use their real relative path", () => {
  assert.equal(
    gardenDocumentNoteSlug({
      slug: "lesson-one",
      relPath: "learning/Unit One/Lesson One.md",
      type: "learning-page",
    }),
    "learning/Unit One/Lesson One",
  );
  assert.equal(
    gardenDocumentNoteSlug({ slug: "plain-note", type: "user-note" }),
    "plain-note",
  );
});
