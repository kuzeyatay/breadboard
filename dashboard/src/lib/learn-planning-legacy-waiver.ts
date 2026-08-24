import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";

import { canonicalCouncilJsonV1 } from "./council-request-hash.ts";

export const LEGACY_PLANNING_WAIVER_ACK =
  "I acknowledge historical negative dispatch proof is unavailable";

export interface LegacyPlanningWaiverBinding {
  originJobId: string;
  gardenId: string;
  userId: number | null;
  model: string;
  sourceSetHash: string;
  sourceIds: string[];
  syllabusSourceId: string | null;
  sourceOnly: boolean;
  includeSourceSnapshots: boolean;
  jobCreatedAt: string;
  recoveredAt: string;
  startedRequests: number;
  completedRequests: number;
  policyObservedRequests: number;
}

export interface LegacyPlanningWaiverResult {
  sequence: number;
  requestHash: string;
  councilRunId: string;
  responseHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyPlanningWaiverReceipt {
  schemaVersion: 2;
  kind: "learn_planning_legacy_migration_waiver";
  createdAt: string;
  operatorReason: string;
  acknowledgement: typeof LEGACY_PLANNING_WAIVER_ACK;
  binding: LegacyPlanningWaiverBinding;
  results: LegacyPlanningWaiverResult[];
  evidenceHash: string;
  resultsHash: string;
  integrityHash: string;
}

const WAIVER_PREFIX = "legacy-planning-waiver-";
const SHA256_RE = /^[0-9a-f]{64}$/;

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(canonicalCouncilJsonV1(value), "utf8")
    .digest("hex");
}

function sortedResults(
  results: readonly LegacyPlanningWaiverResult[],
): LegacyPlanningWaiverResult[] {
  const compareCodeUnits = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  return results
    .map((result) => ({ ...result }))
    .sort((left, right) =>
      left.sequence - right.sequence ||
      compareCodeUnits(left.createdAt, right.createdAt) ||
      compareCodeUnits(left.requestHash, right.requestHash));
}

function receiptWithoutIntegrity(
  receipt: Omit<LegacyPlanningWaiverReceipt, "integrityHash"> | LegacyPlanningWaiverReceipt,
): Omit<LegacyPlanningWaiverReceipt, "integrityHash"> {
  const unsigned = { ...receipt } as Partial<LegacyPlanningWaiverReceipt>;
  delete unsigned.integrityHash;
  return unsigned as Omit<LegacyPlanningWaiverReceipt, "integrityHash">;
}

function waiverDirectory(contentPath: string, gardenId: string): string {
  return path.join(contentPath, gardenId, ".breadboard", "legacy-planning-waivers");
}

function fsyncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function ensureDirectoryDurable(directory: string): void {
  const missing: string[] = [];
  let cursor = directory;
  while (!fs.existsSync(cursor)) {
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  fs.mkdirSync(directory, { recursive: true });
  for (const created of missing.reverse()) fsyncDirectory(path.dirname(created));
}

function exactJson(value: unknown): string {
  return JSON.stringify(value);
}

function validateBinding(value: unknown): value is LegacyPlanningWaiverBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return (
    typeof binding.originJobId === "string" && Boolean(binding.originJobId) &&
    typeof binding.gardenId === "string" && Boolean(binding.gardenId) &&
    (binding.userId === null || Number.isSafeInteger(binding.userId)) &&
    typeof binding.model === "string" && Boolean(binding.model) &&
    typeof binding.sourceSetHash === "string" && SHA256_RE.test(binding.sourceSetHash) &&
    Array.isArray(binding.sourceIds) &&
    binding.sourceIds.every((entry) => typeof entry === "string") &&
    (binding.syllabusSourceId === null || typeof binding.syllabusSourceId === "string") &&
    typeof binding.sourceOnly === "boolean" &&
    typeof binding.includeSourceSnapshots === "boolean" &&
    typeof binding.jobCreatedAt === "string" && Number.isFinite(Date.parse(binding.jobCreatedAt)) &&
    typeof binding.recoveredAt === "string" && Number.isFinite(Date.parse(binding.recoveredAt)) &&
    Number.isSafeInteger(binding.startedRequests) && Number(binding.startedRequests) > 0 &&
    Number.isSafeInteger(binding.completedRequests) &&
    Number(binding.completedRequests) === Number(binding.startedRequests) &&
    Number.isSafeInteger(binding.policyObservedRequests) &&
    Number(binding.policyObservedRequests) === Number(binding.startedRequests)
  );
}

