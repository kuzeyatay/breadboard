import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildLearningPageFrontmatter,
  containsRawVisualPlaceholder,
  formulaMetricFamily,
  normalizeZettelTags,
  sanitizeLearnerTitle,
  validateLearningMapDepth,
  hasPlaceholderText,
  hasEmptyBulletScaffold,
  emptyBulletScaffoldLines,
  assessLessonQuality,
  countAiisms,
  removeRawVisualPlaceholders,
  sourceSetHashForSources,
  textbookPageFileName,
  textbookSectionFolder,
} from "../src/lib/learn-utils.ts";

describe("learn utilities", () => {
  // A learning map is model-authored or it does not exist. There is no builder
  // that synthesizes sections, subsection titles, or purposes from source
  // headings, and no normalizer that substitutes one when the model returns
  // nothing — either would hand the garden a curriculum no model wrote.
  test("exposes no deterministic learning-map synthesizer", () => {
    const utilsSource = fs.readFileSync(
      path.join(process.cwd(), "src/lib/learn-utils.ts"),
      "utf8",
    );
    assert.doesNotMatch(utilsSource, /fallbackLearningMapFromSources/);
    assert.doesNotMatch(utilsSource, /normalizeLearningMapCandidate/);
    assert.doesNotMatch(utilsSource, /conceptPlansForSource|headingPlansForSource/);

    const learnSource = fs.readFileSync(path.join(process.cwd(), "src/lib/learn.ts"), "utf8");
    assert.doesNotMatch(learnSource, /fallbackLearningMapFromSources/);
    // A stored row whose learning map is missing reads back as no map at all.
    assert.match(learnSource, /learningMap\.sections\.length === 0[\s\S]{0,40}return null/);
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

  test("recognizes compact spike-count and convergence formula notation", () => {
    assert.equal(formulaMetricFamily("N_{\\mathrm{spk}} = \\sum_{i,t} s_{i,t}"), "spike-count");
    assert.equal(formulaMetricFamily("e^* = \\operatorname{argmin}_e \\{ A_e \\ge A_{target} \\}"), "convergence");
    assert.equal(formulaMetricFamily("\\eta_E = \\frac{A}{E}"), "efficiency");
    assert.equal(formulaMetricFamily("E_{\\text{total}} = E_{\\text{spike}}S_{\\text{total}} + E_{\\text{syn}}O_{\\text{syn}}"), "energy");
    assert.equal(formulaMetricFamily("E_{\\\\text{total}} = E_{\\\\text{spike}}S_{\\\\text{total}} + E_{\\\\text{syn}}O_{\\\\text{syn}}"), "energy");
    assert.equal(formulaMetricFamily("L = t_{\\text{decision}} - t_{\\text{stimulus}}"), "latency");
    assert.equal(formulaMetricFamily("latency measures the time cost of a decision"), "latency");
  });
});

describe("learn route and council wiring", () => {
  const repoRoot = path.resolve(process.cwd());

  test("learn API routes exist", () => {
    for (const route of [
      "plan",
      "confirm",
      "generate",
      "status",
      "cancel",
      "regenerate",
      "rebuild",
      "clear",
    ]) {
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
    assert.doesNotMatch(learnSource, /learn_source_map_fallback/);
    assert.doesNotMatch(learnSource, /learn_scope_contract_fallback/);
    assert.doesNotMatch(learnSource, /learn_learning_spine_fallback/);
    assert.doesNotMatch(learnSource, /planGardenVisualNecessity/);
    assert.match(learnSource, /runModelVisualNecessityPlanning/);
    assert.match(learnSource, /No fallback curriculum was written/);
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

  test("Learn runs on the selected model through ChatMock Council at high reasoning", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");
    const workspaceSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
      "utf8",
    );
    const learnRoute = (action) => fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "gardens", "[gardenId]", "learn", action, "route.ts"),
      "utf8",
    );

    // Learn is no longer pinned to one model: it follows the Intelligence
    // picker, and LEARN_MODEL is only what that resolution falls back to.
    assert.match(learnSource, /export const LEARN_MODEL = "gpt-5\.6-sol"/);
    assert.match(
      learnSource,
      /falls back to when the user has expressed no preference/,
    );
    assert.match(learnSource, /export const LEARN_REASONING = \{[\s\S]*?effort: "high"[\s\S]*?summary: "detailed"/);
    assert.match(learnSource, /model,[\s\S]*?reasoning: LEARN_REASONING,[\s\S]*?withCouncil|withCouncil\([\s\S]*?reasoning: LEARN_REASONING/);
    for (const action of ["plan", "generate", "regenerate", "rebuild", "confirm"]) {
      assert.match(
        learnRoute(action),
        /model: selectedModelForUser\(userId\)|const model = selectedModelForUser\(userId\)/,
      );
      // The choice comes from the user's stored preference, never from the
      // request body — a caller cannot steer a garden onto another model.
      assert.doesNotMatch(learnRoute(action), /body\.model/);
    }
    assert.doesNotMatch(workspaceSource, /JSON\.stringify\(\{\s*model,/);
    assert.doesNotMatch(workspaceSource, /Council · GPT-5\.6 Sol · High reasoning/);
    assert.match(learnSource, /The AI service connection was lost during Learn\. Retry Learn; if it fails again/);
  });

  test("an initial planning failure retries Learn instead of invoking repair", () => {
    const workspaceSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
      "utf8",
    );

    assert.match(
      workspaceSource,
      /shouldRepairFailedJob =\s*status === "failed" && hasExistingLearnContent/,
    );
    assert.match(
      workspaceSource,
      /shouldRepairFromPrimaryAction[\s\S]*?\? handleRepairIssues[\s\S]*?: status === "cancelled"[\s\S]*?: handleLearnPrimary/,
    );
    assert.match(workspaceSource, /status === "failed"[\s\S]*?"Retry Learn"/);
    assert.match(
      workspaceSource,
      /The AI service connection was lost during Learn\. Retry Learn; if it fails again/,
    );
  });

  test("Windows launcher waits for ChatMock before exposing the dashboard", () => {
    const launcherSource = fs.readFileSync(path.resolve(repoRoot, "..", "start.bat"), "utf8");

    assert.match(launcherSource, /127\.0\.0\.1:8765\/health/);
    assert.match(launcherSource, /if errorlevel 1/);
    assert.ok(
      launcherSource.indexOf("8765/health") < launcherSource.indexOf('start "Dashboard"'),
      "ChatMock health check must run before Dashboard starts",
    );
  });

  test("learn generation retries scaffold/meta-instruction failures before failing", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");

    assert.match(learnSource, /envPositiveInt\("LEARN_MAX_PAGE_ATTEMPTS", 2\)/);
    assert.match(learnSource, /Final-prose rules \(hard requirements\)/);
    assert.match(learnSource, /placeholderFailure/);
    assert.match(learnSource, /scaffold\/meta-instruction text/);
    assert.match(learnSource, /Replace placeholder\/meta-instruction text with finished learner-facing prose/);
  });

  test("page generation is gated behind confirmation, including automatic retained-lease handoff", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");

    // Human review stops at confirmation; the explicitly automatic pipeline
    // retains its fenced lease while it moves the same job into generation.
    assert.match(
      learnSource,
      /status:\s*retainLeaseOnSuccess\s*\?\s*"building_navigation"\s*:\s*"awaiting_confirmation"/,
    );
    assert.match(learnSource, /retainLeaseOnSuccess:\s*autoConfirmTopicMap/);
    assert.match(learnSource, /gardenLease:\s*retainedLease/);
    // Generation refuses unless the map is confirmed.
    assert.match(learnSource, /selectedMap\.status !== "confirmed"/);
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

  test("generate route refuses a stale confirmed map instead of silently replanning", () => {
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
    assert.doesNotMatch(routeSource, /runLearnPlanning/);
    assert.match(routeSource, /requestedMapId && requestedMapId !== status\.confirmedLearningMapId/);
    assert.match(routeSource, /Generate requires the current confirmed Learning Map/);
    assert.match(routeSource, /\{ status: 409 \}/);
  });

  test("creation routes reject existing learner content while full rebuild stays explicit", () => {
    const route = (action) => fs.readFileSync(
      path.join(
        repoRoot,
        "src",
        "app",
        "api",
        "gardens",
        "[gardenId]",
        "learn",
        action,
        "route.ts",
      ),
      "utf8",
    );
    const existingGardenGuard = /status\.latestTextbookVersionId \|\| status\.hasTextbook/;

    assert.match(route("plan"), existingGardenGuard);
    assert.match(route("confirm"), existingGardenGuard);
    assert.match(route("generate"), /status\.latestTextbookVersionId \|\| status\.hasTextbook/);
    assert.match(route("plan"), /Use Repair issues/);
    assert.match(route("confirm"), /Use Repair issues/);
    assert.match(route("generate"), /Use Repair issues/);
    assert.match(route("rebuild"), /forceFullRebuild/);
  });

  test("Learn panel exposes a separately confirmed garden-scoped clear action", () => {
    const workspaceSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
      "utf8",
    );
    const clearRouteSource = fs.readFileSync(
      path.join(
        repoRoot,
        "src",
        "app",
        "api",
        "gardens",
        "[gardenId]",
        "learn",
        "clear",
        "route.ts",
      ),
      "utf8",
    );
    const confirmationDialogSource = fs.readFileSync(
      path.join(
        repoRoot,
        "src",
        "app",
        "components",
        "learn-confirmation-dialog.tsx",
      ),
      "utf8",
    );

    assert.match(workspaceSource, /Clear Learn data/);
    assert.match(workspaceSource, /confirmClearLearnData: true/);
    assert.match(confirmationDialogSource, /Uploaded source documents/);
    assert.match(
      confirmationDialogSource,
      /notes outside the generated Learning folder will remain/,
    );
    assert.match(
      workspaceSource,
      /!learnState\?\.hasSources && status !== "failed" && !hasLearnData/,
    );
    assert.match(clearRouteSource, /requireOwnedClusterFromSlug/);
    assert.match(clearRouteSource, /body\.confirmClearLearnData !== true/);
    assert.match(clearRouteSource, /clearAllLearnData/);
    assert.match(clearRouteSource, /LearnClearConflictError/);
    assert.match(clearRouteSource, /LearnPipelineConflictError/);
    assert.match(clearRouteSource, /status: 409/);
  });

  test("existing gardens escape stale Learning Map review through scoped repair", () => {
    const workspaceSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
      "utf8",
    );
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");

    assert.match(
      workspaceSource,
      /status === "awaiting_confirmation" && hasExistingLearnContent/,
    );
    assert.match(
      workspaceSource,
      /expectedJobId: learnState\.job\.id[\s\S]*?if \(!cancelled\) return;[\s\S]*?postLearnAction\("regenerate", \{ mode: "repair" \}\)/,
    );
    assert.match(
      workspaceSource,
      /shouldRepairFromPrimaryAction[\s\S]*?\? handleRepairIssues/,
    );
    assert.match(
      learnSource,
      /return hasTextbook \|\| latestVersion \? "Repair issues" : "Review Learning Map"/,
    );
    assert.doesNotMatch(workspaceSource, /Last repair:/);
    assert.doesNotMatch(workspaceSource, /Existing learner pages are protected/);
    assert.doesNotMatch(workspaceSource, /proposedMap\.warnings\.map/);
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
    assert.match(workspaceSource, /Finished/);
    assert.match(workspaceSource, /Finished generating lessons\. The garden has been refreshed\./);
    assert.doesNotMatch(workspaceSource, /async function handleCancelLearn\(\) \{\s*if \(learnBusy\) return;/);
  });

  test("cancelling Learn rolls back only the latest Learn workflow", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");
    const cancelRouteSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "gardens", "[gardenId]", "learn", "cancel", "route.ts"),
      "utf8",
    );

    assert.match(learnSource, /createLearnRunSnapshot/);
    assert.match(learnSource, /inheritFromJobId: map\.jobId/);
    assert.match(learnSource, /rollbackLearnRun\(\{ gardenId, contentPath, jobId/);
    assert.match(learnSource, /learnMaps: db[\s\S]*?SELECT \* FROM learn_maps WHERE garden_id/);
    assert.match(learnSource, /learnVersions: db[\s\S]*?SELECT \* FROM learn_versions WHERE garden_id/);
    assert.match(learnSource, /restoreLearnDatabaseSnapshot/);
    assert.match(learnSource, /baselineBackupEntries/);
    const rollbackPathsStart = learnSource.indexOf("const LEARN_RUN_ROLLBACK_PATHS = [");
    const rollbackPathsEnd = learnSource.indexOf("] as const;", rollbackPathsStart);
    assert.ok(rollbackPathsStart >= 0 && rollbackPathsEnd > rollbackPathsStart);
    const rollbackPaths = learnSource.slice(rollbackPathsStart, rollbackPathsEnd);
    assert.doesNotMatch(rollbackPaths, /"_index\.md"|"sources\/_index\.md"/);
    assert.doesNotMatch(rollbackPaths, /source-visual-scan-cache/);
    assert.match(learnSource, /STATIC_LEARN_CLEAR_REMOVAL_ROOTS[\s\S]*?source-visual-scan-cache\.json/);
    assert.match(learnSource, /const snapshotCandidates = \[\.\.\.LEARN_RUN_ROLLBACK_PATHS\]/);
    assert.doesNotMatch(learnSource, /function deleteLearnDatabaseState/);
    assert.match(learnSource, /const activeController = activeLearnAbortControllers\.get\(latest\.id\)/);
    assert.match(learnSource, /activeController\?\.abort\(new LearnCancelledError\(\)\)/);
    assert.match(learnSource, /isLearnCancellation\(job\.id, error\)/);
    assert.match(learnSource, /latest\.id !== expectedJobId/);
    assert.match(learnSource, /void publishQuartzAfterMutation\(`learn cancellation cleanup/);
    assert.match(cancelRouteSource, /await cancelLatestLearnJob/);
    assert.match(cancelRouteSource, /expectedJobId/);
    assert.match(cancelRouteSource, /LearnCancelConflictError/);
    assert.match(cancelRouteSource, /status: 409/);
  });

  test("legacy regenerate maps to scoped repair and never replans", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");
    const regenerateRouteSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "gardens", "[gardenId]", "learn", "regenerate", "route.ts"),
      "utf8",
    );

    assert.match(learnSource, /resetSourceMap \? "full_rebuild" : "plan"/);
    assert.match(regenerateRouteSource, /runLearnRepairOperation/);
    assert.match(regenerateRouteSource, /legacyDefault: "repair"/);
    assert.match(regenerateRouteSource, /LearnRepairPendingMapError/);
    assert.match(regenerateRouteSource, /status: 409/);
    assert.doesNotMatch(regenerateRouteSource, /runLearnPlanning/);
    assert.doesNotMatch(regenerateRouteSource, /resetSourceMap: true/);
    assert.doesNotMatch(regenerateRouteSource, /runTextbookGeneration/);
    assert.match(learnSource, /latestJob\?\.status === "awaiting_confirmation"/);
    assert.match(learnSource, /Scoped repair must use runLearnRepairOperation; it cannot enter the full page-generation loop/);
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

  test("names the offending lines so the repair call can fix them", () => {
    const q = assessLessonQuality(withScaffold("- \n- TBD"), {});
    const problem = q.problems.find((p) => p.code === "empty-bullet-scaffold");
    assert.deepEqual(problem.evidence, ["-", "- TBD"]);
  });

  // Regression: display math splits a formula across lines, leaving the operator
  // alone on its own line. A bare `+`/`-` there is LaTeX, not an empty bullet.
  test("display-math operator lines are not bullet scaffolds", () => {
    const math = [
      "$$",
      "E_{\\text{total}}",
      "=",
      "N_{\\text{spike}}\\varepsilon_{\\text{spike}}",
      "+",
      "N_{\\text{synop}}\\varepsilon_{\\text{synop}}",
      "$$",
      "",
      "$$",
      "E_{\\text{net}}",
      "=",
      "E_{\\text{total}}",
      "-",
      "E_{\\text{idle}}",
      "$$",
    ].join("\n");
    assert.deepEqual(emptyBulletScaffoldLines(math), []);
    assert.ok(!hasEmptyBulletScaffold(math));
    const q = assessLessonQuality(withScaffold(math), {});
    assert.ok(!q.problems.some((p) => p.code === "empty-bullet-scaffold"));
  });

  test("aligned/bracket math and fenced code are not bullet scaffolds", () => {
    const aligned = "\\begin{aligned}\na &= b \\\\\n+\nc\n\\end{aligned}\n\n\\[\nx\n-\ny\n\\]";
    assert.ok(!hasEmptyBulletScaffold(aligned));
    assert.ok(!hasEmptyBulletScaffold("```diff\n-\n-\n+\n+\n```"));
  });

  test("thematic breaks and math-only bullets are not bullet scaffolds", () => {
    assert.ok(!hasEmptyBulletScaffold("Intro text.\n\n---\n\nMore text.\n\n---\n\nEnd."));
    assert.ok(!hasEmptyBulletScaffold("- $E = mc^2$\n- $F = ma$"));
  });

  test("real scaffolds still fail even when the page carries display math", () => {
    const body = "$$\na\n+\nb\n$$\n\n- \n- ...\n";
    assert.ok(hasEmptyBulletScaffold(body));
    assert.deepEqual(emptyBulletScaffoldLines(body), ["-", "- ..."]);
  });

  test("a fully written lesson without scaffolds passes these checks", () => {
    const q = assessLessonQuality(withScaffold("A neuron integrates current until it fires."), {});
    assert.ok(!q.problems.some((p) => p.code === "placeholder" || p.code === "empty-bullet-scaffold"));
  });
});
