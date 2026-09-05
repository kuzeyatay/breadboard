// Runtime V2 compatibility adapter for Agent Browser. Next.js authenticates
// and projects the existing UI contract, but never owns the browser process,
// Chromium descendants, event heap, or cancellation lifecycle.

import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  externalRuntimeFilesystem as fs,
  externalRuntimeLstat,
  externalRuntimePathExists,
  externalRuntimeReadFile,
  externalRuntimeReadFileAsync,
} from "../external-runtime-filesystem.ts";
import { dashboardDataDir } from "../runtime-paths.ts";
import { isChatmockProvider } from "../ui-tars/model-provider.ts";
import {
  cancelRuntimeJob,
  inspectRuntimeJob,
  inspectRuntimeJobForStatus,
  readRuntimeJobOutput,
  RuntimeJobControlError,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";
import { chatmockGatewayBase, type AgentBrowserConfiguration } from "./config.ts";
import { activeProfileDir, resolveBrowserExecutable } from "./browser-profile.ts";
import * as store from "./store.ts";

export { resolveBrowserExecutable };

export interface NormalizedEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "aborted";

interface PendingApproval {
  actionId: string;
  action: string;
  target: string;
  explanation: string;
  risk: string;
  requestedAt: string;
}

interface RuntimeRunProjection {
  protocolVersion: 1;
  identity: {
    jobId: string;
    attempt: number;
    workerInstanceId: string;
  };
  scope: {
    userId: number;
    agentId: string;
  };
  status: RunStatus;
  pendingApproval: PendingApproval | null;
  events: NormalizedEvent[];
}

export interface RuntimeRunView {
  readonly events: readonly NormalizedEvent[];
  readonly terminal: boolean;
  readonly status: RunStatus | null;
}

const JOB_TYPE = "agent-browser-run";
const WORKER_KIND = "agent-browser-node";
const RESOURCE_CLASS = "browser-automation";
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;
const MAX_EVENTS = 5_000;
const MAX_APPROVAL_BYTES = 2_048;
const MAX_ACTIVE_RECONCILIATIONS = 64;
const JOB_ID = /^job_[0-9a-f]{64}$/u;
const AGENT_ID = /^abr_[0-9a-f]{32}$/u;
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const ACTION_ID = /^act_[0-9a-f]{32}$/u;
const SCREENSHOT_ID = /^[0-9]{1,6}$/u;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TERMINAL_RUNTIME_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "completed",
  "failed",
  "aborted",
]);
const EVENT_TYPES = new Set([
  "run.started",
  "run.status",
  "agent.thinking",
  "agent.usage",
  "observation.page",
  "observation.screenshot",
  "auth.required",
  "action.proposed",
  "action.completed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "run.completed",
  "run.failed",
  "run.aborted",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function authority(userId: number, agentId: string): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1 || !AGENT_ID.test(agentId)) {
    throw new TypeError("The Agent Browser Runtime authority is invalid.");
  }
  return { userId, gardenId: null, conversationId: agentId };
}

function isRuntimeAgentBrowserJob(job: RuntimeJobSnapshot, agentId: string): boolean {
  return (
    job.jobType === JOB_TYPE &&
    job.workerKind === WORKER_KIND &&
    job.resourceClass === RESOURCE_CLASS &&
    job.gardenId === null &&
    job.conversationId === agentId
  );
}

function requireRuntimeAgentBrowserJob(job: RuntimeJobSnapshot, agentId: string): RuntimeJobSnapshot {
  if (!isRuntimeAgentBrowserJob(job, agentId)) {
    throw new Error("Runtime returned an Agent Browser job outside its exact scope.");
  }
  return job;
}

function artifactRunRoot(runId: string): string {
  if (!JOB_ID.test(runId)) throw new TypeError("The Agent Browser run identity is invalid.");
  const root = path.resolve(dashboardDataDir(), "agent-browser-artifacts");
  const candidate = path.resolve(root, runId);
  if (!pathWithin(root, candidate) || path.dirname(candidate) !== root) {
    throw new TypeError("The Agent Browser artifact path escaped its data authority.");
  }
  return candidate;
}

