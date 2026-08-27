if (typeof window !== "undefined") {
  throw new Error("Runtime V2 outer-agent control is server-only.");
}

import { randomUUID } from "node:crypto";
import {
  abandonRuntimeJobInput,
  cancelRuntimeJob,
  inspectRuntimeJob,
  inspectRuntimeJobForStatus,
  readRuntimeJobOutput,
  reserveRuntimeJobInput,
  RuntimeJobControlError,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
  type RuntimeJobResourceClass,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";
import {
  getOuterAgentRuntimeRun,
  getOuterAgentRuntimeRunByRequest,
  markOuterAgentRuntimeRunTerminal,
  outerAgentRuntimeAuthority,
  recordOuterAgentRuntimeRun,
  type OuterAgentKind,
} from "./outer-agent-run-store.ts";

export type { OuterAgentKind } from "./outer-agent-run-store.ts";

export type OuterAgentRunStatus =
  | "queued"
  | "planning"
  | "running"
  | "completed"
  | "failed"
  | "aborted";

export interface OuterAgentEvent {
  readonly sequenceNumber: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly at: string;
}

export interface OuterAgentRunView {
  readonly events: readonly OuterAgentEvent[];
  readonly terminal: boolean;
  readonly status: OuterAgentRunStatus | null;
}

export interface OuterAgentRuntimeAdapter {
  readonly kind: OuterAgentKind;
  readonly jobType: string;
  readonly workerKind: string;
  readonly resourceClass: RuntimeJobResourceClass;
  readonly scopePrefix: string;
  readonly timeoutMs: number;
}

/**
 * Fixed client adapters. A route selects one compiled key; renderer input can
 * never select a worker executable, argv vector, environment map, or job type.
 */
export const OUTER_AGENT_RUNTIME_ADAPTERS = Object.freeze({
  codex: Object.freeze({
    kind: "codex",
    jobType: "codex-run",
    workerKind: "outer-codex-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_codex",
    timeoutMs: 2 * 60 * 60 * 1_000,
  }),
  ruflo: Object.freeze({
    kind: "ruflo",
    jobType: "ruflo-run",
    workerKind: "outer-ruflo-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_ruflo",
    timeoutMs: 3 * 60 * 60 * 1_000,
  }),
  "deep-tutor": Object.freeze({
    kind: "deep-tutor",
    jobType: "deep-tutor-run",
    workerKind: "outer-deep-tutor-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_deep_tutor",
    timeoutMs: 50 * 60 * 1_000,
  }),
  "deer-flow": Object.freeze({
    kind: "deer-flow",
    jobType: "deer-flow-run",
    workerKind: "outer-deer-flow-node",
    resourceClass: "core",
    scopePrefix: "oa_deer_flow",
    timeoutMs: 90 * 60 * 1_000,
  }),
  "deep-research": Object.freeze({
    kind: "deep-research",
    jobType: "deep-research-run",
    workerKind: "outer-deep-research-node",
    resourceClass: "core",
    scopePrefix: "oa_deep_research",
    timeoutMs: 60 * 60 * 1_000,
  }),
  opencode: Object.freeze({
    kind: "opencode",
    jobType: "opencode-run",
    workerKind: "outer-opencode-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_opencode",
    timeoutMs: 2 * 60 * 60 * 1_000,
  }),
  "trading-agent": Object.freeze({
    kind: "trading-agent",
    jobType: "trading-agent-run",
    workerKind: "outer-trading-agent-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_trading_agent",
    timeoutMs: 100 * 60 * 1_000,
  }),
  "career-ops": Object.freeze({
    kind: "career-ops",
    jobType: "career-ops-run",
    workerKind: "outer-career-ops-node",
    resourceClass: "browser-automation",
    scopePrefix: "oa_career_ops",
    timeoutMs: 12 * 60 * 60 * 1_000,
  }),
  "agent-reach": Object.freeze({
    kind: "agent-reach",
    jobType: "agent-reach-run",
    workerKind: "outer-agent-reach-node",
    resourceClass: "browser-automation",
    scopePrefix: "oa_agent_reach",
    timeoutMs: 8 * 60 * 60 * 1_000,
  }),
  "agent-tars": Object.freeze({
    kind: "agent-tars",
    jobType: "agent-tars-run",
    workerKind: "outer-agent-tars-node",
    resourceClass: "core",
    scopePrefix: "oa_agent_tars",
    timeoutMs: 32 * 60 * 1_000,
  }),
  openwork: Object.freeze({
    kind: "openwork",
    jobType: "openwork-run",
    workerKind: "outer-openwork-node",
    // This worker coordinates a separately admitted OpenWork service. Holding
    // a heavyweight slot here would make its own dependency wait behind it.
    resourceClass: "core",
    scopePrefix: "oa_openwork",
    timeoutMs: 6 * 60 * 60 * 1_000,
  }),
  shorts: Object.freeze({
    kind: "shorts",
    jobType: "shorts-run",
    workerKind: "outer-shorts-node",
    resourceClass: "media-processing",
    scopePrefix: "oa_shorts",
    timeoutMs: 3 * 60 * 60 * 1_000 + 10 * 60 * 1_000,
  }),
  "open-gym": Object.freeze({
    kind: "open-gym",
    jobType: "open-gym-run",
    workerKind: "outer-open-gym-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_open_gym",
    timeoutMs: 4 * 60 * 60 * 1_000,
  }),
  legal: Object.freeze({
    kind: "legal",
    jobType: "legal-run",
    workerKind: "outer-legal-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_legal",
    timeoutMs: 2 * 60 * 60 * 1_000,
  }),
  openplanter: Object.freeze({
    kind: "openplanter",
    jobType: "openplanter-run",
    workerKind: "outer-openplanter-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_openplanter",
    timeoutMs: 30 * 60 * 1_000,
  }),
  resource2skill: Object.freeze({
    kind: "resource2skill",
    jobType: "resource2skill-run",
    workerKind: "outer-resource2skill-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_resource2skill",
    timeoutMs: 3 * 60 * 60 * 1_000,
  }),
  matraix: Object.freeze({
    kind: "matraix",
    jobType: "matraix-run",
    workerKind: "outer-matraix-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_matraix",
    timeoutMs: 3 * 60 * 60 * 1_000,
  }),
  hyperframes: Object.freeze({
    kind: "hyperframes",
    jobType: "hyperframes-run",
    workerKind: "outer-hyperframes-node",
    resourceClass: "media-processing",
    scopePrefix: "oa_hyperframes",
    timeoutMs: 3 * 60 * 60 * 1_000,
  }),
  openmontage: Object.freeze({
    kind: "openmontage",
    jobType: "openmontage-run",
    workerKind: "outer-openmontage-node",
    resourceClass: "media-processing",
    scopePrefix: "oa_openmontage",
    timeoutMs: 6 * 60 * 60 * 1_000,
  }),
  "bolt-slides": Object.freeze({
    kind: "bolt-slides",
    jobType: "bolt-slides-run",
    workerKind: "outer-bolt-slides-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_bolt_slides",
    timeoutMs: 60 * 60 * 1_000,
  }),
  "hardware-blueprint": Object.freeze({
    kind: "hardware-blueprint",
    jobType: "hardware-blueprint-run",
    workerKind: "outer-hardware-blueprint-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_hardware_blueprint",
    timeoutMs: 45 * 60 * 1_000,
  }),
  "inbox-zero": Object.freeze({
    kind: "inbox-zero",
    jobType: "inbox-zero-run",
    workerKind: "outer-inbox-zero-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_inbox_zero",
    timeoutMs: 12 * 60 * 1_000,
  }),
  "socials-manager": Object.freeze({
    kind: "socials-manager",
    jobType: "socials-manager-run",
    workerKind: "outer-socials-manager-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_socials_manager",
    timeoutMs: 60 * 60 * 1_000,
  }),
  "get-doc": Object.freeze({
    kind: "get-doc",
    jobType: "get-doc-run",
    workerKind: "outer-get-doc-node",
    resourceClass: "document-processing",
    scopePrefix: "oa_get_doc",
    timeoutMs: 12 * 60 * 1_000,
  }),
  "get-doc-download": Object.freeze({
    kind: "get-doc-download",
    jobType: "get-doc-download",
    workerKind: "get-doc-download-node",
    resourceClass: "document-processing",
    scopePrefix: "oa_get_doc_download",
    timeoutMs: 3 * 60 * 1_000,
  }),
  "meeting-notes": Object.freeze({
    kind: "meeting-notes",
    jobType: "meeting-notes-run",
    workerKind: "outer-meeting-notes-node",
    resourceClass: "media-processing",
    scopePrefix: "oa_meeting_notes",
    timeoutMs: 6 * 60 * 60 * 1_000 + 20 * 60 * 1_000,
  }),
  "money-printer": Object.freeze({
    kind: "money-printer",
    jobType: "money-printer-run",
    workerKind: "outer-money-printer-node",
    resourceClass: "media-processing",
    scopePrefix: "oa_money_printer",
    timeoutMs: 70 * 60 * 1_000,
  }),
  "video-use": Object.freeze({
    kind: "video-use",
    jobType: "video-use-run",
    workerKind: "outer-video-use-node",
    // The outer worker is a bounded orchestrator. Its actual ffmpeg/download
    // work runs in separately admitted speech-media jobs, so reserving the
    // heavyweight class here would deadlock the child admission.
    resourceClass: "core",
    scopePrefix: "oa_video_use",
    timeoutMs: 12 * 60 * 60 * 1_000,
  }),
  openscience: Object.freeze({
    kind: "openscience",
    jobType: "openscience-run",
    workerKind: "outer-openscience-node",
    resourceClass: "core",
    scopePrefix: "oa_openscience",
    timeoutMs: 90 * 60 * 1_000,
  }),
  "max-research": Object.freeze({
    kind: "max-research",
    jobType: "max-research-run",
    workerKind: "outer-max-research-node",
    resourceClass: "core",
    scopePrefix: "oa_max_research",
    timeoutMs: 3 * 60 * 60 * 1_000,
  }),
  wardrobe: Object.freeze({
    kind: "wardrobe",
    jobType: "wardrobe-run",
    workerKind: "outer-wardrobe-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_wardrobe",
    timeoutMs: 3 * 60 * 60 * 1_000,
  }),
  "parametric-cad": Object.freeze({
    kind: "parametric-cad",
    jobType: "parametric-cad-run",
    workerKind: "outer-parametric-cad-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_parametric_cad",
    timeoutMs: 60 * 60 * 1_000,
  }),
  "stock-analyst": Object.freeze({
    kind: "stock-analyst",
    jobType: "stock-analyst-run",
    workerKind: "outer-stock-analyst-node",
    resourceClass: "large-generation",
    scopePrefix: "oa_stock_analyst",
    timeoutMs: 50 * 60 * 1_000,
  }),
  "vibe-trading": Object.freeze({
    kind: "vibe-trading",
    jobType: "vibe-trading-run",
    workerKind: "outer-vibe-trading-node",
    // The Python service holds the heavyweight reservation. This worker only
    // translates one bounded authenticated HTTP/SSE attempt.
    resourceClass: "core",
    scopePrefix: "oa_vibe_trading",
    timeoutMs: 100 * 60 * 1_000,
  }),
} satisfies Record<OuterAgentKind, OuterAgentRuntimeAdapter>);

const TERMINAL_JOB_STATES = new Set([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const TERMINAL_RUN_STATUSES = new Set<OuterAgentRunStatus>([
  "completed",
  "failed",
  "aborted",
]);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const WORKER_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const EVENT_TYPE = /^[a-z][a-z0-9_.-]{0,79}$/u;
const MAX_EVENTS = 5_000;
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FORBIDDEN_EXECUTION_KEYS = new Set([
  "argv",
  "args",
  "env",
  "environment",
  "executable",
  "command",
]);
const FORBIDDEN_SECRET_KEYS = /(?:api[-_]?key|authorization|cookie|password|secret|token)$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function assertSealedRequestPayload(value: unknown, depth = 0): void {
  if (depth > 16) throw new TypeError("Outer-agent Runtime request nesting is too deep.");
  if (Array.isArray(value)) {
    for (const item of value) assertSealedRequestPayload(item, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_EXECUTION_KEYS.has(normalized)) {
      throw new TypeError("Outer-agent Runtime requests cannot override execution configuration.");
    }
    if (FORBIDDEN_SECRET_KEYS.test(normalized)) {
      throw new TypeError("Outer-agent Runtime secrets must come from trusted worker environment.");
    }
    assertSealedRequestPayload(item, depth + 1);
  }
}

function runtimeAuthority(adapter: OuterAgentRuntimeAdapter, userId: number): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new TypeError("Outer-agent Runtime user authority is invalid.");
  }
  return {
    userId,
    gardenId: null,
    conversationId: `${adapter.scopePrefix}_${randomUUID().replaceAll("-", "")}`,
  };
}

function requireAdapterJob(
  adapter: OuterAgentRuntimeAdapter,
  authority: RuntimeJobAuthority,
  job: RuntimeJobSnapshot,
): RuntimeJobSnapshot {
  if (
    job.jobType !== adapter.jobType ||
    job.workerKind !== adapter.workerKind ||
    job.resourceClass !== adapter.resourceClass ||
    job.gardenId !== authority.gardenId ||
    job.conversationId !== authority.conversationId
  ) {
    throw new Error("Runtime returned an outer-agent job outside its sealed adapter scope.");
  }
  return job;
}

function runtimeStatus(job: RuntimeJobSnapshot): OuterAgentRunStatus {
  if (job.state === "succeeded") return "completed";
  if (job.state === "cancelled") return "aborted";
  if (TERMINAL_JOB_STATES.has(job.state)) return "failed";
  return "queued";
}

function parseProjection(
  value: unknown,
  expected: {
    readonly adapter: OuterAgentRuntimeAdapter;
    readonly authority: RuntimeJobAuthority;
    readonly runId: string;
  },
  job?: RuntimeJobSnapshot | null,
): OuterAgentRunProjection {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["protocolVersion", "identity", "scope", "adapterId", "status", "events"]) ||
    value.protocolVersion !== 1 ||
    value.adapterId !== expected.adapter.kind ||
    !isRecord(value.identity) ||
    !exactKeys(value.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    value.identity.jobId !== expected.runId ||
    !Number.isSafeInteger(value.identity.attempt) ||
    (value.identity.attempt as number) < 1 ||
    typeof value.identity.workerInstanceId !== "string" ||
    !WORKER_ID.test(value.identity.workerInstanceId) ||
    !isRecord(value.scope) ||
    !exactKeys(value.scope, ["userId", "gardenId", "conversationId"]) ||
    value.scope.userId !== expected.authority.userId ||
    value.scope.gardenId !== expected.authority.gardenId ||
    value.scope.conversationId !== expected.authority.conversationId ||
    typeof value.status !== "string" ||
    !["queued", "planning", "running", "completed", "failed", "aborted"].includes(value.status) ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_EVENTS
  ) {
    throw new Error("The durable outer-agent run projection is invalid.");
  }
  if (
    job &&
    (job.jobId !== value.identity.jobId ||
      job.attempt !== value.identity.attempt ||
      job.workerInstanceId !== value.identity.workerInstanceId)
  ) {
    throw new Error("The outer-agent projection is fenced to another worker attempt.");
  }
  let prior = 0;
  for (const event of value.events) {
    if (
      !isRecord(event) ||
      !exactKeys(event, ["sequenceNumber", "type", "payload", "at"]) ||
      !Number.isSafeInteger(event.sequenceNumber) ||
      (event.sequenceNumber as number) <= prior ||
      typeof event.type !== "string" ||
      !EVENT_TYPE.test(event.type) ||
      !isRecord(event.payload) ||
      typeof event.at !== "string" ||
      !Number.isFinite(Date.parse(event.at))
    ) {
      throw new Error("The durable outer-agent event stream is invalid.");
    }
    prior = event.sequenceNumber as number;
  }
  const status = value.status as OuterAgentRunStatus;
  const terminal = (value.events as OuterAgentEvent[]).findLast((event) =>
    ["run.completed", "run.failed", "run.aborted"].includes(event.type),
  );
  if (TERMINAL_RUN_STATUSES.has(status)) {
    const expectedType = status === "aborted" ? "run.aborted" : `run.${status}`;
    if (terminal?.type !== expectedType) {
      throw new Error("The outer-agent terminal projection is inconsistent.");
    }
  } else if (terminal) {
    throw new Error("The outer-agent projection continued after a terminal event.");
  }
  return value as unknown as OuterAgentRunProjection;
}

