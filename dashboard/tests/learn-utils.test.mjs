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
  learnerFacingScopeNotes,
  placeholderTextMatches,
  stripLeadingAuthorPreamble,
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

  test("filler, ceremony, and contrastive-negation openers count as AI-isms and are reported verbatim", async () => {
    const { aiismMatches, assessLessonQuality } = await import("../src/lib/learn-utils.ts");
    const slop = [
      "Electric potential is not about energy; it is about position.",
      "Far from being a side effect, the field merely encodes the force.",
      "Three features of this force are readily apparent upon measurement.",
      "The permittivity serves as a measure of the medium and plays a crucial role.",
      "Simply put, let's dive into the mechanism.",
    ].join(" ");
    const hits = aiismMatches(slop);
    for (const expected of ["is not about", "Far from being", "merely", "readily apparent", "serves as", "plays a crucial role", "Simply put,", "let's dive"]) {
      assert.ok(hits.some((hit) => hit.toLowerCase().includes(expected.toLowerCase())), `${expected} in ${JSON.stringify(hits)}`);
    }
    // Ordinary technical prose with the same words used plainly is untouched.
    assert.equal(countAiisms("If you measure the force you see three things. The field at a point is the force a unit charge would feel there. Doubling the distance cuts the force to a quarter."), 0);
    const problem = assessLessonQuality(`${slop} ${"word ".repeat(800)} **Question.** q\n\n<details>\n<summary>Answer</summary>\n\n**Answer.** for example a.\n\n</details>`)
      .problems.find((entry) => entry.code === "aiisms");
    assert.ok(problem?.hard);
    assert.ok(problem.evidence.includes("merely"));
    assert.match(problem.message, /contrastive-negation/);
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
    const eventsRouteSource = fs.readFileSync(
      path.join(
        repoRoot,
        "src",
        "app",
        "api",
        "gardens",
        "[gardenId]",
        "learn",
        "events",
        "route.ts",
      ),
      "utf8",
    );

    assert.match(learnSource, /withCouncil/);
    assert.match(learnSource, /taskType: "source_map"/);
    assert.match(learnSource, /taskType: "learning_spine"/);
    assert.match(learnSource, /taskType: "subsection_generation"/);
    assert.match(learnSource, /taskType: "subsection_repair"/);
    assert.doesNotMatch(
      learnSource,
      /taskType: "full_page_revision"|LEARN_ENABLE_UNCONDITIONAL_REVISION/,
    );
    assert.match(learnSource, /LEARN_PLANNING_COUNCIL_MODE/);
    assert.match(learnSource, /callPlanningJsonOnce/);
    assert.match(learnSource, /isAmbiguousModelTransportFailure/);
    assert.match(learnSource, /modelTransportFailureEvidence/);
    assert.doesNotMatch(learnSource, /isPlanningTimeoutError/);
    assert.match(learnSource, /learn_planning_transport_ambiguous/);
    assert.doesNotMatch(learnSource, /LEARN_PLANNING_RETRY_COUNCIL_MODE/);
    assert.doesNotMatch(learnSource, /learn_planning_timeout_retry/);
    assert.match(eventsRouteSource, /learn_planning_transport_ambiguous/);
    assert.doesNotMatch(
      eventsRouteSource,
      /learn_planning_timeout_retry|retryCouncilMode/,
    );
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
    assert.match(
      learnSource,
      /const debugRelPath = `\.breadboard\/debug\/failed-pages\/[\s\S]*?relPath: debugRelPath,[\s\S]*?FAILED QUALITY GATES/,
    );
    assert.doesNotMatch(learnSource, /Start with the idea itself/);
    assert.doesNotMatch(learnSource, /Name the starting idea/);
    assert.doesNotMatch(learnSource, /What is the main idea to take away from/);
  });

  test("Learn runs on the selected model through ChatMock Council at Ultra reasoning", () => {
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
    assert.match(learnSource, /export const LEARN_REASONING = \{[\s\S]*?effort: "max"[\s\S]*?summary: "detailed"/);
    assert.match(learnSource, /model,[\s\S]*?reasoning: LEARN_REASONING,[\s\S]*?withCouncil|withCouncil\([\s\S]*?reasoning: LEARN_REASONING/);
    assert.match(
      learnSource,
      /attachLearnTokenUsageTracking\([\s\S]*?completionRequestOverrides:\s*\{[\s\S]*?reasoning:\s*LEARN_REASONING/,
    );
    for (const action of ["plan", "generate", "regenerate", "rebuild", "confirm"]) {
      assert.match(
        learnRoute(action),
        // The route may take the model straight from the profile or let an
        // explicit per-run pick override it (resolveLearnRequestModel), but
        // the profile selection must remain the fallback either way.
        /model: selectedModelForUser\(userId\)|const model = selectedModelForUser\(userId\)|resolveLearnRequestModel\(body, selectedModelForUser\(userId\)\)/,
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
      /shouldRepairFailedJob =\s*status === "failed" &&\s*hasExistingLearnContent &&\s*job\?\.mode !== "update_sources"/,
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

    // Raised from 2 to 4 (2026-09-17): the term/concept review can reject a
    // page for a reason the repair only half clears, and two attempts left
    // pages failing that a third or fourth pass carried.
    assert.match(learnSource, /envPositiveInt\("LEARN_MAX_PAGE_ATTEMPTS", 4\)/);
    assert.match(learnSource, /Final-prose rules \(hard requirements\)/);
    assert.match(learnSource, /placeholderFailure/);
    assert.match(learnSource, /unfinished author-facing wording/);
    assert.match(learnSource, /diagnostic material from the rejected draft/);
    assert.match(learnSource, /Turn every unfinished or author-facing line into a self-contained learner explanation/);
  });

  test("page generation is gated behind confirmation, including automatic retained-lease handoff", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");
    const statusSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "learn-status-projection.ts"),
      "utf8",
    );

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
    assert.match(statusSource, /isContractBackedLearningMap\(latestConfirmed\)/);
    assert.match(statusSource, /visibleJob/);
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
    const executorSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "learn-operation-executor.ts"),
      "utf8",
    );

    assert.match(routeSource, /executeLearnOperationForRoute/);
    assert.match(routeSource, /operation: "generate"/);
    assert.match(
      routeSource,
      /requestedConfirmedLearningMapId: requestedMapId/,
    );
    assert.doesNotMatch(routeSource, /from "@\/lib\/learn"/);
    assert.match(executorSource, /getLearnStatusSnapshot/);
    assert.doesNotMatch(executorSource, /runLearnPlanning/);
    assert.match(
      executorSource,
      /request\.requestedConfirmedLearningMapId !==[\s\S]*?status\.confirmedLearningMapId/,
    );
    assert.match(executorSource, /Generate requires the current confirmed Learning Map/);
    assert.match(
      executorSource,
      /status\.job\?\.status === "failed" && status\.job\.requiresReplan/,
    );
    assert.match(executorSource, /requiresReplan: true/);
    assert.match(routeSource, /\{ status: 409 \}/);
  });

  test("generation replan intent is durable across background handoff and refresh", () => {
    const learnSource = fs.readFileSync(path.join(repoRoot, "src", "lib", "learn.ts"), "utf8");
    const statusSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "learn-status-projection.ts"),
      "utf8",
    );
    const workspaceSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
      "utf8",
    );

    assert.match(learnSource, /requires_replan\s+INTEGER NOT NULL DEFAULT 0/);
    assert.match(learnSource, /ALTER TABLE learn_jobs ADD COLUMN requires_replan/);
    assert.match(learnSource, /requiresReplan: Boolean\(row\.requires_replan \?\? 0\)/);
    assert.match(
      learnSource,
      /return rethrowAfterBestEffortLearnFailureCleanup\(error, async \(\) => \{[\s\S]*?requiresReplan = learnFailureRequiresReplan\(error\);[\s\S]*?updateLearnJob\(job\.id, \{[\s\S]*?status: restorePending \? "writing_quartz" : "failed"[\s\S]*?requiresReplan,[\s\S]*?\}\);[\s\S]*?\}\);/,
    );
    assert.match(
      learnSource,
      /async function rethrowAfterBestEffortLearnFailureCleanup\([\s\S]*?await cleanup\(\);[\s\S]*?catch \{[\s\S]*?throw authoritativeError;/,
    );
    assert.match(statusSource, /failedGenerationRequiresReplanFromEvents/);
    assert.match(
      workspaceSource,
      /job\?\.status === "failed"[\s\S]*?job\.requiresReplan[\s\S]*?postLearnAction\("plan"\)/,
    );
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
    const executorSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "learn-operation-executor.ts"),
      "utf8",
    );

    for (const action of ["plan", "confirm", "generate"]) {
      const routeSource = route(action);
      assert.match(routeSource, /executeLearnOperationForRoute/);
      assert.match(routeSource, new RegExp(`operation:\\s*"${action}"`));
      assert.doesNotMatch(routeSource, /from "@\/lib\/learn"/);
    }
    assert.match(
      executorSource,
      /function requireCurrentProposal\([\s\S]*?status\.latestTextbookVersionId \|\| status\.hasTextbook/,
    );
    assert.match(
      executorSource,
      /case "plan": \{[\s\S]*?status\.latestTextbookVersionId \|\| status\.hasTextbook/,
    );
    assert.match(
      executorSource,
      /case "generate": \{[\s\S]*?status\.latestTextbookVersionId \|\| status\.hasTextbook[\s\S]*?rejectExistingLearnerContent\(\)/,
    );
    assert.match(executorSource, /Use Repair issues/);
    assert.match(route("rebuild"), /isFullRebuildRequest\(operation\)/);
    assert.match(
      executorSource,
      /case "rebuild":[\s\S]*?forceFullRebuild: true/,
    );
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
    const learnSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "learn.ts"),
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

    assert.match(workspaceSource, /Clear data/);
    assert.match(workspaceSource, /confirmClearLearnData: true/);
    assert.match(confirmationDialogSource, /title: "Clear Learn data\?"/);
    assert.match(
      confirmationDialogSource,
      /This permanently deletes all generated Learn content and history\. This cannot be undone\./,
    );
    assert.match(
      workspaceSource,
      /!learnState\?\.hasSources && status !== "failed" && !hasLearnData/,
    );
    assert.match(clearRouteSource, /requireOwnedClusterFromSlug/);
    assert.match(
      clearRouteSource,
      /const \{ userId, cluster \} = await requireOwnedClusterFromSlug\(gardenId\)/,
    );
    assert.match(clearRouteSource, /body\.confirmClearLearnData !== true/);
    assert.match(
      clearRouteSource,
      /clearAllLearnData\(\{[\s\S]*?userId,[\s\S]*?gardenId: cluster\.slug/,
    );
    assert.match(
      learnSource,
      /export async function clearAllLearnData\(\{\s*userId,[\s\S]*?publishQuartzAfterMutation\(`cleared Learn data in \$\{gardenId\}`,[\s\S]*?\{\s*userId,/,
    );
    assert.match(clearRouteSource, /LearnClearConflictError/);
    assert.match(clearRouteSource, /LearnPipelineConflictError/);
    assert.match(clearRouteSource, /status: 409/);
  });

  test("existing gardens escape stale Learning Map review through scoped repair", () => {
    const workspaceSource = fs.readFileSync(
      path.join(repoRoot, "src", "app", "gardens", "[clusterSlug]", "workspace-client.tsx"),
      "utf8",
    );
    const statusSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "learn-status-projection.ts"),
      "utf8",
    );

    assert.match(
      workspaceSource,
      /status === "awaiting_confirmation" &&\s*hasExistingLearnContent &&\s*job\?\.mode !== "update_sources"/,
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
      statusSource,
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
    assert.match(learnSource, /generationRollbackInheritanceJobId/);
    assert.match(learnSource, /inheritFromJobId: inheritedPlanningSnapshotJobId/);
    assert.doesNotMatch(learnSource, /inheritFromJobId: map\.jobId/);
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
    assert.match(cancelRouteSource, /cancelLatestLearnJob\(\{[\s\S]*?userId,/);
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
    const executorSource = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "learn-operation-executor.ts"),
      "utf8",
    );

    assert.match(
      learnSource,
      /operationMode === "plan" \|\| operationMode === "update_sources"/,
    );
    assert.match(
      learnSource,
      /mode: updateExisting \? "update_sources" : "generate"/,
    );
    assert.match(regenerateRouteSource, /executeLearnOperationForRoute/);
    assert.match(regenerateRouteSource, /operation: "repair"/);
    assert.match(regenerateRouteSource, /legacyDefault: "repair"/);
    assert.match(regenerateRouteSource, /isLearnRouteConflict/);
    assert.match(regenerateRouteSource, /status: 409/);
    assert.doesNotMatch(regenerateRouteSource, /runLearnPlanning/);
    assert.doesNotMatch(regenerateRouteSource, /resetSourceMap: true/);
    assert.doesNotMatch(regenerateRouteSource, /runTextbookGeneration/);
    assert.match(
      executorSource,
      /case "repair":[\s\S]*?return runLearnRepairOperation\(/,
    );
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

// Six telecom-1 receipts (2026-09-17) opened with the model narrating its own
// repair. Replaying them handed the strict critic the same six findings on
// every resumed run.
describe("a repair narration ahead of the lesson", () => {
  const lesson = "A shared physical channel has one finite transmission capacity.\n\nSuppose four terminals want it at once.";
  const preambles = [
    "I'm applying the repair narrowly: I'll keep the lesson, figures, marker, questions, and answers unchanged, and only fix the first use of \"collision\" so the term is taught before it is used.",
    "I'll apply the narrow repair only: anchor \"carrier\" immediately to the existing six-slot D-AMPS frame.",
    "I'm treating this as a focused repair of the existing lesson page: only the flagged repetition changes.",
    "I'm repairing only the flagged gaps: the Maxwell-to-wave-equation step, the cylindrical wave equation, and the LP naming.",
    "I'll repair only the five flagged gaps and leave the rest of the lesson intact, using the copy sheet verbatim.",
  ];

  test("is stripped from the front of the page", () => {
    for (const preamble of preambles) {
      const { markdown, stripped } = stripLeadingAuthorPreamble(`${preamble}\n\n${lesson}`);
      assert.equal(stripped, preamble);
      assert.equal(markdown, lesson);
    }
  });

  test("a lesson that opens in the first person is left alone", () => {
    const body = "I will start with the simplest picture: one carrier, one user.\n\nA second user changes everything.";
    assert.deepEqual(stripLeadingAuthorPreamble(body), { markdown: body, stripped: null });
    const heading = `# Reading a TDMA Radio Allocation\n\n${lesson}`;
    assert.deepEqual(stripLeadingAuthorPreamble(heading), { markdown: heading, stripped: null });
  });

  test("a one-paragraph body is never emptied", () => {
    assert.equal(stripLeadingAuthorPreamble(preambles[0]).stripped, null);
  });

  test("the same narration later in the body is a hard placeholder failure", () => {
    const matches = placeholderTextMatches(`${lesson}\n\n${preambles[0]}\n\nMore lesson.`);
    assert.ok(matches.some((match) => match.snippet.startsWith("I'm applying the repair narrowly")));
    assert.equal(placeholderTextMatches(lesson).length, 0);
  });
});

