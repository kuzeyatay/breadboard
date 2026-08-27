import path from "node:path";
import { pathToFileURL } from "node:url";

const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);
const ASPECTS = new Set(["16:9", "9:16", "1:1"]);
const TERMINAL_EVENTS = new Set(["run.completed", "run.failed", "run.aborted"]);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedText(value, maximumBytes, { empty = false } = {}) {
  return typeof value === "string" &&
    (empty || value.length > 0) &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000]/u.test(value);
}

function nullableText(value, maximumBytes) {
  return value === null || boundedText(value, maximumBytes);
}

function baseUrl(value) {
  if (!boundedText(value, 2_048)) return false;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function validVimaxParsed(value) {
  return exactRecord(value, [
    "brief", "mode", "style", "sceneCount", "shotBudget", "aspectRatio", "images",
    "imageGenerator", "userRequirement",
  ]) &&
    boundedText(value.brief, 60_000) &&
    ["idea2video", "script2video"].includes(value.mode) &&
    nullableText(value.style, 60_000) &&
    (value.sceneCount === null || (Number.isSafeInteger(value.sceneCount) && value.sceneCount >= 1 && value.sceneCount <= 12)) &&
    (value.shotBudget === null || (Number.isSafeInteger(value.shotBudget) && value.shotBudget >= 1 && value.shotBudget <= 12)) &&
    ASPECTS.has(value.aspectRatio) &&
    typeof value.images === "boolean" &&
    ["auto", "gemini", "chatgpt"].includes(value.imageGenerator) &&
    boundedText(value.userRequirement, 60_000, { empty: true });
}

function validVoxParsed(value) {
  return exactRecord(value, [
    "brief", "duration", "aspectRatio", "style", "motion", "images", "music", "seed",
  ]) &&
    boundedText(value.brief, 20_000) &&
    Number.isSafeInteger(value.duration) && value.duration >= 5 && value.duration <= 90 &&
    ASPECTS.has(value.aspectRatio) &&
    nullableText(value.style, 20_000) &&
    ["auto", "local", "kenburns", "scrapbook"].includes(value.motion) &&
    typeof value.images === "boolean" &&
    typeof value.music === "boolean" &&
    (value.seed === null || (Number.isSafeInteger(value.seed) && value.seed >= 0 && value.seed <= 0xffff_ffff));
}

function commonRun(value, parsedValidator, runPattern, maximumBriefBytes) {
  return boundedText(value.runId, 64) && runPattern.test(value.runId) &&
    boundedText(value.conversationPublicId, 256) &&
    boundedText(value.brief, maximumBriefBytes) &&
    parsedValidator(value.parsed) &&
    boundedText(value.model, 256) &&
    EFFORTS.has(value.reasoningEffort) &&
    baseUrl(value.baseUrl) &&
    boundedText(value.conversationContext, 20_000, { empty: true });
}

export function validateRuntimeV2CinemaRequest(agentKind, value) {
  if (agentKind === "vimax") {
    if (
      !exactRecord(value, [
        "operation", "runId", "conversationPublicId", "brief", "parsed", "model",
        "reasoningEffort", "baseUrl", "conversationContext",
      ]) ||
      value.operation !== "run" ||
      !commonRun(value, validVimaxParsed, /^vmxrun_[0-9a-f]{32}$/u, 60_000)
    ) fail("The canonical ViMax Runtime request is invalid.");
    return value;
  }
  if (agentKind !== "vox-director") fail("The cinema Runtime adapter is not registered.");
  if (value?.operation === "health") {
    if (
      !exactRecord(value, ["operation", "baseUrl", "checkpoint", "voiceProfileId"]) ||
      !baseUrl(value.baseUrl) ||
      !nullableText(value.checkpoint, 1_024) ||
      !nullableText(value.voiceProfileId, 512)
    ) fail("The canonical Vox Director health request is invalid.");
    return value;
  }
  if (
    !exactRecord(value, [
      "operation", "runId", "conversationPublicId", "brief", "parsed", "model",
      "reasoningEffort", "baseUrl", "conversationContext", "checkpoint", "steps", "cfg",
      "voiceProfileId", "musicTrack",
    ]) ||
    value.operation !== "run" ||
    !commonRun(value, validVoxParsed, /^voxrun_[0-9a-f]{32}$/u, 20_000) ||
    !nullableText(value.checkpoint, 1_024) ||
    !Number.isSafeInteger(value.steps) || value.steps < 1 || value.steps > 100 ||
    typeof value.cfg !== "number" || !Number.isFinite(value.cfg) || value.cfg < 0 || value.cfg > 30 ||
    !nullableText(value.voiceProfileId, 512) ||
    !nullableText(value.musicTrack, 4_096)
  ) fail("The canonical Vox Director Runtime request is invalid.");
  return value;
}

export const RUNTIME_V2_CINEMA_ADAPTERS = Object.freeze({
  vimax: Object.freeze({
    id: "vimax",
    jobType: "vimax-run",
    workerKind: "vimax-node",
    manager: ["lib", "vimax", "run-manager.ts"],
  }),
  "vox-director": Object.freeze({
    id: "vox-director",
    jobType: "vox-director-run",
    workerKind: "vox-director-node",
    manager: ["lib", "vox-director", "run-manager.ts"],
  }),
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminalStatus(events) {
  const terminal = events.findLast((event) => TERMINAL_EVENTS.has(event.type));
  if (terminal?.type === "run.completed") return "completed";
  if (terminal?.type === "run.aborted") return "aborted";
  if (terminal?.type === "run.failed") return "failed";
  return null;
}

function projectedStatus(events) {
  return terminalStatus(events) ??
    (events.some((event) => event.type === "run.started") ? "running" : undefined);
}

export async function executeRuntimeV2CinemaAdapter({
  agentKind,
  launch,
  sourceRoot,
  signal,
  update,
}) {
  const adapter = RUNTIME_V2_CINEMA_ADAPTERS[agentKind];
  if (!adapter) fail("The cinema Runtime adapter is not registered.");
  if (agentKind === "vox-director" && launch.request.operation === "health") {
    const healthModule = await import(pathToFileURL(
      path.join(sourceRoot, "lib", "vox-director", "worker-health.ts"),
    ).href);
    return {
      status: "completed",
      health: await healthModule.inspectWorkerHealth({
        userId: launch.executionScope.userId,
        baseUrl: launch.request.baseUrl,
        configuredCheckpoint: launch.request.checkpoint,
        voiceProfileId: launch.request.voiceProfileId,
        signal,
      }),
    };
  }

  if (launch.executionScope.conversationId !== launch.request.conversationPublicId) {
    fail("The cinema Runtime request escaped its authenticated conversation scope.");
  }
  const manager = await import(pathToFileURL(path.join(sourceRoot, ...adapter.manager)).href);
  const request = launch.request;
  const local = manager.startRuntimeWorkerRun({
    runId: request.runId,
    userId: launch.executionScope.userId,
    conversationPublicId: request.conversationPublicId,
    brief: request.brief,
    parsed: request.parsed,
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    baseUrl: request.baseUrl,
    conversationContext: request.conversationContext || undefined,
    ...(agentKind === "vox-director"
      ? {
          checkpoint: request.checkpoint,
          steps: request.steps,
          cfg: request.cfg,
          voiceProfileId: request.voiceProfileId,
          musicTrack: request.musicTrack,
        }
      : {}),
  });
  update([], local.status);
  let cursor = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      manager.abortRun(launch.executionScope.userId, request.runId);
    } catch {
      // The native supervisor remains final process-tree authority.
    }
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    while (true) {
      const next = manager.getEventsSince(launch.executionScope.userId, request.runId, cursor);
      if (next.length > 0) {
        cursor = next.at(-1).sequenceNumber;
        update(next, projectedStatus(next));
        const status = terminalStatus(next);
        if (status) return { status };
      }
      if (signal.aborted) {
        stop();
        const finalEvents = manager.getEventsSince(
          launch.executionScope.userId,
          request.runId,
          cursor,
        );
        if (finalEvents.length > 0) update(finalEvents);
        return { status: terminalStatus(finalEvents) ?? "aborted" };
      }
      if (manager.isTerminal(launch.executionScope.userId, request.runId)) {
        return { status: "failed" };
      }
      await wait(100);
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