function validateResult(value: unknown): value is LegacyPlanningWaiverResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(result.sequence) && Number(result.sequence) >= 0 &&
    typeof result.requestHash === "string" && SHA256_RE.test(result.requestHash) &&
    typeof result.councilRunId === "string" && Boolean(result.councilRunId) &&
    typeof result.responseHash === "string" && SHA256_RE.test(result.responseHash) &&
    typeof result.createdAt === "string" && Number.isFinite(Date.parse(result.createdAt)) &&
    typeof result.updatedAt === "string" && Number.isFinite(Date.parse(result.updatedAt)) &&
    Date.parse(result.createdAt) <= Date.parse(result.updatedAt)
  );
}

function validateResultSequence(
  binding: LegacyPlanningWaiverBinding,
  results: readonly LegacyPlanningWaiverResult[],
): boolean {
  if (results.length !== binding.completedRequests) return false;
  const createdAfter = Date.parse(binding.jobCreatedAt);
  const createdBefore = Date.parse(binding.recoveredAt);
  return results.every((result, index) => {
    const createdAt = Date.parse(result.createdAt);
    const updatedAt = Date.parse(result.updatedAt);
    const previousUpdatedAt = index > 0 ? Date.parse(results[index - 1].updatedAt) : null;
    return (
      result.sequence === index &&
      createdAt >= createdAfter &&
      updatedAt <= createdBefore &&
      (previousUpdatedAt === null || createdAt >= previousUpdatedAt)
    );
  });
}

function parseReceipt(raw: string): LegacyPlanningWaiverReceipt {
  if (raw.length > 128_000) throw new Error("Legacy planning waiver is oversized.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Legacy planning waiver is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Legacy planning waiver is not an object.");
  }
  const receipt = value as LegacyPlanningWaiverReceipt;
  if (
    receipt.schemaVersion !== 2 ||
    receipt.kind !== "learn_planning_legacy_migration_waiver" ||
    typeof receipt.createdAt !== "string" ||
    !Number.isFinite(Date.parse(receipt.createdAt)) ||
    typeof receipt.operatorReason !== "string" ||
    receipt.operatorReason.trim().length < 12 ||
    receipt.acknowledgement !== LEGACY_PLANNING_WAIVER_ACK ||
    !validateBinding(receipt.binding) ||
    !Array.isArray(receipt.results) ||
    !receipt.results.every(validateResult) ||
    !SHA256_RE.test(receipt.evidenceHash) ||
    !SHA256_RE.test(receipt.resultsHash) ||
    !SHA256_RE.test(receipt.integrityHash)
  ) {
    throw new Error("Legacy planning waiver shape is invalid.");
  }
  if (Date.parse(receipt.createdAt) < Date.parse(receipt.binding.recoveredAt)) {
    throw new Error("Legacy planning waiver predates its recovered boundary.");
  }
  const sorted = sortedResults(receipt.results);
  if (exactJson(sorted) !== exactJson(receipt.results)) {
    throw new Error("Legacy planning waiver results are not canonical.");
  }
  if (!validateResultSequence(receipt.binding, receipt.results)) {
    throw new Error("Legacy planning waiver result sequence is invalid.");
  }
  if (
    new Set(receipt.results.map((result) => result.councilRunId)).size !== receipt.results.length ||
    new Set(receipt.results.map((result) => result.requestHash)).size !== receipt.results.length
  ) {
    throw new Error("Legacy planning waiver repeats a request or Council run.");
  }
  if (
    receipt.evidenceHash !== hashCanonical(receipt.binding) ||
    receipt.resultsHash !== hashCanonical(receipt.results) ||
    receipt.integrityHash !== hashCanonical(receiptWithoutIntegrity(receipt))
  ) {
    throw new Error("Legacy planning waiver integrity is invalid.");
  }
  return receipt;
}