interface OuterAgentRunProjection {
  readonly protocolVersion: 1;
  readonly identity: {
    readonly jobId: string;
    readonly attempt: number;
    readonly workerInstanceId: string;
  };
  readonly scope: RuntimeJobAuthority;
  readonly adapterId: OuterAgentKind;
  readonly status: OuterAgentRunStatus;
  readonly events: readonly OuterAgentEvent[];
}

async function runtimeProjection(
  adapter: OuterAgentRuntimeAdapter,
  authority: RuntimeJobAuthority,
  job: RuntimeJobSnapshot,
): Promise<OuterAgentRunProjection | null> {
  const kinds: Array<"checkpoint" | "result"> =
    job.state === "succeeded" ? ["result", "checkpoint"] : ["checkpoint"];
  for (const kind of kinds) {
    try {
      const output = await readRuntimeJobOutput(authority, job.jobId, kind);
      const content = output.content;
      const candidate = kind === "result" && isRecord(content) && "run" in content
        ? content.run
        : content;
      return parseProjection(candidate, {
        adapter,
        authority,
        runId: job.jobId,
      }, job);
    } catch (error) {
      if (!(error instanceof RuntimeJobControlError)) throw error;
      if (!['JOB_OUTPUT_NOT_READY', 'JOB_NOT_FOUND'].includes(error.code)) throw error;
    }
  }
  return null;
}

