import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ElectronQaHarness } from "./fixtures";

const MB = 1_048_576;
const FREE_COMMIT_FLOOR_MB = 8_192;
const POST_MIXED_SAMPLE_MS = 300_000;
const REQUIRED_DURATION_MS = 21_600_000;
const DEFAULT_SETTLE_WINDOW_MS = 30_000;
const SAMPLE_GAP_OVERHEAD_MS = 20_000;
const EXTERNAL_PROBE_TIMEOUT_MS = 15_000;
const MAX_CONTAINER_PROBE_ATTEMPTS = 8;
const POSTIZ_ACTION_TIMEOUT_MS = 180_000;
const POSTIZ_READY_POLL_TIMEOUT_MS = 10 * 60_000;
const MAX_EXTERNAL_OUTPUT_BYTES = 64 * 1024;
const BURN_OBSERVED_SERVICE_IDS = ["chatmock", "dashboard", "gbrain", "quartz"] as const;
const SERVICE_EVIDENCE_AUTHORITY = "runtime-v2-services-receipt";
const SERVICE_EVIDENCE_MAX_AGE_MS = 6 * 60 * 60_000;
const SERVICE_EVIDENCE_BINDING_LAUNCH_WINDOW_MS = 2 * 60 * 60_000;
const SERVICE_EVIDENCE_FUTURE_TOLERANCE_MS = 5 * 60_000;
const SHA256_PATTERN = /^[0-9A-F]{64}$/u;
const SERVICE_EVIDENCE_GATES = [
  "cold-start",
  "startup-ready",
  "steady",
  "request-peak",
  "descendants",
  "cancel",
  "restart",
  "shutdown",
  "post-idle",
] as const;
const TERMINAL_STATES = new Set([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

export type BurnInOperationKind = "learn" | "ingestion" | "artifact";

const DEFINITIONS: Readonly<Record<BurnInOperationKind, {
  jobType: string;
  workerKind: string;
  capabilityId: string;
  maximumRuntimeMs: number;
}>> = Object.freeze({
  learn: Object.freeze({
    jobType: "learn",
    workerKind: "learn-node",
    capabilityId: "workflow:learn",
    maximumRuntimeMs: 43_200_000,
  }),
  ingestion: Object.freeze({
    jobType: "document-ingestion",
    workerKind: "document-ingestion-node",
    capabilityId: "tool-family:ingestion",
    maximumRuntimeMs: 7_200_000,
  }),
  artifact: Object.freeze({
    jobType: "office-artifact",
    workerKind: "office-artifact-node",
    capabilityId: "registry:artifact-renderers",
    maximumRuntimeMs: 1_200_000,
  }),
});

interface ProcessSample {
  readonly pid: number;
  readonly parentPid: number;
  readonly name: string;
  readonly privateBytes: number;
  readonly workingSetBytes: number;
}

interface ListenerSample {
  readonly port: number;
  readonly ownerPid: number;
}

interface WindowsSample {
  readonly sampledAt: number;
  readonly commitTotalMb: number;
  readonly commitLimitMb: number;
  readonly processCount: number;
  readonly processes: readonly ProcessSample[];
  readonly listeningPorts: readonly ListenerSample[];
}

interface JobRow {
  readonly job_id: string;
  readonly job_type: string;
  readonly worker_kind: string;
  readonly state: string;
  readonly attempt: number;
  readonly worker_instance_id: string | null;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly finished_at: number | null;
  readonly failure_code: string | null;
  readonly cancellation_requested: number;
}

interface EventRow {
  readonly event_type: string;
  readonly payload_json: string;
  readonly attempt: number;
  readonly worker_instance_id: string | null;
  readonly created_at: number;
}

interface ExhaustionRow {
  readonly resource: string;
  readonly required_headroom_mb: number;
  readonly available_headroom_mb: number;
}

interface ServiceRow {
  readonly service_id: string;
  readonly lifecycle_state: string;
  readonly generation: number;
  readonly idle_ttl_ms: number | null;
  readonly idle_due_at: number | null;
}

interface RuntimeServiceManifestEntry {
  readonly id?: unknown;
  readonly requirement?: unknown;
  readonly startupPolicy?: unknown;
}

interface ServiceEvidenceArtifactIdentity {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface ServiceEvidenceSourceIdentity {
  readonly serviceManifestSha256: string;
  readonly executionInventorySha256: string;
  readonly runnerSha256: string;
  readonly contractSha256: string;
}

interface ServiceEvidenceBinding {
  readonly authority: "runtime-v2-services-receipt";
  readonly pointerPath: string;
  readonly pointerSha256: string;
  readonly receiptPath: string;
  readonly receiptSha256: string;
  readonly runId: string;
  readonly suite: "burn";
  readonly runtimeMode: "packaged";
  readonly outcome: "PASS";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly validatedAt: string;
  readonly maximumAgeMs: number;
  readonly serviceCount: number;
  readonly gbrainIncluded: true;
  readonly executable: ServiceEvidenceArtifactIdentity;
  readonly sourceIdentity: ServiceEvidenceSourceIdentity;
}

function sortedManifestServiceIds(
  services: readonly RuntimeServiceManifestEntry[],
  predicate: (service: RuntimeServiceManifestEntry) => boolean,
  label: string,
): string[] {
  const ids: string[] = [];
  for (const service of services) {
    if (typeof service.id !== "string" || service.id.length === 0) {
      throw new Error(`Runtime V2 manifest contains an invalid ${label} service ID.`);
    }
    if (predicate(service)) ids.push(service.id);
  }
  ids.sort();
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Runtime V2 manifest contains duplicate ${label} service IDs.`);
  }
  return ids;
}

interface SqliteStatement {
  all(...parameters: readonly unknown[]): unknown[];
  get(...parameters: readonly unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  pragma(source: string): unknown;
  close(): void;
}

type SqliteConstructor = new (
  filename: string,
  options: { readonly readonly: true; readonly fileMustExist: true },
) => SqliteDatabase;

type BurnInOperationReceipt = Record<string, unknown>;
type MixedCycleReceipt = Record<string, unknown>;

interface MixedCycleActions extends Readonly<Record<BurnInOperationKind, () => Promise<void>>> {
  readonly gardenChatRetrieval: () => Promise<void>;
  readonly quartzBuild: () => Promise<void>;
  readonly browserAgent: () => Promise<Record<string, unknown>>;
  readonly postiz: () => Promise<Record<string, unknown>>;
}

export interface BrowserAgentAvailabilityProbe {
  readonly checkedAt: string;
  readonly httpStatus: number;
  readonly probeLatencyMs: number;
  readonly runtimeAvailable: boolean;
  readonly reason: string | null;
  readonly agentId: string | null;
  readonly agentRuntimeState: string | null;
}

export interface PostizStatusProbe {
  readonly checkedAt: string;
  readonly httpStatus: number;
  readonly probeLatencyMs: number;
  readonly mode: string;
  readonly state: string;
  readonly reachable: boolean;
  readonly coordinator: Readonly<Record<string, unknown>> | null;
  readonly reason: string | null;
}

export interface PostizActivationResult {
  readonly httpStatus: number;
  readonly actionLatencyMs: number;
  readonly ready: boolean;
  readonly state: string;
  readonly ownership: string;
  readonly reason: string | null;
}

export interface PostizStopResult {
  readonly httpStatus: number;
  readonly actionLatencyMs: number;
  readonly stopped: boolean;
  readonly reason: string | null;
}

interface BoundedCommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly errorCode: string | null;
}

interface ContainerEngineProbe {
  readonly available: boolean;
  readonly engine: "docker" | "podman" | null;
  readonly executable: string | null;
  readonly evidence: Record<string, unknown>;
}

async function runBoundedCommand(
  executable: string,
  args: readonly string[],
  timeoutMs = EXTERNAL_PROBE_TIMEOUT_MS,
): Promise<BoundedCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout;
    const child = spawn(executable, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const finish = (value: Omit<BoundedCommandResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...value, durationMs: Date.now() - startedAt });
    };
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString("utf8")}`.slice(0, MAX_EXTERNAL_OUTPUT_BYTES);
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once("error", (error: NodeJS.ErrnoException) => finish({
      code: null,
      stdout,
      stderr,
      timedOut: false,
      errorCode: error.code ?? "SPAWN_FAILED",
    }));
    child.once("exit", (code) => finish({
      code,
      stdout,
      stderr,
      timedOut: false,
      errorCode: null,
    }));
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout, stderr, timedOut: true, errorCode: "TIMED_OUT" });
    }, timeoutMs);
    timer.unref?.();
  });
}

function boundedDetail(value: string): string {
  return value.trim().replace(/[\r\n]+/gu, " ").slice(0, 500);
}

function assertBoundedPostizStatus(probe: PostizStatusProbe, label: string): void {
  if (
    !Number.isFinite(Date.parse(probe.checkedAt)) ||
    !Number.isSafeInteger(probe.httpStatus) ||
    probe.httpStatus < 0 ||
    probe.httpStatus > 599 ||
    !Number.isFinite(probe.probeLatencyMs) ||
    probe.probeLatencyMs < 0 ||
    probe.probeLatencyMs > 30_000 ||
    !probe.mode ||
    !probe.state
  ) {
    throw new Error(`${label} is incomplete or unbounded.`);
  }
}

function containerCliCandidates(kind: "docker" | "podman"): string[] {
  const executable = `${kind}.exe`;
  const programFiles = process.env["ProgramFiles"]?.trim();
  const candidates = kind === "docker"
    ? [
        ...(programFiles ? [path.join(programFiles, "Docker", "Docker", "resources", "bin", executable)] : []),
        executable,
      ]
    : [
        ...(programFiles ? [path.join(programFiles, "RedHat", "Podman", executable)] : []),
        executable,
      ];
  return unique(candidates);
}

async function probeContainerEngine(): Promise<ContainerEngineProbe> {
  const startedAt = Date.now();
  const attempts: Array<Record<string, unknown>> = [];
  for (const engine of ["docker", "podman"] as const) {
    for (const executable of containerCliCandidates(engine)) {
      if (path.isAbsolute(executable) && !fs.existsSync(executable)) continue;
      const version = await runBoundedCommand(executable, ["--version"]);
      attempts.push({
        engine,
        executable: path.basename(executable),
        code: version.code,
        durationMs: version.durationMs,
        timedOut: version.timedOut,
        errorCode: version.errorCode,
        detail: boundedDetail(version.stderr || version.stdout),
      });
      if (version.code !== 0) continue;
      const compose = await runBoundedCommand(executable, ["compose", "version"]);
      attempts.push({
        engine,
        executable: path.basename(executable),
        capability: "compose",
        code: compose.code,
        durationMs: compose.durationMs,
        timedOut: compose.timedOut,
        errorCode: compose.errorCode,
        detail: boundedDetail(compose.stderr || compose.stdout),
      });
      if (compose.code === 0) {
        return {
          available: true,
          engine,
          executable,
          evidence: {
            checkedAt: new Date().toISOString(),
            timeoutMs: EXTERNAL_PROBE_TIMEOUT_MS,
            attemptLimit: MAX_CONTAINER_PROBE_ATTEMPTS,
            totalTimeoutMs: EXTERNAL_PROBE_TIMEOUT_MS * MAX_CONTAINER_PROBE_ATTEMPTS,
            probeDurationMs: Date.now() - startedAt,
            reasonCode: null,
            attempts,
          },
        };
      }
    }
  }
  const cliObserved = attempts.some(({ capability, code }) => capability !== "compose" && code === 0);
  return {
    available: false,
    engine: null,
    executable: null,
    evidence: {
      checkedAt: new Date().toISOString(),
      timeoutMs: EXTERNAL_PROBE_TIMEOUT_MS,
      attemptLimit: MAX_CONTAINER_PROBE_ATTEMPTS,
      totalTimeoutMs: EXTERNAL_PROBE_TIMEOUT_MS * MAX_CONTAINER_PROBE_ATTEMPTS,
      probeDurationMs: Date.now() - startedAt,
      reasonCode: cliObserved ? "CONTAINER_COMPOSE_UNAVAILABLE" : "CONTAINER_ENGINE_NOT_INSTALLED",
      attempts,
    },
  };
}

