import test, { describe } from "node:test"
import assert from "node:assert/strict"
import { RemoveDrafts } from "./draft"

function shouldPublish(
  frontmatter: Record<string, unknown>,
  relativePath: string,
  opts?: { showLegacySubtopicPages?: boolean },
): boolean {
  return RemoveDrafts(opts).shouldPublish(
    {} as never,
    [{} as never, { data: { frontmatter, relativePath } }] as never,
  )
}

describe("RemoveDrafts", () => {
  test("publishes learn-authored lesson pages", () => {
    assert.equal(
      shouldPublish(
        { knowledge_type: "learning-page", generated_by: "learn_button" },
        "course/Learning/1. Intro/1.1 page.md",
      ),
      true,
    )
    // Legacy textbook-page value still publishes when learn-authored.
    assert.equal(
      shouldPublish(
        { knowledge_type: "textbook-page", generated_by: "learn_button" },
        "course/Learning/1. Intro/1.1 page.md",
      ),
      true,
    )
  })

  test("hides ingest lesson sections/pages that the Learn pipeline did not author", () => {
    // No generated_by: learn_button => internal ingest scaffolding.
    assert.equal(
      shouldPublish({ knowledge_type: "learning-section" }, "course/1. Source Title/_index.md"),
      false,
    )
    assert.equal(
      shouldPublish({ knowledge_type: "textbook-section" }, "course/1. Source Title/_index.md"),
      false,
    )
    assert.equal(
      shouldPublish(
        { knowledge_type: "learning-page", breadboardType: "learning_page" },
        "course/1. Source Title/1.1 topic.md",
      ),
      false,
    )
    // Legacy flat knowledge-topic gardens are a different type and stay visible.
    assert.equal(shouldPublish({ knowledge_type: "knowledge-topic" }, "course/amplitude.md"), true)
  })

  test("hides draft and internal ConceptNode pages", () => {
    assert.equal(shouldPublish({ draft: "true" }, "course/page.md"), false)
    assert.equal(
      shouldPublish(
        { knowledge_type: "internal-concept", breadboardType: "internal_concept" },
        "course/Internal/Concept Graph/waves.md",
      ),
      false,
    )
  })

  test("hides legacy generated subtopic folders by default", () => {
    assert.equal(
      shouldPublish({ knowledge_type: "knowledge-topic" }, "course/generated/waves.md"),
      false,
    )
  })

  test("publishes source notes and learning reference pages", () => {
    assert.equal(
      shouldPublish({ knowledge_type: "source-document" }, "course/sources/reader.md"),
      true,
    )
    // Sources is a public learner reference folder, even without frontmatter.
    assert.equal(shouldPublish({}, "course/sources/reader.md"), true)
    for (const knowledgeType of ["source-map", "scope-contract", "source-coverage", "learning-map"]) {
      assert.equal(
        shouldPublish({ knowledge_type: knowledgeType }, "course/Learning/page.md"),
        true,
        knowledgeType,
      )
    }
    assert.equal(
      shouldPublish({ knowledge_type: "topic-overview" }, "course/Learning/Topic Overview.md"),
      true,
    )
    assert.equal(shouldPublish({ internal: "true" }, "course/Learning/page.md"), false)
  })

  test("hides ingest stub pages titled after the raw upload", () => {
    assert.equal(
      shouldPublish(
        {
          knowledge_type: "textbook-page",
          title: "1.1 2510.27379v1",
          source_file: "2510.27379v1.pdf",
        },
        "course/1. 2510-27379v1/2510-27379v1-123.md",
      ),
      false,
    )
    // A real learn-authored lesson citing the same source stays published.
    assert.equal(
      shouldPublish(
        {
          knowledge_type: "learning-page",
          generated_by: "learn_button",
          title: "1.1 The Leaky Integrate-and-Fire Neuron",
          source_file: "2510.27379v1.pdf",
        },
        "course/Learning/2. Spikes, Neurons/2.1 The Leaky Integrate-and-Fire Neuron.md",
      ),
      true,
    )
  })

  test("can publish legacy generated subtopic folders when explicitly enabled", () => {
    assert.equal(
      shouldPublish(
        {
          knowledge_type: "internal-concept",
          breadboardType: "internal_concept",
          draft: "true",
          legacy_subtopic_page: "true",
        },
        "course/generated/waves.md",
        { showLegacySubtopicPages: true },
      ),
      true,
    )
  })
})