function directDirectory(directoryPath: string): boolean {
  try {
    const metadata = externalRuntimeLstat(directoryPath);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function readBoundedJson(filePath: string, maximumBytes: number): unknown {
  const metadata = externalRuntimeLstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximumBytes) {
    throw new Error("The Agent Browser artifact is not a bounded direct file.");
  }
  const bytes = externalRuntimeReadFile(filePath);
  if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumBytes) {
    throw new Error("The Agent Browser artifact changed while it was read.");
  }
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

function validPendingApproval(value: unknown): value is PendingApproval {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "actionId",
      "action",
      "target",
      "explanation",
      "risk",
      "requestedAt",
    ]) &&
    typeof value.actionId === "string" &&
    ACTION_ID.test(value.actionId) &&
    typeof value.action === "string" &&
    typeof value.target === "string" &&
    typeof value.explanation === "string" &&
    typeof value.risk === "string" &&
    ["low", "medium", "high"].includes(value.risk) &&
    typeof value.requestedAt === "string" &&
    Number.isFinite(Date.parse(value.requestedAt))
  );
}

function parseProjection(
  value: unknown,
  expected: { userId: number; agentId: string; runId: string },
  job?: RuntimeJobSnapshot | null,
): RuntimeRunProjection {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "protocolVersion",
      "identity",
      "scope",
      "status",
      "pendingApproval",
      "events",
    ]) ||
    value.protocolVersion !== 1 ||
    !isRecord(value.identity) ||
    !exactKeys(value.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    value.identity.jobId !== expected.runId ||
    !Number.isSafeInteger(value.identity.attempt) ||
    (value.identity.attempt as number) < 1 ||
    typeof value.identity.workerInstanceId !== "string" ||
    !WORKER_ID.test(value.identity.workerInstanceId) ||
    !isRecord(value.scope) ||
    !exactKeys(value.scope, ["userId", "agentId"]) ||
    value.scope.userId !== expected.userId ||
    value.scope.agentId !== expected.agentId ||
    typeof value.status !== "string" ||
    ![
      "queued",
      "running",
      "awaiting_approval",
      "completed",
      "failed",
      "aborted",
    ].includes(value.status) ||
    (value.pendingApproval !== null && !validPendingApproval(value.pendingApproval)) ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_EVENTS
  ) {
    throw new Error("The durable Agent Browser run projection is invalid.");
  }
  if (
    job &&
    (job.jobId !== value.identity.jobId ||
      job.attempt !== value.identity.attempt ||
      job.workerInstanceId !== value.identity.workerInstanceId)
  ) {
    throw new Error("The Agent Browser run projection is fenced to another worker attempt.");
  }
  let priorSequence = 0;
  for (const event of value.events) {
    if (
      !isRecord(event) ||
      !exactKeys(event, ["sequenceNumber", "type", "payload", "at"]) ||
      !Number.isSafeInteger(event.sequenceNumber) ||
      (event.sequenceNumber as number) <= priorSequence ||
      typeof event.type !== "string" ||
      !EVENT_TYPES.has(event.type) ||
      !isRecord(event.payload) ||
      typeof event.at !== "string" ||
      !Number.isFinite(Date.parse(event.at))
    ) {
      throw new Error("The durable Agent Browser event stream is invalid.");
    }
    priorSequence = event.sequenceNumber as number;
  }
  if ((value.status === "awaiting_approval") !== (value.pendingApproval !== null)) {
    throw new Error("The Agent Browser approval projection is inconsistent.");
  }
  const terminalEvent = value.events.findLast((event) =>
    ["run.completed", "run.failed", "run.aborted"].includes(String((event as { type?: unknown }).type)),
  ) as Record<string, unknown> | undefined;
  if (TERMINAL_RUN_STATUSES.has(value.status as RunStatus)) {
    const expectedType = `run.${value.status}`;
    if (!terminalEvent || terminalEvent.type !== expectedType) {
      throw new Error("The Agent Browser terminal projection is inconsistent.");
    }
  } else if (terminalEvent) {
    throw new Error("The Agent Browser projection continued after a terminal event.");
  }
  return value as unknown as RuntimeRunProjection;
}

