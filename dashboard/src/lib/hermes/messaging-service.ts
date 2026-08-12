// Outbound messaging: "send this to my WhatsApp", "put that on my Telegram".
//
// Both messaging links were built inbound-first — a message arrives, Breadboard
// answers it on the thread it came from. Nothing could start a message. This is
// that missing direction, and it is deliberately the narrowest version of it:
//
//   * The destination is never an argument. The model supplies what to say and
//     which app; where it lands is decided here from the owner's own linked
//     account (see ../messaging/self-target.ts). There is no parameter a
//     prompt-injected instruction could aim at somebody else.
//   * One send per call, rate-limited per user, with a length ceiling. A
//     messaging account that starts emitting bulk traffic gets restricted by
//     WhatsApp, so the cap protects the user's account, not just their attention.
//   * An artifact is attached by id, and the id is resolved against the caller's
//     own conversation before a path is produced.

import fs from "node:fs";

import {
  artifactDeliveryFile,
  getArtifactById,
  type ArtifactRow,
} from "./artifact-store.ts";
import {
  explainSelfTargetFailure,
  resolveTelegramSelfTarget,
  resolveWhatsAppSelfTarget,
  type SelfTarget,
} from "../messaging/self-target.ts";
import { normalizeWhatsAppIdentifier } from "../whatsapp/identity.ts";
import { whatsAppFeatureEnabled } from "../whatsapp/config.ts";
import { telegramFeatureEnabled } from "../telegram/config.ts";

export const MESSAGING_CHANNELS = ["whatsapp", "telegram"] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

/**
 * Ceilings per channel. WhatsApp's is the same 4,000 the inbound reply path
 * uses; Telegram's is its own larger limit. Both are enforced before the send
 * so an over-long message is a clear refusal rather than a silent truncation
 * halfway through a chunked delivery.
 */
const MAX_TEXT_CHARS: Record<MessagingChannel, number> = {
  whatsapp: 4_000,
  telegram: 12_000,
};

/** Attachments above this are refused rather than pushed through a phone. */
const MAX_ATTACHMENT_BYTES = 40 * 1024 * 1024;

/** A send takes a slot; the window keeps a runaway loop off the user's account. */
const RATE_LIMIT = { max: 6, windowMs: 60_000 };

export class MessagingServiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MessagingServiceError";
    this.code = code;
  }
}

export interface SendOwnerMessageInput {
  channel: MessagingChannel;
  text: string;
  /** Optional artifact to attach, scoped to the caller's conversation. */
  artifactId?: string | null;
  userId: number;
  conversationId: number;
}

export interface SendOwnerMessageResult {
  channel: MessagingChannel;
  /** Where it went, in human terms. The raw chat id is never returned. */
  destination: string;
  characters: number;
  attachment: { filename: string; byteSize: number; rendered: boolean } | null;
  sentAt: string;
}

interface RateWindow {
  hits: number[];
}

const globals = globalThis as typeof globalThis & {
  __breadboardMessagingRate?: Map<string, RateWindow>;
};

function rateWindows(): Map<string, RateWindow> {
  if (!globals.__breadboardMessagingRate) globals.__breadboardMessagingRate = new Map();
  return globals.__breadboardMessagingRate;
}

function claimRateSlot(userId: number, channel: MessagingChannel): void {
  const key = `${userId}:${channel}`;
  const now = Date.now();
  const window = rateWindows().get(key) ?? { hits: [] };
  window.hits = window.hits.filter((at) => now - at < RATE_LIMIT.windowMs);
  if (window.hits.length >= RATE_LIMIT.max) {
    throw new MessagingServiceError(
      "messaging_rate_limited",
      `That is more than ${RATE_LIMIT.max} messages in a minute. Messaging accounts get restricted for bursts like that, so this one was not sent.`,
    );
  }
  window.hits.push(now);
  rateWindows().set(key, window);
}

export function normalizeChannel(value: unknown): MessagingChannel {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "whatsapp" || text === "wa") return "whatsapp";
  if (text === "telegram" || text === "tg") return "telegram";
  throw new MessagingServiceError(
    "messaging_unknown_channel",
    "Choose either whatsapp or telegram.",
  );
}

function requireText(text: unknown, channel: MessagingChannel): string {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) {
    throw new MessagingServiceError(
      "messaging_empty_message",
      "There is nothing to send — supply the message text.",
    );
  }
  const limit = MAX_TEXT_CHARS[channel];
  if (value.length > limit) {
    throw new MessagingServiceError(
      "messaging_message_too_long",
      `That message is ${value.length} characters; ${channel} messages are capped at ${limit}. Shorten it or send a summary.`,
    );
  }
  return value;
}

