import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { ChatAttachment } from "../chat-attachments.ts";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import {
  abortOuterAgentRun,
  inspectOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
} from "../runtime-v2/outer-agent-run.ts";
import type { LegalRequest } from "./identity.ts";
import type { LegalSettings } from "./settings.ts";
import { prepareLegalRuntimeInputs } from "./runtime-inputs.ts";

export type LegalEvent = OuterAgentEvent;

export interface StartLegalRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly request: LegalRequest;
  readonly settings: LegalSettings;
  readonly attachments: readonly ChatAttachment[];
  readonly model: string;
  readonly reasoningEffort: string;
  readonly baseUrl: string;
  readonly conversationPublicId: string;
  readonly memoryContext: string;
  readonly conversationContext?: string;
}

/** Durable Next façade. Only Runtime owns the Python harness and descendants. */
export async function startRun(
  input: StartLegalRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  const prepared = prepareLegalRuntimeInputs({
    userId: input.userId,
    task: input.request.task,
    memoryContext: input.memoryContext,
    conversationContext: input.conversationContext ?? "",
    attachments: input.attachments,
  });
  return startOuterAgentRun({
    kind: "legal",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      request: {
        maxTurns: input.request.maxTurns,
        skills: input.request.skills,
        effort: input.request.effort,
        allowShell: input.request.allowShell,
      },
      settings: { shellTimeout: input.settings.shellTimeout },
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      conversationPublicId: input.conversationPublicId,
      contentInputIndex: 0,
      content: prepared.content,
      attachments: prepared.attachments,
    },
    inputBlobs: prepared.inputBlobs,
  });
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<LegalEvent[]> {
  const view = await readOuterAgentRunView("legal", userId, runId, since);
  return [...view.events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("legal", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("legal", userId, runId);
}

interface DurableDeliverable {
  readonly path: string;
  readonly bytes: number;
}

function deliverableFromEvents(
  events: readonly OuterAgentEvent[],
  relativePath: string,
): DurableDeliverable | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const files = events[index]?.payload.files;
    if (!Array.isArray(files)) continue;
    for (const value of files) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      if (
        record.path === relativePath &&
        typeof record.path === "string" &&
        Number.isSafeInteger(record.bytes) &&
        (record.bytes as number) >= 0
      ) {
        return { path: record.path, bytes: record.bytes as number };
      }
    }
  }
  return null;
}

function runtimeDataRoot(): string {
  return process.env.BREADBOARD_DATA_DIR?.trim()
    ? dashboardDataDir()
    : repositoryRoot();
}

/** Read only a deliverable named by the authenticated durable event stream. */
export async function readDeliverable(
  userId: number,
  runId: string,
  relativePath: string,
): Promise<{
  stream: ReadableStream<Uint8Array>;
  filename: string;
} | null> {
  const view = await readOuterAgentRunView("legal", userId, runId, 0);
  const known = deliverableFromEvents(view.events, relativePath);
  if (!known) return null;
  const job = await inspectOuterAgentRun("legal", userId, runId);
  if (job.attempt < 1 || !job.workerInstanceId) return null;
  const outputRoot = path.resolve(
    runtimeDataRoot(),
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "output",
  );
  const candidate = path.resolve(outputRoot, known.path);
  if (candidate !== outputRoot && !candidate.startsWith(`${outputRoot}${path.sep}`)) return null;
  try {
    const metadata = fs.lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== known.bytes) return null;
    const canonicalRoot = fs.realpathSync.native(outputRoot);
    const canonical = fs.realpathSync.native(candidate);
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
      return null;
    }
    return {
      stream: Readable.toWeb(fs.createReadStream(canonical)) as ReadableStream<Uint8Array>,
      filename: known.path.split("/").filter(Boolean).pop() ?? "deliverable",
    };
  } catch {
    return null;
  }
}