function artifactProjection(
  userId: number,
  agentId: string,
  runId: string,
  job?: RuntimeJobSnapshot | null,
): RuntimeRunProjection | null {
  const root = artifactRunRoot(runId);
  const base = path.dirname(root);
  if (!directDirectory(base) || !directDirectory(root)) return null;
  const filePath = path.join(root, "run.json");
  try {
    return parseProjection(readBoundedJson(filePath, MAX_ARTIFACT_BYTES), {
      userId,
      agentId,
      runId,
    }, job);
  } catch {
    return null;
  }
}

async function runtimeOutputProjection(
  userId: number,
  agentId: string,
  runId: string,
  job: RuntimeJobSnapshot,
): Promise<RuntimeRunProjection | null> {
  const scopedAuthority = authority(userId, agentId);
  const kinds: Array<"checkpoint" | "result"> =
    job.state === "succeeded" ? ["result", "checkpoint"] : ["checkpoint"];
  for (const kind of kinds) {
    try {
      const output = await readRuntimeJobOutput(scopedAuthority, runId, kind);
      const candidate =
        kind === "result" && isRecord(output.content) && "run" in output.content
          ? output.content.run
          : output.content;
      return parseProjection(candidate, { userId, agentId, runId }, job);
    } catch (error) {
      if (!(error instanceof RuntimeJobControlError)) throw error;
      if (!["JOB_OUTPUT_NOT_READY", "JOB_NOT_FOUND"].includes(error.code)) throw error;
    }
  }
  return null;
}

function synthesizedTerminalEvent(
  job: RuntimeJobSnapshot,
  sequenceNumber: number,
): NormalizedEvent | null {
  if (!TERMINAL_RUNTIME_STATES.has(job.state)) return null;
  const at = new Date(job.finishedAt ?? job.updatedAt).toISOString();
  if (job.state === "succeeded") {
    return { sequenceNumber, type: "run.completed", payload: { summary: "Task complete." }, at };
  }
  if (job.state === "cancelled") {
    return { sequenceNumber, type: "run.aborted", payload: {}, at };
  }
  return {
    sequenceNumber,
    type: "run.failed",
    payload: { message: job.failureMessage ?? "Agent Browser could not complete the task." },
    at,
  };
}

async function inspectMappedRun(
  userId: number,
  agentId: string,
  runId: string,
  statusRead = true,
): Promise<RuntimeJobSnapshot | null> {
  if (!store.getRuntimeRun(userId, agentId, runId)) return null;
  const job = statusRead
    ? await inspectRuntimeJobForStatus(authority(userId, agentId), runId)
    : await inspectRuntimeJob(authority(userId, agentId), runId);
  requireRuntimeAgentBrowserJob(job, agentId);
  if (TERMINAL_RUNTIME_STATES.has(job.state)) {
    store.markRuntimeRunTerminal(runId, new Date(job.finishedAt ?? job.updatedAt).toISOString());
  }
  return job;
}

export interface RuntimeAvailability {
  available: boolean;
  entry: string | null;
  browser: string | null;
  reason?: string;
}

export function resolveAgentBrowserEntry(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.AGENT_BROWSER_JS?.trim();
  if (explicit && externalRuntimePathExists(explicit)) return explicit;
  const roots: string[] = [];
  if (env.AGENT_BROWSER_HOME?.trim()) roots.push(env.AGENT_BROWSER_HOME.trim());
  if (env.APPDATA) roots.push(path.join(env.APPDATA, "npm", "node_modules", "agent-browser"));
  if (env.npm_config_prefix) roots.push(path.join(env.npm_config_prefix, "node_modules", "agent-browser"));
  roots.push("/usr/local/lib/node_modules/agent-browser", "/usr/lib/node_modules/agent-browser");
  for (const root of roots) {
    const entry = path.join(root, "bin", "agent-browser.js");
    if (externalRuntimePathExists(entry)) return entry;
  }
  return null;
}

export function runtimeAvailability(
  env: NodeJS.ProcessEnv = process.env,
  options: { browserRequired?: boolean } = {},
): RuntimeAvailability {
  const entry = resolveAgentBrowserEntry(env);
  const browser = resolveBrowserExecutable(env);
  if (!entry) return { available: false, entry: null, browser, reason: "agent-browser is not installed" };
  if (options.browserRequired !== false && !browser) {
    return { available: false, entry, browser: null, reason: "no Chrome/Edge executable found" };
  }
  return { available: true, entry, browser };
}

