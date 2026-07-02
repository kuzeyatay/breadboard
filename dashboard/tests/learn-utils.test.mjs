import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildTextbookPageFrontmatter,
  containsRawVisualPlaceholder,
  fallbackLearningMapFromSources,
  normalizeLearningMapCandidate,
  removeRawVisualPlaceholders,
  sourceSetHashForSources,
  textbookPageFileName,
  textbookSectionFolder,
} from "../src/lib/learn-utils.ts";

describe("learn utilities", () => {
  test("creates a fallback learning map from source material", () => {
    const map = fallbackLearningMapFromSources({
      gardenId: "garden",
      gardenTitle: "Garden",
      sources: [
        {
          id: "lecture-1",
          slug: "lecture-1",
          title: "Lecture 1",
          relPath: "sources/lecture-1.md",
          body: "## Force\n\nContent",
        },
      ],
      concepts: [
        {
          title: "Restoring Force",
          sourceDocument: "lecture-1",
          excerpt: "Force points toward equilibrium.",
          locations: ["Page 2"],
          tags: ["restoring force points toward equilibrium"],
        },
      ],
    });

    assert.equal(map.status, undefined);
    assert.equal(map.sections.length, 1);
    assert.equal(map.sections[0].title, "Lecture 1");
    assert.equal(map.sections[0].subsections[0].title, "Restoring Force");
  });

  test("normalizes council topic-map JSON into the proposed textbook order", () => {
    const map = normalizeLearningMapCandidate(
      {
        title: "Physics Textbook",
        sections: [
          {
            title: "Waves",
            subsections: [
              {
                title: "Wave Speed",
                sourceAnchors: ["Lecture 2"],
                visualOpportunities: ["speed plot"],
              },
            ],
          },
        ],
        warnings: ["Missing lab data"],
      },
      {
        gardenId: "garden",
        gardenTitle: "Garden",
        sources: [],
      },
    );

    assert.equal(map.title, "Physics Textbook");
    assert.equal(map.sections[0].subsections[0].title, "Wave Speed");
    assert.deepEqual(map.sections[0].subsections[0].visualOpportunities, ["speed plot"]);
    assert.ok(map.warnings.includes("Missing lab data"));
  });

  test("writes textbook page frontmatter with learn metadata", () => {
    const fm = buildTextbookPageFrontmatter({
      gardenId: "garden",
      sectionNumber: 1,
      subsectionNumber: 2,
      title: "1.2 Wave Speed",
      sourceAnchors: ["Lecture 2"],
      conceptTags: ["wave speed relates wavelength and frequency"],
      visualIds: ["vis_wave_speed"],
      textbookVersionId: "textbook_1",
      sourceSetHash: "hash",
      generatedAt: "2026-07-02T00:00:00.000Z",
    });

    assert.match(fm, /breadboardType: "textbook_page"/);
    assert.match(fm, /generatedBy: "learn_button"/);
    assert.match(fm, /sourceAnchors: \["Lecture 2"\]/);
    assert.match(fm, /visualIds: \["vis_wave_speed"\]/);
  });

  test("removes raw visual placeholders from final markdown", () => {
    const markdown = "Text\n\n[Interactive visual: Wave speed]\n\nMore text";
    assert.equal(containsRawVisualPlaceholder(markdown), true);
    const next = removeRawVisualPlaceholders(markdown, "```breadboard-visual\n{}\n```");
    assert.equal(containsRawVisualPlaceholder(next), false);
    assert.match(next, /```breadboard-visual/);
  });

  test("source set hash changes when source content changes", () => {
    const base = [
      {
        id: "s",
        slug: "s",
        title: "S",
        relPath: "sources/s.md",
        body: "alpha",
      },
    ];
    const changed = [{ ...base[0], body: "beta" }];

    assert.notEqual(sourceSetHashForSources(base), sourceSetHashForSources(changed));
  });

  test("uses ordered textbook paths instead of generated subtopic folders", () => {
    assert.equal(textbookSectionFolder(1, "Simple Harmonic Motion"), "1. Simple Harmonic Motion");
    assert.equal(textbookPageFileName(1, 1, "Restoring Force"), "1.1 Restoring Force.md");
    assert.equal(textbookSectionFolder(2, "Generated Subtopics"), "2. Generated Subtopics");
  });
});

describe("learn route and council wiring", () => {
  const repoRoot = path.resolve(process.cwd());

  test("learn API routes exist", () => {
    for (const route of ["plan", "confirm", "generate", "status", "cancel", "regenerate"]) {
      assert.equal(
        fs.existsSync(
          path.join(
            repoRoot,
            "src",
            "app",
            "api",
            "gardens",
            "[gardenId]",
            "learn",
            route,
            "route.ts",
          ),
        ),
        true,
        `${route} route should exist`,
      );
    }
  });

  test("learn pipeline uses ChatMock Council task types", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");

    assert.match(learnSource, /withCouncil/);
    assert.match(learnSource, /taskType: "source_map"/);
    assert.match(learnSource, /taskType: "topic_map"/);
    assert.match(learnSource, /taskType: "subsection_generation"/);
    assert.match(learnSource, /taskType: "full_page_revision"/);
  });
});