// telecom-1's Learning Map published the planner's own notes ("syllabusCoverage
// marks SU5 unteachable", "expectedWordRange lower bounds ... additive update
// rules") as learner-facing Scope Notes (2026-09-19).
describe("scope notes a learner should see", () => {
  test("planner machinery stays out, coverage decisions stay in", () => {
    const notes = learnerFacingScopeNotes([
      "M2.a.v: NOMA remains uncoverable because syllabusCoverage marks SU5 unteachable and the selected sources do not provide substantive NOMA teaching content.",
      "Existing learning units are preserved verbatim under the additive update rules, so inherited expectedWordRange lower bounds below 1000 words remain unchanged even though newly authored units use the current 1000-word planning floor.",
      "The exact bibliographic identity of the selected 'Intro to wireless MAC and queuing theory' lecture is unresolved, although its content directly supports the MAC and queueing material.",
      'Syllabus item "M2.a.v: NOMA" could not be fully supported by the available source material and was left uncovered.',
      'Syllabus item "M2.a.v: NOMA" could not be fully supported by the available source material and was left uncovered.',
    ]);
    assert.deepEqual(notes, [
      "The exact bibliographic identity of the selected 'Intro to wireless MAC and queuing theory' lecture is unresolved, although its content directly supports the MAC and queueing material.",
      'Syllabus item "M2.a.v: NOMA" could not be fully supported by the available source material and was left uncovered.',
    ]);
  });
});

