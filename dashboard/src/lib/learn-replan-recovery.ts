import fs from "node:fs";
import path from "node:path";

interface LearnRecoveryEvent {
  type?: unknown;
  jobId?: unknown;
  stage?: unknown;
  reviewSetHash?: unknown;
  newlyReplacedFormulaIds?: unknown;
  requiresReplan?: unknown;
}

function parseRecoveryEvent(line: string): LearnRecoveryEvent | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as LearnRecoveryEvent)
      : null;
  } catch {
    // The event ledger is append-only. An interrupted final line must not hide
    // earlier, fully written recovery evidence.
    return null;
  }
}

/**
 * Backward-compatible recovery for failed generation jobs created before
 * `learn_jobs.requires_replan` existed. A generation formula-review event is
 * invalidating when it recorded newly accepted replacements or a review hash
 * different from the confirmed map; the generation gate immediately fails
 * closed in either case. Requiring the same job's terminal failure event keeps
 * an interrupted but still recoverable run from being rerouted prematurely.
 */
export function failedGenerationRequiresReplanFromEvents({
  gardenDir,
  jobId,
  expectedFormulaReviewSetHash,
}: {
  gardenDir: string;
  jobId: string;
  expectedFormulaReviewSetHash?: string;
}): boolean {
  const eventPath = path.join(gardenDir, ".breadboard", "events.jsonl");
  let raw = "";
  try {
    raw = fs.readFileSync(eventPath, "utf8");
  } catch {
    return false;
  }

  let sawTerminalFailure = false;
  let sawExplicitReplanFailure = false;
  let sawInvalidatingFormulaReview = false;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseRecoveryEvent(line);
    if (!event || event.jobId !== jobId) continue;

    if (event.type === "learn_failed") {
      sawTerminalFailure = true;
      sawExplicitReplanFailure ||= event.requiresReplan === true;
      continue;
    }
    if (event.type !== "learn_source_formulas_reviewed" || event.stage !== "generation") {
      continue;
    }

    const newlyReplacedFormulaIds = Array.isArray(event.newlyReplacedFormulaIds)
      ? event.newlyReplacedFormulaIds.filter(
          (formulaId): formulaId is string =>
            typeof formulaId === "string" && Boolean(formulaId.trim()),
        )
      : [];
    const reviewHashChanged =
      Boolean(expectedFormulaReviewSetHash) &&
      typeof event.reviewSetHash === "string" &&
      event.reviewSetHash !== expectedFormulaReviewSetHash;
    sawInvalidatingFormulaReview ||=
      newlyReplacedFormulaIds.length > 0 || reviewHashChanged;
  }

  return (
    sawTerminalFailure &&
    (sawExplicitReplanFailure || sawInvalidatingFormulaReview)
  );
}
