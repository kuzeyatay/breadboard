import crypto from "node:crypto";
import {
  externalRuntimeFilesystem as fs,
  externalRuntimeReadUtf8,
} from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { repositoryRoot } from "./runtime-paths.ts";
import { withCouncil } from "./council.ts";
import {
  runGeneratedVisualCouncilRequestWithReceipt,
  type RunGeneratedVisualCouncilRequestInput,
} from "./generated-visual-council-receipts.ts";
import {
  saveGeneratedVisualArtifact,
  loadGeneratedVisualManifest,
  generatedVisualArtifactDir,
  type CreateGeneratedVisualizationInput,
  type GeneratedVisualResult,
  type GeneratedVisualCriticRecord,
  type GeneratedVisualTestsRecord,
  type GeneratedVisualizationManifest,
} from "./generated-visuals.ts";
import type { GeneratedVisualRejectedAttempt } from "./generated-visuals.ts";
import { LEARN_VISUALIZER_SKILL } from "./learn-native-visualizer-contract.ts";
import { parseJsonObjectResponse } from "./learn-utils.ts";

const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

// What each browser gate actually does, in words a repair can act on. The
// gate names alone ("reduced-motion: pause freezes primary scene: failed")
// left the web chat models guessing: on 2026-09-15 one required visual spent
// two of six attempts failing the same reduced-motion gates and two more
// answering with a prose description of its fix instead of the package.
const BROWSER_GATE_REQUIREMENTS: ReadonlyArray<[RegExp, string]> = [
  [/animation changes primary scene/, "Pressing the play/pause button must visibly change the canvas or SVG geometry within 800 ms, also under prefers-reduced-motion (the test presses Play explicitly; reduced motion only means it must not start playing by itself)."],
  [/pause freezes primary scene/, "After Play then Pause, the canvas/SVG must stay pixel-identical for at least 260 ms and the play/pause button must report aria-pressed=\"false\" - in every mode, including prefers-reduced-motion. Cancel every animation frame, timer and transition on pause."],
  [/reset is deterministic/, "Clicking Reset twice (with playback paused) must draw exactly the same canvas/SVG both times: reset to fixed initial values, never to time-, frame- or random-dependent state."],
  [/reduced motion starts paused/, "Under prefers-reduced-motion the simulation must load paused, with the play/pause button reporting aria-pressed=\"false\"."],
  [/control \S+ changes primary scene/, "Changing each declared control must change the canvas/SVG geometry itself; labels, text and readouts are ignored by the check."],
  [/pause freezes primary scene|reset is deterministic|animation changes primary scene/, "Text inside the SVG is ignored by these checks; only drawn geometry and canvas pixels count."],
];

/** The repair instruction sent with a rejected candidate's exact errors. */
export function learnVisualRepairInstruction(errors: readonly string[]): string {
  const requirements = BROWSER_GATE_REQUIREMENTS.filter(([pattern]) =>
    errors.some((error) => pattern.test(error)),
  ).map(([, requirement]) => `- ${requirement}`);
  return [
    "Repair these exact failures without losing the concept or working behavior.",
    ...(requirements.length > 0
      ? ["What the failed browser checks require:", ...Array.from(new Set(requirements))]
      : []),
    "Return the complete corrected JSON object with plan and package only. Do not describe the changes, explain the failure, or add any text before or after the object.",
  ].join("\n");
}

export function parseLearnVisualizerResponse(
  content: string,
): Record<string, any> {
  // Shared with the critic loop's JSON repairs; see parseJsonObjectResponse
  // for what it accepts (fences, a surplus brace, a sentence of leading prose)
  // and what it still refuses (a second response, trailing prose).
  return parseJsonObjectResponse(content);
}

