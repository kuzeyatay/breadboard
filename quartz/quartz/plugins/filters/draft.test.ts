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