function synthesizedTerminalEvent(
  adapter: OuterAgentRuntimeAdapter,
  job: RuntimeJobSnapshot | null,
  sequenceNumber: number,
  at: string,
): OuterAgentEvent {
  if (job?.state === "succeeded") {
    const summary = adapter.kind === "ruflo"
      ? "The Ruflo swarm finished."
      : adapter.kind === "deep-tutor"
        ? "The tutor finished without an answer."
      : adapter.kind === "deer-flow"
        ? "DeerFlow finished without an answer."
      : adapter.kind === "deep-research"
        ? "Deep Research finished without a report."
      : adapter.kind === "opencode"
          ? "OpenCode completed the task."
          : adapter.kind === "trading-agent"
            ? "The market analysis finished."
          : adapter.kind === "career-ops"
            ? "Career Ops finished without an answer."
          : adapter.kind === "agent-reach"
            ? "Agent Reach finished without an answer."
          : adapter.kind === "agent-tars"
            ? "Agent TARS completed the task."
          : adapter.kind === "openwork"
            ? "OpenWork finished without an answer."
          : adapter.kind === "shorts"
            ? "The Shorts run finished without any clips."
          : adapter.kind === "open-gym"
            ? "openGym finished without an answer."
          : adapter.kind === "legal"
            ? "The Legal Agent finished without producing a response."
          : adapter.kind === "openplanter"
            ? "OpenPlanter completed."
          : adapter.kind === "resource2skill"
            ? "Resource2Skill completed the artifact."
          : adapter.kind === "matraix"
            ? "The MatrAIx study finished."
          : adapter.kind === "hyperframes"
            ? "The HyperFrames video build finished."
          : adapter.kind === "openmontage"
            ? "The OpenMontage production finished."
          : adapter.kind === "bolt-slides"
            ? "The presentation finished."
          : adapter.kind === "hardware-blueprint"
            ? "The hardware blueprint finished."
          : adapter.kind === "inbox-zero"
            ? "Inbox Zero finished without an answer."
          : adapter.kind === "socials-manager"
            ? "The Socials Manager finished without any posts."
          : adapter.kind === "get-doc"
            ? "The document search finished."
          : adapter.kind === "get-doc-download"
            ? "The document was saved to artifacts."
          : adapter.kind === "meeting-notes"
            ? "The meeting notes finished."
          : adapter.kind === "money-printer"
            ? "MoneyPrinter finished without a video."
          : adapter.kind === "video-use"
            ? "Video Use finished without an edited video."
          : adapter.kind === "openscience"
            ? "OpenScience finished without an answer."
          : adapter.kind === "max-research"
            ? "Max Research finished without an answer."
          : adapter.kind === "wardrobe"
            ? "No clothing was found in those photos."
          : adapter.kind === "parametric-cad"
            ? "The parametric CAD operation finished."
          : adapter.kind === "stock-analyst"
            ? "Stock Analyst finished without an answer."
          : adapter.kind === "vibe-trading"
            ? "Vibe Trading finished without an answer."
          : "Codex completed the task.";
    return { sequenceNumber, type: "run.completed", payload: { summary }, at };
  }
  if (job?.state === "cancelled") {
    const summary = adapter.kind === "ruflo"
      ? "Ruflo swarm stopped."
      : adapter.kind === "deep-tutor"
        ? "The tutoring turn was stopped before an answer."
      : adapter.kind === "deer-flow"
        ? "DeerFlow stopped before it answered."
      : adapter.kind === "deep-research"
        ? "The research run was stopped."
      : adapter.kind === "opencode"
          ? "OpenCode task stopped."
          : adapter.kind === "trading-agent"
            ? "The market analysis was stopped."
          : adapter.kind === "career-ops"
            ? "Career Ops stopped."
          : adapter.kind === "agent-reach"
            ? "Agent Reach stopped."
          : adapter.kind === "agent-tars"
            ? "Agent TARS task stopped."
          : adapter.kind === "openwork"
            ? "OpenWork stopped."
          : adapter.kind === "shorts"
            ? "The Shorts run was stopped before any clip was finished."
          : adapter.kind === "open-gym"
            ? "openGym stopped."
          : adapter.kind === "legal"
            ? "The assignment was stopped before anything was written."
          : adapter.kind === "openplanter"
            ? "OpenPlanter investigation stopped."
          : adapter.kind === "resource2skill"
            ? "Resource2Skill run stopped."
          : adapter.kind === "matraix"
            ? "The MatrAIx study was stopped."
          : adapter.kind === "hyperframes"
            ? "Video build stopped."
          : adapter.kind === "openmontage"
            ? "Production stopped."
          : adapter.kind === "bolt-slides"
            ? "The deck was stopped."
          : adapter.kind === "hardware-blueprint"
            ? "The hardware blueprint run was stopped."
          : adapter.kind === "inbox-zero"
            ? "Inbox Zero stopped."
          : adapter.kind === "socials-manager"
            ? "Postiz drafting stopped."
          : adapter.kind === "get-doc"
            ? "The document search was stopped."
          : adapter.kind === "get-doc-download"
            ? "The document download was stopped."
          : adapter.kind === "meeting-notes"
            ? "The meeting notes run was stopped."
          : adapter.kind === "money-printer"
            ? "The video was stopped."
          : adapter.kind === "video-use"
            ? "The edit was stopped before it finished rendering."
          : adapter.kind === "openscience"
            ? "The OpenScience run was stopped."
          : adapter.kind === "max-research"
            ? "Max Research stopped."
          : adapter.kind === "wardrobe"
            ? "The wardrobe import was stopped."
          : adapter.kind === "parametric-cad"
            ? "The parametric CAD operation was stopped."
          : adapter.kind === "stock-analyst"
            ? "Stock Analyst stopped before it answered."
          : adapter.kind === "vibe-trading"
            ? "Vibe Trading stopped before it answered."
          : "Codex task stopped.";
    return { sequenceNumber, type: "run.aborted", payload: { summary }, at };
  }
  return {
    sequenceNumber,
    type: "run.failed",
    payload: {
      error: job?.failureMessage ?? (adapter.kind === "agent-tars"
        ? "Agent TARS could not complete the task."
        : adapter.kind === "openwork"
          ? "OpenWork could not recover its Runtime job."
          : `${adapter.kind} could not recover its Runtime job.`),
    },
    at,
  };
}