export interface StartRunResult {
  runId: string;
  status: RunStatus;
}

function runtimeStatus(job: RuntimeJobSnapshot): RunStatus {
  if (job.state === "succeeded") return "completed";
  if (job.state === "cancelled") return "aborted";
  if (TERMINAL_RUNTIME_STATES.has(job.state)) return "failed";
  return "queued";
}

export async function startRun(input: {
  userId: number;
  agentId: string;
  task: string;
  requestId?: string;
  config: AgentBrowserConfiguration;
  browserMode?: "desktop" | "external";
}): Promise<StartRunResult> {
  const requestId = input.requestId ?? randomUUID();
  if (!REQUEST_ID.test(requestId)) throw new TypeError("The Agent Browser request identity is invalid.");
  const normalizedRequestId = requestId.toLowerCase();
  const idempotencyKey = `agent-browser-v2-${input.agentId}-${normalizedRequestId}`;
  const existing = store.getRuntimeRunByRequest(
    input.userId,
    input.agentId,
    normalizedRequestId,
  );
  if (existing) {
    try {
      const job = requireRuntimeAgentBrowserJob(
        await inspectRuntimeJobForStatus(authority(input.userId, input.agentId), existing.job_id),
        input.agentId,
      );
      if (TERMINAL_RUNTIME_STATES.has(job.state)) {
        store.markRuntimeRunTerminal(
          job.jobId,
          new Date(job.finishedAt ?? job.updatedAt).toISOString(),
        );
      }
      return { runId: job.jobId, status: runtimeStatus(job) };
    } catch (error) {
      if (!(error instanceof RuntimeJobControlError) || error.code !== "JOB_NOT_FOUND") {
        const durable = artifactProjection(input.userId, input.agentId, existing.job_id);
        if (durable) return { runId: existing.job_id, status: durable.status };
        throw error;
      }
      store.markRuntimeRunTerminal(existing.job_id);
      const durable = artifactProjection(input.userId, input.agentId, existing.job_id);
      return {
        runId: existing.job_id,
        status: durable && TERMINAL_RUN_STATUSES.has(durable.status) ? durable.status : "failed",
      };
    }
  }
  const browserMode = input.browserMode ?? "external";
  const availability = runtimeAvailability(process.env, {
    browserRequired: browserMode === "external",
  });
  if (
    !availability.available ||
    !availability.entry ||
    (browserMode === "external" && !availability.browser)
  ) {
    throw new Error(availability.reason ?? "agent-browser runtime unavailable");
  }
  const modelBaseUrl = (
    isChatmockProvider(input.config.provider)
      ? chatmockGatewayBase()
      : (input.config.endpoint ?? chatmockGatewayBase())
  ).replace(/\/$/u, "");
  const job = requireRuntimeAgentBrowserJob(
    await submitRuntimeJob(authority(input.userId, input.agentId), {
      jobType: JOB_TYPE,
      idempotencyKey,
      requestPayload: {
        task: input.task,
        provider: input.config.provider,
        model: input.config.model,
        modelBaseUrl,
        maxSteps: input.config.maxSteps,
        timeoutMs: input.config.timeoutMs,
        approvalMode: input.config.approvalMode,
        allowedDomains: input.config.allowedDomains,
        engine: input.config.engine,
        browserMode,
        agentBrowserEntry: availability.entry,
        browserExecutable: browserMode === "external" ? availability.browser : null,
        profilePath: browserMode === "external" ? activeProfileDir() : null,
      },
    }),
    input.agentId,
  );
  store.recordRuntimeRun({
    jobId: job.jobId,
    ownerUserId: input.userId,
    agentId: input.agentId,
    requestId: normalizedRequestId,
    idempotencyKey,
    createdAt: new Date(job.createdAt).toISOString(),
  });
  if (TERMINAL_RUNTIME_STATES.has(job.state)) {
    store.markRuntimeRunTerminal(job.jobId, new Date(job.finishedAt ?? job.updatedAt).toISOString());
  }
  return { runId: job.jobId, status: runtimeStatus(job) };
}

