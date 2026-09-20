import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  CONCEPTS_FOLDER,
  INTERNAL_CONCEPT_TYPE,
  LEARNING_PAGE_ORDER,
  TEXTBOOK_PAGE_TYPE,
  isConceptPageRelPath,
  isLearnAuthoredLesson,
  isInternalConceptMetadata,
  isLegacySubtopicRelPath,
  isPublicGardenPath,
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

  test("recognizes Concepts as the public document-ingestion collection", () => {
    assert.equal(CONCEPTS_FOLDER, "Concepts");
    assert.equal(
      isConceptPageRelPath("Concepts/1. Fields/vector-fields.md"),
      true,
    );
    assert.equal(
      isPublicGardenPath("Concepts/1. Fields/vector-fields.md"),
      true,
    );
    assert.equal(isConceptPageRelPath("learning/1. Fields/vector-fields.md"), false);
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

describe("Save page shares the generated/ folder with legacy topic cards", () => {
  // electromagnetism-1, 2026-09-17: a saved chat page was written to
  // Generated/, listed as a folder, and then filtered out of every document
  // list, because the folder name is also the legacy auto-topic folder.
  test("a saved chat page under generated/ is not a legacy card", () => {
    assert.equal(
      isLegacySubtopicRelPath("Generated/1-the-electric-field-of-a-long-charged-wire.md", TEXTBOOK_PAGE_TYPE),
      false,
    );
  });

  test("a legacy knowledge-topic card in the same folder stays hidden", () => {
    assert.equal(
      isLegacySubtopicRelPath("generated/apparent-position-of-a-fish-under-water.md", "knowledge-topic"),
      true,
    );
  });

  test("callers that cannot name the type keep the old path-only verdict", () => {
    assert.equal(isLegacySubtopicRelPath("generated/anything.md"), true);
  });

  test("the unambiguous legacy folders hide whatever type they carry", () => {
    for (const relPath of [
      "generated subtopics/a.md",
      "subtopics/a.md",
      "ai topics/a.md",
      "topic cards/a.md",
      "legacy/generated subtopics/a.md",
    ]) {
      assert.equal(isLegacySubtopicRelPath(relPath, TEXTBOOK_PAGE_TYPE), true, relPath);
    }
  });

  test("an ordinary folder is never legacy", () => {
    assert.equal(isLegacySubtopicRelPath("Concepts/a.md", "knowledge-topic"), false);
  });
});
