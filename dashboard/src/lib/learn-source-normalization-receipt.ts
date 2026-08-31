import { createHash, randomUUID } from "node:crypto";

import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "./external-runtime-path.ts";

const RECEIPT_RELATIVE_PATH = ".breadboard/source-normalization-receipt.json";
const RECEIPT_KIND = "learn_source_normalization_receipt";
const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_TRANSFORM_VERSION = 1;
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const MAX_RECEIPT_SOURCES = 16_384;
const SHA256 = /^[0-9a-f]{64}$/u;

export interface LearnSourceBindingRecord {
  slug: string;
  relPath: string;
  title: string;
  description: string;
  sourceFile: string;
  date: string;
  wordCount: number;
  bodyHash: string;
}

export interface LearnSourceNormalizationReceipt {
  schemaVersion: 1;
  kind: typeof RECEIPT_KIND;
  transformVersion: 1;
  createdAt: string;
  expectedCombinedSourceSetHash: string;
  sourceIds: string[];
  before: LearnSourceBindingRecord[];
  after: LearnSourceBindingRecord[];
  integritySha256: string;
}

interface ReceiptPayload {
  schemaVersion: 1;
  kind: typeof RECEIPT_KIND;
  transformVersion: 1;
  createdAt: string;
  expectedCombinedSourceSetHash: string;
  sourceIds: string[];
  before: LearnSourceBindingRecord[];
  after: LearnSourceBindingRecord[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareRecords(
  left: LearnSourceBindingRecord,
  right: LearnSourceBindingRecord,
): number {
  return left.relPath.localeCompare(right.relPath) || left.slug.localeCompare(right.slug);
}

function canonicalRecords(
  records: readonly LearnSourceBindingRecord[],
): LearnSourceBindingRecord[] {
  return records.map((record) => ({ ...record })).sort(compareRecords);
}

export function learnSourceBindingRecord(input: {
  slug: string;
  relPath: string;
  title: string;
  description?: string;
  sourceFile?: string;
  date?: string;
  wordCount?: number;
  body?: string;
  bodyHash?: string;
}): LearnSourceBindingRecord {
  const body = input.body?.trim() ?? "";
  const wordCount = input.wordCount ?? (body ? body.split(/\s+/u).length : 0);
  const bodyHash = input.bodyHash ?? sha256(body);
  return {
    slug: input.slug,
    relPath: input.relPath.replace(/\\/gu, "/"),
    title: input.title,
    description: input.description ?? "",
    sourceFile: input.sourceFile ?? "",
    date: input.date ?? "",
    wordCount,
    bodyHash,
  };
}

export function sourceSetHashForBindingRecords(
  records: readonly LearnSourceBindingRecord[],
): string {
  return sha256(JSON.stringify(canonicalRecords(records)));
}

function receiptPayload(input: {
  createdAt: string;
  expectedCombinedSourceSetHash: string;
  sourceIds: readonly string[];
  before: readonly LearnSourceBindingRecord[];
  after: readonly LearnSourceBindingRecord[];
}): ReceiptPayload {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND,
    transformVersion: RECEIPT_TRANSFORM_VERSION,
    createdAt: input.createdAt,
    expectedCombinedSourceSetHash: input.expectedCombinedSourceSetHash,
    sourceIds: [...input.sourceIds],
    before: canonicalRecords(input.before),
    after: canonicalRecords(input.after),
  };
}

function receiptIntegrity(payload: ReceiptPayload): string {
  return sha256(JSON.stringify(payload));
}

function validRecord(value: unknown): value is LearnSourceBindingRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<LearnSourceBindingRecord>;
  return (
    typeof record.slug === "string" &&
    record.slug.trim() === record.slug &&
    Boolean(record.slug) &&
    typeof record.relPath === "string" &&
    record.relPath.trim() === record.relPath &&
    Boolean(record.relPath) &&
    !record.relPath.includes("\\") &&
    typeof record.title === "string" &&
    typeof record.description === "string" &&
    typeof record.sourceFile === "string" &&
    typeof record.date === "string" &&
    Number.isSafeInteger(record.wordCount) &&
    Number(record.wordCount) >= 0 &&
    typeof record.bodyHash === "string" &&
    SHA256.test(record.bodyHash)
  );
}