export function loadLearnVisualizerSkill() {
  const skillPath = path.join(
    repositoryRoot(),
    "hermes-skills",
    "prebuilt",
    LEARN_VISUALIZER_SKILL,
    "SKILL.md",
  );
  const text = externalRuntimeReadUtf8(skillPath);
  if (!text.includes(`name: ${LEARN_VISUALIZER_SKILL}`))
    throw new Error("The native Learn visualizer skill is missing or invalid.");
  return { text, hash: hash(text), path: skillPath };
}

export function learnVisualizerAuthorPrompt(skillText: string): string {
  return `${skillText}\n\nLEARN ARTIFACT ADAPTER\nThe host invokes this skill for an existing lesson. Return JSON {plan, package}; the host performs the create tool's compilation, browser tests, critique and versioned garden publication. Do not call tools or rewrite the lesson. Use the complete schema-2 native package above, never defineVisualization or a declarative scene catalogue.
Teach the hard concept through a dominant spatial or animated scene. Show the causal mechanism, then its equation/readout. Every animation must change the explanatory geometry, field, path, wave or solver state; never animate decoration or merely a number. For a static relation animate a clearly labelled explanatory sweep, construction or probe, and distinguish that from physical time. For spatial concepts use a rotatable projected 3D Canvas/SVG or THREE only when useful. Preserve the supplied source claims, units and sign conventions. Label illustrative normalization, time scale and model limits.
Design for readable geometry before adding detail: place vector quantities at their actual points of evaluation, use shared endpoints for compared angles, distinguish coordinate guides from physical vectors, and encode magnitudes consistently or explicitly label normalized arrows. Keep labels away from geometry, move secondary labels into a semantic HTML legend, and use readable text at 375px. Never draw a sentence or caption with a single-line canvas fillText: explanatory strings (share captions, disclaimers, state descriptions) live in DOM text elements that wrap naturally inside the panel, or, if they must be on the canvas, are wrapped with measureText against the current panel width; check every view and every control value at 375px so nothing is clipped or overlaps. Preserve vertical touch scrolling with pan-y and dedicated keyboard-accessible orbit/zoom controls. Provide a named canvas and a concise nonvisual equivalent that updates on control changes and pause, without announcing every frame. Use semantic subscripts/superscripts for equations and define normalized variables. Never use local identifiers named parent, top, or opener, which are reserved by the offline boundary.
Include working Play/Pause and Reset with the exact data-action attributes and icon/accessibility contract. Start at a useful representative state; start paused when an exact limiting case should be inspected first, and always start paused for reduced motion. aria-pressed=true means playing. Reset restores a deterministic useful initial state and pauses. All controls must materially affect the primary scene, including every requiredInput with its exact id as a native DOM id, original options/range/default and purpose. Use a required reset control as the top Reset control instead of duplicating it. Preserve requiredOutputs in plan.outputs and show their meaning; add at most two explanatory controls when needed. The first SVG outside buttons or main canvas is the scene the release gate observes. No inert controls or prose-only case switches. Pause when hidden, bound simulation steps and frame delta, and repaint on host theme changes.
The plan is {schemaVersion:1,title,objective,mode,rationale,concepts:string[],assumptions:string[],controls:[{id,label,type:range|number|select|toggle|button,purpose,initialValue?,minimum?,maximum?,step?,unit?}],outputs:[{id,label,purpose,unit?}],interactions:string[],animation:{enabled:true,canPause:true,canReset:true},dataRequirements:[],assetRequirements:[],accessibilityRequirements:string[],sourceReferences:string[]}.
Use exactly three package files, no assets or external URLs in any file (including SVG namespace URL literals; use canvas or existing SVG markup). Keep combined source compact, under 45000 characters. Include a visual integrity semantic assertion plus assertions describing the actual equations, limiting cases, and animation mechanism. Before returning, trace the exact reset, animation, each control, and reduced motion behavior in your JavaScript.`;
}

