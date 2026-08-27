if (typeof window !== "undefined") {
  throw new Error("DeerFlow Runtime control is server-only.");
}

// Durable Next.js facade for DeerFlow. This is the trusted half of the
// boundary: it writes the private Gateway profile before submission, then
// limits Next to scoped submit/replay/cancel and durable artifact delivery.

import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import {
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
} from "../supervisor-control.ts";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { artifactDeliveryFile, getArtifactById } from "../hermes/artifact-store.ts";
import { DEER_FLOW_PRESENT_TOOL } from "./artifact.ts";
import { prepareService } from "./service.ts";
import type { DeerFlowSettings } from "./settings.ts";

export type DeerFlowEvent = OuterAgentEvent;

const RUNNING_SERVICE_STATES = new Set(["starting", "healthy", "degraded", "ready", "busy"]);
const ARTIFACT_INDEX_ID = /^(?:0|[1-9][0-9]{0,3})$/u;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function coldStartHint(): Promise<boolean> {
  if (!isRuntimeV2ServiceControlConfigured()) return false;
  const snapshot = await readSupervisedServiceSnapshot("deer-flow").catch(() => null);
  return !snapshot || !RUNNING_SERVICE_STATES.has(snapshot.state);
}

export interface StartDeerFlowRuntimeRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly task: string;
  readonly model: string;
  readonly reasoningEffort: string;
  /** Trusted ChatMock origin, written to the private service profile only. */
  readonly baseUrl: string;
  readonly settings: DeerFlowSettings;
  readonly conversationPublicId: string;
  readonly conversationContext?: string;
}

export async function startRun(
  input: StartDeerFlowRuntimeRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  // The managed Gateway reads this profile at dependency admission. Neither
  // the provider key nor its URL is copied into the sealed worker request.
  const [, coldStart] = await Promise.all([
    prepareService({
      baseUrl: input.baseUrl,
      apiKey: chatmockApiKeyValue(),
      model: input.model,
      settings: input.settings,
    }),
    coldStartHint(),
  ]);
  return startOuterAgentRun({
    kind: "deer-flow",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      task: input.task,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      settings: input.settings,
      conversationPublicId: input.conversationPublicId,
      conversationContext: input.conversationContext ?? "",
      coldStart,
    },
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<DeerFlowEvent[]> {
  return [...(await readOuterAgentRunView("deer-flow", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("deer-flow", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("deer-flow", userId, runId);
}

interface SealedArtifactEntry {
  readonly id: string;
  readonly path: string;
  readonly artifactId: string;
}

function sealedArtifactEntry(
  events: readonly DeerFlowEvent[],
  artifactIndexId: string,
): SealedArtifactEntry | null {
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const event = events[eventIndex];
    const candidates = event.type === "artifacts"
      ? event.payload.files
      : ["run.completed", "run.aborted"].includes(event.type)
        ? event.payload.artifacts
        : null;
    if (!Array.isArray(candidates)) continue;
    for (const value of candidates) {
      const entry = record(value);
      if (
        entry.id === artifactIndexId &&
        typeof entry.path === "string" &&
        entry.path.length > 0 &&
        entry.path.length <= 4_096 &&
        typeof entry.artifactId === "string" &&
        /^art_[A-Za-z0-9_-]{1,128}$/u.test(entry.artifactId)
      ) {
        return {
          id: artifactIndexId,
          path: entry.path,
          artifactId: entry.artifactId,
        };
      }
    }
  }
  return null;
}

/** Resolve only a durable artifact named by this run's sealed projection. */
export async function readRunArtifact(
  userId: number,
  runId: string,
  artifactIndexId: string,
): Promise<{
  absolutePath: string;
  filename: string;
  mimeType: string;
  byteSize: number;
}> {
  if (!ARTIFACT_INDEX_ID.test(artifactIndexId)) throw new Error("artifact_not_found");
  const view = await readOuterAgentRunView("deer-flow", userId, runId, 0);
  const entry = sealedArtifactEntry(view.events, artifactIndexId);
  if (!entry) throw new Error("artifact_not_found");
  const artifact = getArtifactById(entry.artifactId);
  let metadata: Record<string, unknown> = {};
  try {
    metadata = record(JSON.parse(artifact?.metadata_json ?? "{}"));
  } catch {
    metadata = {};
  }
  if (
    !artifact ||
    artifact.user_id !== userId ||
    artifact.source_hermes_tool !== DEER_FLOW_PRESENT_TOOL ||
    metadata.deerFlowOutput !== true ||
    metadata.deerFlowPath !== entry.path
  ) {
    throw new Error("artifact_not_found");
  }
  const delivery = artifactDeliveryFile(artifact);
  return {
    absolutePath: delivery.absolutePath,
    filename: delivery.filename,
    mimeType: delivery.mimeType,
    byteSize: delivery.byteSize,
  };
}