function parsedReceipt(value: unknown): LearnSourceNormalizationReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Partial<LearnSourceNormalizationReceipt>;
  if (
    receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION ||
    receipt.kind !== RECEIPT_KIND ||
    receipt.transformVersion !== RECEIPT_TRANSFORM_VERSION ||
    typeof receipt.createdAt !== "string" ||
    !Number.isFinite(Date.parse(receipt.createdAt)) ||
    typeof receipt.expectedCombinedSourceSetHash !== "string" ||
    !SHA256.test(receipt.expectedCombinedSourceSetHash) ||
    !Array.isArray(receipt.sourceIds) ||
    receipt.sourceIds.length === 0 ||
    receipt.sourceIds.length > MAX_RECEIPT_SOURCES ||
    receipt.sourceIds.some(
      (sourceId) =>
        typeof sourceId !== "string" || !sourceId || sourceId.trim() !== sourceId,
    ) ||
    new Set(receipt.sourceIds).size !== receipt.sourceIds.length ||
    !Array.isArray(receipt.before) ||
    !Array.isArray(receipt.after) ||
    receipt.before.length !== receipt.sourceIds.length ||
    receipt.after.length !== receipt.sourceIds.length ||
    receipt.before.length > MAX_RECEIPT_SOURCES ||
    !receipt.before.every(validRecord) ||
    !receipt.after.every(validRecord) ||
    typeof receipt.integritySha256 !== "string" ||
    !SHA256.test(receipt.integritySha256)
  ) {
    return null;
  }
  const payload = receiptPayload({
    createdAt: receipt.createdAt,
    expectedCombinedSourceSetHash: receipt.expectedCombinedSourceSetHash,
    sourceIds: receipt.sourceIds,
    before: receipt.before,
    after: receipt.after,
  });
  if (
    receiptIntegrity(payload) !== receipt.integritySha256 ||
    JSON.stringify(payload.before) !== JSON.stringify(receipt.before) ||
    JSON.stringify(payload.after) !== JSON.stringify(receipt.after)
  ) {
    return null;
  }
  return { ...payload, integritySha256: receipt.integritySha256 };
}

export function readLearnSourceNormalizationReceipt(
  gardenDir: string,
): LearnSourceNormalizationReceipt | null {
  const receiptPath = path.join(gardenDir, ...RECEIPT_RELATIVE_PATH.split("/"));
  try {
    const stat = fs.lstatSync(receiptPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECEIPT_BYTES) {
      return null;
    }
    return parsedReceipt(JSON.parse(fs.readFileSync(receiptPath, "utf8")));
  } catch {
    return null;
  }
}

export function writeLearnSourceNormalizationReceipt(input: {
  gardenDir: string;
  expectedCombinedSourceSetHash: string;
  sourceIds: readonly string[];
  before: readonly LearnSourceBindingRecord[];
  after: readonly LearnSourceBindingRecord[];
  createdAt?: string;
}): LearnSourceNormalizationReceipt | null {
  const before = canonicalRecords(input.before);
  const after = canonicalRecords(input.after);
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  const payload = receiptPayload({
    createdAt: input.createdAt ?? new Date().toISOString(),
    expectedCombinedSourceSetHash: input.expectedCombinedSourceSetHash,
    sourceIds: input.sourceIds,
    before,
    after,
  });
  const receipt = parsedReceipt({
    ...payload,
    integritySha256: receiptIntegrity(payload),
  });
  if (!receipt) {
    throw new Error("Learn source-normalization receipt failed self-validation.");
  }
  const receiptPath = path.join(input.gardenDir, ...RECEIPT_RELATIVE_PATH.split("/"));
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, receiptPath);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // A successful rename removes the temporary path. Failed cleanup must not
      // replace the authoritative receipt write error.
    }
  }
  return receipt;
}

export function matchingLearnSourceNormalizationReceipt(input: {
  gardenDir: string;
  expectedCombinedSourceSetHash: string;
  sourceIds: readonly string[];
  current: readonly LearnSourceBindingRecord[];
}): LearnSourceNormalizationReceipt | null {
  const receipt = readLearnSourceNormalizationReceipt(input.gardenDir);
  if (
    !receipt ||
    receipt.expectedCombinedSourceSetHash !== input.expectedCombinedSourceSetHash ||
    JSON.stringify(receipt.sourceIds) !== JSON.stringify(input.sourceIds) ||
    JSON.stringify(receipt.after) !== JSON.stringify(canonicalRecords(input.current))
  ) {
    return null;
  }
  return receipt;
}

/**
 * Rebind a verified normalization receipt when only the reviewed-formula
 * manifest changes. The raw source bytes must still match the receipt's exact
 * post-normalization records, so a later user edit can never be laundered into
 * the older pre-normalization binding.
 */
export function rebindLearnSourceNormalizationReceipt(input: {
  gardenDir: string;
  expectedCombinedSourceSetHash: string;
  sourceIds: readonly string[];
  current: readonly LearnSourceBindingRecord[];
}): LearnSourceNormalizationReceipt | null {
  const receipt = readLearnSourceNormalizationReceipt(input.gardenDir);
  if (
    !receipt ||
    JSON.stringify(receipt.sourceIds) !== JSON.stringify(input.sourceIds) ||
    JSON.stringify(receipt.after) !== JSON.stringify(canonicalRecords(input.current))
  ) {
    return null;
  }
  if (
    receipt.expectedCombinedSourceSetHash ===
    input.expectedCombinedSourceSetHash
  ) {
    return receipt;
  }
  return writeLearnSourceNormalizationReceipt({
    gardenDir: input.gardenDir,
    expectedCombinedSourceSetHash: input.expectedCombinedSourceSetHash,
    sourceIds: receipt.sourceIds,
    before: receipt.before,
    after: receipt.after,
    createdAt: receipt.createdAt,
  });
}