async function listComposeIdentities(
  executable: string,
  kind: "containers" | "volumes",
): Promise<string[]> {
  const args = kind === "containers"
    ? [
        "ps", "-a",
        "--filter", "label=com.docker.compose.project=breadboard-postiz",
        "--format", "{{.ID}}|{{.Names}}",
      ]
    : [
        "volume", "ls",
        "--filter", "label=com.docker.compose.project=breadboard-postiz",
        "--format", "{{.Name}}",
      ];
  const result = await runBoundedCommand(executable, args, 30_000);
  if (result.code !== 0) {
    throw new Error(
      `Container engine ${kind} identity probe failed: ${boundedDetail(result.stderr || result.stdout)}`,
    );
  }
  const values = unique(result.stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)).sort();
  if (values.length > 512) throw new Error(`Container engine returned too many ${kind} identities.`);
  return values;
}

function requiredIntegerEnvironment(name: string, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/u.test(raw)) throw new Error(`${name} must be explicitly configured.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Runtime V2 burn-in.`);
  return value;
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256File(file: string): string {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex").toUpperCase();
}

function serviceEvidenceSourceIdentity(value: unknown): value is ServiceEvidenceSourceIdentity {
  return recordValue(value) && [
    value["serviceManifestSha256"],
    value["executionInventorySha256"],
    value["runnerSha256"],
    value["contractSha256"],
  ].every((candidate) => typeof candidate === "string" && SHA256_PATTERN.test(candidate));
}

function serviceEvidenceArtifactIdentity(value: unknown): value is ServiceEvidenceArtifactIdentity {
  return (
    recordValue(value) &&
    typeof value["path"] === "string" &&
    path.isAbsolute(value["path"]) &&
    path.extname(value["path"]).toLowerCase() === ".exe" &&
    Number.isSafeInteger(value["bytes"]) &&
    (value["bytes"] as number) > 0 &&
    typeof value["sha256"] === "string" &&
    SHA256_PATTERN.test(value["sha256"])
  );
}

function requiredServiceEvidenceBinding(): ServiceEvidenceBinding {
  const raw = requiredEnvironment("BREADBOARD_RUNTIME_V2_SERVICE_EVIDENCE_BINDING");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `BREADBOARD_RUNTIME_V2_SERVICE_EVIDENCE_BINDING is malformed: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !recordValue(value) ||
    value["authority"] !== SERVICE_EVIDENCE_AUTHORITY ||
    typeof value["pointerPath"] !== "string" ||
    !path.isAbsolute(value["pointerPath"]) ||
    typeof value["pointerSha256"] !== "string" ||
    !SHA256_PATTERN.test(value["pointerSha256"]) ||
    typeof value["receiptPath"] !== "string" ||
    !path.isAbsolute(value["receiptPath"]) ||
    typeof value["receiptSha256"] !== "string" ||
    !SHA256_PATTERN.test(value["receiptSha256"]) ||
    typeof value["runId"] !== "string" ||
    value["runId"].length === 0 ||
    value["suite"] !== "burn" ||
    value["runtimeMode"] !== "packaged" ||
    value["outcome"] !== "PASS" ||
    typeof value["startedAt"] !== "string" ||
    typeof value["finishedAt"] !== "string" ||
    typeof value["validatedAt"] !== "string" ||
    value["maximumAgeMs"] !== SERVICE_EVIDENCE_MAX_AGE_MS ||
    value["serviceCount"] !== 32 ||
    value["gbrainIncluded"] !== true ||
    !serviceEvidenceArtifactIdentity(value["executable"]) ||
    !serviceEvidenceSourceIdentity(value["sourceIdentity"])
  ) {
    throw new Error("Runtime V2 burn-in service-evidence binding is malformed or incomplete.");
  }
  const startedAt = Date.parse(value["startedAt"]);
  const finishedAt = Date.parse(value["finishedAt"]);
  const validatedAt = Date.parse(value["validatedAt"]);
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finishedAt) ||
    !Number.isFinite(validatedAt) ||
    finishedAt < startedAt ||
    validatedAt < finishedAt ||
    validatedAt - finishedAt > SERVICE_EVIDENCE_MAX_AGE_MS ||
    validatedAt > Date.now() + SERVICE_EVIDENCE_FUTURE_TOLERANCE_MS
  ) {
    throw new Error("Runtime V2 burn-in service-evidence binding has invalid or stale time bounds.");
  }
  return value as unknown as ServiceEvidenceBinding;
}

function descendants(rootPids: ReadonlySet<number>, processes: readonly ProcessSample[]): Set<number> {
  const result = new Set(rootPids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const processInfo of processes) {
      if (!result.has(processInfo.pid) && result.has(processInfo.parentPid)) {
        result.add(processInfo.pid);
        changed = true;
      }
    }
  }
  return result;
}

function processPrivateMb(ids: ReadonlySet<number>, processes: readonly ProcessSample[]): number {
  return processes
    .filter((processInfo) => ids.has(processInfo.pid))
    .reduce((sum, processInfo) => sum + processInfo.privateBytes, 0) / MB;
}

function processPrivateMbByPid(pid: number, processes: readonly ProcessSample[]): number {
  return (processes.find((processInfo) => processInfo.pid === pid)?.privateBytes ?? 0) / MB;
}

function portOf(rawUrl: string): number {
  const url = new URL(rawUrl);
  const value = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Runtime endpoint has an invalid port: ${rawUrl}`);
  }
  return value;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function parsePayload(row: EventRow, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(row.payload_json);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} has a malformed Runtime V2 event payload.`);
  }
  return value as Record<string, unknown>;
}

function exactPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} is not a positive integer.`);
  }
  return value as number;
}

async function waitForCadence(deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, remaining);
    timer.unref?.();
  });
}

class WindowsSampler {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdout = "";
  private readonly pending: Array<{
    resolve(value: WindowsSample): void;
    reject(error: Error): void;
  }> = [];

  constructor(
    private readonly scriptPath: string,
    private readonly onSample: (sample: WindowsSample) => void,
  ) {}

  start(): void {
    if (process.platform !== "win32") {
      throw new Error("Runtime V2 burn-in requires Windows GetPerformanceInfo evidence.");
    }
    if (this.child) return;
    this.child = spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      this.scriptPath,
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.consume(chunk));
    this.child.stderr.resume();
    this.child.once("exit", () => {
      for (const pending of this.pending.splice(0)) {
        pending.reject(new Error("The Windows memory sampler exited."));
      }
      this.child = null;
    });
  }

  private consume(chunk: string): void {
    this.stdout += chunk;
    for (;;) {
      const newline = this.stdout.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      const pending = this.pending.shift();
      if (!pending) continue;
      try {
        const value = JSON.parse(line) as WindowsSample & { readonly error?: string };
        if (value.error) throw new Error(value.error);
        if (!Array.isArray(value.processes) || !Array.isArray(value.listeningPorts)) {
          throw new Error("The Windows sampler returned an incomplete measurement.");
        }
        this.onSample(value);
        pending.resolve(value);
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error("Invalid sampler response."));
      }
    }
  }

  sample(): Promise<WindowsSample> {
    this.start();
    return new Promise((resolve, reject) => {
      const pending = {
        resolve: (value: WindowsSample) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      const timeout = setTimeout(() => {
        const index = this.pending.indexOf(pending);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new Error("The Windows memory sampler timed out."));
      }, 20_000);
      this.pending.push(pending);
      this.child!.stdin.write("sample-with-listeners\n");
    });
  }

  stop(): void {
    this.child?.stdin.end();
    this.child = null;
  }
}

class RuntimeStoreReader {
  private readonly database: SqliteDatabase;

  constructor(repoRoot: string, databasePath: string) {
    if (!fs.statSync(databasePath).isFile()) {
      throw new Error(`Runtime V2 durable store is missing: ${databasePath}`);
    }
    const require = createRequire(path.join(repoRoot, "dashboard", "package.json"));
    const Database = require("better-sqlite3") as SqliteConstructor;
    this.database = new Database(databasePath, { readonly: true, fileMustExist: true });
    this.database.pragma("query_only = ON");
    this.database.pragma("busy_timeout = 5000");
  }

  jobIds(): string[] {
    return (this.database.prepare(
      "SELECT job_id FROM runtime_jobs ORDER BY created_at, job_id",
    ).all() as Array<{ readonly job_id: string }>).map(({ job_id }) => job_id);
  }

  jobsAfter(knownIds: ReadonlySet<string>, jobType: string): JobRow[] {
    return (this.database.prepare(`
      SELECT job_id, job_type, worker_kind, state, attempt, worker_instance_id,
             created_at, started_at, finished_at, failure_code, cancellation_requested
      FROM runtime_jobs
      WHERE job_type = ?
      ORDER BY created_at, job_id
    `).all(jobType) as JobRow[]).filter(({ job_id }) => !knownIds.has(job_id));
  }

  job(jobId: string): JobRow {
    const value = this.database.prepare(`
      SELECT job_id, job_type, worker_kind, state, attempt, worker_instance_id,
             created_at, started_at, finished_at, failure_code, cancellation_requested
      FROM runtime_jobs WHERE job_id = ?
    `).get(jobId) as JobRow | undefined;
    if (!value) throw new Error(`Runtime V2 job disappeared: ${jobId}`);
    return value;
  }

  events(jobId: string): EventRow[] {
    return this.database.prepare(`
      SELECT event_type, payload_json, attempt, worker_instance_id, created_at
      FROM runtime_job_events WHERE job_id = ? ORDER BY sequence
    `).all(jobId) as EventRow[];
  }

  exhaustion(jobId: string): ExhaustionRow | null {
    return (this.database.prepare(`
      SELECT resource, required_headroom_mb, available_headroom_mb
      FROM runtime_job_resource_exhaustion WHERE job_id = ?
    `).get(jobId) as ExhaustionRow | undefined) ?? null;
  }

  service(serviceId: string): ServiceRow {
    const value = this.database.prepare(`
      SELECT service_id, lifecycle_state, generation, idle_ttl_ms, idle_due_at
      FROM runtime_services WHERE service_id = ?
    `).get(serviceId) as ServiceRow | undefined;
    if (!value) throw new Error(`Runtime V2 service is missing: ${serviceId}`);
    return value;
  }

  close(): void {
    this.database.close();
  }
}

export class RuntimeV2BurnInRecorder {
  readonly sequential: Record<BurnInOperationKind, BurnInOperationReceipt[]> = {
    learn: [],
    ingestion: [],
    artifact: [],
  };
  readonly mixedCycles: MixedCycleReceipt[] = [];
  readonly browserAgentRuns: Record<string, unknown>[] = [];
  readonly postizRuns: Record<string, unknown>[] = [];

  private readonly settleWindowMs = requiredIntegerEnvironment(
    "BREADBOARD_RUNTIME_V2_BURN_IN_SETTLE_WINDOW_MS",
    1_000,
    30 * 60_000,
  );
  private readonly sampleIntervalMs = requiredIntegerEnvironment(
    "BREADBOARD_RUNTIME_V2_BURN_IN_SAMPLE_INTERVAL_MS",
    1_000,
    300_000,
  );
  private readonly requiredDurationMs = requiredIntegerEnvironment(
    "BREADBOARD_RUNTIME_V2_BURN_IN_DURATION_MS",
    REQUIRED_DURATION_MS,
    REQUIRED_DURATION_MS,
  );
  private readonly receiptPath = path.resolve(
    requiredEnvironment("BREADBOARD_RUNTIME_V2_BURN_IN_RECEIPT_PATH"),
  );
  private readonly serviceEvidence = requiredServiceEvidenceBinding();
  private readonly sampler: WindowsSampler;
  private readonly store: RuntimeStoreReader;
  private readonly mandatoryServiceIds: readonly string[];
  private readonly eagerRequiredServiceIds: readonly string[];
  private readonly observedServiceIds: readonly string[];
  private readonly startedAtMs = Date.now();
  private readonly startedAt = new Date(this.startedAtMs).toISOString();
  private readonly knownOwnedPids = new Set<number>();
  private readonly observedServicePids = new Map<string, Set<number>>();
  private readonly duplicateServiceIdsObserved = new Set<string>();
  private serviceUrls: Readonly<Record<string, string>> = {};
  private monitoredSampleCount = 0;
  private firstSampleAt: number | null = null;
  private previousSampleAt: number | null = null;
  private maximumSampleGapMs = 0;
  private minimumMonitoredFreeCommitMb = Number.POSITIVE_INFINITY;
  private peakMonitoredCommitTotalMb = 0;
  private initialSample: WindowsSample | null = null;
  private stackEvidence: Record<string, unknown> | null = null;
  private gbrainBackend: "gbrain" | null = null;
  private admissionDenial: Record<string, unknown> | null = null;
  private cancellation: Record<string, unknown> | null = null;
  private restart: Record<string, unknown> | null = null;
  private idleStop: Record<string, unknown> | null = null;
  private postMixedSample: Record<string, unknown> | null = null;
  private endurance: Record<string, unknown> | null = null;
  private quit: Record<string, unknown> | null = null;

