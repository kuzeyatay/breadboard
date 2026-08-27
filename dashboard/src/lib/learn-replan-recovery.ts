import { StringDecoder } from "node:string_decoder";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

const RECOVERY_EVENT_LEDGER_BYTE_LIMIT = 16 * 1024 * 1024;
const RECOVERY_EVENT_LINE_BYTE_LIMIT = 256 * 1024;
const RECOVERY_EVENT_READ_CHUNK_BYTES = 64 * 1024;

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
  let descriptor: number | undefined;
  let sawTerminalFailure = false;
  let sawExplicitReplanFailure = false;
  let sawInvalidatingFormulaReview = false;

  const inspectLine = (line: string): void => {
    if (!line.trim()) return;
    const event = parseRecoveryEvent(line);
    if (!event || event.jobId !== jobId) return;

    if (event.type === "learn_failed") {
      sawTerminalFailure = true;
      sawExplicitReplanFailure ||= event.requiresReplan === true;
      return;
    }
    if (event.type !== "learn_source_formulas_reviewed" || event.stage !== "generation") {
      return;
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
  };

  try {
    const authorityRoot = fs.realpathSync.native(gardenDir);
    if (!fs.statSync(authorityRoot).isDirectory()) return true;
    const before = fs.lstatSync(eventPath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size > RECOVERY_EVENT_LEDGER_BYTE_LIMIT
    ) {
      return true;
    }
    const realEventPath = fs.realpathSync.native(eventPath);
    const relative = path.relative(authorityRoot, realEventPath);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return true;
    }
    descriptor = fs.openSync(realEventPath, "r");
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs
    ) {
      return true;
    }

    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(RECOVERY_EVENT_READ_CHUNK_BYTES);
    let pending = "";
    let position = 0;
    while (position < opened.size) {
      const count = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, opened.size - position),
        position,
      );
      if (count === 0) return true;
      position += count;
      pending += decoder.write(buffer.subarray(0, count));

      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        let line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (Buffer.byteLength(line, "utf8") > RECOVERY_EVENT_LINE_BYTE_LIMIT) {
          return true;
        }
        inspectLine(line);
      }
      if (Buffer.byteLength(pending, "utf8") > RECOVERY_EVENT_LINE_BYTE_LIMIT) {
        return true;
      }
    }
    pending += decoder.end();
    if (Buffer.byteLength(pending, "utf8") > RECOVERY_EVENT_LINE_BYTE_LIMIT) {
      return true;
    }
    inspectLine(pending.endsWith("\r") ? pending.slice(0, -1) : pending);

    const after = fs.fstatSync(descriptor);
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      return true;
    }
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    return candidate.code === "ENOENT" ? false : true;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  return (
    sawTerminalFailure &&
    (sawExplicitReplanFailure || sawInvalidatingFormulaReview)
  );
}
