import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

interface SqliteStatement { all(...values: readonly unknown[]): unknown[] }
interface SqliteDatabase { prepare(sql: string): SqliteStatement; pragma(sql: string): unknown; close(): void }
type SqliteConstructor = new (file: string, options: { readonly readonly: true; readonly fileMustExist: true }) => SqliteDatabase;

export interface RuntimeParitySnapshot {
  readonly capturedAtMs: number;
  readonly jobs: readonly RuntimeParityJob[];
  readonly services: readonly RuntimeParityService[];
  readonly leases: readonly RuntimeParityLease[];
  readonly listeners: readonly RuntimeParityListener[];
  readonly processIds: readonly number[];
  readonly runtimeOwnedProcessIds: readonly number[];
}

export interface RuntimeParityJob {
  readonly jobId: string;
  readonly jobType: string;
  readonly workerKind: string;
  readonly state: string;
  readonly attempt: number;
  readonly workerInstanceId: string | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly cancellationRequested: number;
  readonly events: readonly {
    readonly eventType: string;
    readonly payload: Record<string, unknown> | null;
    readonly attempt: number;
    readonly workerInstanceId: string | null;
    readonly createdAt: number;
  }[];
}

interface RuntimeParityService {
  readonly serviceId: string;
  readonly required: number;
  readonly lifecycleState: string;
  readonly generation: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface RuntimeParityLease {
  readonly leaseId: string;
  readonly serviceId: string;
  readonly generation: number;
  readonly lifecycleState: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface RuntimeParityListener {
  readonly serviceId: string;
  readonly port: number;
  readonly ownerPids: readonly number[];
  readonly runtimeOwned: boolean;
}

interface RawJobRow {
  job_id: string; job_type: string; worker_kind: string; state: string; attempt: number;
  worker_instance_id: string | null; created_at: number; started_at: number | null;
  finished_at: number | null; cancellation_requested: number;
}
interface RawEventRow { job_id: string; event_type: string; payload_json: string; attempt: number; worker_instance_id: string | null; created_at: number }
interface RawServiceRow { service_id: string; required: number; lifecycle_state: string; generation: number; created_at: number; updated_at: number }
interface RawLeaseRow { lease_id: string; service_id: string; generation: number; lifecycle_state: string; created_at: number; updated_at: number }

function parsePayload(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function portOf(value: string): number {
  const url = new URL(value);
  const port = Number(url.port);
  if (url.hostname !== "127.0.0.1" || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Packaged parity endpoint is not a bounded loopback URL: ${value}`);
  }
  return port;
}

function windowsOwnership(endpoints: Readonly<Record<string, string>>, roots: readonly number[]): {
  readonly listeners: readonly RuntimeParityListener[];
  readonly processIds: readonly number[];
  readonly runtimeOwnedProcessIds: readonly number[];
} {
  if (process.platform !== "win32") throw new Error("Packaged parity process ownership requires Windows.");
  const command = [
    "$ErrorActionPreference='Stop'",
    "$p=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId",
    "$l=Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess",
    "[pscustomobject]@{processes=$p;listeners=$l}|ConvertTo-Json -Compress -Depth 4",
  ].join(";");
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    shell: false,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Packaged parity could not capture Windows listener ownership: ${result.stderr.trim().slice(0, 500)}`);
  }
  const raw = JSON.parse(result.stdout) as {
    processes?: Array<{ ProcessId: number; ParentProcessId: number }> | { ProcessId: number; ParentProcessId: number };
    listeners?: Array<{ LocalAddress: string; LocalPort: number; OwningProcess: number }> | { LocalAddress: string; LocalPort: number; OwningProcess: number };
  };
  const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
  const parents = new Map(array(raw.processes).map(({ ProcessId, ParentProcessId }) => [Number(ProcessId), Number(ParentProcessId)]));
  const descendants = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parentPid] of parents) {
      if (!descendants.has(pid) && descendants.has(parentPid)) { descendants.add(pid); changed = true; }
    }
  }
  const listeners = array(raw.listeners);
  const mapped = Object.entries(endpoints).map(([serviceId, url]) => {
    const port = portOf(url);
    const ownerPids = [...new Set(listeners
      .filter(({ LocalAddress, LocalPort }) => Number(LocalPort) === port && ["127.0.0.1", "::1"].includes(LocalAddress))
      .map(({ OwningProcess }) => Number(OwningProcess)))].sort((left, right) => left - right);
    const ownerPid = ownerPids.length === 1 ? ownerPids[0] : undefined;
    return Object.freeze({ serviceId, port, ownerPids: Object.freeze(ownerPids), runtimeOwned: ownerPid !== undefined && descendants.has(ownerPid) });
  });
  return Object.freeze({
    listeners: Object.freeze(mapped),
    processIds: Object.freeze([...parents.keys()].sort((left, right) => left - right)),
    runtimeOwnedProcessIds: Object.freeze([...descendants].sort((left, right) => left - right)),
  });
}