  constructor(private readonly qa: ElectronQaHarness) {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(qa.run.paths.repoRoot, "desktop", "runtime-v2", "manifests", "services.json"),
      "utf8",
    )) as { readonly services?: readonly RuntimeServiceManifestEntry[] };
    if (!Array.isArray(manifest.services)) throw new Error("Runtime V2 service manifest is invalid.");
    this.mandatoryServiceIds = sortedManifestServiceIds(
      manifest.services,
      ({ requirement }) => requirement === "required",
      "mandatory",
    );
    this.eagerRequiredServiceIds = sortedManifestServiceIds(
      manifest.services,
      ({ requirement, startupPolicy }) => requirement === "required" && startupPolicy === "eager",
      "eager required",
    );
    this.observedServiceIds = [...BURN_OBSERVED_SERVICE_IDS].sort();
    for (const serviceId of this.observedServiceIds) {
      if (!this.mandatoryServiceIds.includes(serviceId)) {
        throw new Error(`Burn-in observed service ${serviceId} is not mandatory.`);
      }
    }
    if (!this.mandatoryServiceIds.includes("gbrain")) {
      throw new Error("Runtime V2 mandatory service manifest omits GBrain.");
    }
    this.assertServiceEvidenceBindingFiles(true);
    this.sampler = new WindowsSampler(
      path.join(qa.run.paths.repoRoot, "qa", "memory", "windows-sampler.ps1"),
      (sample) => this.recordSample(sample),
    );
    this.store = new RuntimeStoreReader(
      qa.run.paths.repoRoot,
      path.join(qa.run.paths.dataDir, "runtime-v2", "runtime-v2.sqlite3"),
    );
  }

  private assertServiceEvidenceBindingFiles(requireFreshness: boolean): void {
    const binding = this.serviceEvidence;
    const repoRoot = this.qa.run.paths.repoRoot;
    const expectedPointerPath = path.join(
      repoRoot,
      ".qa-results",
      "runtime-v2-services",
      "latest-success.json",
    );
    const expectedReceiptPath = path.join(
      repoRoot,
      ".qa-results",
      "runtime-v2-services",
      binding.runId,
      "receipt.json",
    );
    const samePath = (left: string, right: string): boolean => {
      const resolvedLeft = path.resolve(left);
      const resolvedRight = path.resolve(right);
      return process.platform === "win32"
        ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
        : resolvedLeft === resolvedRight;
    };
    if (
      !samePath(binding.pointerPath, expectedPointerPath) ||
      !samePath(binding.receiptPath, expectedReceiptPath)
    ) {
      throw new Error("Runtime V2 burn-in service evidence escaped its canonical result paths.");
    }
    for (const [file, expectedHash, label] of [
      [binding.pointerPath, binding.pointerSha256, "canonical pointer"],
      [binding.receiptPath, binding.receiptSha256, "packaged receipt"],
      [binding.executable.path, binding.executable.sha256, "packaged executable"],
    ] as const) {
      if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile() || sha256File(file) !== expectedHash) {
        throw new Error(`Runtime V2 burn-in ${label} identity changed after validation.`);
      }
    }
    if (fs.statSync(binding.executable.path).size !== binding.executable.bytes) {
      throw new Error("Runtime V2 burn-in packaged executable size changed after validation.");
    }
    const currentSourceIdentity: ServiceEvidenceSourceIdentity = {
      serviceManifestSha256: sha256File(path.join(
        repoRoot,
        "desktop",
        "runtime-v2",
        "manifests",
        "services.json",
      )),
      executionInventorySha256: sha256File(path.join(
        repoRoot,
        "qa",
        "runtime-v2",
        "execution-inventory.json",
      )),
      runnerSha256: sha256File(path.join(repoRoot, "qa", "memory", "run-service-evidence.mjs")),
      contractSha256: sha256File(path.join(repoRoot, "qa", "memory", "service-evidence-contract.mjs")),
    };
    if (JSON.stringify(currentSourceIdentity) !== JSON.stringify(binding.sourceIdentity)) {
      throw new Error("Runtime V2 burn-in packaged service evidence is not from the current runner sources.");
    }
    const pointer = JSON.parse(fs.readFileSync(binding.pointerPath, "utf8")) as Record<string, unknown>;
    if (
      pointer["receiptPath"] !== binding.receiptPath ||
      pointer["receiptSha256"] !== binding.receiptSha256 ||
      pointer["runId"] !== binding.runId ||
      pointer["finishedAt"] !== binding.finishedAt ||
      JSON.stringify(pointer["executable"]) !== JSON.stringify(binding.executable) ||
      JSON.stringify(pointer["sourceIdentity"]) !== JSON.stringify(binding.sourceIdentity)
    ) {
      throw new Error("Runtime V2 burn-in canonical pointer drifted from its validated binding.");
    }
    const receipt = JSON.parse(fs.readFileSync(binding.receiptPath, "utf8")) as Record<string, unknown>;
    const services = Array.isArray(receipt["services"])
      ? receipt["services"].filter(recordValue)
      : [];
    const serviceIds = services.map((service) => service["serviceId"]);
    if (
      receipt["runId"] !== binding.runId ||
      receipt["runtimeMode"] !== "packaged" ||
      receipt["suite"] !== "burn" ||
      receipt["outcome"] !== "PASS" ||
      receipt["startedAt"] !== binding.startedAt ||
      receipt["finishedAt"] !== binding.finishedAt ||
      JSON.stringify(receipt["mandatoryServiceIds"]) !== JSON.stringify(this.mandatoryServiceIds) ||
      JSON.stringify(receipt["executable"]) !== JSON.stringify(binding.executable) ||
      JSON.stringify(receipt["sourceIdentity"]) !== JSON.stringify(binding.sourceIdentity) ||
      services.length !== this.mandatoryServiceIds.length ||
      new Set(serviceIds).size !== this.mandatoryServiceIds.length ||
      this.mandatoryServiceIds.some((serviceId) => !serviceIds.includes(serviceId)) ||
      !serviceIds.includes("gbrain") ||
      services.some((service) => {
        const gates = Array.isArray(service["gates"])
          ? service["gates"].filter(recordValue)
          : [];
        return (
          gates.length !== SERVICE_EVIDENCE_GATES.length ||
          gates.some((gate, index) =>
            gate["gate"] !== SERVICE_EVIDENCE_GATES[index] || gate["status"] !== "pass")
        );
      })
    ) {
      throw new Error("Runtime V2 burn-in packaged service receipt lost all-32-service/GBrain PASS coverage.");
    }
    if (requireFreshness) {
      const finishedAt = Date.parse(binding.finishedAt);
      const validatedAt = Date.parse(binding.validatedAt);
      if (
        this.startedAtMs - finishedAt > binding.maximumAgeMs ||
        this.startedAtMs - validatedAt > SERVICE_EVIDENCE_BINDING_LAUNCH_WINDOW_MS ||
        validatedAt > this.startedAtMs + SERVICE_EVIDENCE_FUTURE_TOLERANCE_MS
      ) {
        throw new Error("Runtime V2 burn-in packaged service evidence is stale at recorder start.");
      }
    }
  }

  async initialize(): Promise<void> {
    const endpoints = this.qa.readEndpoints();
    this.serviceUrls = { ...endpoints.urls };
    this.sampler.start();
    this.initialSample = await this.sampler.sample();
    this.assertFreeCommit(this.initialSample, "initial burn-in sample");
    await this.qa.mainProcessPid();
    await this.qa.rendererProcessPid();
    if (!Number.isSafeInteger(endpoints.pid) || endpoints.pid < 1) {
      throw new Error("Runtime endpoint receipt has no valid Runtime PID.");
    }
    const runtimeProcess = this.initialSample.processes.find(({ pid }) => pid === endpoints.pid);
    if (!runtimeProcess || !/^breadboard-runtime(?:\.exe)?$/iu.test(runtimeProcess.name)) {
      throw new Error("Runtime endpoint PID is not the native breadboard-runtime process.");
    }
    if (process.env["BREADBOARD_QA_DASHBOARD_MODE"] !== "standalone") {
      throw new Error("Runtime V2 burn-in requires the standalone/lean dashboard mode.");
    }
    for (const serviceId of this.eagerRequiredServiceIds) {
      if (this.endpointOwners(this.initialSample, serviceId).length !== 1) {
        throw new Error(`Eager required service ${serviceId} has no exact listener owner.`);
      }
    }
    this.stackEvidence = {
      classification: "PASS",
      electron: true,
      runtimeLaunchMode: "lean",
      dashboardMode: "standalone",
      runtimeOwner: "rust-runtime-v2",
      runtimePid: endpoints.pid,
      runtimeProcessName: "breadboard-runtime",
    };
  }

  private recordSample(sample: WindowsSample): void {
    if (
      !Number.isSafeInteger(sample.sampledAt) ||
      sample.sampledAt < 1 ||
      !Number.isFinite(sample.commitTotalMb) ||
      sample.commitTotalMb < 0 ||
      !Number.isFinite(sample.commitLimitMb) ||
      sample.commitLimitMb <= 0
    ) {
      throw new Error("Continuous burn-in monitoring received a malformed Windows sample.");
    }
    if (this.previousSampleAt !== null && sample.sampledAt < this.previousSampleAt) {
      throw new Error("Continuous burn-in monitoring timestamps moved backwards.");
    }
    const freeCommitMb = sample.commitLimitMb - sample.commitTotalMb;
    if (freeCommitMb <= FREE_COMMIT_FLOOR_MB) {
      throw new Error(
        `Continuous burn-in monitoring reached ${Math.round(freeCommitMb)} MB free commit; required > 8192 MB.`,
      );
    }
    const duplicateServiceIds = this.duplicateServiceIds(sample);
    for (const serviceId of duplicateServiceIds) this.duplicateServiceIdsObserved.add(serviceId);
    if (duplicateServiceIds.length !== 0) {
      throw new Error(`Continuous burn-in monitoring observed duplicate services: ${duplicateServiceIds.join(", ")}.`);
    }
    for (const serviceId of Object.keys(this.serviceUrls)) {
      const owners = this.endpointOwners(sample, serviceId);
      if (owners.length === 0) continue;
      const observed = this.observedServicePids.get(serviceId) ?? new Set<number>();
      for (const pid of owners) observed.add(pid);
      this.observedServicePids.set(serviceId, observed);
    }
    if (this.previousSampleAt !== null) {
      this.maximumSampleGapMs = Math.max(this.maximumSampleGapMs, sample.sampledAt - this.previousSampleAt);
    }
    this.firstSampleAt ??= sample.sampledAt;
    this.previousSampleAt = sample.sampledAt;
    this.monitoredSampleCount += 1;
    this.minimumMonitoredFreeCommitMb = Math.min(this.minimumMonitoredFreeCommitMb, freeCommitMb);
    this.peakMonitoredCommitTotalMb = Math.max(this.peakMonitoredCommitTotalMb, sample.commitTotalMb);
  }

  jobIds(): string[] {
    return this.store.jobIds();
  }

  async prepareOperation(kind: BurnInOperationKind, action: () => Promise<void>): Promise<JobRow> {
    const known = new Set(this.store.jobIds());
    const samples: WindowsSample[] = [];
    let collecting = true;
    const collection = this.collectSamples(samples, () => collecting);
    try {
      await action();
      return await this.waitForNewTerminalJob(kind, known, true);
    } finally {
      collecting = false;
      await collection;
    }
  }

  async measureSequential(
    kind: BurnInOperationKind,
    ordinal: number,
    action: () => Promise<void>,
  ): Promise<BurnInOperationReceipt> {
    if (ordinal !== this.sequential[kind].length + 1 || ordinal > 10) {
      throw new Error(`${kind} sequential operation ${ordinal} is out of order.`);
    }
    const receipt = await this.measureFiniteOperation(kind, "sequential", ordinal, action);
    this.sequential[kind].push(receipt);
    return receipt;
  }

  async measureMixedCycle(
    cycle: number,
    actions: MixedCycleActions,
  ): Promise<MixedCycleReceipt> {
    if (cycle !== this.mixedCycles.length + 1 || cycle > 5) {
      throw new Error(`Mixed cycle ${cycle} is out of order.`);
    }
    await this.measureSurfaceAction(`mixed cycle ${cycle} Garden Chat retrieval`, actions.gardenChatRetrieval);
    const operations = {
      learn: await this.measureFiniteOperation("learn", `mixed-${cycle}`, cycle, actions.learn),
      ingestion: await this.measureFiniteOperation("ingestion", `mixed-${cycle}`, cycle, actions.ingestion),
      artifact: await this.measureFiniteOperation("artifact", `mixed-${cycle}`, cycle, actions.artifact),
    };
    const browserAgent = await actions.browserAgent();
    await this.measureSurfaceAction(`mixed cycle ${cycle} Quartz build`, actions.quartzBuild);
    const postiz = await actions.postiz();
    if (browserAgent.cycle !== cycle || postiz.cycle !== cycle) {
      throw new Error(`Mixed cycle ${cycle} conditional lifecycle evidence is mis-correlated.`);
    }
    const conditionalEvidence = {
      browserAgent: browserAgent.classification,
      postiz: postiz.classification,
    };
    const settled = await this.sampler.sample();
    this.assertFreeCommit(settled, `mixed cycle ${cycle} settled sample`);
    const owned = await this.ownedMeasurement(settled);
    const duplicateServiceIds = this.duplicateServiceIds(settled);
    const receipt: MixedCycleReceipt = {
      cycle,
      classification: Object.values(conditionalEvidence).every((value) => value === "PASS")
        ? "PASS"
        : "BLOCKED",
      surfaceEvidence: {
        gardenChat: true,
        retrieval: true,
        quartzBuild: true,
        actualElectronUi: true,
      },
      conditionalEvidence,
      operations,
      minimumFreeCommitMb: settled.commitLimitMb - settled.commitTotalMb,
      settledCommitMb: settled.commitTotalMb,
      settledOwnedPrivateMb: owned.privateMb,
      settledOwnedProcessCount: owned.ids.size,
      serviceIds: Object.keys(this.serviceUrls)
        .filter((serviceId) => this.endpointOwners(settled, serviceId).length > 0)
        .sort(),
      orphanCount: this.orphanCount(settled),
      duplicateServiceIds,
    };
    if (receipt.orphanCount !== 0 || duplicateServiceIds.length !== 0) {
      throw new Error(`Mixed cycle ${cycle} did not settle without orphans and duplicate services.`);
    }
    this.mixedCycles.push(receipt);
    return receipt;
  }

  private async measureSurfaceAction(label: string, action: () => Promise<void>): Promise<void> {
    const samples: WindowsSample[] = [];
    let collecting = true;
    const collection = this.collectSamples(samples, () => collecting);
    try {
      await action();
    } finally {
      collecting = false;
      await collection;
    }
    const settled = await this.sampler.sample();
    this.assertFreeCommit(settled, `${label} settled sample`);
    this.assertNoDuplicateServices(settled, `${label} settled sample`);
    if (this.orphanCount(settled) !== 0) throw new Error(`${label} left owned worker descendants alive.`);
  }

  private async measureFiniteOperation(
    kind: BurnInOperationKind,
    phase: string,
    ordinal: number,
    action: () => Promise<void>,
  ): Promise<BurnInOperationReceipt> {
    const definition = DEFINITIONS[kind];
    const knownJobs = new Set(this.store.jobIds());
    const samples: WindowsSample[] = [];
    let collecting = true;
    const collection = this.collectSamples(samples, () => collecting);
    let job: JobRow;
    try {
      await action();
      job = await this.waitForNewTerminalJob(kind, knownJobs, true);
      await waitForCadence(Date.now() + this.settleWindowMs);
    } finally {
      collecting = false;
      await collection;
    }
    // The cadence sampler may have taken its last sample before the terminal
    // boundary. Always take a dedicated sample after the configured settle
    // window so the receipt's baseline is genuinely settled.
    const settledSample = await this.sampler.sample();
    this.assertFreeCommit(settledSample, `${phase} ${kind} settled sample`);
    this.assertNoDuplicateServices(settledSample, `${phase} ${kind} settled sample`);
    samples.push(settledSample);
    const finalSample = samples.at(-1)!;
    const completion = this.completionEvidence(job);
    const rootPid = completion.rootPid;
    const descendantPids = this.observedDescendants(rootPid, samples);
    const knownTree = new Set([rootPid, ...descendantPids]);
    for (const pid of knownTree) this.knownOwnedPids.add(pid);
    const survivingDescendantPids = finalSample.processes
      .filter(({ pid }) => knownTree.has(pid))
      .map(({ pid }) => pid);
    const rendererPid = await this.qa.rendererProcessPid();
    const dashboardPids = samples.flatMap((sample) => this.endpointOwners(sample, "dashboard"));
    if (dashboardPids.length === 0) throw new Error(`${phase} ${kind} did not measure dashboard ownership.`);
    const serviceIds = unique(samples.flatMap((sample) => this.activeServiceIds(sample))).sort();
    const duplicateServiceIds = unique(samples.flatMap((sample) => this.duplicateServiceIds(sample))).sort();
    const owned = await this.ownedMeasurement(finalSample);
    const minimumFreeCommitMb = Math.min(...samples.map((sample) => sample.commitLimitMb - sample.commitTotalMb));
    if (minimumFreeCommitMb <= FREE_COMMIT_FLOOR_MB) {
      throw new Error(`${phase} ${kind} crossed the 8192 MB free-commit floor.`);
    }
    if (survivingDescendantPids.length !== 0 || duplicateServiceIds.length !== 0) {
      throw new Error(`${phase} ${kind} left worker descendants or duplicate services.`);
    }
    const receipt: BurnInOperationReceipt = {
      operationId: `${phase}-${kind}-${ordinal}`,
      phase,
      kind,
      ordinal,
      jobType: definition.jobType,
      workerKind: definition.workerKind,
      capabilityId: definition.capabilityId,
      jobId: job.job_id,
      rootWorkerPid: rootPid,
      workerInstanceId: job.worker_instance_id,
      descendantPids,
      survivingDescendantPids,
      treeExited: true,
      peakPrivateMb: {
        worker: completion.peakPrivateMb,
        dashboard: Math.max(...samples.map((sample) => {
          const roots = new Set(this.endpointOwners(sample, "dashboard"));
          return processPrivateMb(descendants(roots, sample.processes), sample.processes);
        })),
        renderer: Math.max(...samples.map((sample) => processPrivateMbByPid(rendererPid, sample.processes))),
        services: Math.max(...samples.map((sample) => this.servicePrivateMb(sample))),
      },
      minimumFreeCommitMb,
      settledCommitMb: finalSample.commitTotalMb,
      settledOwnedPrivateMb: owned.privateMb,
      settledOwnedProcessCount: owned.ids.size,
      orphanCount: survivingDescendantPids.length,
      classification: "PASS",
      exitLatencyMs: completion.exitLatencyMs,
      idleStopLatencyMs: null,
      serviceIds,
      duplicateServiceIds,
      evidence: {
        electron: true,
        windowsSampler: "GetPerformanceInfo",
        runtimeStore: "runtime-v2-sqlite",
      },
    };
    return receipt;
  }

  private async collectSamples(
    target: WindowsSample[],
    keepGoing: () => boolean,
  ): Promise<void> {
    do {
      const started = Date.now();
      const sample = await this.sampler.sample();
      this.assertFreeCommit(sample, "ordinary operation sample");
      this.assertNoDuplicateServices(sample, "ordinary operation sample");
      target.push(sample);
      if (!keepGoing()) return;
      await waitForCadence(started + this.sampleIntervalMs);
    } while (keepGoing());
  }

  private async waitForNewTerminalJob(
    kind: BurnInOperationKind,
    knownIds: ReadonlySet<string>,
    requireSuccess: boolean,
  ): Promise<JobRow> {
    const definition = DEFINITIONS[kind];
    const deadline = Date.now() + definition.maximumRuntimeMs;
    for (;;) {
      const jobs = this.store.jobsAfter(knownIds, definition.jobType);
      if (jobs.length > 1) {
        throw new Error(`${kind} action created ${jobs.length} jobs; exact one-job correlation is required.`);
      }
      const job = jobs[0];
      if (job && TERMINAL_STATES.has(job.state)) {
        if (requireSuccess && job.state !== "succeeded") {
          throw new Error(`${kind} job ${job.job_id} ended ${job.state}: ${job.failure_code ?? "no failure code"}`);
        }
        if (requireSuccess && (!job.worker_instance_id || job.attempt < 1)) {
          throw new Error(`${kind} job ${job.job_id} has no finite worker instance.`);
        }
        return job;
      }
      if (Date.now() >= deadline) throw new Error(`${kind} job did not settle before its manifest runtime bound.`);
      await waitForCadence(Math.min(deadline, Date.now() + this.sampleIntervalMs));
    }
  }

  private async waitForNewActiveJob(
    jobType: string,
    workerKind: string,
    knownIds: ReadonlySet<string>,
    deadline: number,
  ): Promise<JobRow> {
    for (;;) {
      const jobs = this.store.jobsAfter(knownIds, jobType);
      if (jobs.length > 1) {
        throw new Error(`${jobType} action created ${jobs.length} jobs; exact one-job correlation is required.`);
      }
      const job = jobs[0];
      if (job) {
        if (job.worker_kind !== workerKind) {
          throw new Error(`${jobType} used ${job.worker_kind}, expected ${workerKind}.`);
        }
        if (TERMINAL_STATES.has(job.state)) {
          throw new Error(`${jobType} reached ${job.state} before cancellation evidence could be collected.`);
        }
        if (job.worker_instance_id && job.attempt > 0) return job;
      }
      if (Date.now() >= deadline) throw new Error(`${jobType} did not start before its bounded deadline.`);
      await waitForCadence(Math.min(deadline, Date.now() + this.sampleIntervalMs));
    }
  }

  private completionEvidence(job: JobRow): {
    rootPid: number;
    peakPrivateMb: number;
    exitLatencyMs: number;
  } {
    const treeExit = this.treeExitEvidence(job);
    const events = this.store.events(job.job_id);
    const exactAttempt = (event: EventRow) =>
      event.attempt === job.attempt && event.worker_instance_id === job.worker_instance_id;
    const complete = events.find((event) => event.event_type === "complete" && exactAttempt(event));
    if (!complete) throw new Error(`Job ${job.job_id} lacks its worker complete event.`);
    return {
      rootPid: treeExit.rootPid,
      peakPrivateMb: treeExit.peakPrivateMb,
      exitLatencyMs: Math.max(0, treeExit.confirmedAt - complete.created_at),
    };
  }

  private treeExitEvidence(job: JobRow): {
    rootPid: number;
    peakPrivateMb: number;
    confirmedAt: number;
  } {
    const confirmed = this.store.events(job.job_id).find((event) =>
      event.event_type === "completion-confirmed" &&
      event.attempt === job.attempt &&
      event.worker_instance_id === job.worker_instance_id);
    if (!confirmed) throw new Error(`Job ${job.job_id} lacks its authoritative tree-exit event.`);
    const payload = parsePayload(confirmed, `Job ${job.job_id}`);
    if (payload.treeExited !== true || payload.peakAccountingComplete !== true) {
      throw new Error(`Job ${job.job_id} lacks complete authoritative tree accounting.`);
    }
    const rootPid = exactPositiveInteger(payload.rootPid, `Job ${job.job_id} rootPid`);
    const peakBytes = exactPositiveInteger(
      payload.peakPrivateCommitBytes,
      `Job ${job.job_id} peakPrivateCommitBytes`,
    );
    return {
      rootPid,
      peakPrivateMb: peakBytes / MB,
      confirmedAt: confirmed.created_at,
    };
  }

  private observedDescendants(rootPid: number, samples: readonly WindowsSample[]): number[] {
    const observed = new Set<number>();
    for (const sample of samples) {
      for (const pid of descendants(new Set([rootPid]), sample.processes)) observed.add(pid);
    }
    observed.delete(rootPid);
    return [...observed].sort((left, right) => left - right);
  }

  private endpointOwners(sample: WindowsSample, serviceId: string): number[] {
    const url = this.serviceUrls[serviceId];
    if (!url) return [];
    const port = portOf(url);
    return unique(sample.listeningPorts.filter((listener) => listener.port === port).map(({ ownerPid }) => ownerPid));
  }

  private activeServiceIds(sample: WindowsSample): string[] {
    return Object.keys(this.qa.readEndpoints().urls).filter((serviceId) =>
      serviceId !== "dashboard" &&
      serviceId !== "quartz" &&
      this.endpointOwners(sample, serviceId).length > 0);
  }

  private duplicateServiceIds(sample: WindowsSample): string[] {
    return Object.keys(this.qa.readEndpoints().urls).filter((serviceId) =>
      new Set(this.endpointOwners(sample, serviceId)).size > 1);
  }

  private servicePrivateMb(sample: WindowsSample): number {
    const roots = new Set(this.activeServiceIds(sample).flatMap((serviceId) => this.endpointOwners(sample, serviceId)));
    return processPrivateMb(descendants(roots, sample.processes), sample.processes);
  }

  private async ownedMeasurement(sample: WindowsSample): Promise<{ ids: Set<number>; privateMb: number }> {
    const roots = new Set([await this.qa.mainProcessPid(), this.qa.readEndpoints().pid]);
    const ids = descendants(roots, sample.processes);
    return { ids, privateMb: processPrivateMb(ids, sample.processes) };
  }

  private orphanCount(sample: WindowsSample): number {
    const live = new Set(sample.processes.map(({ pid }) => pid));
    return [...this.knownOwnedPids].filter((pid) => live.has(pid)).length;
  }

  private assertFreeCommit(sample: WindowsSample, label: string): void {
    const free = sample.commitLimitMb - sample.commitTotalMb;
    if (free <= FREE_COMMIT_FLOOR_MB) {
      throw new Error(`${label} reached ${Math.round(free)} MB free commit; required > 8192 MB.`);
    }
  }

  private assertNoDuplicateServices(sample: WindowsSample, label: string): void {
    const duplicateServiceIds = this.duplicateServiceIds(sample);
    if (duplicateServiceIds.length !== 0) {
      throw new Error(`${label} observed duplicate services: ${duplicateServiceIds.join(", ")}.`);
    }
  }

  private minimumFreeCommitMb(samples: readonly WindowsSample[]): number {
    if (samples.length === 0) throw new Error("No Windows samples were recorded.");
    return Math.min(...samples.map((sample) => sample.commitLimitMb - sample.commitTotalMb));
  }

  async measureCancellation(
    startAction: () => Promise<void>,
    cancelAction: () => Promise<void>,
  ): Promise<void> {
    const knownJobs = new Set(this.store.jobIds());
    const baseline = await this.sampler.sample();
    this.assertFreeCommit(baseline, "cancellation baseline sample");
    this.assertNoDuplicateServices(baseline, "cancellation baseline sample");
    const baselinePids = new Set(baseline.processes.map(({ pid }) => pid));
    const samples: WindowsSample[] = [baseline];
    let collecting = true;
    const collection = this.collectSamples(samples, () => collecting);
    let active: JobRow | null = null;
    try {
      await startAction();
      const deadline = Date.now() + DEFINITIONS.learn.maximumRuntimeMs;
      while (Date.now() < deadline) {
        const jobs = this.store.jobsAfter(knownJobs, DEFINITIONS.learn.jobType);
        if (jobs.length > 1) throw new Error("Cancellation action created more than one Learn job.");
        const candidate = jobs[0];
        if (
          candidate?.worker_instance_id &&
          ["starting", "running", "checkpointing"].includes(candidate.state)
        ) {
          active = candidate;
          break;
        }
        if (candidate && TERMINAL_STATES.has(candidate.state)) {
          throw new Error("The cancellation target became terminal before cancellation was requested.");
        }
        await waitForCadence(Date.now() + this.sampleIntervalMs);
      }
      if (!active) throw new Error("Cancellation did not observe an assigned live Learn worker.");
      const requestedAt = Date.now();
      await cancelAction();
      const terminal = await this.waitForSpecificTerminal(active.job_id, "cancelled", deadline);
      await waitForCadence(Date.now() + this.settleWindowMs);
      const finalSample = await this.sampler.sample();
      this.assertFreeCommit(finalSample, "cancellation settled sample");
      this.assertNoDuplicateServices(finalSample, "cancellation settled sample");
      samples.push(finalSample);
      const newNodePids = unique(samples.flatMap((sample) => sample.processes
        .filter((processInfo) =>
          !baselinePids.has(processInfo.pid) && /^node(?:\.exe)?$/iu.test(processInfo.name))
        .map(({ pid }) => pid)));
      if (newNodePids.length === 0) {
        throw new Error("Cancellation sampling did not capture the assigned Learn worker PID.");
      }
      const newNodePidSet = new Set(newNodePids);
      const observedParents = new Map<number, number>();
      for (const sample of samples) {
        for (const processInfo of sample.processes) {
          if (newNodePidSet.has(processInfo.pid) && !observedParents.has(processInfo.pid)) {
            observedParents.set(processInfo.pid, processInfo.parentPid);
          }
        }
      }
      const rootCandidates = newNodePids.filter((pid) => {
        const parentPid = observedParents.get(pid);
        return parentPid !== undefined && !newNodePidSet.has(parentPid);
      });
      if (rootCandidates.length !== 1) {
        throw new Error(
          `Cancellation could not identify one exact Learn process-tree root; observed ${rootCandidates.length}.`,
        );
      }
      const rootWorkerPid = rootCandidates[0]!;
      const descendantPids = this.observedDescendants(rootWorkerPid, samples);
      const tree = new Set([rootWorkerPid, ...descendantPids]);
      const survivingDescendantPids = finalSample.processes.filter(({ pid }) => tree.has(pid)).map(({ pid }) => pid);
      if (survivingDescendantPids.length !== 0) {
        throw new Error("Cancellation left the observed Learn process tree alive.");
      }
      for (const pid of tree) this.knownOwnedPids.add(pid);
      const cancelledEvent = this.store.events(terminal.job_id).find((event) =>
        event.event_type === "cancelled" &&
        event.attempt === terminal.attempt &&
        event.worker_instance_id === terminal.worker_instance_id);
      if (!cancelledEvent) throw new Error("Cancelled Learn job lacks its durable cancelled event.");
      this.cancellation = {
        classification: "PASS",
        jobId: terminal.job_id,
        workerInstanceId: terminal.worker_instance_id,
        rootWorkerPid,
        descendantPids,
        survivingDescendantPids,
        terminalState: "cancelled",
        treeExited: true,
        orphanCount: 0,
        reclaimLatencyMs: Math.max(0, finalSample.sampledAt - requestedAt),
        minimumFreeCommitMb: this.minimumFreeCommitMb(samples),
      };
    } finally {
      collecting = false;
      await collection;
    }
  }

  async measureBrowserAgent(
    cycle: number,
    availability: BrowserAgentAvailabilityProbe,
    startAction: () => Promise<void>,
    cancelAction: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    if (cycle !== this.browserAgentRuns.length + 1 || cycle > 5) {
      throw new Error(`Agent Browser mixed-cycle run ${cycle} is out of order.`);
    }
    if (
      !Number.isSafeInteger(availability.httpStatus) ||
      availability.probeLatencyMs < 0 ||
      availability.probeLatencyMs > 30_000 ||
      !Number.isFinite(Date.parse(availability.checkedAt))
    ) {
      throw new Error("Agent Browser availability probe is incomplete or unbounded.");
    }
    const reasonCode = availability.httpStatus !== 200
      ? "AVAILABILITY_PROBE_FAILED"
      : !availability.runtimeAvailable
        ? availability.reason?.includes("not installed")
          ? "AGENT_BROWSER_NOT_INSTALLED"
          : availability.reason?.includes("Chrome/Edge")
            ? "BROWSER_EXECUTABLE_NOT_FOUND"
            : "AGENT_BROWSER_RUNTIME_UNAVAILABLE"
        : !availability.agentId
          ? "NO_CONFIGURED_AGENT"
          : availability.agentRuntimeState !== "available"
            ? "CONFIGURED_AGENT_UNAVAILABLE"
            : null;
    const availabilityEvidence = {
      probe: "/api/agent-browser/agents",
      checkedAt: availability.checkedAt,
      httpStatus: availability.httpStatus,
      probeLatencyMs: availability.probeLatencyMs,
      runtimeAvailable: availability.runtimeAvailable,
      agentId: availability.agentId,
      agentRuntimeState: availability.agentRuntimeState,
      reasonCode,
      detail: boundedDetail(availability.reason ?? ""),
    };
    if (reasonCode) {
      const receipt = {
        cycle,
        classification: "BLOCKED",
        availability: availabilityEvidence,
        actualElectronUi: false,
        jobId: null,
        workerInstanceId: null,
        rootWorkerPid: null,
        browserPids: [],
        descendantPids: [],
        survivingDescendantPids: [],
        treeExited: false,
        peakTreePrivateMb: null,
        minimumFreeCommitMb: null,
        settledCommitMb: null,
        settledOwnedPrivateMb: null,
        settledOwnedProcessCount: null,
        orphanCount: null,
        reclaimLatencyMs: null,
        duplicateServiceIds: [],
      };
      this.browserAgentRuns.push(receipt);
      return receipt;
    }

    const knownJobs = new Set(this.store.jobIds());
    const baseline = await this.sampler.sample();
    const baselinePids = new Set(baseline.processes.map(({ pid }) => pid));
    const samples: WindowsSample[] = [baseline];
    let collecting = true;
    const collection = this.collectSamples(samples, () => collecting);
    let terminal: JobRow;
    let requestedAt = 0;
    try {
      await startAction();
      const active = await this.waitForNewActiveJob(
        "agent-browser-run",
        "agent-browser-node",
        knownJobs,
        Date.now() + 5 * 60_000,
      );
      const browserDeadline = Date.now() + 2 * 60_000;
      for (;;) {
        const observedBrowser = samples.some((sample) => sample.processes.some((processInfo) =>
          !baselinePids.has(processInfo.pid) &&
          /^(?:chrome|msedge|chromium|google-chrome)(?:\.exe)?$/iu.test(processInfo.name)));
        if (observedBrowser) break;
        if (Date.now() >= browserDeadline) {
          throw new Error("Agent Browser did not create a Chromium descendant before cancellation.");
        }
        await waitForCadence(Math.min(browserDeadline, Date.now() + this.sampleIntervalMs));
      }
      requestedAt = Date.now();
      await cancelAction();
      terminal = await this.waitForSpecificTerminal(active.job_id, "cancelled", Date.now() + 5 * 60_000);
      await waitForCadence(Date.now() + this.settleWindowMs);
    } finally {
      collecting = false;
      await collection;
    }
    const finalSample = await this.sampler.sample();
    samples.push(finalSample);
    const treeExit = this.treeExitEvidence(terminal!);
    const descendantPids = this.observedDescendants(treeExit.rootPid, samples);
    const tree = new Set([treeExit.rootPid, ...descendantPids]);
    const browserPids = unique(samples.flatMap((sample) => sample.processes
      .filter((processInfo) =>
        tree.has(processInfo.pid) &&
        /^(?:chrome|msedge|chromium|google-chrome)(?:\.exe)?$/iu.test(processInfo.name))
      .map(({ pid }) => pid))).sort((left, right) => left - right);
    if (browserPids.length === 0) {
      throw new Error("Agent Browser cancellation lacks a Chromium process identity inside its Runtime tree.");
    }
    const survivingDescendantPids = finalSample.processes
      .filter(({ pid }) => tree.has(pid))
      .map(({ pid }) => pid);
    if (survivingDescendantPids.length !== 0) {
      throw new Error("Agent Browser cancellation left Runtime-owned Chromium descendants alive.");
    }
    for (const pid of tree) this.knownOwnedPids.add(pid);
    const owned = await this.ownedMeasurement(finalSample);
    const receipt = {
      cycle,
      classification: "PASS",
      availability: availabilityEvidence,
      actualElectronUi: true,
      jobId: terminal!.job_id,
      workerInstanceId: terminal!.worker_instance_id,
      rootWorkerPid: treeExit.rootPid,
      browserPids,
      descendantPids,
      survivingDescendantPids,
      treeExited: true,
      peakTreePrivateMb: treeExit.peakPrivateMb,
      minimumFreeCommitMb: this.minimumFreeCommitMb(samples),
      settledCommitMb: finalSample.commitTotalMb,
      settledOwnedPrivateMb: owned.privateMb,
      settledOwnedProcessCount: owned.ids.size,
      orphanCount: this.orphanCount(finalSample),
      reclaimLatencyMs: Math.max(0, finalSample.sampledAt - requestedAt),
      duplicateServiceIds: unique(samples.flatMap((sample) => this.duplicateServiceIds(sample))).sort(),
    };
    this.browserAgentRuns.push(receipt);
    return receipt;
  }

  private async waitForSpecificTerminal(jobId: string, expected: string, deadline: number): Promise<JobRow> {
    for (;;) {
      const job = this.store.job(jobId);
      if (TERMINAL_STATES.has(job.state)) {
        if (job.state !== expected) throw new Error(`Job ${jobId} ended ${job.state}, expected ${expected}.`);
        return job;
      }
      if (Date.now() >= deadline) throw new Error(`Job ${jobId} did not reach ${expected}.`);
      await waitForCadence(Math.min(deadline, Date.now() + this.sampleIntervalMs));
    }
  }

  async measureAdmissionDenial(action: () => Promise<void>): Promise<void> {
    const before = await this.sampler.sample();
    this.assertFreeCommit(before, "reserve-unavailable admission sample");
    this.assertNoDuplicateServices(before, "reserve-unavailable admission sample");
    const freeCommitMb = before.commitLimitMb - before.commitTotalMb;
    const requiredHeadroomMb = FREE_COMMIT_FLOOR_MB + 4_096;
    if (freeCommitMb >= requiredHeadroomMb) {
      throw new Error(
        `No natural reserve-unavailable window exists (${Math.round(freeCommitMb)} MB free, ` +
        `${requiredHeadroomMb} MB required). The gate will not fabricate memory pressure.`,
      );
    }
    const knownJobs = new Set(this.store.jobIds());
    const samples: WindowsSample[] = [before];
    let collecting = true;
    const collection = this.collectSamples(samples, () => collecting);
    let denied: JobRow;
    try {
      await action();
      denied = await this.waitForNewTerminalJob("learn", knownJobs, false);
    } finally {
      collecting = false;
      await collection;
    }
    if (denied.state !== "resource_exhausted") {
      throw new Error(`Heavyweight admission ended ${denied.state}, not resource_exhausted.`);
    }
    const exhaustion = this.store.exhaustion(denied.job_id);
    if (!exhaustion || exhaustion.available_headroom_mb >= exhaustion.required_headroom_mb) {
      throw new Error("Resource-exhausted job lacks reserve-unavailable admission evidence.");
    }
    const after = await this.sampler.sample();
    this.assertFreeCommit(after, "reserve-unavailable denial settled sample");
    this.assertNoDuplicateServices(after, "reserve-unavailable denial settled sample");
    samples.push(after);
    this.admissionDenial = {
      classification: "PASS",
      reserveUnavailableObserved: true,
      heavyweightSubmissionAttempted: true,
      jobId: denied.job_id,
      jobState: denied.state,
      failureCode: denied.failure_code ?? exhaustion.resource,
      requiredHeadroomMb: exhaustion.required_headroom_mb,
      availableHeadroomMb: exhaustion.available_headroom_mb,
      minimumFreeCommitMb: this.minimumFreeCommitMb(samples),
    };
  }

  async measureRestart(restartAction: () => Promise<void>): Promise<void> {
    const jobIdsBefore = this.store.jobIds();
    const beforeRuntimePid = this.qa.readEndpoints().pid;
    const beforeMainPid = await this.qa.mainProcessPid();
    const beforeRendererPid = await this.qa.rendererProcessPid();
    const before = await this.sampler.sample();
    this.assertFreeCommit(before, "dashboard restart baseline sample");
    this.assertNoDuplicateServices(before, "dashboard restart baseline sample");
    const priorOwnedPids = [...descendants(
      new Set([beforeMainPid, beforeRendererPid, beforeRuntimePid]),
      before.processes,
    )].sort((left, right) => left - right);
    const samples: WindowsSample[] = [before];
    let collecting = true;
    const collection = this.collectSamples(samples, () => collecting);
    try {
      await restartAction();
    } finally {
      collecting = false;
      await collection;
    }
    this.serviceUrls = { ...this.qa.readEndpoints().urls };
    const afterRuntimePid = this.qa.readEndpoints().pid;
    const jobIdsAfter = this.store.jobIds();
    const lostJobIds = jobIdsBefore.filter((jobId) => !jobIdsAfter.includes(jobId));
    const duplicateJobIds = jobIdsAfter.filter((jobId, index) => jobIdsAfter.indexOf(jobId) !== index);
    if (lostJobIds.length || duplicateJobIds.length || jobIdsBefore.join("\0") !== jobIdsAfter.join("\0")) {
      throw new Error("Dashboard restart lost or duplicated durable Runtime V2 jobs.");
    }
    if (beforeRuntimePid === afterRuntimePid) throw new Error("Dashboard restart reused the Runtime PID.");
    const settled = await this.sampler.sample();
    this.assertFreeCommit(settled, "dashboard restart settled sample");
    this.assertNoDuplicateServices(settled, "dashboard restart settled sample");
    samples.push(settled);
    const priorOwnedSet = new Set(priorOwnedPids);
    const survivingPriorOwnedPids = settled.processes
      .filter(({ pid }) => priorOwnedSet.has(pid))
      .map(({ pid }) => pid);
    const orphanCount = survivingPriorOwnedPids.length;
    if (orphanCount !== 0) throw new Error("Dashboard restart left prior owned processes alive.");
    this.restart = {
      classification: "PASS",
      beforeRuntimePid,
      afterRuntimePid,
      priorOwnedPids,
      survivingPriorOwnedPids,
      jobIdsBefore,
      jobIdsAfter,
      lostJobIds,
      duplicateJobIds,
      minimumFreeCommitMb: this.minimumFreeCommitMb(samples),
      orphanCount,
    };
  }

  async measureIdleStop(
    serviceId: string,
    acquireAndRelease: () => Promise<{ readonly backend: string }>,
  ): Promise<void> {
    const initial = await this.sampler.sample();
    this.assertFreeCommit(initial, `${serviceId} idle-stop baseline sample`);
    this.assertNoDuplicateServices(initial, `${serviceId} idle-stop baseline sample`);
    const acquireSamples: WindowsSample[] = [];
    let collecting = true;
    const collection = this.collectSamples(acquireSamples, () => collecting);
    let acquisition: { readonly backend: string };
    try {
      acquisition = await acquireAndRelease();
    } finally {
      collecting = false;
      await collection;
    }
    if (serviceId === "gbrain") {
      if (acquisition!.backend !== "gbrain") {
        throw new Error("GBrain acquisition did not prove the real GBrain backend.");
      }
      this.gbrainBackend = "gbrain";
    }
    const ready = this.store.service(serviceId);
    if (ready.lifecycle_state !== "ready" || !ready.idle_ttl_ms || !ready.idle_due_at) {
      throw new Error(`${serviceId} did not reach ready with configured durable idle timing.`);
    }
    const configuredManifestTtl = this.serviceManifestIdleTtl(serviceId);
    if (ready.idle_ttl_ms !== configuredManifestTtl) {
      throw new Error(`${serviceId} durable TTL drifted from the checked-in manifest.`);
    }
    const before = await this.sampler.sample();
    this.assertFreeCommit(before, `${serviceId} idle-stop ready sample`);
    this.assertNoDuplicateServices(before, `${serviceId} idle-stop ready sample`);
    const samples: WindowsSample[] = [initial, ...acquireSamples, before];
    const serviceOwners = this.endpointOwners(before, serviceId);
    if (serviceOwners.length !== 1) throw new Error(`${serviceId} has no exact single listener owner.`);
    const servicePid = serviceOwners[0]!;
    const serviceTree = descendants(new Set([servicePid]), before.processes);
    const privateMbBefore = processPrivateMb(serviceTree, before.processes);
    const releasedAt = ready.idle_due_at - configuredManifestTtl;
    if (!Number.isSafeInteger(releasedAt) || releasedAt < 0) {
      throw new Error(`${serviceId} durable idle boundary is invalid.`);
    }
    const deadline = ready.idle_due_at + this.settleWindowMs;
    let stopped: WindowsSample | null = null;
    for (;;) {
      const service = this.store.service(serviceId);
      const sample = await this.sampler.sample();
      this.assertFreeCommit(sample, `${serviceId} idle-stop sample`);
      this.assertNoDuplicateServices(sample, `${serviceId} idle-stop sample`);
      samples.push(sample);
      if (
        service.lifecycle_state === "available_but_stopped" &&
        !sample.processes.some(({ pid }) => serviceTree.has(pid))
      ) {
        stopped = sample;
        break;
      }
      if (Date.now() >= deadline) throw new Error(`${serviceId} did not stop at its configured idle TTL.`);
      await waitForCadence(Math.min(deadline, Date.now() + this.sampleIntervalMs));
    }
    const survivingDescendantPids = stopped.processes.filter(({ pid }) => serviceTree.has(pid)).map(({ pid }) => pid);
    this.idleStop = {
      classification: "PASS",
      serviceId,
      servicePid,
      lifecycleState: "available-but-stopped",
      configuredIdleTtlMs: configuredManifestTtl,
      idleStopLatencyMs: stopped.sampledAt - releasedAt,
      privateMbBefore,
      privateMbAfter: processPrivateMb(serviceTree, stopped.processes),
      survivingDescendantPids,
      minimumFreeCommitMb: this.minimumFreeCommitMb(samples),
      orphanCount: survivingDescendantPids.length,
    };
  }

  async measurePostiz(
    cycle: number,
    initialStatus: PostizStatusProbe,
    activateAction: () => Promise<PostizActivationResult>,
    stopAction: () => Promise<PostizStopResult>,
    statusAction: () => Promise<PostizStatusProbe>,
  ): Promise<Record<string, unknown>> {
    if (cycle !== this.postizRuns.length + 1 || cycle > 5) {
      throw new Error(`Postiz mixed-cycle run ${cycle} is out of order.`);
    }
    assertBoundedPostizStatus(initialStatus, "Postiz availability probe");
    const routeProbe = {
      probe: "/api/socials-manager/stack?probe=docker",
      checkedAt: initialStatus.checkedAt,
      httpStatus: initialStatus.httpStatus,
      probeLatencyMs: initialStatus.probeLatencyMs,
      mode: initialStatus.mode,
      state: initialStatus.state,
      reachable: initialStatus.reachable,
      reason: boundedDetail(initialStatus.reason ?? ""),
    };
    const samples: WindowsSample[] = [];
    let collecting = true;
    const collection = this.collectSamples(samples, () => collecting);
    if (initialStatus.httpStatus !== 200 || initialStatus.mode !== "stack") {
      collecting = false;
      await collection;
      return this.recordPostizRun(cycle, this.blockedPostizReceipt(
        initialStatus.httpStatus !== 200 ? "AVAILABILITY_PROBE_FAILED" : "POSTIZ_STACK_DISABLED",
        routeProbe,
        null,
      ));
    }

    const engine = await probeContainerEngine();
    if (!engine.available || !engine.executable || !engine.engine) {
      collecting = false;
      await collection;
      return this.recordPostizRun(cycle, this.blockedPostizReceipt(
        String(engine.evidence.reasonCode ?? "CONTAINER_ENGINE_UNAVAILABLE"),
        routeProbe,
        engine.evidence,
      ));
    }
    const daemonProbe = await runBoundedCommand(engine.executable, ["info", "--format", "{{.ServerVersion}}"]);
    const engineEvidence = {
      ...engine.evidence,
      engine: engine.engine,
      daemonRunningAtBaseline: daemonProbe.code === 0,
      daemonProbeDurationMs: daemonProbe.durationMs,
      daemonProbeErrorCode: daemonProbe.errorCode,
      daemonProbeDetail: boundedDetail(daemonProbe.stderr || daemonProbe.stdout),
    };
    const volumesBefore = daemonProbe.code === 0
      ? await listComposeIdentities(engine.executable, "volumes")
      : null;

    let activation: PostizActivationResult;
    let readyStatus: PostizStatusProbe | null = null;
    let activationUnavailable = false;
    try {
      activation = await activateAction();
      if (
        !Number.isFinite(activation.actionLatencyMs) ||
        activation.actionLatencyMs < 0 ||
        activation.actionLatencyMs > POSTIZ_ACTION_TIMEOUT_MS + 5_000
      ) {
        throw new Error("Postiz Runtime activation action is incomplete or unbounded.");
      }
      const readyDeadline = Date.now() + POSTIZ_READY_POLL_TIMEOUT_MS;
      while (!activation.ready) {
        if (Date.now() >= readyDeadline) {
          activationUnavailable = true;
          break;
        }
        await waitForCadence(Math.min(readyDeadline, Date.now() + 30_000));
        const status = await statusAction();
        assertBoundedPostizStatus(status, "Postiz ready status probe");
        readyStatus = status;
        if (status.reachable && status.state === "running") {
          activation = {
            httpStatus: status.httpStatus,
            actionLatencyMs: activation.actionLatencyMs,
            ready: true,
            state: "ready",
            ownership: String(status.coordinator?.ownership ?? "unknown"),
            reason: status.reason,
          };
        }
      }
      if (activation.ready && !readyStatus) {
        readyStatus = await statusAction();
        assertBoundedPostizStatus(readyStatus, "Postiz ready status probe");
      }
    } finally {
      collecting = false;
      await collection;
    }
    const activationEvidence = {
      httpStatus: activation!.httpStatus,
      actionLatencyMs: activation!.actionLatencyMs,
      actionTimeoutMs: POSTIZ_ACTION_TIMEOUT_MS,
      readyPollTimeoutMs: POSTIZ_READY_POLL_TIMEOUT_MS,
      ready: activation!.ready,
      state: activation!.state,
      ownership: activation!.ownership,
      reason: boundedDetail(
        activation!.reason ?? readyStatus?.reason ?? (activation!.ready ? "" : activation!.state),
      ),
    };
    if (activationUnavailable) {
      const activeSample = await this.sampler.sample();
      this.assertFreeCommit(activeSample, "Postiz unavailable activation sample");
      this.assertNoDuplicateServices(activeSample, "Postiz unavailable activation sample");
      samples.push(activeSample);
      const coordinatorOwners = this.endpointOwners(activeSample, "postiz-coordinator");
      if (coordinatorOwners.length > 1) {
        throw new Error("Postiz unavailable activation observed duplicate Runtime coordinator owners.");
      }
      const servicePid = coordinatorOwners[0] ?? null;
      const coordinatorTree = servicePid
        ? descendants(new Set([servicePid]), activeSample.processes)
        : new Set<number>();
      const ownership = String(
        readyStatus?.coordinator?.ownership ?? activation!.ownership ?? "unknown",
      );
      const containersActive = await listComposeIdentities(engine.executable, "containers");
      const volumesActive = await listComposeIdentities(engine.executable, "volumes");
      let containersAfter = [...containersActive];
      let volumesAfter = [...volumesActive];
      let finalSample = activeSample;
      let activationCleanup: Record<string, unknown> | null = null;
      if (ownership === "breadboard") {
        const cleanupSamples: WindowsSample[] = [];
        let cleanupCollecting = true;
        const cleanupCollection = this.collectSamples(cleanupSamples, () => cleanupCollecting);
        try {
          const cleanupStartedAt = Date.now();
          const cleanup = await stopAction();
          if (
            !Number.isSafeInteger(cleanup.httpStatus) ||
            cleanup.httpStatus !== 200 ||
            !Number.isFinite(cleanup.actionLatencyMs) ||
            cleanup.actionLatencyMs < 0 ||
            cleanup.actionLatencyMs > POSTIZ_ACTION_TIMEOUT_MS + 5_000 ||
            cleanup.stopped !== true
          ) {
            throw new Error("Breadboard-owned partial Postiz activation did not accept bounded Runtime cleanup.");
          }
          activationCleanup = {
            httpStatus: cleanup.httpStatus,
            actionLatencyMs: cleanup.actionLatencyMs,
            actionTimeoutMs: POSTIZ_ACTION_TIMEOUT_MS,
            stopped: true,
            reason: boundedDetail(cleanup.reason ?? ""),
          };
          const cleanupDeadline = cleanupStartedAt + POSTIZ_READY_POLL_TIMEOUT_MS;
          for (;;) {
            const status = await statusAction();
            assertBoundedPostizStatus(status, "Postiz unavailable activation cleanup status");
            containersAfter = await listComposeIdentities(engine.executable, "containers");
            finalSample = await this.sampler.sample();
            samples.push(finalSample);
            const treeExited = !finalSample.processes.some(({ pid }) => coordinatorTree.has(pid));
            if (containersAfter.length === 0 && status.state === "stopped" && treeExited) break;
            if (Date.now() >= cleanupDeadline) {
              throw new Error("Breadboard-owned partial Postiz activation did not clean up completely.");
            }
            await waitForCadence(Math.min(cleanupDeadline, Date.now() + 30_000));
          }
          volumesAfter = await listComposeIdentities(engine.executable, "volumes");
          if (volumesAfter.join("\0") !== volumesActive.join("\0")) {
            throw new Error("Partial Postiz activation cleanup changed Docker volume identities.");
          }
          if (volumesBefore && volumesBefore.some((identity) => !volumesAfter.includes(identity))) {
            throw new Error("Partial Postiz activation cleanup removed a pre-existing Docker volume identity.");
          }
        } finally {
          cleanupCollecting = false;
          await cleanupCollection;
          samples.push(...cleanupSamples);
        }
      }
      const survivingCoordinatorPids = finalSample.processes
        .filter(({ pid }) => coordinatorTree.has(pid))
        .map(({ pid }) => pid);
      return this.recordPostizRun(cycle, this.blockedPostizReceipt(
        "POSTIZ_ACTIVATION_UNAVAILABLE",
        routeProbe,
        engineEvidence,
        {
          activation: activationEvidence,
          activationCleanup,
          actualRuntimeActivation: true,
          servicePid,
          ownership,
          configuredStackIdleTtlMs: Number.isSafeInteger(Number(readyStatus?.coordinator?.idleTimeoutMs))
            ? Number(readyStatus?.coordinator?.idleTimeoutMs)
            : null,
          containersActive,
          containersAfter,
          volumesBefore,
          volumesActive,
          volumesAfter,
          coordinatorDescendantPids: [...coordinatorTree]
            .filter((pid) => pid !== servicePid)
            .sort((left, right) => left - right),
          survivingCoordinatorPids,
          treeExited: survivingCoordinatorPids.length === 0,
          minimumFreeCommitMb: this.minimumFreeCommitMb(samples),
          settledCommitMb: finalSample.commitTotalMb,
          orphanCount: this.orphanCount(finalSample),
          duplicateServiceIds: unique(samples.flatMap((sample) => this.duplicateServiceIds(sample))).sort(),
        },
      ));
    }
    if (activation!.httpStatus !== 200 || !activation!.ready || activation!.state !== "ready") {
      throw new Error("Postiz activation did not return an exact ready Runtime receipt.");
    }

    const activeSample = await this.sampler.sample();
    samples.push(activeSample);
    const activeContainers = await listComposeIdentities(engine.executable, "containers");
    const volumesActive = await listComposeIdentities(engine.executable, "volumes");
    if (activeContainers.length === 0 || volumesActive.length === 0) {
      throw new Error("Postiz activation lacks exact container or volume identities.");
    }
    const coordinatorOwners = this.endpointOwners(activeSample, "postiz-coordinator");
    if (coordinatorOwners.length !== 1) {
      throw new Error("Postiz activation lacks one exact Runtime-owned coordinator listener.");
    }
    const coordinatorPid = coordinatorOwners[0]!;
    const coordinatorTree = descendants(new Set([coordinatorPid]), activeSample.processes);
    const privateMbBefore = processPrivateMb(coordinatorTree, activeSample.processes);
    const coordinator = readyStatus?.coordinator ?? null;
    const configuredStackIdleTtlMs = Number(coordinator?.idleTimeoutMs);
    const configuredServiceIdleTtlMs = this.serviceManifestIdleTtl("postiz-coordinator");
    if (!Number.isSafeInteger(configuredStackIdleTtlMs) || configuredStackIdleTtlMs < 1) {
      throw new Error("Postiz coordinator did not expose its configured stack idle TTL.");
    }
    if (activation!.ownership !== "breadboard") {
      return this.recordPostizRun(cycle, this.blockedPostizReceipt(
        activation!.ownership === "pre-existing"
          ? "PREEXISTING_STACK_OWNERSHIP"
          : "POSTIZ_OWNERSHIP_UNAVAILABLE",
        routeProbe,
        engineEvidence,
        {
          activation: activationEvidence,
          activationCleanup: null,
          actualRuntimeActivation: true,
          servicePid: coordinatorPid,
          ownership: activation!.ownership,
          configuredStackIdleTtlMs,
          privateMbBefore,
          containersActive: activeContainers,
          containersAfter: activeContainers,
          volumesBefore,
          volumesActive,
          volumesAfter: volumesActive,
          coordinatorDescendantPids: [...coordinatorTree]
            .filter((pid) => pid !== coordinatorPid)
            .sort((left, right) => left - right),
          survivingCoordinatorPids: [...coordinatorTree].sort((left, right) => left - right),
          minimumFreeCommitMb: this.minimumFreeCommitMb(samples),
          settledCommitMb: activeSample.commitTotalMb,
          orphanCount: this.orphanCount(activeSample),
          duplicateServiceIds: unique(samples.flatMap((sample) => this.duplicateServiceIds(sample))).sort(),
        },
      ));
    }

    const releasedAt = Date.now();
    const stopDeadline = releasedAt + Math.max(
      configuredStackIdleTtlMs,
      configuredServiceIdleTtlMs,
    ) + 10 * 60_000;
    const idleSamples: WindowsSample[] = [];
    collecting = true;
    const idleCollection = this.collectSamples(idleSamples, () => collecting);
    let stoppedSample: WindowsSample | null = null;
    let containersAfter: string[] = activeContainers;
    try {
      for (;;) {
        const status = await statusAction();
        assertBoundedPostizStatus(status, "Postiz idle status probe");
        containersAfter = await listComposeIdentities(engine.executable, "containers");
        const sample = await this.sampler.sample();
        idleSamples.push(sample);
        const service = this.store.service("postiz-coordinator");
        const serviceTreeExited = !sample.processes.some(({ pid }) => coordinatorTree.has(pid));
        if (
          containersAfter.length === 0 &&
          status.state === "stopped" &&
          service.lifecycle_state === "available_but_stopped" &&
          serviceTreeExited
        ) {
          stoppedSample = sample;
          break;
        }
        if (Date.now() >= stopDeadline) {
          throw new Error("Postiz did not return containers and its Runtime coordinator to idle.");
        }
        await waitForCadence(Math.min(stopDeadline, Date.now() + 30_000));
      }
    } finally {
      collecting = false;
      await idleCollection;
    }
    const volumesAfter = await listComposeIdentities(engine.executable, "volumes");
    if (volumesAfter.join("\0") !== volumesActive.join("\0")) {
      throw new Error("Postiz idle shutdown changed Docker volume identities.");
    }
    if (volumesBefore && volumesBefore.some((identity) => !volumesAfter.includes(identity))) {
      throw new Error("Postiz idle shutdown removed a pre-existing Docker volume identity.");
    }
    const allSamples = [...samples, ...idleSamples];
    const coordinatorDescendantPids = this.observedDescendants(coordinatorPid, allSamples);
    const observedCoordinatorTree = new Set([coordinatorPid, ...coordinatorDescendantPids]);
    for (const pid of observedCoordinatorTree) this.knownOwnedPids.add(pid);
    const survivingCoordinatorPids = stoppedSample!.processes
      .filter(({ pid }) => observedCoordinatorTree.has(pid))
      .map(({ pid }) => pid);
    if (survivingCoordinatorPids.length !== 0) {
      throw new Error("Postiz idle shutdown left Runtime coordinator descendants alive.");
    }
    const receipt = {
      cycle,
      classification: "PASS",
      reasonCode: null,
      routeProbe,
      engineProbe: engineEvidence,
      activation: activationEvidence,
      activationCleanup: null,
      actualRuntimeActivation: true,
      serviceId: "postiz-coordinator",
      servicePid: coordinatorPid,
      ownership: activation!.ownership,
      configuredStackIdleTtlMs,
      configuredServiceIdleTtlMs,
      idleStopLatencyMs: stoppedSample!.sampledAt - releasedAt,
      privateMbBefore,
      privateMbAfter: processPrivateMb(coordinatorTree, stoppedSample!.processes),
      containersActive: activeContainers,
      containersAfter,
      volumesBefore,
      volumesActive,
      volumesAfter,
      coordinatorDescendantPids,
      survivingCoordinatorPids,
      treeExited: survivingCoordinatorPids.length === 0,
      minimumFreeCommitMb: this.minimumFreeCommitMb(allSamples),
      settledCommitMb: stoppedSample!.commitTotalMb,
      orphanCount: this.orphanCount(stoppedSample!),
      duplicateServiceIds: unique(allSamples.flatMap((sample) => this.duplicateServiceIds(sample))).sort(),
    };
    this.postizRuns.push(receipt);
    return receipt;
  }

  private recordPostizRun(
    cycle: number,
    receipt: Record<string, unknown>,
  ): Record<string, unknown> {
    const correlated = { cycle, ...receipt };
    this.postizRuns.push(correlated);
    return correlated;
  }

  private blockedPostizReceipt(
    reasonCode: string,
    routeProbe: Record<string, unknown>,
    engineProbe: Record<string, unknown> | null,
    partial: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      classification: "BLOCKED",
      reasonCode,
      routeProbe,
      engineProbe,
      activation: null,
      activationCleanup: null,
      actualRuntimeActivation: false,
      serviceId: "postiz-coordinator",
      servicePid: null,
      ownership: null,
      configuredStackIdleTtlMs: null,
      configuredServiceIdleTtlMs: this.serviceManifestIdleTtl("postiz-coordinator"),
      idleStopLatencyMs: null,
      privateMbBefore: null,
      privateMbAfter: null,
      containersActive: [],
      containersAfter: [],
      volumesBefore: null,
      volumesActive: [],
      volumesAfter: [],
      coordinatorDescendantPids: [],
      survivingCoordinatorPids: [],
      treeExited: false,
      minimumFreeCommitMb: null,
      settledCommitMb: null,
      orphanCount: null,
      duplicateServiceIds: [],
      ...partial,
    };
  }

  private serviceManifestIdleTtl(serviceId: string): number {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(this.qa.run.paths.repoRoot, "desktop", "runtime-v2", "manifests", "services.json"),
      "utf8",
    )) as { readonly services?: readonly { readonly id?: string; readonly idleTtlMs?: number }[] };
    const ttl = manifest.services?.find(({ id }) => id === serviceId)?.idleTtlMs;
    if (!Number.isSafeInteger(ttl) || (ttl ?? 0) < 1) {
      throw new Error(`${serviceId} has no explicit manifest idle TTL.`);
    }
    return ttl!;
  }

  async measurePostMixedSample(): Promise<void> {
    const samples: WindowsSample[] = [];
    const first = await this.sampler.sample();
    this.assertFreeCommit(first, "five-minute post-mixed sample");
    this.assertNoDuplicateServices(first, "five-minute post-mixed sample");
    samples.push(first);
    const deadline = first.sampledAt + POST_MIXED_SAMPLE_MS;
    do {
      await waitForCadence(Math.min(deadline, Date.now() + this.sampleIntervalMs));
      const sample = await this.sampler.sample();
      this.assertFreeCommit(sample, "five-minute post-mixed sample");
      this.assertNoDuplicateServices(sample, "five-minute post-mixed sample");
      samples.push(sample);
      if (sample.sampledAt >= deadline) break;
    } while (true);
    const finalSample = samples.at(-1)!;
    const owned = await this.ownedMeasurement(finalSample);
    this.postMixedSample = {
      classification: "PASS",
      durationMs: finalSample.sampledAt - samples[0]!.sampledAt,
      sampleCount: samples.length,
      minimumFreeCommitMb: this.minimumFreeCommitMb(samples),
      settledCommitMb: finalSample.commitTotalMb,
      settledOwnedPrivateMb: owned.privateMb,
      settledOwnedProcessCount: owned.ids.size,
      orphanCount: this.orphanCount(finalSample),
    };
    if (this.postMixedSample.durationMs as number < POST_MIXED_SAMPLE_MS) {
      throw new Error("Post-mixed measurement did not span a full five minutes.");
    }
  }

  async measureEndurance(): Promise<void> {
    const settleStartedAt = Date.now();
    const requiredDeadline = this.startedAtMs + this.requiredDurationMs;
    const settleDeadline = settleStartedAt + this.settleWindowMs;
    const deadline = Math.max(requiredDeadline, settleDeadline);
    let finalSample: WindowsSample;
    do {
      finalSample = await this.sampler.sample();
      if (finalSample.sampledAt >= deadline) break;
      await waitForCadence(Math.min(deadline, Date.now() + this.sampleIntervalMs));
    } while (true);

    const durationMs = finalSample.sampledAt - this.startedAtMs;
    const settleDurationMs = finalSample.sampledAt - settleStartedAt;
    const allowedSampleGapMs = this.sampleIntervalMs + SAMPLE_GAP_OVERHEAD_MS;
    const initialSampleDelayMs = (this.firstSampleAt ?? finalSample.sampledAt) - this.startedAtMs;
    if (durationMs < this.requiredDurationMs) {
      throw new Error("Runtime V2 endurance measurement did not span exactly the mandatory six-hour minimum.");
    }
    if (settleDurationMs < this.settleWindowMs) {
      throw new Error("Runtime V2 endurance measurement did not cover the configured settle window.");
    }
    if (this.maximumSampleGapMs > allowedSampleGapMs) {
      throw new Error(
        `Continuous burn-in evidence has a ${this.maximumSampleGapMs} ms sample gap; ` +
        `the bounded allowance is ${allowedSampleGapMs} ms.`,
      );
    }
    if (initialSampleDelayMs > allowedSampleGapMs) {
      throw new Error(
        `Burn-in monitoring began ${initialSampleDelayMs} ms after the run started; ` +
        `the bounded allowance is ${allowedSampleGapMs} ms.`,
      );
    }
    const owned = await this.ownedMeasurement(finalSample);
    const orphanCount = this.orphanCount(finalSample);
    if (orphanCount !== 0) throw new Error("Six-hour endurance settling left owned worker descendants alive.");
    this.requiredServiceCoverage();
    this.endurance = {
      classification: "PASS",
      requiredDurationMs: this.requiredDurationMs,
      durationMs,
      settleDurationMs,
      sampleCount: this.monitoredSampleCount,
      firstSampleAt: this.firstSampleAt,
      lastSampleAt: finalSample.sampledAt,
      initialSampleDelayMs,
      maximumSampleGapMs: this.maximumSampleGapMs,
      allowedSampleGapMs,
      minimumFreeCommitMb: this.minimumMonitoredFreeCommitMb,
      peakCommitTotalMb: this.peakMonitoredCommitTotalMb,
      settledCommitMb: finalSample.commitTotalMb,
      settledOwnedPrivateMb: owned.privateMb,
      settledOwnedProcessCount: owned.ids.size,
      orphanCount,
      duplicateServiceIds: [...this.duplicateServiceIdsObserved].sort(),
    };
  }

  private requiredServiceCoverage(): Record<string, unknown> {
    const services = this.observedServiceIds.map((serviceId) => ({
      serviceId,
      observedPids: [...(this.observedServicePids.get(serviceId) ?? [])].sort((left, right) => left - right),
    }));
    const missingObservedServiceIds = services
      .filter(({ observedPids }) => observedPids.length === 0)
      .map(({ serviceId }) => serviceId);
    if (missingObservedServiceIds.length !== 0) {
      throw new Error(`Burn-in did not observe required scenario services: ${missingObservedServiceIds.join(", ")}.`);
    }
    if (this.gbrainBackend !== "gbrain") throw new Error("Burn-in lacks real GBrain backend evidence.");
    return {
      classification: "PASS",
      mandatoryServiceIds: [...this.mandatoryServiceIds],
      eagerRequiredServiceIds: [...this.eagerRequiredServiceIds],
      observedServiceIds: [...this.observedServiceIds],
      manifestWideEvidenceAuthority: "runtime-v2-services-receipt",
      services,
      missingObservedServiceIds,
      gbrainBackend: this.gbrainBackend,
    };
  }

  async measureQuit(shutdownAction: () => Promise<void>): Promise<void> {
    const endpoints = this.qa.readEndpoints();
    const ownedRootPids = unique([
      await this.qa.mainProcessPid(),
      await this.qa.rendererProcessPid(),
      endpoints.pid,
    ]);
    const before = await this.sampler.sample();
    this.assertFreeCommit(before, "quit baseline sample");
    this.assertNoDuplicateServices(before, "quit baseline sample");
    const ownedBeforeQuit = descendants(new Set(ownedRootPids), before.processes);
    const samples: WindowsSample[] = [before];
    let collecting = true;
    const collection = this.collectSamples(samples, () => collecting);
    try {
      await shutdownAction();
    } finally {
      collecting = false;
      await collection;
    }
    const deadline = Date.now() + this.settleWindowMs;
    let sample: WindowsSample;
    let survivingOwnedPids: number[];
    for (;;) {
      sample = await this.sampler.sample();
      this.assertFreeCommit(sample, "quit cleanup sample");
      this.assertNoDuplicateServices(sample, "quit cleanup sample");
      samples.push(sample);
      const dynamicOwned = descendants(new Set(ownedRootPids), sample.processes);
      const allKnownOwned = new Set([...ownedBeforeQuit, ...this.knownOwnedPids, ...dynamicOwned]);
      survivingOwnedPids = sample.processes
        .filter(({ pid }) => allKnownOwned.has(pid))
        .map(({ pid }) => pid);
      if (survivingOwnedPids.length === 0) break;
      if (Date.now() >= deadline) throw new Error("Electron quit left owned processes alive.");
      await waitForCadence(Math.min(deadline, Date.now() + this.sampleIntervalMs));
    }
    this.quit = {
      classification: "PASS",
      ownedRootPids,
      survivingOwnedPids,
      ownedProcessCount: 0,
      minimumFreeCommitMb: this.minimumFreeCommitMb(samples),
      orphanCount: 0,
    };
  }

  writeReceipt(): string {
    for (const kind of Object.keys(this.sequential) as BurnInOperationKind[]) {
      if (this.sequential[kind].length !== 10) throw new Error(`${kind} does not have 10 sequential receipts.`);
    }
    if (this.mixedCycles.length !== 5) throw new Error("Mixed workload does not have 5 cycle receipts.");
    for (const [label, value] of Object.entries({
      admissionDenial: this.admissionDenial,
      cancellation: this.cancellation,
      restart: this.restart,
      idleStop: this.idleStop,
      postMixedSample: this.postMixedSample,
      endurance: this.endurance,
      quit: this.quit,
    })) {
      if (!value) throw new Error(`${label} evidence is missing; no receipt will be written.`);
    }
    for (const [label, values] of Object.entries({
      browserAgent: this.browserAgentRuns,
      postiz: this.postizRuns,
    })) {
      if (values.length !== 5) {
        throw new Error(`${label} does not have 5 mixed-cycle lifecycle receipts.`);
      }
      if (values.some((value, index) =>
        value.cycle !== index + 1 ||
        (value.classification !== "PASS" && value.classification !== "BLOCKED"))) {
        throw new Error(`${label} lacks ordered exact PASS or BLOCKED dispositions.`);
      }
    }
    const initial = this.initialSample;
    if (!initial) throw new Error("Burn-in recorder was not initialized.");
    if (!this.stackEvidence) throw new Error("Lean Rust-owned stack evidence is missing.");
    const serviceCoverage = this.requiredServiceCoverage();
    const finishedAt = new Date().toISOString();
    if (Date.parse(finishedAt) - this.startedAtMs < this.requiredDurationMs) {
      throw new Error("No burn-in receipt can be written before the mandatory six-hour minimum.");
    }
    this.assertServiceEvidenceBindingFiles(false);
    const receipt = {
      schemaVersion: 1,
      workloadProject: "runtime-v2-burn-in",
      runtimeMode: "actual-electron",
      metricSource: "GetPerformanceInfo",
      runId: this.qa.run.runId,
      startedAt: this.startedAt,
      finishedAt,
      outcome: [...this.browserAgentRuns, ...this.postizRuns]
        .every((value) => value.classification === "PASS")
        ? "PASS"
        : "BLOCKED",
      serviceEvidence: this.serviceEvidence,
      acceptance: {
        requiredDurationMs: this.requiredDurationMs,
        sequentialRepetitions: 10,
        mixedCycles: 5,
        ordinaryFreeCommitFloorMb: FREE_COMMIT_FLOOR_MB,
        priorDangerStateMb: 2_900,
        sequentialGrowthFloorMb: 512,
        mixedGrowthFloorMb: 768,
        growthPercent: 0.10,
        postMixedSampleMs: POST_MIXED_SAMPLE_MS,
        defaultSettleWindowMs: DEFAULT_SETTLE_WINDOW_MS,
        measurementCadenceMs: this.sampleIntervalMs,
        settleWindowMs: this.settleWindowMs,
        serviceIdleTtlMs: this.serviceManifestIdleTtl("gbrain"),
      },
      stackEvidence: this.stackEvidence,
      serviceCoverage,
      sequential: this.sequential,
      mixedCycles: this.mixedCycles,
      admissionDenial: this.admissionDenial,
      cancellation: this.cancellation,
      restart: this.restart,
      idleStop: this.idleStop,
      postMixedSample: this.postMixedSample,
      browserAgent: this.browserAgentRuns,
      postiz: this.postizRuns,
      endurance: this.endurance,
      quit: this.quit,
      orphanCount: 0,
      duplicateServiceIds: [],
    };
    fs.mkdirSync(path.dirname(this.receiptPath), { recursive: true });
    const temporary = `${this.receiptPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, this.receiptPath);
    return this.receiptPath;
  }

  close(): void {
    this.store.close();
    this.sampler.stop();
  }
}