export interface OuterAgentImageInput {
  readonly dataUrl: string;
}

/**
 * Server-constructed Runtime input. Callers resolve user ownership before
 * creating one; only the opaque upload id crosses the native submission
 * boundary, never a source path.
 */
export interface OuterAgentRuntimeBlobInput {
  readonly displayName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly stream: () => ReadableStream<Uint8Array>;
}

function decodeImage(input: OuterAgentImageInput, index: number): {
  bytes: Buffer;
  displayName: string;
  mediaType: string;
} {
  const match = input.dataUrl.match(
    /^data:image\/(png|jpeg|webp|gif);base64,([a-z0-9+/=\s]+)$/iu,
  );
  if (!match) throw new Error("invalid_image_attachment");
  const bytes = Buffer.from(match[2].replace(/\s/gu, ""), "base64");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("image_attachment_too_large");
  }
  const subtype = match[1].toLowerCase();
  return {
    bytes,
    displayName: `screenshot-${index + 1}.${subtype === "jpeg" ? "jpg" : subtype}`,
    mediaType: `image/${subtype}`,
  };
}

async function stageImages(
  authority: RuntimeJobAuthority,
  images: readonly OuterAgentImageInput[],
): Promise<{
  uploadIds: string[];
  markAdopted: () => void;
  abandon: () => Promise<void>;
}> {
  if (images.length > MAX_IMAGE_COUNT) throw new Error("too_many_image_attachments");
  const uploadIds: string[] = [];
  let adopted = false;
  const abandon = async () => {
    if (adopted) return;
    await Promise.allSettled(
      uploadIds.map((uploadId) => abandonRuntimeJobInput(authority, uploadId)),
    );
    uploadIds.length = 0;
  };
  try {
    for (let index = 0; index < images.length; index += 1) {
      const image = decodeImage(images[index]!, index);
      const reservation = await reserveRuntimeJobInput(authority, {
        gardenId: authority.gardenId,
        conversationId: authority.conversationId,
        displayName: image.displayName,
        mediaType: image.mediaType,
        declaredSizeBytes: image.bytes.byteLength,
      });
      uploadIds.push(reservation.uploadId);
      await uploadRuntimeJobInput(
        authority,
        reservation,
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(image.bytes);
            controller.close();
          },
        }),
      );
    }
    return {
      uploadIds,
      markAdopted: () => {
        adopted = true;
      },
      abandon,
    };
  } catch (error) {
    await abandon();
    throw error;
  }
}