export async function createLearnNativeVisualizer(
  input: CreateGeneratedVisualizationInput,
): Promise<GeneratedVisualResult> {
  let skill = loadLearnVisualizerSkill();
  const opportunity = input.opportunity;
  const owner = input.recoveryOwnerId ?? crypto.randomUUID();
  const root = generatedVisualArtifactDir(input.gardenDir, opportunity.id);
  const runDir = path.join(
    root,
    "attempts",
    `native-${owner.replace(/[^\w-]/g, "_")}`,
  );
  fs.mkdirSync(runDir, { recursive: true });
  const skillSnapshot = path.join(runDir, "skill.md");
  if (fs.existsSync(skillSnapshot)) {
    const text = fs.readFileSync(skillSnapshot, "utf8");
    skill = { text, hash: hash(text), path: skillSnapshot };
  } else fs.writeFileSync(skillSnapshot, skill.text);
  const signal = input.abortSignal;
  let errors: string[] = [];
  let failureCategory: GeneratedVisualResult["failureCategory"] = "validation";
  let previous: unknown;
  const rejected = (
    attempt: number,
    category: GeneratedVisualRejectedAttempt["category"],
    evidence?: GeneratedVisualRejectedAttempt["evidence"],
    sourceCode?: string,
  ) => {
    const at = new Date().toISOString();
    const candidate = previous as Record<string, any> | undefined;
    const record: GeneratedVisualRejectedAttempt = {
      schemaVersion: 1,
      visualizationId: opportunity.id,
      runId: `native-${owner}`,
      attempt,
      category,
      rejectedAt: at,
      errors: [...errors],
      candidate:
        sourceCode && candidate
          ? {
              title: String(candidate.plan?.title ?? opportunity.id),
              explanation: String(
                candidate.package?.manifest?.description ?? "",
              ),
              sourceCode,
              testCases: [],
              accessibilityDescription: String(
                candidate.package?.manifest?.accessibilityDescription ?? "",
              ),
              pedagogicalClaims: Array.isArray(candidate.plan?.concepts)
                ? candidate.plan.concepts
                : [],
            }
          : null,
      lifecycle: [
        { status: "rejected", at, attempt, detail: errors.join("; ") },
      ],
      evidence,
    };
    fs.writeFileSync(
      path.join(runDir, `attempt-${attempt}`, "rejection.json"),
      JSON.stringify(record, null, 2),
    );
    input.onRejectedAttempt?.(record);
    input.onEvent?.({
      type: "visual_native_attempt_rejected",
      data: { visualizationId: opportunity.id, attempt, category, errors },
    });
  };
  const request = async (
    phase: "author" | "critic",
    attempt: number,
    system: string,
    evidence: unknown,
    previewPath?: string,
  ) => {
    input.checkCancelled?.();
    signal?.throwIfAborted();
    const images = (
      previewPath
        ? [
            previewPath,
            path.join(path.dirname(previewPath), "mobile-preview.png"),
          ]
        : []
    )
      .filter((file) => fs.existsSync(file))
      .map((file) => ({
        type: "image_url" as const,
        image_url: {
          url: `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`,
        },
      }));
    const requestPath = path.join(runDir, `${phase}-${attempt}.request.json`);
    const preparedRequest = fs.existsSync(requestPath)
      ? JSON.parse(fs.readFileSync(requestPath, "utf8"))
      : withCouncil(
          {
            model: input.model,
            reasoning: { effort: "max", summary: "detailed" },
            max_completion_tokens: phase === "author" ? 16000 : 3000,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: images.length
                  ? [
                      { type: "text", text: JSON.stringify(evidence) },
                      ...images,
                    ]
                  : JSON.stringify(evidence),
              },
            ],
          },
          {
            taskType:
              phase === "author" ? "visualization_generation" : "critique",
            gardenId: opportunity.gardenId,
            pageId: opportunity.targetPage,
            councilModeOverride: "direct_council",
          },
        );
    if (!fs.existsSync(requestPath))
      fs.writeFileSync(requestPath, JSON.stringify(preparedRequest));
    const receipt = await runGeneratedVisualCouncilRequestWithReceipt({
      client:
        input.client as unknown as RunGeneratedVisualCouncilRequestInput["client"],
      durableRecoveryDir:
        input.durableRecoveryDir ??
        path.join(path.dirname(input.gardenDir), ".native-visual-receipts"),
      invocationKey: `${owner}:${opportunity.id}:native:${phase}:${attempt}`,
      recoveryMetadata: {
        sourceSkill: LEARN_VISUALIZER_SKILL,
        skillHash: skill.hash,
        phase,
        attempt,
      },
      allowImageUrlParts: images.length > 0,
      signal,
      startedReceiptObservationTimeoutMs: input.timeoutMs ?? 20 * 60_000,
      request: preparedRequest,
    });
    input.onCouncilReceipt?.({ ...receipt, phase, semanticAttempt: attempt });
    fs.writeFileSync(
      path.join(runDir, `${phase}-${attempt}.json`),
      receipt.content,
    );
    return parseLearnVisualizerResponse(receipt.content);
  };
  const attempts = Math.max(1, Math.min(6, input.maxAttempts ?? 3));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const stage = path.join(runDir, `attempt-${attempt}`);
    fs.mkdirSync(stage, { recursive: true });
    input.onEvent?.({
      type: "visual_native_skill_generation_started",
      data: {
        visualizationId: opportunity.id,
        attempt,
        sourceSkill: LEARN_VISUALIZER_SKILL,
        skillHash: skill.hash,
      },
    });
    const recovered = attempt === 1 ? input.nativeAuthorRecovery : undefined;
    if (
      recovered &&
      (!/^[a-f0-9]{64}$/.test(recovered.skillHash) ||
        !/^[a-f0-9]{64}$/.test(recovered.requestHash) ||
        !/^lrq_[\w-]+$/.test(recovered.requestId))
    )
      throw new Error("Invalid native author recovery binding.");
    let candidate: Record<string, any>;
    try {
      candidate = recovered
        ? (recovered.candidate as Record<string, any>)
        : await request(
            "author",
            attempt,
            learnVisualizerAuthorPrompt(skill.text),
            {
              opportunity,
              localTeachingText: input.pageMarkdown,
              sourceContext: input.sourceContext,
              sourceFigures: input.sourceFigureSummaries,
              formulas: input.formulaDefinitions,
              ...(previous
                ? {
                    previousCandidate: previous,
                    exactErrors: errors,
                    instruction: learnVisualRepairInstruction(errors),
                  }
                : {}),
            },
          );
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      errors = [
        `Return one valid JSON object with plan and package. ${error.message}`,
      ];
      previous = fs.readFileSync(
        path.join(runDir, `author-${attempt}.json`),
        "utf8",
      );
      failureCategory = "validation";
      rejected(attempt, "generation");
      continue;
    }
    previous = candidate;
    if (recovered)
      fs.writeFileSync(
        path.join(stage, "author-recovery.json"),
        JSON.stringify(recovered),
      );
    const authorSkillHash = recovered?.skillHash ?? skill.hash;
    const sourceCode = JSON.stringify({
      ...candidate,
      sourceSkill: LEARN_VISUALIZER_SKILL,
      skillHash: authorSkillHash,
    });
    const sourcePath = path.join(stage, "source.json");
    const sameCandidate =
      fs.existsSync(sourcePath) &&
      fs.readFileSync(sourcePath, "utf8") === sourceCode;
    fs.writeFileSync(sourcePath, sourceCode);
    const compiled = await input.compilerRunner(
      sourceCode,
      opportunity,
      signal,
    );
    fs.writeFileSync(
      path.join(stage, "validation.json"),
      JSON.stringify(compiled.validation, null, 2),
    );
    if (!compiled.definition) {
      errors = compiled.validation.errors;
      failureCategory = "validation";
      rejected(
        attempt,
        "validation",
        { validation: compiled.validation },
        sourceCode,
      );
      continue;
    }
    const previousCriticPath = path.join(stage, "critic.json");
    if (sameCandidate && fs.existsSync(previousCriticPath)) {
      const prior = JSON.parse(fs.readFileSync(previousCriticPath, "utf8"));
      // A byte-identical candidate still needs the same source-level repairs.
      // Resume at the next author receipt instead of repeating browser work.
      if (
        prior.approved === false &&
        typeof prior.reason === "string" &&
        Array.isArray(prior.requestedChanges)
      ) {
        errors = [prior.reason, ...prior.requestedChanges];
        failureCategory = "critic";
        rejected(
          attempt,
          "critic",
          { validation: compiled.validation, critic: prior },
          sourceCode,
        );
        continue;
      }
    }
    const browser = await input.browserTestRunner({
      definition: compiled.definition,
      outputDir: stage,
      timeoutMs: 35000,
      signal,
      requireMobileValidation: true,
    });
    const tests: GeneratedVisualTestsRecord = {
      passed: browser.tests.length > 0 && browser.tests.every((t) => t.passed),
      checkedAt: new Date().toISOString(),
      staticTests: [
        {
          name: "native chat skill compiler",
          passed: compiled.validation.valid,
        },
      ],
      semanticTests: [],
      runtimeTests: browser.tests,
      browser: browser.browser,
    };
    fs.writeFileSync(
      path.join(stage, "tests.json"),
      JSON.stringify(tests, null, 2),
    );
    if (!tests.passed) {
      errors = browser.tests
        .filter((t) => !t.passed)
        .map((t) => `${t.name}: ${t.detail ?? "failed"}`);
      failureCategory = "runtime";
      rejected(
        attempt,
        "runtime",
        { validation: compiled.validation, tests },
        sourceCode,
      );
      continue;
    }
    let verdict: Record<string, any>;
    try {
      verdict = await request(
        "critic",
        attempt,
        "Review this native interactive teaching simulation against the source lesson, package code and browser evidence. Inspect the preview. Verify mathematical/physical correctness, meaningful animation, causal controls, useful initial scene, labels/units, geometry, mobile usability and accessibility. Reject decorative motion, static label-switching, wrong physics, disconnected geometry, or claims unsupported by the source. Audit equations and limiting cases directly in the supplied code; schema-2 semanticTests are descriptive assertions, while runtimeTests execute animation and controls in the browser with a deterministic frame clock. Do not mistake an absent numerical-test API for incorrect equations. Focus the simulation on its declared objective rather than requiring every concept in the surrounding lesson. Return JSON {approved:boolean,reason:string,requestedChanges:string[],scores:{pedagogicalValue:number,sourceFidelity:number,usability:number,accessibility:number}} with each score 0-5. Approve only if every score is at least 4 and no material teaching, correctness, usability or accessibility defect remains. Treat optional cosmetic preferences as nonblocking; return requestedChanges only for defects that block approval.",
        {
          opportunity,
          lesson: input.pageMarkdown,
          formulas: input.formulaDefinitions,
          candidate,
          tests,
        },
        path.join(stage, "preview.png"),
      );
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      errors = [`The review returned invalid JSON: ${error.message}`];
      failureCategory = "critic";
      rejected(
        attempt,
        "critic",
        { validation: compiled.validation, tests },
        sourceCode,
      );
      continue;
    }
    const scoreKeys = [
      "pedagogicalValue",
      "sourceFidelity",
      "usability",
      "accessibility",
    ] as const;
    const approved =
      verdict.approved === true &&
      typeof verdict.reason === "string" &&
      Array.isArray(verdict.requestedChanges) &&
      verdict.requestedChanges.length === 0 &&
      scoreKeys.every(
        (key) =>
          Number.isFinite(verdict.scores?.[key]) &&
          verdict.scores[key] >= 4 &&
          verdict.scores[key] <= 5,
      );
    const critic: GeneratedVisualCriticRecord = {
      approved,
      checkedAt: new Date().toISOString(),
      reason:
        typeof verdict.reason === "string"
          ? verdict.reason
          : "Invalid critic verdict",
      requestedChanges: Array.isArray(verdict.requestedChanges)
        ? verdict.requestedChanges.filter((v: unknown) => typeof v === "string")
        : ["Return a complete critic verdict."],
      scores: {
        pedagogicalValue: Number(verdict.scores?.pedagogicalValue) || 0,
        sourceFidelity: Number(verdict.scores?.sourceFidelity) || 0,
        usability: Number(verdict.scores?.usability) || 0,
        accessibility: Number(verdict.scores?.accessibility) || 0,
      },
    };
    fs.writeFileSync(
      path.join(stage, "critic.json"),
      JSON.stringify(critic, null, 2),
    );
    if (!approved) {
      errors = [
        verdict.reason ?? "Invalid critic verdict",
        ...(verdict.requestedChanges ?? []),
      ];
      failureCategory = "critic";
      rejected(
        attempt,
        "critic",
        { validation: compiled.validation, tests, critic },
        sourceCode,
      );
      continue;
    }
    input.checkCancelled?.();
    signal?.throwIfAborted();
    const current = loadGeneratedVisualManifest(
      input.gardenDir,
      opportunity.id,
    );
    const versionsDir = path.join(root, "versions");
    const versions = fs.existsSync(versionsDir)
      ? fs.readdirSync(versionsDir).map(Number).filter(Number.isSafeInteger)
      : [];
    const version = Math.max(0, current?.version ?? 0, ...versions) + 1;
    const manifest: GeneratedVisualizationManifest = {
      schemaVersion: 1,
      sdkVersion: "1.0.0",
      id: opportunity.id,
      gardenId: opportunity.gardenId,
      learningUnitId: opportunity.learningUnitId,
      title: candidate.plan.title,
      description: candidate.package.manifest.description,
      learningObjective: opportunity.learningObjective,
      sourceAnchorIds: opportunity.sourceAnchorIds,
      sourceVisualIds: opportunity.sourceVisualIds,
      sourceVisualRelationships: opportunity.sourceVisualRelationships,
      conceptIds: opportunity.conceptIds,
      insertionAnchor: opportunity.insertionAnchor,
      targetPage: opportunity.targetPage,
      targetHeading: opportunity.targetHeading,
      sourceHash: compiled.sourceHash,
      compiledHash: compiled.compiledHash,
      status: "published",
      generatedAt: new Date().toISOString(),
      generatorModel: input.model,
      generationAttempt: attempt,
      version,
      ...(current ? { previousVersion: current.version } : {}),
      artifactPath: `.breadboard/visuals/${opportunity.id}`,
      similarityFingerprint: opportunity.similarityFingerprint,
      sourceSkill: LEARN_VISUALIZER_SKILL,
      skillHash: authorSkillHash,
      runtimeEngine: "breadboard-interactive-visualizer",
    };
    saveGeneratedVisualArtifact({
      gardenDir: input.gardenDir,
      manifest,
      sourceCode,
      compiledJavaScript: compiled.compiledJavaScript,
      validation: compiled.validation,
      tests,
      critic,
      previewPath: path.join(stage, "preview.png"),
      lifecycle: [
        {
          status: "published",
          at: manifest.generatedAt,
          attempt,
          detail:
            "Native chat skill, animation/control browser gates and source critic passed.",
        },
      ],
    });
    input.onEvent?.({
      type: "visual_native_skill_published",
      data: {
        visualizationId: opportunity.id,
        version,
        sourceSkill: LEARN_VISUALIZER_SKILL,
        skillHash: authorSkillHash,
      },
    });
    return { manifest, definition: compiled.definition, errors: [] };
  }
  return { manifest: null, definition: null, errors, failureCategory };
}
