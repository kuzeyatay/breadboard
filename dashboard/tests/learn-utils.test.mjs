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
  validateLearningMapDepth,
  hasPlaceholderText,
  hasEmptyBulletScaffold,
  assessLessonQuality,
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
          tags: ["restoring-force"],
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
      tags: ["wave-speed", "propagation-speed", "string-tension", "medium-density"],
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

  test("normalizeZettelTags produces clean concept-handle tags", () => {
    const tags = normalizeZettelTags(
      ["motivation", "LIF Neuron", "energy", "threshold firing", "Membrane Potential", "reset dynamics"],
      "The Leaky Integrate-and-Fire Neuron",
      "Spiking Neural Networks",
      {
        title: "The Leaky Integrate-and-Fire Neuron",
        sectionTitle: "Spiking Neurons",
        body: "The LIF neuron tracks membrane potential until it reaches a firing threshold, then it spikes and resets. Reset dynamics returns the membrane potential to a lower value after the spike. The membrane potential and threshold define the core mechanism.",
        assignedVisualCaptions: [],
      },
    );
    assert.ok(tags.length >= 4 && tags.length <= 8, `got ${tags.length} tags`);
    assert.ok(!tags.includes("motivation"), "drops generic 'motivation'");
    assert.ok(!tags.includes("energy"), "drops broad debris 'energy'");
    assert.ok(tags.includes("lif-neuron"));
    assert.ok(tags.includes("membrane-potential"));
    assert.ok(tags.every((tag) => /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(tag)));
    assert.ok(tags.every((tag) => !tag.includes("/")));
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

  test("scrubs the banned commentary word 'evidence' from titles with verb agreement", () => {
    // Planning-clustering titles that previously tripped the depth warning.
    assert.equal(sanitizeLearnerTitle("Reading the Evidence"), "Reading the Results");
    assert.equal(sanitizeLearnerTitle("What the Evidence Shows"), "What the Results Show");
    assert.equal(sanitizeLearnerTitle("Neuron Model LIF as Evidence"), "Neuron Model LIF");
    // A clean title is left untouched.
    assert.equal(sanitizeLearnerTitle("Interpreting the Results"), "Interpreting the Results");
    // The commentary gate must accept the scrubbed titles.
    assert.deepEqual(
      validateLearningMapDepth({
        sections: [
          { title: "How the Mechanism Works", subsections: [{ title: "Interpreting the Results" }, { title: "What the Results Show" }] },
          { title: "What the Results Show", subsections: [{ title: "Reading the Results" }, { title: "Neuron Model LIF" }] },
        ],
      }),
      [],
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
    assert.match(learnSource, /taskType: "learning_spine"/);
    assert.match(learnSource, /taskType: "subsection_generation"/);
    assert.match(learnSource, /taskType: "full_page_revision"/);
    assert.match(learnSource, /LEARN_PLANNING_COUNCIL_MODE/);
    assert.match(learnSource, /isPlanningTimeoutError/);
    assert.match(learnSource, /learn_source_map_fallback/);
    assert.match(learnSource, /learn_scope_contract_fallback/);
    assert.match(learnSource, /learn_learning_spine_fallback/);
    // Bad generation must fail the job, never degrade into a fallback learner
    // page. The old preparedFallback path is gone; pageBody starts null and a
    // failed page throws after quarantining the draft for debugging.
    assert.doesNotMatch(learnSource, /preparedFallback/);
    assert.match(learnSource, /let pageBody: string \| null = null/);
    assert.match(learnSource, /No fallback learner page was written/);
    assert.match(learnSource, /debugFailedSubsectionDraft/);
    assert.doesNotMatch(learnSource, /Start with the idea itself/);
    assert.doesNotMatch(learnSource, /Name the starting idea/);
    assert.doesNotMatch(learnSource, /What is the main idea to take away from/);
  });

  test("learn generation retries scaffold/meta-instruction failures before failing", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");

    assert.match(learnSource, /envPositiveInt\("LEARN_MAX_PAGE_ATTEMPTS", 2\)/);
    assert.match(learnSource, /Final-prose rules \(hard requirements\)/);
    assert.match(learnSource, /placeholderFailure/);
    assert.match(learnSource, /scaffold\/meta-instruction text/);
    assert.match(learnSource, /Replace placeholder\/meta-instruction text with finished learner-facing prose/);
  });

  test("page generation is gated behind an explicit topic-map confirmation", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");

    // Planning stops at a pending confirmation state and never generates pages.
    assert.match(learnSource, /status: "awaiting_confirmation"/);
    // Generation refuses unless the map is confirmed.
    assert.match(learnSource, /map\.status !== "confirmed"/);
    assert.match(learnSource, /Confirm a learning map before generating lessons/);
    // A noninteractive/test escape hatch exists, defaulting OFF.
    assert.match(learnSource, /autoConfirmTopicMap = false/);
    assert.match(learnSource, /autoConfirmTopicMap\?: boolean/);
    // The bypass only fires when the flag is set (auto-promotes a proposed map).
    assert.match(learnSource, /&& autoConfirmTopicMap\)/);
    // Confirmation is a distinct exported step, not folded into planning.
    assert.match(learnSource, /export function confirmLearningMap/);
    // Legacy confirmed/proposed maps without Learning Unit Contracts must not
    // be exposed to generation/status.
    assert.match(learnSource, /function isContractBackedLearningMap/);
    assert.match(learnSource, /isContractBackedLearningMap\(latestConfirmed\)/);
    assert.match(learnSource, /visibleJob/);
  });

  test("generate route replans when a posted confirmed map id is stale", () => {
    const routeSource = fs.readFileSync(
      path.join(
        repoRoot,
        "src",
        "app",
        "api",
        "gardens",
        "[gardenId]",
        "learn",
        "generate",
        "route.ts",
      ),
      "utf8",
    );

    assert.match(routeSource, /getLearnStatusSnapshot/);
    assert.match(routeSource, /runLearnPlanning/);
    assert.match(routeSource, /requestedMapId && requestedMapId !== status\.confirmedLearningMapId/);
  });

  test("learn panel hides raw council output and allows stop while busy", () => {
    const workspaceSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
      "utf8",
    );

    assert.doesNotMatch(workspaceSource, /Show council output/);
    assert.doesNotMatch(workspaceSource, /Show council thinking/);
    assert.match(workspaceSource, /learnCancelBusy/);
    assert.match(workspaceSource, /disabled=\{learnCancelBusy\}/);
    assert.doesNotMatch(workspaceSource, /async function handleCancelLearn\(\) \{\s*if \(learnBusy\) return;/);
  });

  test("cancelling Learn rolls back generated learning artifacts", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");
    const cancelRouteSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "gardens", "[gardenId]", "learn", "cancel", "route.ts"),
      "utf8",
    );

    assert.match(learnSource, /cleanupLearnArtifactsAfterCancel/);
    assert.match(learnSource, /removeClusterPath\(clusterDir, LEARNING_ROOT/);
    assert.match(learnSource, /removeClusterPath\(clusterDir, "Learning"/);
    assert.match(learnSource, /DELETE FROM learn_maps WHERE garden_id = \?/);
    assert.match(learnSource, /DELETE FROM learn_versions WHERE garden_id = \?/);
    assert.match(learnSource, /\.breadboard\/learning-unit-contract\.json/);
    assert.match(learnSource, /\.breadboard\/planning/);
    assert.match(learnSource, /assets\/source-visuals/);
    assert.match(cancelRouteSource, /await cancelLatestLearnJob/);
  });
});

