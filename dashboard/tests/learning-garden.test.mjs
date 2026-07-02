import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  INTERNAL_CONCEPT_TYPE,
  LEARNING_PAGE_ORDER,
  TEXTBOOK_PAGE_TYPE,
  isInternalConceptMetadata,
  isLegacySubtopicRelPath,
  readingOrderRank,
  shouldPublishGardenPage,
  showLegacySubtopicPages,
} from "../src/lib/learning-garden.ts";

describe("learning garden metadata", () => {
  test("hides internal ConceptNodes from published/default views", () => {
    const metadata = {
      knowledge_type: INTERNAL_CONCEPT_TYPE,
      breadboardType: "internal_concept",
    };

    assert.equal(isInternalConceptMetadata(metadata, "Internal/Concept Graph/waves.md"), true);
    assert.equal(
      shouldPublishGardenPage({
        metadata,
        relPath: "Internal/Concept Graph/waves.md",
      }),
      false,
    );
    assert.equal(
      shouldPublishGardenPage({
        metadata,
        relPath: "Internal/Concept Graph/waves.md",
        showLegacySubtopics: true,
      }),
      false,
    );
  });

  test("treats legacy generated subtopic folders as hidden by default", () => {
    const relPath = "generated/waves-and-boundaries.md";
    const metadata = { knowledge_type: "knowledge-topic" };

    assert.equal(isLegacySubtopicRelPath(relPath), true);
    assert.equal(shouldPublishGardenPage({ metadata, relPath }), false);
    assert.equal(
      shouldPublishGardenPage({ metadata, relPath, showLegacySubtopics: true }),
      true,
    );
  });

  test("parses the legacy visibility flag", () => {
    assert.equal(showLegacySubtopicPages("true"), true);
    assert.equal(showLegacySubtopicPages("1"), true);
    assert.equal(showLegacySubtopicPages("false"), false);
    assert.equal(showLegacySubtopicPages(undefined), false);
  });

  test("keeps Learning pages and textbook pages ahead of sources and legacy folders", () => {
    assert.deepEqual(LEARNING_PAGE_ORDER, [
      "Learning/Topic Overview.md",
      "Learning/Learning Map.md",
      "Learning/Source Map.md",
      "Learning/Scope Contract.md",
    ]);
    assert.equal(readingOrderRank("Learning/Learning Map.md", "learning-map"), 1);
    assert.equal(readingOrderRank("1. Waves/phase.md", TEXTBOOK_PAGE_TYPE), 20);
    assert.equal(readingOrderRank("sources/lecture-1.md", "source-document"), 30);
    assert.equal(readingOrderRank("generated/phase.md", "knowledge-topic"), 95);
  });
});