async function stageRuntimeBlobs(
  authority: RuntimeJobAuthority,
  inputs: readonly OuterAgentRuntimeBlobInput[],
): Promise<{
  uploadIds: string[];
  markAdopted: () => void;
  abandon: () => Promise<void>;
}> {
  if (inputs.length > 16) throw new Error("too_many_runtime_inputs");
  const uploadIds: string[] = [];
  let adopted = false;
  const abandon = async () => {
    if (adopted) return;
    await Promise.allSettled(
      uploadIds.map((uploadId) => abandonRuntimeJobInput(authority, uploadId)),
    );
    uploadIds.length = 0;
  };
  try {
    for (const input of inputs) {
      if (
        input.displayName !== input.displayName.trim() ||
        !input.displayName ||
        Buffer.byteLength(input.displayName, "utf8") > 512 ||
        /[\\/\u0000\r\n]/u.test(input.displayName) ||
        !/^[a-z0-9][a-z0-9.+-]{0,126}\/[a-z0-9][a-z0-9.+-]{0,126}$/iu.test(input.mediaType) ||
        !Number.isSafeInteger(input.sizeBytes) ||
        input.sizeBytes < 1 ||
        input.sizeBytes > 2 * 1024 * 1024 * 1024
      ) {
        throw new TypeError("Outer-agent Runtime input metadata is invalid.");
      }
      const reservation = await reserveRuntimeJobInput(authority, {
        gardenId: authority.gardenId,
        conversationId: authority.conversationId,
        displayName: input.displayName,
        mediaType: input.mediaType,
        declaredSizeBytes: input.sizeBytes,
      });
      uploadIds.push(reservation.uploadId);
      await uploadRuntimeJobInput(authority, reservation, input.stream());
    }
    return {
      uploadIds,
      markAdopted: () => {
        adopted = true;
      },
      abandon,
    };
  } catch (error) {
    await abandon();
    throw error;
  }
}

