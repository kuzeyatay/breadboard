// Post-build humanization for Learn.
//
// Learn owns a complete isolated staging garden. That gives rewriting a safer
// boundary than page-by-page generation: wait until every learner-facing page
// exists and the normal build/critic gates have passed, rewrite only Markdown
// under learning/, then run the caller's full final-artifact verifier. A bad
// candidate restores every changed byte before the staging garden can publish.

import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  availableTextHumanizer,
  storedTextHumanizerForUser,
} from "./humanizer/auto-server.ts";

export interface LearnHumanizerValidation {
  accepted: boolean;
  problems?: string[];
}

export interface LearnHumanizerResult {
  requested: boolean;
  adopted: boolean;
  filesConsidered: number;
  candidateFiles: number;
  adoptedFiles: number;
  chunks: { total: number; rewritten: number; reverted: number };
  reason:
    | "preference_off"
    | "no_learning_pages"
    | "no_improvement"
    | "adopted"
    | "validation_failed"
    | "filesystem_failed"
    | "rewrite_failed";
  validationProblems: string[];
}

export type LearnHumanizerCopy = "ai" | "humanized";
export type LearnHumanizerStatus =
  | "ai"
  | "running"
  | "humanized"
  | "restoring_ai"
  | "failed";

export interface LearnHumanizerVersionState {
  schemaVersion: 1;
  versionId: string;
  requested: boolean;
  activeCopy: LearnHumanizerCopy;
  status: LearnHumanizerStatus;
  reason?: string;
  error?: string;
  updatedAt: string;
}

interface HumanizeFinishedLearnBuildInput {
  userId?: number;
  gardenDir: string;
  validate: () => LearnHumanizerValidation;
  checkCancelled?: () => void;
  onStart?: (fileCount: number) => void;
  /** Explicit toggles have already captured intent and do not re-read the
   * eventually-consistent account preference. */
  force?: boolean;
  /** When present, preserve a restorable AI copy and persist pass state. */
  versionId?: string;
  /** Explicit version switches require their state marker to commit with the
   * candidate; an ordinary Learn build still treats marker failures as a no-op. */
  strictStatePersistence?: boolean;
}

const EMPTY_CHUNKS = { total: 0, rewritten: 0, reverted: 0 } as const;
const HUMANIZER_STATE_ROOT = ".breadboard/humanizer";

function safeVersionId(versionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(versionId)) {
    throw new Error("Invalid Learn version id for humanizer state");
  }
  return versionId;
}

function versionStateDir(gardenDir: string, versionId: string): string {
  return path.join(
    gardenDir,
    ...HUMANIZER_STATE_ROOT.split("/"),
    safeVersionId(versionId),
  );
}

function versionStatePath(gardenDir: string, versionId: string): string {
  return path.join(versionStateDir(gardenDir, versionId), "manifest.json");
}

function aiLearningDir(gardenDir: string, versionId: string): string {
  return path.join(versionStateDir(gardenDir, versionId), "ai", "learning");
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    fs.renameSync(temporary, filePath);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The complete destination, if any, remains authoritative.
    }
  }
}

export function readLearnHumanizerVersionState(
  gardenDir: string,
  versionId: string,
): LearnHumanizerVersionState {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(versionStatePath(gardenDir, versionId), "utf8"),
    ) as Partial<LearnHumanizerVersionState>;
    const activeCopy = parsed.activeCopy === "humanized" ? "humanized" : "ai";
    const status: LearnHumanizerStatus = [
      "ai",
      "running",
      "humanized",
      "restoring_ai",
      "failed",
    ].includes(String(parsed.status))
      ? (parsed.status as LearnHumanizerStatus)
      : activeCopy;
    if (parsed.schemaVersion === 1 && parsed.versionId === versionId) {
      return {
        schemaVersion: 1,
        versionId,
        requested: parsed.requested === true,
        activeCopy,
        status,
        ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
        ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
        updatedAt:
          typeof parsed.updatedAt === "string"
            ? parsed.updatedAt
            : new Date(0).toISOString(),
      };
    }
  } catch {
    // Versions created before reversible humanization are ordinary AI copies.
  }
  return {
    schemaVersion: 1,
    versionId,
    requested: false,
    activeCopy: "ai",
    status: "ai",
    updatedAt: new Date(0).toISOString(),
  };
}