export async function readRunView(
  userId: number,
  agentId: string,
  runId: string,
  since = 0,
): Promise<RuntimeRunView> {
  const mapping = store.getRuntimeRun(userId, agentId, runId);
  if (!mapping) {
    return { events: [], terminal: true, status: null };
  }
  let job: RuntimeJobSnapshot | null = null;
  let runtimeMissing = false;
  let runtimeMissingAt = mapping.terminal_at;
  try {
    job = await inspectMappedRun(userId, agentId, runId, true);
  } catch (error) {
    if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND") {
      runtimeMissing = true;
      runtimeMissingAt ??= new Date().toISOString();
      store.markRuntimeRunTerminal(runId, runtimeMissingAt);
    } else {
      const durable = artifactProjection(userId, agentId, runId);
      return {
        events: (durable?.events ?? []).filter((event) => event.sequenceNumber > since),
        terminal: durable ? TERMINAL_RUN_STATUSES.has(durable.status) : false,
        status: durable?.status ?? null,
      };
    }
  }
  let projection = artifactProjection(userId, agentId, runId, job);
  if (
    job &&
    (!projection ||
      (TERMINAL_RUNTIME_STATES.has(job.state) && !TERMINAL_RUN_STATUSES.has(projection.status)))
  ) {
    const runtimeProjection = await runtimeOutputProjection(userId, agentId, runId, job).catch(
      () => null,
    );
    if (runtimeProjection) projection = runtimeProjection;
  }
  const events = projection ? [...projection.events] : [];
  const last = events.at(-1)?.sequenceNumber ?? 0;
  if (job && !events.some((event) => ["run.completed", "run.failed", "run.aborted"].includes(event.type))) {
    const synthesized = synthesizedTerminalEvent(job, last + 1);
    if (synthesized) events.push(synthesized);
  }
  if (
    runtimeMissing &&
    !events.some((event) => ["run.completed", "run.failed", "run.aborted"].includes(event.type))
  ) {
    events.push({
      sequenceNumber: last + 1,
      type: "run.failed",
      payload: { message: "Agent Browser could not recover its native Runtime record." },
      at: runtimeMissingAt ?? mapping.created_at,
    });
  }
  const projectionTerminal = Boolean(
    projection && TERMINAL_RUN_STATUSES.has(projection.status),
  );
  const nativeTerminal = runtimeMissing || Boolean(job && TERMINAL_RUNTIME_STATES.has(job.state));
  const terminal = projectionTerminal || nativeTerminal;
  const status = projectionTerminal
    ? projection?.status ?? null
    : job && TERMINAL_RUNTIME_STATES.has(job.state)
      ? runtimeStatus(job)
      : runtimeMissing
        ? "failed"
        : projection?.status ?? (job ? runtimeStatus(job) : null);
  return {
    events: events.filter((event) => event.sequenceNumber > since),
    terminal,
    status,
  };
}

export async function getEventsSince(
  userId: number,
  agentId: string,
  runId: string,
  since: number,
): Promise<NormalizedEvent[]> {
  const view = await readRunView(userId, agentId, runId, since);
  return [...view.events];
}

export async function isTerminal(userId: number, agentId: string, runId: string): Promise<boolean> {
  return (await readRunView(userId, agentId, runId)).terminal;
}

export async function hasActiveRun(): Promise<boolean> {
  for (let index = 0; index < MAX_ACTIVE_RECONCILIATIONS; index += 1) {
    const row = store.firstPotentiallyActiveRuntimeRun();
    if (!row) return false;
    try {
      const job = await inspectRuntimeJobForStatus(
        authority(row.owner_user_id, row.agent_id),
        row.job_id,
      );
      requireRuntimeAgentBrowserJob(job, row.agent_id);
      if (TERMINAL_RUNTIME_STATES.has(job.state)) {
        store.markRuntimeRunTerminal(
          row.job_id,
          new Date(job.finishedAt ?? job.updatedAt).toISOString(),
        );
        continue;
      }
      return true;
    } catch (error) {
      if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND") {
        store.markRuntimeRunTerminal(row.job_id);
        continue;
      }
      // An unreachable native owner is not evidence that the shared profile is free.
      return true;
    }
  }
  return true;
}

