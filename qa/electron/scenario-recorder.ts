import * as fs from "node:fs";
import * as path from "node:path";
import { test as playwrightTest, type TestInfo } from "@playwright/test";

export type ScenarioStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
export type FailureClassification =
  | "PRODUCT_BUG"
  | "TEST_ENVIRONMENT"
  | "EXTERNAL_DEPENDENCY"
  | "EXPECTED_BEHAVIOR"
  | "FLAKY"
  | "MISSING_FEATURE"
  | null;
export type BlockerClassification = Exclude<
  FailureClassification,
  "PRODUCT_BUG" | null
>;
export type ScenarioDependencyKind = "required" | "optional";
export type ScenarioBlockerAction =
  | "BLOCK"
  | "BLOCK_DEPENDENT_ASSERTIONS"
  | "CONTINUE"
  | "CONTINUE_WITH_CACHED_DATA"
  | "CONTINUE_WITH_DEGRADED_ASSERTIONS"
  | "RECORD_KNOWN_PACKAGING_LIMITATION"
  | "SKIP_OPTIONAL_ASSERTIONS"
  | "USE_CACHED_REVIEWED_SKILL_OR_BLOCK";

export interface ScenarioDependencies {
  readonly required: readonly string[];
  readonly optional: readonly string[];
}

export interface ScenarioBlockerPolicy {
  readonly onMissingRequired: ScenarioBlockerAction;
  readonly requiredClassification: BlockerClassification;
  readonly onMissingOptional: ScenarioBlockerAction;
  readonly optionalClassification: BlockerClassification;
  readonly continueInventory: boolean;
  readonly repairEligible: boolean;
}

export interface ScenarioDefinition {
  readonly id: string;
  readonly priority: "P0" | "P1" | "P2" | "P3";
  readonly task: string;
  readonly successCriteria: readonly string[];
  readonly dependencies: ScenarioDependencies;
  readonly blockerPolicy: ScenarioBlockerPolicy;
}

export interface ScenarioBlocker {
  readonly dependency: ScenarioDependencyKind;
  readonly action: ScenarioBlockerAction;
  readonly classification: BlockerClassification;
  readonly continueInventory: boolean;
  readonly repairEligible: boolean;
}

export interface ScenarioDegradation {
  readonly dependency: "optional";
  readonly dependencies: readonly string[];
  readonly disposition: "MISSING" | "UNEXERCISED";
  readonly action: ScenarioBlockerAction;
  readonly classification: BlockerClassification;
  readonly reason: string;
}

export interface ScenarioDegradationInput {
  readonly dependencies: readonly string[];
  readonly disposition: "MISSING" | "UNEXERCISED";
  readonly reason: string;
}

export interface ScenarioAttempt {
  readonly id: string;
  readonly priority: ScenarioDefinition["priority"];
  readonly task: string;
  readonly status: ScenarioStatus;
  readonly classification: FailureClassification;
  readonly blocker: ScenarioBlocker | null;
  readonly degradations: readonly ScenarioDegradation[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly expected: string;
  readonly actual: string;
  readonly evidence: readonly string[];
  readonly repairEligible: boolean;
  readonly repairAttempted: boolean;
}

export type ScenarioProbeOutcome =
  | {
      readonly status: "PASS";
      readonly actual?: string;
      readonly evidence?: readonly string[];
      /** Missing or deliberately unexercised optional dependencies that narrowed the assertions. */
      readonly optionalDegradations?: readonly ScenarioDegradationInput[];
    }
  | {
      readonly status: "BLOCKED";
      readonly dependency: ScenarioDependencyKind;
      readonly reason: string;
      readonly evidence?: readonly string[];
    }
  | {
      readonly status: "NOT_RUN";
      readonly reason: string;
      readonly evidence?: readonly string[];
    };

export interface ScenarioProbeOptions {
  /** Playwright cancels the step if this bound is exceeded. */
  readonly timeoutMs?: number;
  /** Stable artifact paths retained when an unexpected probe failure occurs. */
  readonly failureEvidence?: readonly string[];
  /** Classify unexpected errors from concrete diagnostics instead of assuming every harness failure is a product bug. */
  readonly classifyFailure?: (
    error: unknown,
  ) => ScenarioFailureDecision | Promise<ScenarioFailureDecision>;
}

export interface ScenarioFailureDecision {
  readonly classification: Exclude<FailureClassification, null>;
  readonly evidence?: readonly string[];
  /** A redacted summary suitable for the persisted receipt. */
  readonly actual?: string;
}

interface RecordInput {
  readonly id: string;
  readonly status: ScenarioStatus;
  readonly classification: FailureClassification;
  readonly blocker: ScenarioBlocker | null;
  readonly degradations: readonly ScenarioDegradation[];
  readonly startedAt: string;
  readonly started: number;
  readonly expected: string;
  readonly actual: string;
  readonly evidence: readonly string[];
}

/**
 * Writes one run inventory derived from the canonical scenario manifest.
 * `probe` converts an unexpected assertion failure to a recorded FAIL and
 * returns so independent exploratory inventory can continue. `attempt` keeps
 * fail-fast behavior for deterministic regression specs.
 */
export class ScenarioRecorder {
  private readonly definitions: Map<string, ScenarioDefinition>;
  private readonly attempts: ScenarioAttempt[] = [];
  readonly outputPath: string;