/**
 * Resolve an attachment. The artifact must belong to this user *and* to the
 * conversation the send is happening in — an artifact id is guessable enough
 * that ownership alone would let one chat exfiltrate another chat's output to a
 * phone.
 */
function resolveAttachment(input: {
  artifactId: string;
  userId: number;
  conversationId: number;
}): { artifact: ArtifactRow; file: ReturnType<typeof artifactDeliveryFile> } {
  const artifact = getArtifactById(input.artifactId);
  if (!artifact || artifact.user_id !== input.userId) {
    throw new MessagingServiceError("messaging_artifact_not_found", "No such artifact.");
  }
  if (artifact.conversation_id !== input.conversationId) {
    throw new MessagingServiceError(
      "messaging_artifact_out_of_scope",
      "That artifact belongs to a different chat.",
    );
  }
  if (artifact.status !== "ready") {
    throw new MessagingServiceError(
      "messaging_artifact_not_ready",
      "That artifact is not finished rendering yet.",
    );
  }
  const file = artifactDeliveryFile(artifact);
  if (file.byteSize > MAX_ATTACHMENT_BYTES) {
    throw new MessagingServiceError(
      "messaging_attachment_too_large",
      `That file is ${Math.round(file.byteSize / (1024 * 1024))} MB, over the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit for a phone message.`,
    );
  }
  return { artifact, file };
}

async function whatsAppTarget(): Promise<SelfTarget> {
  if (!whatsAppFeatureEnabled()) {
    throw new MessagingServiceError(
      "messaging_channel_disabled",
      "The WhatsApp link is turned off in this Breadboard.",
    );
  }
  const { getWhatsAppStore } = await import("../whatsapp/instance.ts");
  const store = getWhatsAppStore();
  const settings = store.settings();
  if (settings.ownerUserId === null) {
    throw new MessagingServiceError(
      "messaging_not_linked",
      explainSelfTargetFailure("whatsapp_not_linked"),
    );
  }
  const resolved = resolveWhatsAppSelfTarget({
    linkedNumber: settings.linkedNumber,
    linkedName: settings.linkedName,
    chats: store.listChats(settings.ownerUserId, 100),
    normalize: normalizeWhatsAppIdentifier,
  });
  if (!resolved.ok) {
    throw new MessagingServiceError(
      "messaging_not_linked",
      explainSelfTargetFailure(resolved.reason),
    );
  }
  return resolved.target;
}

async function telegramTarget(): Promise<{ target: SelfTarget; token: string }> {
  if (!telegramFeatureEnabled()) {
    throw new MessagingServiceError(
      "messaging_channel_disabled",
      "The Telegram link is turned off in this Breadboard.",
    );
  }
  const { readBotToken } = await import("../telegram/credentials.ts");
  const token = readBotToken();
  const { getTelegramStore } = await import("../telegram/instance.ts");
  const store = getTelegramStore();
  const settings = store.settings();
  const resolved = resolveTelegramSelfTarget({
    linked: Boolean(token) && Boolean(settings.botId),
    ownerUserId: settings.ownerUserId,
    chats: settings.ownerUserId === null ? [] : store.listChats(settings.ownerUserId, 100),
  });
  if (!resolved.ok || !token) {
    throw new MessagingServiceError(
      "messaging_not_linked",
      explainSelfTargetFailure(resolved.ok ? "telegram_not_linked" : resolved.reason),
    );
  }
  return { target: resolved.target, token };
}

/**
 * Send one message to the owner's own thread on the chosen app.
 *
 * Throws `MessagingServiceError` for every foreseeable refusal so the caller can
 * turn a code into an HTTP status; anything else escaping is a genuine bug.
 */
export interface OwnerMessagePreview {
  deliverable: boolean;
  channel: MessagingChannel;
  /** Where it would go, in the same words the real result uses. */
  destination: string | null;
  characters: number;
  /** Why it could not be delivered, when `deliverable` is false. */
  reason: string | null;
}

/**
 * Resolve where a message *would* go, and whether it could be sent at all,
 * without sending anything.
 *
 * This exists for the gadget approval queue: an action is described, simulated,
 * and queued long before anyone approves it, and a simulation that said "this
 * will be delivered" for an unlinked account would be a lie the user only
 * discovers after approving. It deliberately claims no rate slot — nothing is
 * being sent — and swallows the refusal codes into `reason` rather than
 * throwing, because "you cannot send this" is a normal simulation result.
 */
