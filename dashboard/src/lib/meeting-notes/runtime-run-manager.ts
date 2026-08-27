import "server-only";

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  abortOuterAgentRun,
  observeOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRunStatus,
  type OuterAgentRuntimeBlobInput,
} from "../runtime-v2/outer-agent-run.ts";
import { getSpeechSettings } from "../speech/settings.ts";
import type { MeetingNotesRequest } from "./identity.ts";
import {
  recordingBytes,
  resolveMeetingSource,
  SourceError,
  type ResolvedMeeting,
} from "./source.ts";
import { transcriptionAvailability } from "./transcribe.ts";
import { removeMeetingUpload } from "./uploads.ts";

export type MeetingNotesEvent = OuterAgentEvent;

export interface StartRunInput {
  userId: number;
  requestId?: string;
  conversationPublicId: string;
  request: MeetingNotesRequest;
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  conversationContext?: string;
}

const MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

function safeDisplayName(value: string): string {
  return path.basename(value)
    .replace(/[\\/\u0000\r\n]+/gu, "-")
    .slice(0, 260) || "recording";
}

function bufferInput(buffer: Buffer): OuterAgentRuntimeBlobInput {
  return {
    displayName: "transcript.txt",
    mediaType: "text/plain",
    sizeBytes: buffer.byteLength,
    stream: () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buffer);
        controller.close();
      },
    }),
  };
}

function fileInput(filePath: string, filename: string): OuterAgentRuntimeBlobInput {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > MAX_AUDIO_BYTES) {
    throw new Error("That recording is larger than 2 GB.");
  }
  return {
    displayName: safeDisplayName(filename),
    mediaType: "application/octet-stream",
    sizeBytes: metadata.size,
    stream: () => Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>,
  };
}

export async function startRun(
  input: StartRunInput,
): Promise<{ runId: string; status: OuterAgentRunStatus }> {
  let resolved: ResolvedMeeting | null = null;
  let sourceError: string | null = null;
  try {
    resolved = resolveMeetingSource({
      userId: input.userId,
      conversationPublicId: input.conversationPublicId,
      source: input.request.source,
      fallbackTitle: "Meeting",
    });
  } catch (error) {
    sourceError = error instanceof SourceError
      ? error.message
      : "The recording could not be read.";
  }
  const sourceLabel = !resolved
    ? "the requested recording"
    : resolved.kind === "transcript"
      ? "a transcript you provided"
      : `${resolved.filename}${input.request.source.kind === "auto" ? " (the newest recording in this chat)" : ""}`;
  const speech = getSpeechSettings(input.userId);
  const availability = resolved?.kind === "audio"
    ? await transcriptionAvailability(input.userId)
    : null;
  const engine = resolved?.kind === "audio" ? availability?.engine ?? "none" : "none";

  let inputBlob: OuterAgentRuntimeBlobInput;
  if (!resolved) {
    inputBlob = bufferInput(Buffer.from(sourceError ?? "The recording could not be read.", "utf8"));
  } else if (resolved.kind === "transcript") {
    const buffer = Buffer.from(resolved.text, "utf8");
    if (buffer.byteLength < 1 || buffer.byteLength > MAX_TRANSCRIPT_BYTES) {
      throw new Error("That transcript is too large.");
    }
    inputBlob = bufferInput(buffer);
  } else {
    inputBlob = fileInput(resolved.path, resolved.filename);
  }

  const launched = await startOuterAgentRun({
    kind: "meeting-notes",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      conversationPublicId: input.conversationPublicId,
      request: {
        sourceKind: input.request.source.kind,
        prompt: input.request.prompt,
        language: input.request.language,
        speakers: input.request.speakers,
        transcriptOnly: input.request.transcriptOnly,
      },
      source: resolved
        ? {
            kind: resolved.kind,
            filename: resolved.kind === "audio" ? safeDisplayName(resolved.filename) : "transcript.txt",
            title: resolved.title.replace(/\s+/gu, " ").trim().slice(0, 1_000) || "Meeting",
            label: sourceLabel,
            artifactId: resolved.kind === "audio" ? resolved.artifactId : null,
            byteSize: resolved.kind === "audio" ? recordingBytes(resolved.path) ?? inputBlob.sizeBytes : inputBlob.sizeBytes,
            error: null,
          }
        : {
            kind: "error",
            filename: "unavailable.txt",
            title: "Meeting",
            label: sourceLabel,
            artifactId: null,
            byteSize: inputBlob.sizeBytes,
            error: sourceError,
          },
      engine,
      voiceboxModel: speech.transcriptionModel,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      conversationContext: input.conversationContext ?? "",
    },
    inputBlobs: [inputBlob],
  });

  if (input.request.source.kind === "upload") {
    const uploadId = input.request.source.uploadId;
    observeOuterAgentRun("meeting-notes", input.userId, launched.runId, (view) => {
      if (view.status === "completed") {
        removeMeetingUpload({ userId: input.userId, uploadId });
      }
    });
  }
  return launched;
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<MeetingNotesEvent[]> {
  return [...(await readOuterAgentRunView("meeting-notes", userId, runId, since)).events];
}

export async function isTerminal(userId: number, runId: string): Promise<boolean> {
  return (await readOuterAgentRunView("meeting-notes", userId, runId, 0)).terminal;
}

export async function abortRun(userId: number, runId: string): Promise<boolean> {
  return abortOuterAgentRun("meeting-notes", userId, runId);
}
