import type { DiagnosticEntry } from "./diagnostics";
import type {
  FailureClassification,
  ScenarioFailureDecision,
} from "./scenario-recorder";

/**
 * The failure classifier used by exploratory probes, extracted from the
 * inventory spec so it can be exercised by the harness self-test suite with
 * deterministic fixtures instead of only through a live Electron run.
 *
 * This module decides *what kind* of failure occurred. It deliberately does not
 * decide whether a repair may touch production source: that gate is enforced
 * separately by `qa/autonomous/lib/repair-gate.mjs`, which the repair tooling
 * runs against a persisted finding. Keeping the two apart means a classifier
 * bug cannot silently widen repair permission, and a gate bug cannot silently
 * rewrite evidence.
 */

/** Diagnostic events that only the product under test can produce. */
export const PRODUCT_FAILURE_EVENTS: readonly string[] = [
  "renderer-crash",
  "page-error",
  "unhandled-rejection",
  "uncaught-exception",
  "main-process-error",
];

/**
 * Messages that describe the harness, the host, or the isolation controls
 * rather than Breadboard behaviour. These must never reach the repair gate as
 * product defects.
 */
const TEST_ENVIRONMENT_MESSAGE_PATTERN =
  /(?:EADDRINUSE|ECONNREFUSED|ENOENT|runtime endpoints? omit|QA runtime marker|QA run marker|service readiness file|manifest dependencies changed|does not declare optional dependency|QA fixture|fixture file is missing|malformed QA fixture|QA run root|forbidden QA path|cleanup target)/i;

/**
 * The only classification whose findings may reach a production source repair.
 * Exported as an array so callers can render it in receipts verbatim.
 */
export const REPAIR_ELIGIBLE_CLASSIFICATIONS: readonly FailureClassification[] = [
  "PRODUCT_BUG",
];

export function isRepairEligibleClassification(
  classification: FailureClassification,
): boolean {
  return REPAIR_ELIGIBLE_CLASSIFICATIONS.includes(classification);
}

/**
 * Classify an unexpected probe error using the diagnostics captured while the
 * probe ran. Concrete product evidence wins over message heuristics; concrete
 * environment evidence wins over the assertion-failure default.
 */
export function classifyProbeFailure(
  error: unknown,
  diagnostics: readonly DiagnosticEntry[],
): ScenarioFailureDecision {
  const productEvents = new Set(PRODUCT_FAILURE_EVENTS);
  if (
    diagnostics.some(
      (entry) => entry.actionable !== false && productEvents.has(entry.event),
    )
  ) {
    return { classification: "PRODUCT_BUG" };
  }

  const environmentEvidence = diagnostics.some((entry) => {
    if (entry.event === "service-startup-failure") return true;
    if (entry.event === "qa-fixture-missing") return true;
    if (entry.event === "qa-fixture-malformed") return true;
    if (entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)) {
      return entry.data["category"] === "port-conflict";
    }
    return false;
  });
  const message = error instanceof Error ? error.message : String(error);
  if (environmentEvidence || TEST_ENVIRONMENT_MESSAGE_PATTERN.test(message)) {
    return { classification: "TEST_ENVIRONMENT" };
  }

  // Assertion failures and renderer-visible timeouts default to product
  // failures unless the run captured concrete environment evidence above.
  return { classification: "PRODUCT_BUG" };
}