export async function startOuterAgentRun(input: {
  readonly kind: OuterAgentKind;
  readonly userId: number;
  readonly requestId?: string;
  readonly requestPayload: unknown;
  readonly images?: readonly OuterAgentImageInput[];
  readonly inputBlobs?: readonly OuterAgentRuntimeBlobInput[];
}): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  const adapter = OUTER_AGENT_RUNTIME_ADAPTERS[input.kind];
  const requestId = input.requestId ?? randomUUID();
  if (!REQUEST_ID.test(requestId)) {
    throw new TypeError("Outer-agent Runtime request identity is invalid.");
  }
  assertSealedRequestPayload(input.requestPayload);
  const existing = getOuterAgentRuntimeRunByRequest(input.userId, input.kind, requestId);
  if (existing) {
    try {
      const authority = outerAgentRuntimeAuthority(existing);
      const job = requireAdapterJob(
        adapter,
        authority,
        await inspectRuntimeJobForStatus(authority, existing.job_id),
      );
      if (TERMINAL_JOB_STATES.has(job.state)) {
        markOuterAgentRuntimeRunTerminal(
          job.jobId,
          new Date(job.finishedAt ?? job.updatedAt).toISOString(),
        );
      }
      const projection = await runtimeProjection(adapter, authority, job);
      return { runId: job.jobId, status: projection?.status ?? runtimeStatus(job) };
    } catch (error) {
      if (!(error instanceof RuntimeJobControlError) || error.code !== "JOB_NOT_FOUND") {
        throw error;
      }
      markOuterAgentRuntimeRunTerminal(existing.job_id);
      return { runId: existing.job_id, status: "failed" };
    }
  }
  const authority = runtimeAuthority(adapter, input.userId);
  const idempotencyKey = `${adapter.jobType}-v2:${input.userId}:${requestId}`;
  if (input.images?.length && input.inputBlobs?.length) {
    throw new TypeError("Outer-agent Runtime inputs have more than one owner.");
  }
  const staged = input.inputBlobs
    ? await stageRuntimeBlobs(authority, input.inputBlobs)
    : await stageImages(authority, input.images ?? []);
  try {
    const job = requireAdapterJob(
      adapter,
      authority,
      await submitRuntimeJob(authority, {
        jobType: adapter.jobType,
        idempotencyKey,
        requestPayload: input.requestPayload,
        inputUploads: staged.uploadIds.map((uploadId) => ({ uploadId })),
      }),
    );
    staged.markAdopted();
    try {
      recordOuterAgentRuntimeRun({
        jobId: job.jobId,
        ownerUserId: input.userId,
        kind: input.kind,
        requestId,
        idempotencyKey,
        authority,
        createdAt: new Date(job.createdAt).toISOString(),
      });
    } catch (error) {
      await cancelRuntimeJob(authority, job.jobId).catch(() => undefined);
      const canonical = getOuterAgentRuntimeRunByRequest(
        input.userId,
        input.kind,
        requestId,
      );
      if (!canonical) throw error;
      const canonicalAuthority = outerAgentRuntimeAuthority(canonical);
      const canonicalJob = requireAdapterJob(
        adapter,
        canonicalAuthority,
        await inspectRuntimeJobForStatus(canonicalAuthority, canonical.job_id),
      );
      const projection = await runtimeProjection(
        adapter,
        canonicalAuthority,
        canonicalJob,
      );
      return {
        runId: canonicalJob.jobId,
        status: projection?.status ?? runtimeStatus(canonicalJob),
      };
    }
    if (TERMINAL_JOB_STATES.has(job.state)) {
      markOuterAgentRuntimeRunTerminal(
        job.jobId,
        new Date(job.finishedAt ?? job.updatedAt).toISOString(),
      );
    }
    return { runId: job.jobId, status: runtimeStatus(job) };
  } catch (error) {
    await staged.abandon();
    throw error;
  }
}