describe("pipeline vocabulary never reaches a learner", () => {
  test("machinery nouns and planning verdicts are a hard page failure", async () => {
    const { assessLessonQuality, pipelineVocabularyMatches } =
      await import("../src/lib/learn-utils.ts");
    // telecom-1 11.3, 2026-09-19: this prose shipped to a learner and the
    // critic could only catch it late as a non-deterministic debug_artifact_leak.
    const body = [
      "None of the supplied passages directly establishes the material-level properties.",
      "",
      "This unit is deferred until direct plastic-optical-fiber evidence is added.",
      "",
      "The available material assigned to this unit discusses other parts of the theory.",
    ].join(String.fromCharCode(10));
    const matches = pipelineVocabularyMatches(body);
    assert.ok(matches.length >= 3, "each machinery phrase is reported");
    const problem = assessLessonQuality(body, { minWords: 1 }).problems
      .find((entry) => entry.code === "pipeline-vocabulary");
    assert.ok(problem, "pipeline vocabulary is reported as its own problem");
    assert.equal(problem.hard, true);
    assert.ok(
      problem.evidence.some((line) => line.includes("This unit is deferred")),
      "the offending line travels with the failure so a repair can act on it",
    );
  });

  test("an honest statement of what a source does not cover is allowed", async () => {
    const { pipelineVocabularyMatches } = await import("../src/lib/learn-utils.ts");
    // Every one of these ships in accepted telecom-1 lessons. A lesson stating
    // its own limits is teaching; only machinery vocabulary is rejected.
    for (const line of [
      "The material used here does not explain how the speech coder converts speech.",
      "Its full derivation is outside the assigned treatment.",
      "The information available here does not provide a rule for calculating that value.",
      "A complete accounting would need the detailed relationship between the fields.",
      "The base station serves several users, and each cell reuses its frequency set.",
    ]) {
      assert.deepEqual(pipelineVocabularyMatches(line), [], line);
    }
  });

  test("interactive-visual markers are machinery, not prose", async () => {
    const { pipelineVocabularyMatches } = await import("../src/lib/learn-utils.ts");
    const body = [
      "Frequency, time and code are three answers to one shared-resource problem.",
      "",
      "<!-- learning-unit:U2:interactive-visual -->",
      "",
      "Switch between the bands while the underlying channel stays fixed.",
    ].join(String.fromCharCode(10));
    assert.deepEqual(pipelineVocabularyMatches(body), []);
  });
});