describe("anti-placeholder quality gate", () => {
  // A long, otherwise-valid lesson body we can inject scaffold text into.
  const LONG = "The membrane potential rises as input current arrives. ".repeat(50);
  const withScaffold = (scaffold) =>
    `# Lesson\n\n${LONG}\n\n${scaffold}\n\nFor example, raising the current makes it climb faster.\n\n**Question.** Why?\n\n**Answer.** Because timing carries information.\n`;

  test("rejects half-written scaffold verbs (insert / fill in / source says)", () => {
    for (const scaffold of [
      "Insert explanation of the threshold here.",
      "Add the example here.",
      "Source says the neuron leaks.",
    ]) {
      const q = assessLessonQuality(withScaffold(scaffold), {});
      assert.ok(q.hardFail, `should hard-fail: ${scaffold}`);
      assert.ok(
        q.problems.some((p) => p.code === "placeholder"),
        `should flag placeholder: ${scaffold}`,
      );
    }
  });

  test("rejects empty/ellipsis bullet scaffolds", () => {
    assert.ok(hasEmptyBulletScaffold("- \n- \n- "));
    assert.ok(hasEmptyBulletScaffold("- ...\n- TBD"));
    assert.ok(!hasEmptyBulletScaffold("- a real point\n- another real point"));
    const q = assessLessonQuality(withScaffold("- \n- \n- "), {});
    assert.ok(q.problems.some((p) => p.code === "empty-bullet-scaffold"));
  });

  test("a fully written lesson without scaffolds passes these checks", () => {
    const q = assessLessonQuality(withScaffold("A neuron integrates current until it fires."), {});
    assert.ok(!q.problems.some((p) => p.code === "placeholder" || p.code === "empty-bullet-scaffold"));
  });
});