export async function readOuterAgentRunView(
  kind: OuterAgentKind,
  userId: number,
  runId: string,
  since = 0,
): Promise<OuterAgentRunView> {
  if (!JOB_ID.test(runId) || !Number.isSafeInteger(since) || since < 0) {
    throw new Error("run_not_found");
  }
  const adapter = OUTER_AGENT_RUNTIME_ADAPTERS[kind];
  const mapping = getOuterAgentRuntimeRun(userId, kind, runId);
  if (!mapping) throw new Error("run_not_found");
  const authority = outerAgentRuntimeAuthority(mapping);
  let job: RuntimeJobSnapshot | null = null;
  let missing = false;
  try {
    job = requireAdapterJob(
      adapter,
      authority,
      await inspectRuntimeJobForStatus(authority, runId),
    );
  } catch (error) {
    if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND") {
      missing = true;
    } else {
      throw error;
    }
  }
  if (job && TERMINAL_JOB_STATES.has(job.state)) {
    markOuterAgentRuntimeRunTerminal(
      runId,
      new Date(job.finishedAt ?? job.updatedAt).toISOString(),
    );
  } else if (missing) {
    markOuterAgentRuntimeRunTerminal(runId);
  }
  const projection = job ? await runtimeProjection(adapter, authority, job) : null;
  const events = projection ? [...projection.events] : [];
  const lastSequence = events.at(-1)?.sequenceNumber ?? 0;
  const hasTerminal = events.some((event) =>
    ["run.completed", "run.failed", "run.aborted"].includes(event.type),
  );
  if (!hasTerminal && (missing || (job && TERMINAL_JOB_STATES.has(job.state)))) {
    const at = missing
      ? mapping.terminal_at ?? new Date().toISOString()
      : new Date(job!.finishedAt ?? job!.updatedAt).toISOString();
    events.push(synthesizedTerminalEvent(adapter, job, lastSequence + 1, at));
  }
  const projectionTerminal = Boolean(
    projection && TERMINAL_RUN_STATUSES.has(projection.status),
  );
  const nativeTerminal = missing || Boolean(job && TERMINAL_JOB_STATES.has(job.state));
  return {
    events: events.filter((event) => event.sequenceNumber > since),
    terminal: projectionTerminal || nativeTerminal,
    status: projectionTerminal
      ? projection!.status
      : nativeTerminal
        ? job
          ? runtimeStatus(job)
          : "failed"
        : projection?.status ?? (job ? runtimeStatus(job) : null),
  };
}

