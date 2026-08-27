if (typeof window !== "undefined") {
  throw new Error("OpenScience Runtime control is server-only.");
}

// Durable trusted facade for standalone OpenScience turns. Next.js prepares
// the private provider profile, then owns only scoped submit/replay/cancel and
// delivery of files named by Runtime's sealed event projection.

import fs from "node:fs";
import path from "node:path";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import type { PromptOptions } from "./prompt.ts";
import { prepareService } from "./service-profile.ts";
import { workspaceRoot } from "./state-paths.ts";

export type OpenscienceEvent = OuterAgentEvent;

export interface StartOpenscienceRuntimeRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly task: string;
  readonly model: string;
  readonly reasoningEffort: string;
  /** Trusted provider endpoint written only to the private service profile. */
  readonly baseUrl: string;
  readonly options: PromptOptions;
  readonly conversationPublicId: string;
  readonly conversationContext?: string;
}

interface StartDependencies {
  readonly prepare: typeof prepareService;
  readonly submit: typeof startOuterAgentRun;
}

const DEFAULT_DEPENDENCIES: StartDependencies = {
  prepare: prepareService,
  submit: startOuterAgentRun,
};

/** Prepare private service state before Rust can admit the job dependency. */
export async function startRun(
  input: StartOpenscienceRuntimeRunInput,
  dependencies: StartDependencies = DEFAULT_DEPENDENCIES,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  await dependencies.prepare({
    baseUrl: input.baseUrl,
    apiKey: chatmockApiKeyValue(),
    model: input.model,
  });
  return dependencies.submit({
    kind: "openscience",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      options: input.options,
      conversationPublicId: input.conversationPublicId,
      conversationContext: input.conversationContext ?? "",
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<OpenscienceEvent[]> {
  return [...(await readOuterAgentRunView("openscience", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("openscience", userId, runId, 0)).terminal;
}

export function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("openscience", userId, runId);
}

const MAX_DELIVERABLE_BYTES = 256 * 1024 * 1024;
const MAX_DELIVERABLE_PATH_BYTES = 4_096;

function sealedDeliverable(
  events: readonly OpenscienceEvent[],
  requestedPath: string,
): { path: string; size: number } | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "deliverable.ready") continue;
    const filePath = event.payload.path;
    const size = event.payload.size;
    if (
      filePath === requestedPath &&
      typeof filePath === "string" &&
      Number.isSafeInteger(size) &&
      Number(size) >= 0 &&
      Number(size) <= MAX_DELIVERABLE_BYTES
    ) {
      return { path: filePath, size: Number(size) };
    }
  }
  return null;
}

/** Resolve only a direct file named by this run's sealed durable projection. */
export async function readRunDeliverable(
  userId: number,
  runId: string,
  requestedPath: string,
): Promise<{
  absolutePath: string;
  filename: string;
  byteSize: number;
}> {
  if (
    !requestedPath ||
    Buffer.byteLength(requestedPath, "utf8") > MAX_DELIVERABLE_PATH_BYTES ||
    requestedPath.includes("\\") ||
    requestedPath.includes("\0") ||
    path.posix.isAbsolute(requestedPath) ||
    requestedPath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("deliverable_not_found");
  }
  const view = await readOuterAgentRunView("openscience", userId, runId, 0);
  const sealed = sealedDeliverable(view.events, requestedPath);
  if (!sealed) throw new Error("deliverable_not_found");

  const root = path.resolve(workspaceRoot());
  const candidate = path.resolve(root, ...sealed.path.split("/"));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("deliverable_not_found");
  }
  let rootReal: string;
  let candidateReal: string;
  let metadata: fs.Stats;
  try {
    rootReal = fs.realpathSync(root);
    candidateReal = fs.realpathSync(candidate);
    metadata = fs.lstatSync(candidate);
  } catch {
    throw new Error("deliverable_not_found");
  }
  const realRelative = path.relative(rootReal, candidateReal);
  if (
    !realRelative ||
    realRelative.startsWith("..") ||
    path.isAbsolute(realRelative) ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size !== sealed.size ||
    metadata.size > MAX_DELIVERABLE_BYTES
  ) {
    throw new Error("deliverable_not_found");
  }
  return {
    absolutePath: candidateReal,
    filename: path.basename(candidateReal).replace(/["\\\r\n]/gu, "") || "deliverable",
    byteSize: metadata.size,
  };
}