describe("a lesson that declines to teach its own subject", () => {
  test("objective-aware refusals distinguish missing teaching from optional derivations", async () => {
    const { declinedLessonMatches } = await import("../src/lib/learn-utils.ts");
    const objective = { title: "Step-index and graded-index fiber", learningQuestion: "How do step-index and graded-index profiles differ?" };
    for (const text of [
      "This lesson cannot explain the difference between step-index and graded-index profiles.",
      "The material used here does not explain how step-index and graded-index profiles differ.",
      "The step-index and graded-index profiles cannot be compared here.",
    ]) assert.equal(declinedLessonMatches(text, objective).length, 1, text);
    for (const text of [
      "The full Maxwell derivation cannot be derived here; this lesson teaches how to use Snell's law.",
      "This lesson does not explain the full Maxwell derivation.",
      "An optional derivation of graded-index propagation cannot be established here.",
      "The critical angle cannot be calculated without both refractive indices.",
    ]) assert.deepEqual(declinedLessonMatches(text, objective), [], text);
  });
  test("is reported with the offending line", async () => {
    const { declinedLessonMatches } = await import("../src/lib/learn-utils.ts");
    // A refusal of the central distinction, even when wrapped across lines.
    const body = [
      "The names step-index fiber and graded-index fiber identify two profile classes.",
      "",
      "The specific physical distinction between the step-index and graded-index",
      "profiles cannot be derived here without adding information.",
    ].join(String.fromCharCode(10));
    const declined = declinedLessonMatches(body);
    assert.equal(declined.length, 1);
    assert.ok(declined[0].snippet.includes("cannot be derived here"));
  });

  test("an honest scope note about a digression is not a declination", async () => {
    const { declinedLessonMatches } = await import("../src/lib/learn-utils.ts");
    for (const line of [
      "The material used here does not explain how the speech coder converts speech.",
      "Its full derivation requires the refraction law, which has not been established.",
      "A complete accounting would need the detailed frame description.",
      "The critical angle cannot be calculated without both refractive indices.",
    ]) {
      assert.deepEqual(declinedLessonMatches(line), [], line);
    }
  });
});

