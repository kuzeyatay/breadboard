import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  INTERNAL_CONCEPT_TYPE,
  LEARNING_PAGE_ORDER,
  TEXTBOOK_PAGE_TYPE,
  isLearnAuthoredLesson,
  isInternalConceptMetadata,
  isLegacySubtopicRelPath,
  readingOrderRank,
  shouldPublishGardenPage,
  showLegacySubtopicPages,
} from "../src/lib/learning-garden.ts";

describe("learning garden metadata", () => {
  test("distinguishes Learn lessons from document-ingestion learning pages", () => {
    assert.equal(
      isLearnAuthoredLesson({
        type: "learning-page",
        relPath: "1. Engineering Electromagnetics/vector-fields.md",
        internal: "true",
      }),
      false,
    );
    assert.equal(
      isLearnAuthoredLesson({
        type: "learning-map",
        relPath: "learning/Learning Map.md",
      }),
      false,
    );
    assert.equal(
      isLearnAuthoredLesson({
        type: "learning-page",
        relPath: "learning/1. Fields/1.1 Vector Fields.md",
        generatedBy: "learn_button",
      }),
      true,
    );
    assert.equal(
      isLearnAuthoredLesson({
        type: "textbook-page",
        relPath: "learning/1. Fields/1.1 Vector Fields.md",
        generated_by: "learn_button",
      }),
      true,
    );
  });

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

  test("keeps learning pages and lesson pages ahead of sources and legacy folders", () => {
    // Only the learner-facing planning pages are ordered here; Source Map /
    // Scope Contract / Source Coverage are internal and live under
    // .breadboard/planning/.
    assert.deepEqual(LEARNING_PAGE_ORDER, [
      "learning/Topic Overview.md",
      "learning/Learning Map.md",
    ]);
    assert.equal(readingOrderRank("learning/Learning Map.md", "learning-map"), 1);
    // A page under learning/ that is not a named planning page ranks as a lesson.
    assert.equal(readingOrderRank("learning/Source Map.md", "source-map"), 10);
    assert.equal(readingOrderRank("1. Waves/phase.md", TEXTBOOK_PAGE_TYPE), 20);
    // Legacy value maps to the same lesson rank.
    assert.equal(readingOrderRank("1. Waves/phase.md", "textbook-page"), 20);
    assert.equal(readingOrderRank("sources/lecture-1.md", "source-document"), 30);
    assert.equal(readingOrderRank("generated/phase.md", "knowledge-topic"), 95);
  });
});
