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
  test("publishes normal textbook pages", () => {
    assert.equal(
      shouldPublish({ knowledge_type: "textbook-page" }, "course/1. Intro/page.md"),
      true,
    )
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

  test("hides raw source archives and planning documents", () => {
    assert.equal(
      shouldPublish({ knowledge_type: "source-document" }, "course/sources/reader.md"),
      false,
    )
    // Path rule alone hides anything under sources/, even without frontmatter.
    assert.equal(shouldPublish({}, "course/sources/reader.md"), false)
    for (const knowledgeType of ["source-map", "scope-contract", "source-coverage", "learning-map"]) {
      assert.equal(
        shouldPublish({ knowledge_type: knowledgeType }, "course/Learning/page.md"),
        false,
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
    // A real lesson page citing the same source stays published.
    assert.equal(
      shouldPublish(
        {
          knowledge_type: "textbook-page",
          title: "1.1 The Leaky Integrate-and-Fire Neuron",
          source_file: "2510.27379v1.pdf",
        },
        "course/1. Spiking Neural Networks/1.1 The Leaky Integrate-and-Fire Neuron.md",
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