export function createLegacyPlanningWaiverReceipt(input: {
  contentPath: string;
  binding: LegacyPlanningWaiverBinding;
  results: readonly LegacyPlanningWaiverResult[];
  operatorReason: string;
  acknowledgement: string;
  now: string;
}): string {
  if (!validateBinding(input.binding)) throw new Error("Waiver binding is invalid.");
  if (
    input.acknowledgement !== LEGACY_PLANNING_WAIVER_ACK ||
    input.operatorReason.trim().length < 12 ||
    !Number.isFinite(Date.parse(input.now))
  ) {
    throw new Error("Waiver operator acknowledgement is incomplete.");
  }
  if (Date.parse(input.now) < Date.parse(input.binding.recoveredAt)) {
    throw new Error("Legacy planning waiver cannot predate its recovered boundary.");
  }
  const results = sortedResults(input.results);
  if (
    !results.every(validateResult) ||
    !validateResultSequence(input.binding, results) ||
    new Set(results.map((result) => result.councilRunId)).size !== results.length ||
    new Set(results.map((result) => result.requestHash)).size !== results.length
  ) {
    throw new Error("Waiver results are invalid or not unique.");
  }
  const unsigned: Omit<LegacyPlanningWaiverReceipt, "integrityHash"> = {
    schemaVersion: 2,
    kind: "learn_planning_legacy_migration_waiver",
    createdAt: input.now,
    operatorReason: input.operatorReason.trim(),
    acknowledgement: LEGACY_PLANNING_WAIVER_ACK,
    binding: { ...input.binding, sourceIds: [...input.binding.sourceIds] },
    results,
    evidenceHash: hashCanonical(input.binding),
    resultsHash: hashCanonical(results),
  };
  const receipt: LegacyPlanningWaiverReceipt = {
    ...unsigned,
    integrityHash: hashCanonical(unsigned),
  };
  const directory = waiverDirectory(input.contentPath, input.binding.gardenId);
  ensureDirectoryDurable(directory);
  const originHash = createHash("sha256")
    .update(input.binding.originJobId, "utf8")
    .digest("hex")
    .slice(0, 24);
  const destination = path.join(directory, `${WAIVER_PREFIX}${originHash}.json`);
  const temporary = path.join(directory, `.${WAIVER_PREFIX}${randomUUID()}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8");
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    // Hard-link publication is atomic and refuses to replace an existing seal.
    fs.linkSync(temporary, destination);
    fsyncDirectory(directory);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
      fsyncDirectory(directory);
    } catch {
      // A retained temp cannot be mistaken for a waiver (different suffix).
    }
  }
  return destination;
}

export function readExactLegacyPlanningWaiver(input: {
  contentPath: string;
  expectedBinding: LegacyPlanningWaiverBinding;
}): LegacyPlanningWaiverReceipt | null {
  const directory = waiverDirectory(input.contentPath, input.expectedBinding.gardenId);
  let names: string[];
  try {
    names = fs.readdirSync(directory)
      .filter((name) => name.startsWith(WAIVER_PREFIX) && name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const matching: LegacyPlanningWaiverReceipt[] = [];
  for (const name of names) {
    const receipt = parseReceipt(fs.readFileSync(path.join(directory, name), "utf8"));
    if (receipt.binding.originJobId === input.expectedBinding.originJobId) {
      matching.push(receipt);
    }
  }
  if (matching.length === 0) return null;
  if (matching.length !== 1) throw new Error("Multiple legacy planning waivers match.");
  const receipt = matching[0];
  if (receipt.evidenceHash !== hashCanonical(input.expectedBinding)) {
    throw new Error("Legacy planning waiver binding is stale.");
  }
  return receipt;
}

/** A migration waiver is a pre-run seal. It cannot be minted by, or during,
 * the retry whose first native planning dispatch it would authorize. */
export function assertLegacyPlanningWaiverPredatesCurrentJob(input: {
  receipt: LegacyPlanningWaiverReceipt;
  currentJobCreatedAt: string;
}): void {
  const currentCreatedAt = Date.parse(input.currentJobCreatedAt);
  if (
    !Number.isFinite(currentCreatedAt) ||
    Date.parse(input.receipt.createdAt) >= currentCreatedAt
  ) {
    throw new Error("Legacy planning waiver was not sealed before the current Learn job.");
  }
}

export interface MaterializedLegacyPlanningResult {
  requestHash: string;
  councilRunId: string;
  responseHash: string;
}

function exactResultIdentity(
  sealed: LegacyPlanningWaiverResult,
  materialized: MaterializedLegacyPlanningResult,
): boolean {
  return (
    sealed.requestHash === materialized.requestHash &&
    sealed.councilRunId === materialized.councilRunId &&
    sealed.responseHash === materialized.responseHash
  );
}

function assertMaterializedLegacyPrefix(
  receipt: LegacyPlanningWaiverReceipt,
  materialized: readonly MaterializedLegacyPlanningResult[],
): void {
  if (materialized.length > receipt.results.length) {
    throw new Error("Materialized legacy planning results exceed the sealed inventory.");
  }
  for (let index = 0; index < materialized.length; index += 1) {
    if (!exactResultIdentity(receipt.results[index], materialized[index])) {
      throw new Error("Materialized legacy planning results do not match the sealed order.");
    }
  }
}

export function assertNextLegacyPlanningWaiverResult(input: {
  receipt: LegacyPlanningWaiverReceipt;
  materialized: readonly MaterializedLegacyPlanningResult[];
  candidate: MaterializedLegacyPlanningResult;
}): void {
  assertMaterializedLegacyPrefix(input.receipt, input.materialized);
  const next = input.receipt.results[input.materialized.length];
  if (!next || !exactResultIdentity(next, input.candidate)) {
    throw new Error("Recovered legacy planning result is not the next sealed result.");
  }
}

export function assertLegacyPlanningWaiverFullyMaterialized(input: {
  receipt: LegacyPlanningWaiverReceipt;
  materialized: readonly MaterializedLegacyPlanningResult[];
}): void {
  assertMaterializedLegacyPrefix(input.receipt, input.materialized);
  if (input.materialized.length !== input.receipt.results.length) {
    throw new Error("Not every sealed legacy planning result has been materialized.");
  }
}

export function assertLegacyPlanningWaiverContainsResult(input: {
  receipt: LegacyPlanningWaiverReceipt;
  candidate: MaterializedLegacyPlanningResult;
}): void {
  if (!input.receipt.results.some((result) => exactResultIdentity(result, input.candidate))) {
    throw new Error("Recovered legacy planning result is absent from the sealed inventory.");
  }
}

/** Close the seal-to-dispatch inventory gap by comparing a freshly audited,
 * promptless inventory with the exact ordered identities sealed by the
 * operator. Both the canonical bytes and their receipt hash must agree. */
export function assertLegacyPlanningWaiverMatchesInventory(input: {
  receipt: LegacyPlanningWaiverReceipt;
  inventory: readonly LegacyPlanningWaiverResult[];
}): void {
  const inventory = input.inventory.map((result) => ({ ...result }));
  if (
    !inventory.every(validateResult) ||
    !validateResultSequence(input.receipt.binding, inventory) ||
    exactJson(sortedResults(inventory)) !== exactJson(inventory) ||
    new Set(inventory.map((result) => result.councilRunId)).size !== inventory.length ||
    new Set(inventory.map((result) => result.requestHash)).size !== inventory.length
  ) {
    throw new Error("Live legacy planning inventory is invalid.");
  }
  if (
    hashCanonical(inventory) !== input.receipt.resultsHash ||
    canonicalCouncilJsonV1(inventory) !== canonicalCouncilJsonV1(input.receipt.results)
  ) {
    throw new Error("Live legacy planning inventory no longer matches the sealed inventory.");
  }
}

export interface LegacyPlanningWaiverExercise {
  schemaVersion: 1;
  kind: "learn_planning_legacy_waiver_exercised";
  createdAt: string;
  currentJobId: string;
  gardenId: string;
  stageKey: string;
  semanticAttempt: number;
  requestHash: string;
  exactLookupStatus: 404;
  exactLookupCode: "legacy_not_found";
  originJobId: string;
  waiverIntegrityHash: string;
  integrityHash: string;
}

function validateExercise(
  value: unknown,
): value is LegacyPlanningWaiverExercise {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const exercise = value as Record<string, unknown>;
  const unsigned = { ...exercise };
  delete unsigned.integrityHash;
  return (
    exercise.schemaVersion === 1 &&
    exercise.kind === "learn_planning_legacy_waiver_exercised" &&
    typeof exercise.createdAt === "string" &&
    Number.isFinite(Date.parse(exercise.createdAt)) &&
    typeof exercise.currentJobId === "string" && Boolean(exercise.currentJobId) &&
    typeof exercise.gardenId === "string" && Boolean(exercise.gardenId) &&
    typeof exercise.stageKey === "string" && Boolean(exercise.stageKey) &&
    Number.isSafeInteger(exercise.semanticAttempt) &&
    Number(exercise.semanticAttempt) >= 0 &&
    typeof exercise.requestHash === "string" && SHA256_RE.test(exercise.requestHash) &&
    exercise.exactLookupStatus === 404 &&
    exercise.exactLookupCode === "legacy_not_found" &&
    typeof exercise.originJobId === "string" && Boolean(exercise.originJobId) &&
    typeof exercise.waiverIntegrityHash === "string" &&
    SHA256_RE.test(exercise.waiverIntegrityHash) &&
    typeof exercise.integrityHash === "string" &&
    SHA256_RE.test(exercise.integrityHash) &&
    exercise.integrityHash === hashCanonical(unsigned)
  );
}

/** Persist the exact authorization edge before the caller may return a
 * no-prior-attempt decision. Publication is atomic and idempotent only for the
 * byte-for-byte same bound exercise; a stale/corrupt collision fails closed. */
export function persistLegacyPlanningWaiverExercise(input: {
  contentPath: string;
  currentJobId: string;
  gardenId: string;
  stageKey: string;
  semanticAttempt: number;
  requestHash: string;
  exactLookupCode: "legacy_not_found";
  originJobId: string;
  waiverIntegrityHash: string;
  now: string;
}): string {
  const unsigned: Omit<LegacyPlanningWaiverExercise, "integrityHash"> = {
    schemaVersion: 1,
    kind: "learn_planning_legacy_waiver_exercised",
    createdAt: input.now,
    currentJobId: input.currentJobId,
    gardenId: input.gardenId,
    stageKey: input.stageKey,
    semanticAttempt: input.semanticAttempt,
    requestHash: input.requestHash,
    exactLookupStatus: 404,
    exactLookupCode: input.exactLookupCode,
    originJobId: input.originJobId,
    waiverIntegrityHash: input.waiverIntegrityHash,
  };
  const exercise: LegacyPlanningWaiverExercise = {
    ...unsigned,
    integrityHash: hashCanonical(unsigned),
  };
  if (!validateExercise(exercise)) {
    throw new Error("Legacy planning waiver exercise binding is invalid.");
  }
  const directory = path.join(
    waiverDirectory(input.contentPath, input.gardenId),
    "exercised",
  );
  ensureDirectoryDurable(directory);
  const identity = hashCanonical({
    originJobId: input.originJobId,
    waiverIntegrityHash: input.waiverIntegrityHash,
  }).slice(0, 32);
  const destination = path.join(directory, `exercise-${identity}.json`);
  const temporary = path.join(directory, `.exercise-${randomUUID()}.tmp`);
  const encoded = `${JSON.stringify(exercise)}\n`;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeSync(descriptor, encoded, undefined, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
      descriptor = null;
    }
    // Publish only after the complete temp file is durable. Hard-linking is
    // atomic and refuses to replace a prior exercise.
    fs.linkSync(temporary, destination);
    fsyncDirectory(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = parseExercise(fs.readFileSync(destination, "utf8"));
    const stableExercise = (value: LegacyPlanningWaiverExercise): Record<string, unknown> => {
      const stable = { ...value } as Record<string, unknown>;
      delete stable.createdAt;
      delete stable.currentJobId;
      delete stable.integrityHash;
      return stable;
    };
    const stableExisting = stableExercise(existing);
    const stableExpected = stableExercise(exercise);
    if (exactJson(stableExisting) !== exactJson(stableExpected)) {
      throw new Error("Legacy planning waiver exercise conflicts with its durable record.");
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
      fsyncDirectory(directory);
    } catch {
      // Temp files use a non-receipt suffix and can never authorize dispatch.
    }
  }
  return destination;
}

function parseExercise(raw: string): LegacyPlanningWaiverExercise {
  if (raw.length > 32_000) throw new Error("Legacy planning waiver exercise is oversized.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Legacy planning waiver exercise is not valid JSON.");
  }
  if (!validateExercise(value)) {
    throw new Error("Legacy planning waiver exercise integrity is invalid.");
  }
  return value;
}