export async function getScreenshot(
  userId: number,
  agentId: string,
  runId: string,
  screenshotId: string,
): Promise<Buffer | null> {
  if (!SCREENSHOT_ID.test(screenshotId) || !store.getRuntimeRun(userId, agentId, runId)) return null;
  const root = artifactRunRoot(runId);
  const screenshots = path.join(root, "screenshots");
  const candidate = path.join(screenshots, `s${screenshotId}.png`);
  if (
    !directDirectory(path.dirname(root)) ||
    !directDirectory(root) ||
    !directDirectory(screenshots) ||
    !pathWithin(screenshots, candidate) ||
    path.dirname(candidate) !== screenshots
  ) {
    return null;
  }
  try {
    const metadata = externalRuntimeLstat(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > MAX_SCREENSHOT_BYTES) {
      return null;
    }
    const bytes = await externalRuntimeReadFileAsync(candidate);
    return bytes.byteLength === metadata.size && bytes.byteLength <= MAX_SCREENSHOT_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

function approvalFile(runId: string, actionId: string): string {
  if (!ACTION_ID.test(actionId)) throw new TypeError("The approval action identity is invalid.");
  const root = artifactRunRoot(runId);
  const approvals = path.join(root, "approvals");
  const candidate = path.join(approvals, `${actionId}.json`);
  if (!pathWithin(approvals, candidate) || path.dirname(candidate) !== approvals) {
    throw new TypeError("The approval decision escaped its run artifact root.");
  }
  return candidate;
}

export async function decideApproval(
  userId: number,
  agentId: string,
  runId: string,
  actionId: string,
  decision: "approve" | "reject",
): Promise<boolean> {
  const row = store.getRuntimeRun(userId, agentId, runId);
  if (!row || !ACTION_ID.test(actionId)) return false;
  let job: RuntimeJobSnapshot;
  try {
    const inspected = await inspectMappedRun(userId, agentId, runId, false);
    if (!inspected) return false;
    job = inspected;
  } catch {
    return false;
  }
  if (
    TERMINAL_RUNTIME_STATES.has(job.state) ||
    job.attempt < 1 ||
    !job.workerInstanceId
  ) {
    return false;
  }
  const projection = artifactProjection(userId, agentId, runId, job) ??
    (await runtimeOutputProjection(userId, agentId, runId, job).catch(() => null));
  if (
    !projection ||
    projection.status !== "awaiting_approval" ||
    projection.pendingApproval?.actionId !== actionId
  ) {
    return false;
  }
  const filePath = approvalFile(runId, actionId);
  const parent = path.dirname(filePath);
  if (!directDirectory(path.dirname(parent)) || !directDirectory(parent)) return false;
  const bytes = Buffer.from(`${JSON.stringify({
    protocolVersion: 1,
    jobId: runId,
    attempt: job.attempt,
    workerInstanceId: job.workerInstanceId,
    actionId,
    decision,
    decidedAt: new Date().toISOString(),
  })}\n`, "utf8");
  if (bytes.byteLength > MAX_APPROVAL_BYTES) return false;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    return true;
  } catch {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    return false;
  }
}

export async function abortRun(userId: number, runId: string): Promise<boolean>;
export async function abortRun(userId: number, agentId: string, runId: string): Promise<boolean>;
export async function abortRun(
  userId: number,
  agentIdOrRunId: string,
  explicitRunId?: string,
): Promise<boolean> {
  const runId = explicitRunId ?? agentIdOrRunId;
  const agentId = explicitRunId
    ? agentIdOrRunId
    : store.getRuntimeRunByOwner(userId, runId)?.agent_id;
  if (!agentId) return false;
  if (!store.getRuntimeRun(userId, agentId, runId)) return false;
  try {
    const job = requireRuntimeAgentBrowserJob(
      await cancelRuntimeJob(authority(userId, agentId), runId),
      agentId,
    );
    if (TERMINAL_RUNTIME_STATES.has(job.state)) {
      store.markRuntimeRunTerminal(runId, new Date(job.finishedAt ?? job.updatedAt).toISOString());
    }
    return true;
  } catch (error) {
    if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND") {
      const durable = artifactProjection(userId, agentId, runId);
      return Boolean(durable && TERMINAL_RUN_STATUSES.has(durable.status));
    }
    return false;
  }
}