export async function abortOuterAgentRun(
  kind: OuterAgentKind,
  userId: number,
  runId: string,
): Promise<boolean> {
  const adapter = OUTER_AGENT_RUNTIME_ADAPTERS[kind];
  const mapping = getOuterAgentRuntimeRun(userId, kind, runId);
  if (!mapping) throw new Error("run_not_found");
  const authority = outerAgentRuntimeAuthority(mapping);
  try {
    const before = requireAdapterJob(
      adapter,
      authority,
      await inspectRuntimeJobForStatus(authority, runId),
    );
    if (TERMINAL_JOB_STATES.has(before.state)) {
      markOuterAgentRuntimeRunTerminal(
        runId,
        new Date(before.finishedAt ?? before.updatedAt).toISOString(),
      );
      return false;
    }
    const job = requireAdapterJob(
      adapter,
      authority,
      await cancelRuntimeJob(authority, runId),
    );
    if (TERMINAL_JOB_STATES.has(job.state)) {
      markOuterAgentRuntimeRunTerminal(
        runId,
        new Date(job.finishedAt ?? job.updatedAt).toISOString(),
      );
    }
    return true;
  } catch (error) {
    if (error instanceof RuntimeJobControlError && error.code === "JOB_NOT_FOUND") {
      markOuterAgentRuntimeRunTerminal(runId);
      return false;
    }
    throw error;
  }
}

const observers = new Map<string, ReturnType<typeof setTimeout>>();

export function observeOuterAgentRun(
  kind: OuterAgentKind,
  userId: number,
  runId: string,
  onTerminal: (view: OuterAgentRunView) => void | Promise<void>,
): void {
  const key = `${kind}:${userId}:${runId}`;
  const prior = observers.get(key);
  if (prior) clearTimeout(prior);
  const deadline = Date.now() + OUTER_AGENT_RUNTIME_ADAPTERS[kind].timeoutMs + 10 * 60_000;
  const poll = async () => {
    try {
      const view = await readOuterAgentRunView(kind, userId, runId, 0);
      if (view.terminal) {
        observers.delete(key);
        await onTerminal(view);
        return;
      }
    } catch {
      // A transient control-plane failure is retried within the bounded job window.
    }
    if (Date.now() >= deadline) {
      observers.delete(key);
      return;
    }
    const timer = setTimeout(() => void poll(), 1_000);
    timer.unref?.();
    observers.set(key, timer);
  };
  const timer = setTimeout(() => void poll(), 0);
  timer.unref?.();
  observers.set(key, timer);
}

export async function inspectOuterAgentRun(
  kind: OuterAgentKind,
  userId: number,
  runId: string,
): Promise<RuntimeJobSnapshot> {
  const adapter = OUTER_AGENT_RUNTIME_ADAPTERS[kind];
  const mapping = getOuterAgentRuntimeRun(userId, kind, runId);
  if (!mapping) throw new Error("run_not_found");
  const authority = outerAgentRuntimeAuthority(mapping);
  return requireAdapterJob(adapter, authority, await inspectRuntimeJob(authority, runId));
}
