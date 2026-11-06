/** The repair controller's state and release authority. Never model-editable. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const SOURCE_REPAIR_VERSION = 1;
export const MAX_SOURCE_REPAIRS_PER_DAY = 3;
export const MAX_SOURCE_REPAIR_ATTEMPTS = 2;
export const SOURCE_REPAIR_DEADLINE_MS = 2 * 60 * 60_000;
export type RepairStage = "queued" | "preparing" | "testing" | "building" | "ready" |
  "activating" | "probation" | "committed" | "rollback_requested" | "rolled_back" |
  "cancelled" | "blocked" | "failed";
export interface SourceRepairRequest {
  id: string; version: 1; userId: number; conversationId: number;
  sourceRunId: string; rootClientMessageId: string; request: string;
  failure: { code: string; message: string; fingerprint: string };
  model: string; baseRoot: string; stage: RepairStage; attempt: number;
  createdAt: number; updatedAt: number; deadline: number;
  jobId?: string; generation?: number; reason?: string; candidateRoot?: string; sourceFingerprint?: string; parentReleaseId?: string | null;
  release?: SourceRepairRelease; resumedRunId?: string; resumeAfterRollback?: boolean;
  checks?: Record<string, unknown>;
}
export interface SourceRepairRelease {
  id: string; baseRoot: string; root: string; sourceFingerprint: string;
  files: Array<{ path: string; sha256: string }>;
  baseFiles?: Array<{ path: string; sha256: string }>;
  changedSources: string[]; createdAt: number; signature: string;
}
export interface SourceRepairJournal {
  version: 1; phase: "stable" | "activating" | "probation" | "rolling_back";
  active: SourceRepairRelease | null; previous: SourceRepairRelease | null;
  repairId: string | null; updatedAt: number; healthyAt?: number;
}
export interface SourceRepairConfig { version: 1; enabled: boolean; baseRoot: string }
const ID = /^sr-[a-f0-9]{24}$/;
const TERMINAL = new Set<RepairStage>(["committed", "rolled_back", "cancelled", "blocked", "failed"]);
const SERVER = "dashboard/.next-desktop/standalone/server.js";
const MAX_JSON_BYTES = 64 * 1024 * 1024;

export function sameRepairPath(a: string, b: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value).replace(/^\\\\\?\\/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}
export function repairPathWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function directRepairPath(target: string): string {
  const resolved = path.resolve(target);
  let current = path.parse(resolved).root;
  for (const segment of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error("Repair state or source traverses a link.");
  }
  return resolved;
}
export function sourceRepairDirectory(dataRoot: string): string {
  return directRepairPath(path.join(dataRoot, "source-repair"));
}
export function readRepairJson<T>(file: string): T | null {
  directRepairPath(file);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > MAX_JSON_BYTES || stat.size === 0) throw new Error("Invalid repair state file.");
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
export function writeRepairJson(file: string, value: unknown): void {
  directRepairPath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  if (bytes.length > MAX_JSON_BYTES) throw new Error("Repair state exceeded its size limit.");
  const temporary = `${file}.${randomUUID()}.pending`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  try { fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function initializeSourceRepair(dataRoot: string, baseRoot: string, enabled: boolean): SourceRepairConfig {
  const directory = sourceRepairDirectory(dataRoot);
  fs.mkdirSync(path.join(directory, "requests"), { recursive: true });
  const file = path.join(directory, "config.json");
  const existing = readRepairJson<SourceRepairConfig>(file);
  if (existing) {
    if (existing.version !== 1 || !sameRepairPath(existing.baseRoot, baseRoot)) throw new Error("Repair configuration belongs to another installation.");
    return existing;
  }
  const config: SourceRepairConfig = { version: 1, enabled, baseRoot: directRepairPath(baseRoot) };
  const key = path.join(directory, "release-key");
  try { fs.writeFileSync(key, randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  writeRepairJson(file, config);
  return config;
}
export function sourceRepairConfig(dataRoot: string): SourceRepairConfig | null {
  return readRepairJson<SourceRepairConfig>(path.join(sourceRepairDirectory(dataRoot), "config.json"));
}
function requestFile(dataRoot: string, id: string): string {
  if (!ID.test(id)) throw new Error("Invalid repair identity.");
  return path.join(sourceRepairDirectory(dataRoot), "requests", `${id}.json`);
}
export function readSourceRepair(dataRoot: string, id: string): SourceRepairRequest | null {
  const request = readRepairJson<SourceRepairRequest>(requestFile(dataRoot, id));
  if (request && (request.id !== id || request.version !== 1)) throw new Error("Mismatched repair identity.");
  if (request && fs.existsSync(`${requestFile(dataRoot, id)}.cancel`) && request.stage !== "committed") request.stage = "cancelled";
  return request;
}
export function cancelSourceRepair(dataRoot: string, id: string): void {
  const file = `${requestFile(dataRoot, id)}.cancel`;
  try { fs.writeFileSync(file, "cancelled\n", { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}
export function updateSourceRepair(dataRoot: string, id: string, update: Partial<SourceRepairRequest>): SourceRepairRequest {
  const previous = readSourceRepair(dataRoot, id);
  if (!previous) throw new Error("Repair request is missing.");
  // Cancellation is monotonic; a late worker may not publish over Stop.
  if (previous.stage === "cancelled" && update.stage !== "cancelled") return previous;
  const next = { ...previous, ...update, id: previous.id, version: 1 as const, updatedAt: Date.now() };
  writeRepairJson(requestFile(dataRoot, id), next);
  return next;
}
export function listSourceRepairs(dataRoot: string): SourceRepairRequest[] {
  const directory = path.join(sourceRepairDirectory(dataRoot), "requests");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => /^sr-[a-f0-9]{24}\.json$/.test(name))
    .map(name => readSourceRepair(dataRoot, name.slice(0, -5))!).filter(Boolean)
    .sort((a, b) => a.createdAt - b.createdAt);
}
export function redactedRepairText(text: string, maximum = 4000): string {
  return text.replace(/(bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]").slice(0, maximum);
}
export function enqueueSourceRepair(dataRoot: string, input: Pick<SourceRepairRequest,
  "userId" | "conversationId" | "sourceRunId" | "rootClientMessageId" | "request" | "failure" | "model">): SourceRepairRequest | null {
  const config = sourceRepairConfig(dataRoot);
  if (!config?.enabled || config.version !== 1) return null;
  const id = `sr-${createHash("sha256").update(`${input.conversationId}:${input.rootClientMessageId}:${input.failure.fingerprint}`).digest("hex").slice(0, 24)}`;
  const existing = readSourceRepair(dataRoot, id);
  if (existing) return existing;
  const now = Date.now();
  const recent = listSourceRepairs(dataRoot).filter(item => item.createdAt > now - 86_400_000);
  if (recent.length >= MAX_SOURCE_REPAIRS_PER_DAY || recent.some(item => !TERMINAL.has(item.stage))) return null;
  const request: SourceRepairRequest = { ...input, id, version: 1, baseRoot: config.baseRoot,
    request: redactedRepairText(input.request), failure: { ...input.failure, message: redactedRepairText(input.failure.message) },
    stage: "queued", attempt: 0, createdAt: now, updatedAt: now, deadline: now + SOURCE_REPAIR_DEADLINE_MS };
  writeRepairJson(requestFile(dataRoot, id), request);
  return request;
}
export function readRepairJournal(dataRoot: string): SourceRepairJournal {
  const result = readRepairJson<SourceRepairJournal>(path.join(sourceRepairDirectory(dataRoot), "release.json"));
  if (result && result.version !== 1) throw new Error("Unsupported repair journal.");
  return result ?? { version: 1, phase: "stable", active: null, previous: null, repairId: null, updatedAt: Date.now() };
}
export function writeRepairJournal(dataRoot: string, journal: SourceRepairJournal): void {
  writeRepairJson(path.join(sourceRepairDirectory(dataRoot), "release.json"), { ...journal, updatedAt: Date.now() });
}
export function recoverInterruptedRepairActivation(dataRoot: string): void {
  const journal = readRepairJournal(dataRoot);
  let interrupted = journal.phase === "activating" || journal.phase === "rolling_back";
  const baseRoot = sourceRepairConfig(dataRoot)?.baseRoot;
  if (!interrupted && journal.active && baseRoot) {
    try { verifySourceRepairRelease(dataRoot, baseRoot, journal.active, false); }
    catch { interrupted = true; }
  }
  if (!interrupted) return;
  let previous = journal.previous;
  if (previous && baseRoot) {
    try { verifySourceRepairRelease(dataRoot, baseRoot, previous, false); }
    catch { previous = null; }
  }
  writeRepairJournal(dataRoot, { ...journal, phase: "stable", active: previous, previous: null, repairId: null });
  const id = journal.repairId ?? journal.active?.id;
  if (id && readSourceRepair(dataRoot, id)) updateSourceRepair(dataRoot, id, { stage: "rolled_back", reason: "Activation was interrupted or its release changed; restored the last verified release." });
}
export function repairFileHash(file: string): string {
  directRepairPath(file);
  const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(256 * 1024);
  const descriptor = fs.openSync(file, "r");
  try {
    let count: number;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally { fs.closeSync(descriptor); }
}
function releaseSignature(dataRoot: string, value: Omit<SourceRepairRelease, "signature">): string {
  const key = path.join(sourceRepairDirectory(dataRoot), "release-key");
  directRepairPath(key);
  const bytes = fs.readFileSync(key);
  if (bytes.length !== 32) throw new Error("Release authority is unavailable.");
  return createHmac("sha256", bytes).update(JSON.stringify(value)).digest("hex");
}
export function signSourceRepairRelease(dataRoot: string, release: Omit<SourceRepairRelease, "signature">): SourceRepairRelease {
  return { ...release, signature: releaseSignature(dataRoot, release) };
}
export function verifySourceRepairRelease(dataRoot: string, baseRoot: string, release: SourceRepairRelease, full = true): void {
  const { signature, ...unsigned } = release;
  const expected = Buffer.from(releaseSignature(dataRoot, unsigned));
  const actual = Buffer.from(signature ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Release proof is invalid.");
  if (!ID.test(release.id) || !sameRepairPath(release.baseRoot, baseRoot) ||
      !sameRepairPath(path.dirname(release.root), path.join(baseRoot, ".qa-worktrees"))) throw new Error("Release is outside this installation's isolated copies.");
  directRepairPath(release.root);
  if (!release.files.some(file => file.path === SERVER) || release.files.length > 100_000) throw new Error("Release has no verified dashboard build.");
  for (const file of release.files) {
    const target = path.resolve(release.root, file.path);
    if (!repairPathWithin(release.root, target) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Release manifest escapes its copy.");
    if ((full || file.path === SERVER || release.changedSources.includes(file.path)) && repairFileHash(target) !== file.sha256) throw new Error("Release changed after verification.");
  }
}
export function selectedSourceRepairRelease(dataRoot: string, baseRoot: string): SourceRepairRelease | null {
  const journal = readRepairJournal(dataRoot);
  if (!journal.active) return null;
  verifySourceRepairRelease(dataRoot, baseRoot, journal.active, false);
  return journal.active;
}
export async function verifySourceRepairReleaseAsync(dataRoot: string, baseRoot: string, release: SourceRepairRelease): Promise<void> {
  verifySourceRepairRelease(dataRoot, baseRoot, release, false);
  let count = 0;
  for (const file of release.files) {
    if (repairFileHash(path.resolve(release.root, file.path)) !== file.sha256) throw new Error("Release changed after verification.");
    if (++count % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
}
export async function verifyRepairBaseSource(sourceRoot: string, release: SourceRepairRelease): Promise<void> {
  if (!release.baseFiles?.length) throw new Error("The repair has no baseline source proof.");
  let count = 0;
  for (const file of release.baseFiles) {
    const target = path.resolve(sourceRoot, file.path);
    if (!repairPathWithin(sourceRoot, target) || repairFileHash(target) !== file.sha256) throw new Error("The source changed after repair verification.");
    if (++count % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
}
export function automaticRepairPathAllowed(file: string): boolean {
  if (!/^(dashboard\/src\/lib\/|dashboard\/src\/app\/components\/)[a-zA-Z0-9_./[\]-]+\.(ts|tsx)$/.test(file) || file.split("/").includes("..")) return false;
  return !/(?:^|\/)(?:auth|server-auth|db|migrat|permission|approval|capabilit|autonomy|security|supervisor|runtime-v2|source-repair|task-recovery|run-recovery|session-service|session-cancel|event-stream|goal-|turn-service|route-core|external-runtime|filesystem|artifact-completion|conversations|.*(?:guard|policy|validator|verification|contract))[^/]*(?:\/|\.)/i.test(file);
}
export function assertAutomaticRepairPatch(edits: Array<{ path: string; before: string; after: string }>): void {
  if (!Array.isArray(edits) || !edits.length || edits.length > 8 || new Set(edits.map(edit => edit.path)).size > 4) throw new Error("Repair scope exceeds four existing application files.");
  if (JSON.stringify(edits).length > 128_000) throw new Error("Repair patch is too large.");
  for (const edit of edits) {
    if (!automaticRepairPathAllowed(edit.path) || typeof edit.before !== "string" || !edit.before || typeof edit.after !== "string" || edit.before === edit.after) throw new Error("Repair attempts to change a protected or unsupported path.");
    if (/(?:child_process|eval\s*\(|new\s+Function|process\.(?:env|exit)|require\s*\(|import\s*\(|\.\.\/.*source-repair)/.test(edit.after)) throw new Error("Repair introduces dynamic execution or process authority.");
  }
}

/** An advisory process lock, separate from the model's worktree. */
export function claimSourceRepairEngine(dataRoot: string): (() => void) | null {
  const file = path.join(sourceRepairDirectory(dataRoot), "engine.lock");
  const token = randomUUID();
  try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = readRepairJson<{ pid: number; token: string }>(file);
    if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return null;
    try { process.kill(owner.pid, 0); return null; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") return null; }
    fs.unlinkSync(file);
    return claimSourceRepairEngine(dataRoot);
  }
  return () => { if (readRepairJson<{ token: string }>(file)?.token === token) fs.unlinkSync(file); };
}