export function capturePackagedRuntimeSnapshot(options: {
  readonly repoRoot: string;
  readonly dataDir: string;
  readonly endpoints: Readonly<Record<string, string>>;
  readonly runtimeRootPids: readonly number[];
}): RuntimeParitySnapshot {
  const databasePath = path.join(options.dataDir, "runtime-v2", "runtime-v2.sqlite3");
  if (!fs.statSync(databasePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Packaged Runtime V2 database is missing: ${databasePath}`);
  }
  const require = createRequire(path.join(options.repoRoot, "dashboard", "package.json"));
  const Database = require("better-sqlite3") as SqliteConstructor;
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    database.pragma("query_only = ON");
    database.pragma("busy_timeout = 5000");
    const rawJobs = database.prepare(`
      SELECT job_id, job_type, worker_kind, state, attempt, worker_instance_id,
             created_at, started_at, finished_at, cancellation_requested
      FROM runtime_jobs ORDER BY created_at, job_id`).all() as RawJobRow[];
    const rawEvents = database.prepare(`
      SELECT job_id, event_type, payload_json, attempt, worker_instance_id, created_at
      FROM runtime_job_events ORDER BY job_id, sequence`).all() as RawEventRow[];
    const jobs = rawJobs.map((job) => Object.freeze({
      jobId: job.job_id,
      jobType: job.job_type,
      workerKind: job.worker_kind,
      state: job.state,
      attempt: job.attempt,
      workerInstanceId: job.worker_instance_id,
      createdAt: job.created_at,
      startedAt: job.started_at,
      finishedAt: job.finished_at,
      cancellationRequested: job.cancellation_requested,
      events: Object.freeze(rawEvents.filter(({ job_id }) => job_id === job.job_id).map((event) => Object.freeze({
        eventType: event.event_type,
        payload: parsePayload(event.payload_json),
        attempt: event.attempt,
        workerInstanceId: event.worker_instance_id,
        createdAt: event.created_at,
      }))),
    }));
    const services = (database.prepare(`
      SELECT service_id, required, lifecycle_state, generation, created_at, updated_at
      FROM runtime_services ORDER BY service_id`).all() as RawServiceRow[]).map((service) => Object.freeze({
        serviceId: service.service_id,
        required: service.required,
        lifecycleState: service.lifecycle_state,
        generation: service.generation,
        createdAt: service.created_at,
        updatedAt: service.updated_at,
      }));
    const leases = (database.prepare(`
      SELECT lease_id, service_id, generation, lifecycle_state, created_at, updated_at
      FROM runtime_service_leases ORDER BY created_at, lease_id`).all() as RawLeaseRow[]).map((lease) => Object.freeze({
        leaseId: lease.lease_id,
        serviceId: lease.service_id,
        generation: lease.generation,
        lifecycleState: lease.lifecycle_state,
        createdAt: lease.created_at,
        updatedAt: lease.updated_at,
      }));
    const ownership = windowsOwnership(options.endpoints, options.runtimeRootPids);
    return Object.freeze({
      capturedAtMs: Date.now(),
      jobs: Object.freeze(jobs),
      services: Object.freeze(services),
      leases: Object.freeze(leases),
      listeners: ownership.listeners,
      processIds: ownership.processIds,
      runtimeOwnedProcessIds: ownership.runtimeOwnedProcessIds,
    });
  } finally {
    database.close();
  }
}

export function assertPackagedProcessCleanup(
  before: RuntimeParitySnapshot,
  after: RuntimeParitySnapshot,
): { readonly trackedProcessIds: readonly number[]; readonly releasedServiceIds: readonly string[] } {
  const live = new Set(after.processIds);
  const survivors = before.runtimeOwnedProcessIds.filter((pid) => live.has(pid));
  if (survivors.length > 0) {
    throw new Error(`Packaged Electron cleanup left Runtime-owned PID(s): ${survivors.join(", ")}`);
  }
  const occupied = after.listeners.filter(({ ownerPids }) => ownerPids.length > 0);
  if (occupied.length > 0) {
    throw new Error(`Packaged Electron cleanup left listener(s): ${occupied.map(({ serviceId, port, ownerPids }) => `${serviceId}:${port}=>${ownerPids.join("+")}`).join(", ")}`);
  }
  return Object.freeze({
    trackedProcessIds: Object.freeze([...before.runtimeOwnedProcessIds]),
    releasedServiceIds: Object.freeze(after.listeners.map(({ serviceId }) => serviceId).sort()),
  });
}