export async function previewOwnerMessage(input: {
  channel: unknown;
  text: unknown;
}): Promise<OwnerMessagePreview> {
  const channel = normalizeChannel(input.channel);
  let characters = 0;
  try {
    characters = requireText(input.text, channel).length;
  } catch (cause) {
    return {
      deliverable: false,
      channel,
      destination: null,
      characters: typeof input.text === "string" ? input.text.length : 0,
      reason: cause instanceof Error ? cause.message : "The message text is not valid.",
    };
  }
  try {
    if (channel === "whatsapp") {
      const target = await whatsAppTarget();
      return {
        deliverable: true,
        channel,
        destination: `your own WhatsApp chat (${target.label})`,
        characters,
        reason: null,
      };
    }
    const { target } = await telegramTarget();
    return {
      deliverable: true,
      channel,
      destination: `your Telegram chat with ${target.label}`,
      characters,
      reason: null,
    };
  } catch (cause) {
    return {
      deliverable: false,
      channel,
      destination: null,
      characters,
      reason:
        cause instanceof MessagingServiceError
          ? cause.message
          : `${channel} is not available right now.`,
    };
  }
}

export async function sendOwnerMessage(
  input: SendOwnerMessageInput,
): Promise<SendOwnerMessageResult> {
  const channel = normalizeChannel(input.channel);
  const text = requireText(input.text, channel);
  const attachment = input.artifactId?.trim()
    ? resolveAttachment({
        artifactId: input.artifactId.trim(),
        userId: input.userId,
        conversationId: input.conversationId,
      })
    : null;

  claimRateSlot(input.userId, channel);

  let destination: string;
  if (channel === "whatsapp") {
    const target = await whatsAppTarget();
    const { getWhatsAppBridge } = await import("../whatsapp/bridge.ts");
    const bridge = getWhatsAppBridge();
    if (bridge.currentState() !== "connected") {
      throw new MessagingServiceError(
        "messaging_channel_offline",
        "WhatsApp is linked but not connected right now. Open Settings → Messaging → WhatsApp and press Connect.",
      );
    }
    try {
      if (attachment) {
        await bridge.sendMedia(target.chatId, {
          filePath: attachment.file.absolutePath,
          fileName: attachment.file.filename,
          caption: text,
        });
      } else {
        await bridge.sendMessage(target.chatId, text);
      }
    } catch (cause) {
      throw new MessagingServiceError(
        "messaging_send_failed",
        cause instanceof Error ? cause.message : "WhatsApp refused the message.",
      );
    }
    destination = `your own WhatsApp chat (${target.label})`;
  } else {
    const { target, token } = await telegramTarget();
    const { sendDocument, sendMessage } = await import("../telegram/client.ts");
    try {
      if (attachment) {
        await sendDocument(
          token,
          target.chatId,
          {
            bytes: fs.readFileSync(attachment.file.absolutePath),
            filename: attachment.file.filename,
            mimeType: attachment.file.mimeType,
          },
          // Telegram caps a caption at 1,024 characters. Anything longer is
          // sent as its own message first so nothing is quietly lost.
          text.length <= 1_024 ? text : undefined,
        );
        if (text.length > 1_024) await sendMessage(token, target.chatId, text);
      } else {
        await sendMessage(token, target.chatId, text);
      }
    } catch (cause) {
      throw new MessagingServiceError(
        "messaging_send_failed",
        cause instanceof Error ? cause.message : "Telegram refused the message.",
      );
    }
    destination = `your Telegram chat with ${target.label}`;
  }

  return {
    channel,
    destination,
    characters: text.length,
    attachment: attachment
      ? {
          filename: attachment.file.filename,
          byteSize: attachment.file.byteSize,
          rendered: attachment.file.rendered,
        }
      : null,
    sentAt: new Date().toISOString(),
  };
}

/** HTTP status for each refusal, so the route stays a thin translation. */
export function statusForMessagingError(code: string): number {
  switch (code) {
    case "messaging_unknown_channel":
    case "messaging_empty_message":
    case "messaging_message_too_long":
    case "messaging_attachment_too_large":
      return 400;
    case "messaging_artifact_out_of_scope":
      return 403;
    case "messaging_artifact_not_found":
      return 404;
    case "messaging_artifact_not_ready":
    case "messaging_not_linked":
    case "messaging_channel_disabled":
      return 409;
    case "messaging_rate_limited":
      return 429;
    case "messaging_channel_offline":
      return 503;
    case "messaging_send_failed":
      return 502;
    default:
      return 400;
  }
}