describe("notation continuity across a garden", () => {
  test("mentions, assumptions, code and HTML markers do not establish prerequisites", async () => {
    const { unexplainedApparatus, createApparatusProgress } = await import("../src/lib/learn-utils.ts");
    const progress = createApparatusProgress();
    assert.deepEqual(unexplainedApparatus("We assume partial derivatives are familiar. $$\\partial E$$", progress), ["partial derivative"]);
    assert.deepEqual([...progress.encountered], ["partial derivative"]);
    assert.deepEqual([...progress.unresolved], ["partial derivative"]);
    assert.equal(progress.explained.size, 0);
    assert.deepEqual(unexplainedApparatus("A partial derivative measures how one quantity changes while the other inputs stay fixed. $$\\partial E$$", progress), []);
    assert.equal(progress.unresolved.size, 0);
    assert.deepEqual(unexplainedApparatus("$$\\partial F$$", progress), []);
    assert.deepEqual(unexplainedApparatus("<!-- \\nabla -->\n```js\nconst formula = '\\int';\n```", createApparatusProgress()), []);
    assert.deepEqual(unexplainedApparatus("$$e^{j\\omega t}$$", createApparatusProgress()), ["complex number"]);
    const proseFirst = createApparatusProgress();
    unexplainedApparatus("An integral measures the total accumulated quantity, like the area under a curve.", proseFirst);
    assert.deepEqual(unexplainedApparatus("$$\\int f(x)dx$$", proseFirst), []);
  });
  test("unexplained apparatus remains unresolved in later lessons", async () => {
    const { unexplainedApparatus } = await import("../src/lib/learn-utils.ts");
    const BS = String.fromCharCode(92);
    const bare = `The field obeys $$${BS}frac{${BS}partial^2 E}{${BS}partial r^2} + q^2 E = 0$$ here.`;
    const established = new Set();
    assert.deepEqual(unexplainedApparatus(bare, established), ["partial derivative"]);
    assert.deepEqual(unexplainedApparatus(bare, established), ["partial derivative"]);
    assert.equal(established.size, 0);
  });

  test("apparatus the lesson names in prose is not reported", async () => {
    const { unexplainedApparatus } = await import("../src/lib/learn-utils.ts");
    const BS = String.fromCharCode(92);
    // telecom-1 9.2 explains the symbol as a radial slope before leaning on it.
    const explained = `The radial slope changes outward, so $$${BS}frac{${BS}partial E}{${BS}partial r}$$ appears.`;
    assert.deepEqual(unexplainedApparatus(explained, new Set()), []);
    const summed = `Adding up every state gives $$${BS}sum_{n=0}^{C} P_n = 1$$ for the trunk.`;
    assert.deepEqual(unexplainedApparatus(summed, new Set()), []);
  });
});