  constructor(repoRoot: string, runId: string, artifactsDir: string) {
    const manifestFile = path.join(repoRoot, "qa", "autonomous", "scenarios.json");
    const definitions = parseManifest(manifestFile);
    this.definitions = new Map(
      definitions.map((definition) => [definition.id, definition]),
    );
    this.outputPath = path.join(artifactsDir, `scenario-results-${runId}.json`);
  }

  definition(id: string): ScenarioDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown autonomous QA scenario: ${id}`);
    return definition;
  }

  allDefinitions(): readonly ScenarioDefinition[] {
    return [...this.definitions.values()];
  }

  async attempt(
    testInfo: TestInfo,
    id: string,
    run: () => Promise<{ actual?: string; evidence?: readonly string[] } | void>,
  ): Promise<ScenarioAttempt> {
    void testInfo;
    const definition = this.definition(id);
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    try {
      const result = await playwrightTest.step(`[${definition.priority}] ${id}`, run);
      return this.record({
        id,
        status: "PASS",
        classification: null,
        blocker: null,
        degradations: [],
        startedAt,
        started,
        expected: definition.successCriteria.join("; "),
        actual: result?.actual ?? "Scenario assertions passed.",
        evidence: result?.evidence ?? [],
      });
    } catch (error) {
      const attempt = this.recordFailure(id, started, startedAt, error);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        scenarioAttempt: attempt,
      });
    }
  }

  /** Run one exploratory probe without preventing later inventory. */
  async probe(
    testInfo: TestInfo,
    id: string,
    run: () => Promise<ScenarioProbeOutcome>,
    options: ScenarioProbeOptions = {},
  ): Promise<ScenarioAttempt> {
    void testInfo;
    const definition = this.definition(id);
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    try {
      const outcome = await playwrightTest.step(
        `[${definition.priority}] ${id}`,
        run,
        options.timeoutMs === undefined
          ? undefined
          : { timeout: options.timeoutMs },
      );
      if (outcome.status === "PASS") {
        return this.record({
          id,
          status: "PASS",
          classification: null,
          blocker: null,
          degradations: this.optionalDegradations(
            definition,
            outcome.optionalDegradations ?? [],
          ),
          startedAt,
          started,
          expected: definition.successCriteria.join("; "),
          actual: outcome.actual ?? "Scenario assertions passed.",
          evidence: outcome.evidence ?? [],
        });
      }
      if (outcome.status === "NOT_RUN") {
        return this.recordNotRun(
          id,
          outcome.reason,
          outcome.evidence ?? [],
          started,
          startedAt,
        );
      }
      return this.recordMissingDependency(
        id,
        outcome.dependency,
        outcome.reason,
        outcome.evidence ?? [],
        started,
        startedAt,
      );
    } catch (error) {
      const decision = await options.classifyFailure?.(error);
      return this.recordFailure(
        id,
        started,
        startedAt,
        error,
        [
          ...(options.failureEvidence ?? []),
          ...(decision?.evidence ?? []),
        ],
        decision?.classification ?? "PRODUCT_BUG",
        decision?.actual,
      );
    }
  }

  blockMissing(
    id: string,
    dependency: ScenarioDependencyKind,
    reason: string,
    evidence: readonly string[] = [],
  ): ScenarioAttempt {
    const now = Date.now();
    return this.recordMissingDependency(
      id,
      dependency,
      reason,
      evidence,
      now,
      new Date(now).toISOString(),
    );
  }

  notRun(
    id: string,
    reason: string,
    evidence: readonly string[] = [],
  ): ScenarioAttempt {
    const now = Date.now();
    return this.recordNotRun(
      id,
      reason,
      evidence,
      now,
      new Date(now).toISOString(),
    );
  }

  /** @deprecated Prefer blockMissing so classification comes from the manifest. */
  block(
    id: string,
    classification: BlockerClassification,
    reason: string,
    evidence: readonly string[] = [],
  ): ScenarioAttempt {
    const definition = this.definition(id);
    const now = Date.now();
    return this.record({
      id,
      status: "BLOCKED",
      classification,
      blocker: {
        dependency: "required",
        action: definition.blockerPolicy.onMissingRequired,
        classification,
        continueInventory: definition.blockerPolicy.continueInventory,
        repairEligible: definition.blockerPolicy.repairEligible,
      },
      degradations: [],
      startedAt: new Date(now).toISOString(),
      started: now,
      expected: definition.successCriteria.join("; "),
      actual: reason,
      evidence,
    });
  }

  list(): readonly ScenarioAttempt[] {
    return [...this.attempts];
  }

  private recordFailure(
    id: string,
    started: number,
    startedAt: string,
    error: unknown,
    evidence: readonly string[] = [],
    classification: Exclude<FailureClassification, null> = "PRODUCT_BUG",
    actual?: string,
  ): ScenarioAttempt {
    const definition = this.definition(id);
    return this.record({
      id,
      status: "FAIL",
      classification,
      blocker: null,
      degradations: [],
      startedAt,
      started,
      expected: definition.successCriteria.join("; "),
      actual: actual ?? (error instanceof Error ? error.message : String(error)),
      evidence,
    });
  }

  private recordMissingDependency(
    id: string,
    dependency: ScenarioDependencyKind,
    reason: string,
    evidence: readonly string[],
    started: number,
    startedAt: string,
  ): ScenarioAttempt {
    const definition = this.definition(id);
    const policy = definition.blockerPolicy;
    const blocker: ScenarioBlocker =
      dependency === "required"
        ? {
            dependency,
            action: policy.onMissingRequired,
            classification: policy.requiredClassification,
            continueInventory: policy.continueInventory,
            repairEligible: policy.repairEligible,
          }
        : {
            dependency,
            action: policy.onMissingOptional,
            classification: policy.optionalClassification,
            continueInventory: policy.continueInventory,
            repairEligible: policy.repairEligible,
          };
    return this.record({
      id,
      status: "BLOCKED",
      classification: blocker.classification,
      blocker,
      degradations: [],
      startedAt,
      started,
      expected: definition.successCriteria.join("; "),
      actual: reason,
      evidence,
    });
  }

  private recordNotRun(
    id: string,
    reason: string,
    evidence: readonly string[],
    started: number,
    startedAt: string,
  ): ScenarioAttempt {
    const definition = this.definition(id);
    return this.record({
      id,
      status: "NOT_RUN",
      classification: null,
      blocker: null,
      degradations: [],
      startedAt,
      started,
      expected: definition.successCriteria.join("; "),
      actual: reason,
      evidence,
    });
  }

  private record(input: RecordInput): ScenarioAttempt {
    const definition = this.definition(input.id);
    const finished = Date.now();
    const attempt: ScenarioAttempt = {
      id: input.id,
      priority: definition.priority,
      task: definition.task,
      status: input.status,
      classification: input.classification,
      blocker: input.blocker,
      degradations: input.degradations,
      startedAt: input.startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - input.started,
      expected: input.expected,
      actual: input.actual,
      evidence: input.evidence,
      repairEligible:
        input.status === "FAIL" && definition.blockerPolicy.repairEligible,
      repairAttempted: false,
    };
    this.attempts.push(attempt);
    this.flush();
    return attempt;
  }

  private optionalDegradations(
    definition: ScenarioDefinition,
    inputs: readonly ScenarioDegradationInput[],
  ): ScenarioDegradation[] {
    return inputs.map((input) => {
      for (const dependency of input.dependencies) {
        if (!definition.dependencies.optional.includes(dependency)) {
          throw new Error(
            `${definition.id} does not declare optional dependency: ${dependency}`,
          );
        }
      }
      return {
        dependency: "optional",
        dependencies: [...input.dependencies],
        disposition: input.disposition,
        action: definition.blockerPolicy.onMissingOptional,
        classification: definition.blockerPolicy.optionalClassification,
        reason: input.reason,
      };
    });
  }

  private flush(): void {
    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    fs.writeFileSync(
      this.outputPath,
      `${JSON.stringify(
        {
          schemaVersion: 3,
          generatedAt: new Date().toISOString(),
          attempts: this.attempts,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

function parseManifest(manifestFile: string): ScenarioDefinition[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`Autonomous QA scenario manifest must be an array: ${manifestFile}`);
  }
  const definitions = parsed as ScenarioDefinition[];
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (
      !definition ||
      typeof definition.id !== "string" ||
      !Array.isArray(definition.successCriteria) ||
      !definition.dependencies ||
      !Array.isArray(definition.dependencies.required) ||
      !Array.isArray(definition.dependencies.optional) ||
      !definition.blockerPolicy
    ) {
      throw new Error(`Invalid autonomous QA scenario in ${manifestFile}`);
    }
    if (seen.has(definition.id)) {
      throw new Error(`Duplicate autonomous QA scenario id: ${definition.id}`);
    }
    seen.add(definition.id);
  }
  return definitions;
}
