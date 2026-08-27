// Durable dashboard facade for Wardrobe. The route validates the existing
// request and uploads each photo into Runtime-owned storage; detection, image
// generation, gallery writes, artifact publication, and polling run only in a
// fresh disposable worker.

import type { ChatAttachment } from "../chat-attachments.ts";
import {
  abortOuterAgentRun,
  readOuterAgentRunView,
  startOuterAgentRun,
  type OuterAgentEvent,
  type OuterAgentRuntimeBlobInput,
} from "../runtime-v2/outer-agent-run.ts";
import type { WardrobeRequest } from "./identity.ts";

export type WardrobeEvent = OuterAgentEvent;
export type WardrobeRunStatus =
  "queued" | "running" | "completed" | "failed" | "aborted";

interface RuntimePhoto {
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly input: OuterAgentRuntimeBlobInput;
}

const IMAGE_DATA_URL =
  /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/iu;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function decodedSize(base64: string): number {
  const compact = base64.replace(/\s/gu, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      compact,
    )
  ) {
    throw new TypeError("Wardrobe photo encoding is invalid.");
  }
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return (compact.length / 4) * 3 - padding;
}

function runtimePhoto(
  attachment: Extract<ChatAttachment, { type: "image" }>,
): RuntimePhoto {
  const match = IMAGE_DATA_URL.exec(attachment.dataUrl);
  if (!match) throw new TypeError("Wardrobe photo encoding is invalid.");
  const mediaType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/gu, "");
  const sizeBytes = decodedSize(base64);
  if (sizeBytes < 1 || sizeBytes > MAX_PHOTO_BYTES) {
    throw new TypeError("Wardrobe photo size is invalid.");
  }
  const name = attachment.name.trim();
  if (
    !name ||
    Buffer.byteLength(name, "utf8") > 500 ||
    /[\\/\u0000\r\n]/u.test(name)
  ) {
    throw new TypeError("Wardrobe photo name is invalid.");
  }
  return {
    name,
    mediaType,
    sizeBytes,
    input: {
      displayName: name,
      mediaType,
      sizeBytes,
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            const bytes = Buffer.from(base64, "base64");
            if (bytes.byteLength !== sizeBytes) {
              controller.error(
                new TypeError("Wardrobe photo encoding is invalid."),
              );
              return;
            }
            controller.enqueue(bytes);
            controller.close();
          },
        }),
    },
  };
}

export interface StartWardrobeRuntimeRunInput {
  readonly userId: number;
  readonly requestId?: string;
  readonly request: WardrobeRequest;
  readonly attachments: readonly ChatAttachment[];
  readonly model: string;
  readonly baseUrl: string;
  readonly conversationPublicId: string;
  readonly conversationContext?: string;
}

export async function startRun(
  input: StartWardrobeRuntimeRunInput,
): Promise<{ runId: string; status: WardrobeRunStatus }> {
  const photos = input.attachments
    .filter(
      (attachment): attachment is Extract<ChatAttachment, { type: "image" }> =>
        attachment.type === "image",
    )
    .map(runtimePhoto);
  if (photos.length < 1 || photos.length > 10) {
    throw new TypeError("Wardrobe requires between one and ten photos.");
  }
  const run = await startOuterAgentRun({
    kind: "wardrobe",
    userId: input.userId,
    requestId: input.requestId,
    requestPayload: {
      request: input.request,
      model: input.model,
      baseUrl: input.baseUrl,
      conversationPublicId: input.conversationPublicId,
      conversationContext: input.conversationContext ?? "",
      photos: photos.map(({ name, mediaType, sizeBytes }) => ({
        name,
        mediaType,
        sizeBytes,
      })),
    },
    inputBlobs: photos.map((photo) => photo.input),
  });
  return {
    runId: run.runId,
    status: run.status === "planning" ? "running" : run.status,
  };
}

export async function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): Promise<WardrobeEvent[]> {
  return [
    ...(await readOuterAgentRunView("wardrobe", userId, runId, since)).events,
  ];
}

export async function isTerminal(
  userId: number,
  runId: string,
): Promise<boolean> {
  return (await readOuterAgentRunView("wardrobe", userId, runId, 0)).terminal;
}

export async function abortRun(
  userId: number,
  runId: string,
): Promise<boolean> {
  return abortOuterAgentRun("wardrobe", userId, runId);
}