export function writeLearnHumanizerVersionState(
  gardenDir: string,
  state: Omit<LearnHumanizerVersionState, "schemaVersion" | "updatedAt">,
): LearnHumanizerVersionState {
  const stored: LearnHumanizerVersionState = {
    schemaVersion: 1,
    ...state,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomically(versionStatePath(gardenDir, state.versionId), stored);
  return stored;
}

function recordHumanizerState(
  input: HumanizeFinishedLearnBuildInput,
  state: Omit<LearnHumanizerVersionState, "schemaVersion" | "updatedAt" | "versionId">,
): void {
  if (!input.versionId) return;
  try {
    writeLearnHumanizerVersionState(input.gardenDir, {
      versionId: input.versionId,
      ...state,
    });
  } catch (error) {
    if (input.strictStatePersistence) throw error;
  }
}

function preserveAiLearningCopy(gardenDir: string, versionId: string): void {
  const source = path.join(gardenDir, "learning");
  const destination = aiLearningDir(gardenDir, versionId);
  if (fs.existsSync(destination)) return;
  if (!fs.existsSync(source)) throw new Error("The completed Learn tree has no learning directory");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

/** Reset a staging tree to its saved AI copy before a repeat humanizer pass. */
export function resetLearnTreeToAiCopy(gardenDir: string, versionId: string): boolean {
  const source = aiLearningDir(gardenDir, versionId);
  if (!fs.existsSync(source)) return false;
  const destination = path.join(gardenDir, "learning");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
  return true;
}

function result(
  overrides: Partial<LearnHumanizerResult> &
    Pick<LearnHumanizerResult, "requested" | "reason">,
): LearnHumanizerResult {
  return {
    adopted: false,
    filesConsidered: 0,
    candidateFiles: 0,
    adoptedFiles: 0,
    chunks: { ...EMPTY_CHUNKS },
    validationProblems: [],
    ...overrides,
    requested: overrides.requested,
    reason: overrides.reason,
  };
}

function learningMarkdownFiles(gardenDir: string): string[] {
  const root = path.join(gardenDir, "learning");
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(absolute);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function restoreOriginals(originals: ReadonlyMap<string, string>): void {
  for (const [filePath, content] of originals) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function cancellationCheckpoint(
  checkCancelled: (() => void) | undefined,
  originals: ReadonlyMap<string, string>,
): void {
  try {
    checkCancelled?.();
  } catch (error) {
    // Cancellation is authoritative. Put the staging tree back first, then let
    // Learn's normal cancellation path discard it and update the job.
    restoreOriginals(originals);
    throw error;
  }
}

/**
 * Humanize a complete, already-approved Learn staging tree.
 *
 * Rewriter/service failures are ordinary no-ops. Cancellation still propagates,
 * and an unrecoverable filesystem restore failure is allowed to fail the build
 * rather than risk publishing a partially rewritten garden.
 */
export async function humanizeFinishedLearnBuild(
  input: HumanizeFinishedLearnBuildInput,
): Promise<LearnHumanizerResult> {
  if (!input.force && input.userId === undefined) {
    return result({ requested: false, reason: "preference_off" });
  }
  // Capture once: changing the standing preference during a multi-page pass
  // must never produce a half-humanized garden.
  const humanize = input.force
    ? availableTextHumanizer()
    : storedTextHumanizerForUser(input.userId!);
  if (!humanize) {
    const unavailable = result({
      requested: input.force === true,
      reason: "preference_off",
    });
    if (input.force) {
      recordHumanizerState(input, {
        requested: true,
        activeCopy: "ai",
        status: "failed",
        reason: unavailable.reason,
        error: "The local humanizer is disabled or unavailable.",
      });
    }
    return unavailable;
  }

  const files = learningMarkdownFiles(input.gardenDir);
  if (files.length === 0) {
    const empty = result({ requested: true, reason: "no_learning_pages" });
    if (input.versionId) {
      recordHumanizerState(input, {
        requested: true,
        activeCopy: "ai",
        status: "failed",
        reason: empty.reason,
        error: "The completed Learn version has no learner Markdown to rewrite.",
      });
    }
    return empty;
  }
  if (input.versionId) {
    try {
      preserveAiLearningCopy(input.gardenDir, input.versionId);
      recordHumanizerState(input, {
        requested: true,
        activeCopy: "ai",
        status: "running",
      });
    } catch (error) {
      if (input.strictStatePersistence) throw error;
      return result({
        requested: true,
        reason: "filesystem_failed",
        filesConsidered: files.length,
      });
    }
  }
  try {
    input.onStart?.(files.length);
  } catch {
    // Progress reporting decorates the pass; it does not own it.
  }

  const originals = new Map<string, string>();
  const chunks = { total: 0, rewritten: 0, reverted: 0 };
  for (const filePath of files) {
    cancellationCheckpoint(input.checkCancelled, originals);
    let original: string;
    try {
      original = fs.readFileSync(filePath, "utf8");
    } catch {
      restoreOriginals(originals);
      const failed = result({
        requested: true,
        reason: "filesystem_failed",
        filesConsidered: files.length,
        candidateFiles: originals.size,
        chunks,
      });
      if (input.versionId) {
        recordHumanizerState(input, {
          requested: true,
          activeCopy: "ai",
          status: "failed",
          reason: failed.reason,
        });
      }
      return failed;
    }
    let candidate: Awaited<ReturnType<typeof humanize>>;
    try {
      candidate = await humanize(original, "learn_page");
    } catch {
      restoreOriginals(originals);
      const failed = result({
        requested: true,
        reason: "rewrite_failed",
        filesConsidered: files.length,
        candidateFiles: originals.size,
        chunks,
      });
      if (input.versionId) {
        recordHumanizerState(input, {
          requested: true,
          activeCopy: "ai",
          status: "failed",
          reason: failed.reason,
        });
      }
      return failed;
    }
    cancellationCheckpoint(input.checkCancelled, originals);
    if (!candidate.humanized || candidate.text === original) continue;
    originals.set(filePath, original);
    try {
      // This is an unpublished, disposable staging tree. A synchronous write
      // plus the all-files restore below is safer on Windows than renaming over
      // an open destination, which can fail transiently with EPERM.
      fs.writeFileSync(filePath, candidate.text, "utf8");
    } catch {
      restoreOriginals(originals);
      const failed = result({
        requested: true,
        reason: "filesystem_failed",
        filesConsidered: files.length,
        candidateFiles: originals.size,
        chunks,
      });
      if (input.versionId) {
        recordHumanizerState(input, {
          requested: true,
          activeCopy: "ai",
          status: "failed",
          reason: failed.reason,
        });
      }
      return failed;
    }
    if (candidate.chunks) {
      chunks.total += candidate.chunks.total;
      chunks.rewritten += candidate.chunks.rewritten;
      chunks.reverted += candidate.chunks.reverted;
    }
  }

  if (originals.size === 0) {
    const unchanged = result({
      requested: true,
      reason: "no_improvement",
      filesConsidered: files.length,
      chunks,
    });
    if (input.versionId) {
      recordHumanizerState(input, {
        requested: true,
        activeCopy: "humanized",
        status: "humanized",
        reason: unchanged.reason,
      });
    }
    return unchanged;
  }

  cancellationCheckpoint(input.checkCancelled, originals);
  let validation: LearnHumanizerValidation;
  try {
    validation = input.validate();
  } catch (error) {
    validation = {
      accepted: false,
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }
  if (!validation.accepted) {
    restoreOriginals(originals);
    const failed = result({
      requested: true,
      reason: "validation_failed",
      filesConsidered: files.length,
      candidateFiles: originals.size,
      chunks,
      validationProblems: (validation.problems ?? []).slice(0, 20),
    });
    if (input.versionId) {
      recordHumanizerState(input, {
        requested: true,
        activeCopy: "ai",
        status: "failed",
        reason: failed.reason,
        error: failed.validationProblems.join("; "),
      });
    }
    return failed;
  }

  const adopted = result({
    requested: true,
    adopted: true,
    reason: "adopted",
    filesConsidered: files.length,
    candidateFiles: originals.size,
    adoptedFiles: originals.size,
    chunks,
  });
  if (input.versionId) {
    recordHumanizerState(input, {
      requested: true,
      activeCopy: "humanized",
      status: "humanized",
      reason: adopted.reason,
    });
  }
  return adopted;
}

export interface RestoreLearnAiCopyResult {
  restored: boolean;
  reason: "restored" | "already_ai" | "original_copy_missing" | "validation_failed";
  validationProblems: string[];
}

/** Replace a staged humanized learning tree with the complete saved AI copy. */
export function restoreLearnAiCopy(input: {
  gardenDir: string;
  versionId: string;
  validate: () => LearnHumanizerValidation;
}): RestoreLearnAiCopyResult {
  const prior = readLearnHumanizerVersionState(input.gardenDir, input.versionId);
  if (prior.activeCopy === "ai") {
    writeLearnHumanizerVersionState(input.gardenDir, {
      versionId: input.versionId,
      requested: false,
      activeCopy: "ai",
      status: "ai",
      reason: "already_ai",
    });
    return { restored: false, reason: "already_ai", validationProblems: [] };
  }

  const originalCopy = aiLearningDir(input.gardenDir, input.versionId);
  if (!fs.existsSync(originalCopy)) {
    return {
      restored: false,
      reason: "original_copy_missing",
      validationProblems: [],
    };
  }

  const learningDir = path.join(input.gardenDir, "learning");
  const rollbackDir = path.join(
    versionStateDir(input.gardenDir, input.versionId),
    `rollback-${process.pid}-${Date.now().toString(36)}`,
  );
  try {
    if (fs.existsSync(learningDir)) {
      fs.cpSync(learningDir, rollbackDir, { recursive: true, force: true });
    }
    fs.rmSync(learningDir, { recursive: true, force: true });
    fs.cpSync(originalCopy, learningDir, { recursive: true, force: true });
    const validation = input.validate();
    if (!validation.accepted) {
      fs.rmSync(learningDir, { recursive: true, force: true });
      if (fs.existsSync(rollbackDir)) {
        fs.cpSync(rollbackDir, learningDir, { recursive: true, force: true });
      }
      return {
        restored: false,
        reason: "validation_failed",
        validationProblems: (validation.problems ?? []).slice(0, 20),
      };
    }
    writeLearnHumanizerVersionState(input.gardenDir, {
      versionId: input.versionId,
      requested: false,
      activeCopy: "ai",
      status: "ai",
      reason: "restored",
    });
    return { restored: true, reason: "restored", validationProblems: [] };
  } finally {
    fs.rmSync(rollbackDir, { recursive: true, force: true });
  }
}
