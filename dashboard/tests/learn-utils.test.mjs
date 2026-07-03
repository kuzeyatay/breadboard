import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildLearningPageFrontmatter,
  containsRawVisualPlaceholder,
  fallbackLearningMapFromSources,
  normalizeLearningMapCandidate,
  normalizeZettelTags,
  sanitizeLearnerTitle,
  hasPlaceholderText,
  countAiisms,
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

  test("writes learning page frontmatter with clean tags and no textbook terms", () => {
    const fm = buildLearningPageFrontmatter({
      gardenId: "garden",
      sectionNumber: 1,
      subsectionNumber: 2,
      title: "1.2 Wave Speed",
      sourceAnchors: ["Lecture 2"],
      tags: ["waves/wave-speed"],
      visualIds: ["vis_wave_speed"],
      learningVersionId: "learn_1",
      sourceSetHash: "hash",
      generatedAt: "2026-07-02T00:00:00.000Z",
    });

    assert.match(fm, /knowledge_type: "learning-page"/);
    assert.match(fm, /breadboardType: "learning_page"/);
    assert.match(fm, /generatedBy: "learn_button"/);
    assert.match(fm, /sourceAnchors: \["Lecture 2"\]/);
    assert.match(fm, /visualIds: \["vis_wave_speed"\]/);
    // No conceptTags and no "textbook" anywhere in visible frontmatter.
    assert.ok(!/conceptTags/.test(fm));
    assert.ok(!/textbook/i.test(fm));
  });

  test("normalizeZettelTags produces clean hierarchical tags", () => {
    const tags = normalizeZettelTags(
      ["motivation", "sn/lif-neuron", "energy", "snn/threshold-firing", "computational-neuroscience/membrane-potential"],
      "The Leaky Integrate-and-Fire Neuron",
      "Spiking Neural Networks",
    );
    assert.ok(tags.length >= 3 && tags.length <= 5, `got ${tags.length} tags`);
    assert.ok(!tags.includes("snn/motivation"), "drops generic 'motivation'");
    assert.ok(!tags.some((t) => t.split("/").includes("energy")), "drops debris 'energy'");
    assert.ok(tags.includes("snn/lif-neuron"), "repairs sn/ typo root to snn/");
    assert.ok(tags.every((t) => t.includes("/")), "every tag is hierarchical");
  });

  test("quality helpers flag placeholder + AI-ism prose", () => {
    assert.equal(hasPlaceholderText("Use the page 10 and 11 materials to explain."), true);
    assert.equal(hasPlaceholderText("A spiking neuron sends a discrete event."), false);
    assert.ok(countAiisms("The second big idea is that X is not a side detail. The point is not Y.") >= 2);
    assert.equal(countAiisms("A spike is a discrete event whose timing carries information."), 0);
  });

  test("sanitizes generated lesson titles", () => {
    assert.equal(
      sanitizeLearnerTitle("1.1 From Conventional Neural Networks to SNNs Overview"),
      "1.1 From Conventional Neural Networks to SNNs",
    );
    assert.equal(
      sanitizeLearnerTitle("Why the Source Turns from Conventional Neural Networks to SNNs"),
      "From Conventional Neural Networks to SNNs",
    );
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
    assert.match(learnSource, /preparedFallback/);
    assert.match(learnSource, /assessLessonQuality\(\s*preparedFallback/);
    assert.doesNotMatch(learnSource, /Start with the idea itself/);
    assert.doesNotMatch(learnSource, /Name the starting idea/);
    assert.doesNotMatch(learnSource, /What is the main idea to take away from/);
  });
});
