// The Telegram gateway loop: drain the connection, run each message through the
// Breadboard chat pipeline, send the answer back.
//
// Like the scheduled-chat scheduler and the WhatsApp gateway, this lives in the
// Next.js server process — Breadboard's only long-lived process — and is started
// from src/instrumentation-node.ts. Work is serialized per Telegram chat so a
// burst of messages cannot open two turns on one conversation (the transcript
// reserves adjacent slots and would reject the second), while different chats
// still run concurrently. A burst is answered as one turn, and a text sent
// mid-answer steers it (see ChatMailbox).

import { getMe, TelegramApiError } from "./client.ts";
import { telegramTimings } from "./config.ts";
import { readBotToken, tokenIsFromEnvironment, writeBotToken, clearBotToken } from "./credentials.ts";
import {
  getTelegramGateway,
  type TelegramGatewaySnapshot,
  type TelegramInboundMessage,
} from "./gateway.ts";
import { TelegramError } from "./store.ts";

// The store and the router are imported lazily throughout this module: it is
// reached from src/instrumentation-node.ts at boot, and `inbound.ts` pulls in the
// whole conversation/runtime stack. A failure to load that stack must degrade
// Telegram, not stop the server from starting. `gateway.ts` above uses fetch and
// node built-ins only, so it is safe to load eagerly.
async function store() {
  return (await import("./instance.ts")).getTelegramStore();
}

type ServiceGlobals = typeof globalThis & {
  __breadboardTelegramPoll?: ReturnType<typeof setInterval>;
  __breadboardTelegramPolling?: boolean;
  __breadboardTelegramMailboxes?: Map<string, ChatMailbox>;
};

const globals = globalThis as ServiceGlobals;

/**
 * One per Telegram chat. Texts that arrive while nothing is running wait a
 * short beat and are answered together, like a person reading a burst of
 * messages before replying. Texts that arrive mid-answer steer the running
 * turn; whatever cannot be steered is answered together once it finishes.
 */
interface ChatMailbox {
  pending: TelegramInboundMessage[];
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  steer: ((message: TelegramInboundMessage) => Promise<boolean>) | null;
}

/** Quiet time before answering, so "hey" then "can you..." become one turn. */
const BURST_QUIET_MS = 1_500;
/** Telegram clears a chat action after about 5 s; refresh it while the turn runs. */
const STEER_ATTEMPTS = 6;
const STEER_RETRY_MS = 1_000;
const TYPING_REFRESH_MS = 4_500;

function mailbox(chatId: string): ChatMailbox {
  if (!globals.__breadboardTelegramMailboxes) globals.__breadboardTelegramMailboxes = new Map();
  const boxes = globals.__breadboardTelegramMailboxes;
  let box = boxes.get(chatId);
  if (!box) {
    box = { pending: [], running: false, timer: null, steer: null };
    boxes.set(chatId, box);
  }
  return box;
}

const isCommand = (message: TelegramInboundMessage) => !message.hasMedia && message.body.trim().startsWith("/");

/** Merge a burst into the one message the agent answers. Commands stay alone. */
export function takeTelegramBurst(pending: TelegramInboundMessage[]): TelegramInboundMessage | null {
  const first = pending.shift();
  if (!first || isCommand(first)) return first ?? null;
  const merged = { ...first, attachments: [...(first.attachments ?? [])] };
  while (pending.length && !isCommand(pending[0])) {
    const next = pending.shift()!;
    merged.body = [merged.body, next.body].filter(Boolean).join("\n");
    merged.attachments.push(...(next.attachments ?? []));
    merged.hasMedia ||= next.hasMedia;
    merged.mediaType ||= next.mediaType;
    merged.fileName ||= next.fileName;
    // The last id names the turn, so a replayed burst cannot answer twice.
    merged.messageId = next.messageId;
    merged.updateId = next.updateId;
  }
  return merged;
}

function schedule(chatId: string, box: ChatMailbox): void {
  if (box.timer) clearTimeout(box.timer);
  box.timer = setTimeout(() => {
    box.timer = null;
    void drainMailbox(chatId);
  }, BURST_QUIET_MS);
  box.timer.unref?.();
}

function enqueue(message: TelegramInboundMessage): void {
  const box = mailbox(message.chatId);
  void getTelegramGateway().sendTyping(message.chatId);
  if (box.running && box.steer && !box.pending.length) {
    const steer = box.steer;
    const queue = () => {
      box.pending.push(message);
      // The turn may have ended while Hermes was refusing the steer.
      if (!box.running) schedule(message.chatId, box);
    };
    void steer(message).then((steered) => { if (!steered) queue(); }, queue);
    return;
  }
  box.pending.push(message);
  if (!box.running) schedule(message.chatId, box);
}

async function drainMailbox(chatId: string): Promise<void> {
  const box = mailbox(chatId);
  if (box.running) return;
  box.running = true;
  try {
    for (let message = takeTelegramBurst(box.pending); message; message = takeTelegramBurst(box.pending)) {
      // A turn that throws (for example a half-edited source module that fails
      // to import) must neither kill this process, which once took Telegram
      // down for hours, nor leave the sender waiting in silence.
      await handleMessage(message, box).catch((cause) => {
        process.stderr.write(`[telegram] turn failed: ${cause instanceof Error ? cause.message : String(cause)}\n`);
        return getTelegramGateway()
          .sendMessage(chatId, "Something went wrong on my side and I could not answer that. Try again in a moment.")
          .catch(() => undefined);
      });
    }
  } finally {
    box.running = false;
    box.steer = null;
  }
}

function uploadAction(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "upload_photo";
  if (mimeType.startsWith("video/")) return "upload_video";
  if (mimeType.startsWith("audio/")) return "upload_voice";
  return "upload_document";
}

/** Send the files a turn produced right after its text, each once. */
async function sendTurnMedia(
  chatId: string,
  turn: { conversationId: number; clientMessageId: string },
  content: string,
  sent: Set<string>,
): Promise<void> {
  const gateway = getTelegramGateway();
  const { telegramTurnMedia } = await import("./inbound.ts");
  const { readFileSync } = await import("node:fs");
  const { files, imageUrls } = telegramTurnMedia(turn, content, sent);
  for (const file of files) {
    sent.add(file.artifactId);
    void gateway.sendTyping(chatId, uploadAction(file.mimeType));
    await gateway.sendMedia(chatId, {
      bytes: readFileSync(file.absolutePath),
      filename: file.filename,
      mimeType: file.mimeType,
    }).catch(() => undefined);
  }
  for (const url of imageUrls) {
    if (sent.has(url)) continue;
    sent.add(url);
    await gateway.sendPhotoUrl(chatId, url).catch(() => undefined);
  }
}

async function handleMessage(message: TelegramInboundMessage, box: ChatMailbox): Promise<void> {
  const gateway = getTelegramGateway();
  const {
    deliverTelegramFollowUps,
    deliverTelegramLateReply,
    routeTelegramMessage,
    steerTelegramTurn,
  } = await import("./inbound.ts");
  const messages = await store();

  void gateway.sendTyping(message.chatId);
  const typing = setInterval(() => void gateway.sendTyping(message.chatId), TYPING_REFRESH_MS);
  typing.unref?.();
  let outcome: Awaited<ReturnType<typeof routeTelegramMessage>>;
  try {
    outcome = await routeTelegramMessage(message, {
      store: messages,
      onTurnStarted: (conversation) => {
        // Hermes registers the run a moment after the turn starts, so a text
        // landing in that gap retries briefly instead of waiting for the end.
        const steer = async (next: TelegramInboundMessage): Promise<boolean> => {
          for (let attempt = 0; attempt < STEER_ATTEMPTS; attempt += 1) {
            if (await steerTelegramTurn(conversation, next)) return true;
            if (box.steer !== steer) return false;
            await new Promise((resolve) => setTimeout(resolve, STEER_RETRY_MS));
          }
          return false;
        };
        box.steer = steer;
        // Texts sent while the turn was still starting (a cold Hermes takes
        // seconds) are steered now rather than answered after the reply.
        const early = box.pending.filter((next) => !next.hasMedia && !next.body.trim().startsWith("/"));
        if (!early.length) return;
        box.pending = box.pending.filter((next) => !early.includes(next));
        void (async () => {
          for (const next of early) {
            if (await steer(next).catch(() => false)) continue;
            box.pending.push(next);
            if (!box.running) schedule(message.chatId, box);
          }
        })();
      },
    });
  } finally {
    box.steer = null;
    clearInterval(typing);
  }
  if (outcome.status === "ignored") {
    // Surfacing who was turned away is what makes the allowlist usable: the panel
    // offers to admit them instead of asking for a numeric id nobody knows.
    if (outcome.reason === "not_allowed") gateway.noteBlockedSender(message);
    return;
  }
  const sent = new Set<string>();
  try {
    await gateway.sendMessage(message.chatId, outcome.reply);
    if (outcome.status === "replied") {
      const turn = outcome.turn;
      if (turn) await sendTurnMedia(message.chatId, turn, outcome.reply, sent);
      if (outcome.delegatedFollowUp) {
        await deliverTelegramFollowUps(outcome.delegatedFollowUp, async (reply) => {
          await gateway.sendMessage(message.chatId, reply);
          if (turn) await sendTurnMedia(message.chatId, turn, reply, sent);
        });
      }
    }
  } catch {
    // A failed delivery leaves the answer in the durable transcript, which is
    // where the user can still read it. Retrying risks duplicate replies.
  }
  if (outcome.status === "failed" && outcome.lateReply) {
    const late = outcome.lateReply;
    // Detached: watching an hours-long turn must not block this chat's queue.
    void deliverTelegramLateReply(outcome.lateReply, async (reply) => {
      await gateway.sendMessage(message.chatId, reply);
      await sendTurnMedia(message.chatId, late, reply, sent);
    }).catch(() => {});
  }
}

async function pollOnce(): Promise<void> {
  const gateway = getTelegramGateway();
  if (gateway.currentState() !== "connected") return;
  const drained = gateway.drainMessages();
  if (drained.length) {
    const messages = await store();
    for (const message of drained) {
      if (!message.chatId) continue;
      // Telegram replays unacknowledged updates on reconnect; one id may only
      // ever reach the agent once.
      if (!messages.claimMessage(message.messageId)) continue;
      enqueue(message);
    }
  }
  const owner = (await store()).settings().ownerUserId;
  if (owner !== null) {
    const { queueMessagingNotifications } = await import("../messaging-notifications/instance.ts");
    queueMessagingNotifications(owner, "telegram", (chatId, text) =>
      gateway.sendMessage(chatId, `🌱 Breadboard\n\n${text}`));
  }
}

/** Start the process-wide drain loop. Safe to call repeatedly (dev hot reloads). */
export function startTelegramDrainLoop(): void {
  if (globals.__breadboardTelegramPoll) return;
  const tick = async () => {
    if (globals.__breadboardTelegramPolling) return;
    globals.__breadboardTelegramPolling = true;
    try {
      await pollOnce();
    } catch {
      // A failed drain is retried on the next tick; the gateway keeps the queue.
    } finally {
      globals.__breadboardTelegramPolling = false;
    }
  };
  const timer = setInterval(() => void tick(), telegramTimings().drainIntervalMs);
  timer.unref();
  globals.__breadboardTelegramPoll = timer;
}

/**
 * Accept a token from BotFather: check it against Telegram, store it out of the
 * browser's reach, and bring the connection up. The check is the whole point of
 * doing this server-side — a typo is reported here rather than as a connection
 * that silently never receives anything.
 */
export async function linkTelegramBot(
  userId: number,
  token: string,
): Promise<TelegramGatewaySnapshot> {
  const trimmed = String(token ?? "").trim();
  if (!trimmed) throw new TelegramError(400, "Paste the token BotFather gave you.");

  let identity;
  try {
    identity = await getMe(trimmed);
  } catch (cause) {
    if (cause instanceof TelegramApiError) {
      throw new TelegramError(400, `Telegram did not accept that token: ${cause.message}`);
    }
    throw cause;
  }

  const settings = await store();
  settings.claimOwner(userId);
  if (!tokenIsFromEnvironment()) writeBotToken(trimmed);
  settings.recordBot({ id: identity.id, username: identity.username, name: identity.name });
  return startTelegramGateway();
}

/** Connect using the stored token, then keep draining it. */
export async function startTelegramGateway(): Promise<TelegramGatewaySnapshot> {
  const token = readBotToken();
  if (!token) throw new TelegramError(400, "Add a bot token before connecting.");

  const settings = await store();
  // Environment-provided bots may never have passed through the link form.
  // Persist their identity so notification preferences bind to the actual bot.
  if (!settings.settings().botId || tokenIsFromEnvironment()) {
    const identity = await getMe(token);
    settings.recordBot({ id: identity.id, username: identity.username, name: identity.name });
  }
  const gateway = getTelegramGateway();
  await gateway.start({
    token,
    offset: settings.settings().lastUpdateId,
    onOffset: (offset) => {
      // Acknowledging durably is what stops a restart from replaying — and
      // re-answering — everything Telegram still holds.
      settings.recordOffset(offset);
    },
  });
  startTelegramDrainLoop();
  return gateway.snapshot();
}

export async function stopTelegramGateway(): Promise<TelegramGatewaySnapshot> {
  const gateway = getTelegramGateway();
  await gateway.stop();
  return gateway.snapshot();
}

/** Stop the connection and forget the bot token. */
export async function unlinkTelegramBot(): Promise<TelegramGatewaySnapshot> {
  // Refused before anything is stopped: an unlink that cannot finish must not
  // leave the connection down as a side effect.
  if (tokenIsFromEnvironment()) {
    throw new TelegramError(
      400,
      "This bot token comes from the environment (BREADBOARD_TELEGRAM_BOT_TOKEN) and has to be removed there.",
    );
  }
  const gateway = getTelegramGateway();
  await gateway.stop();
  clearBotToken();
  (await store()).clearBot();
  return gateway.snapshot();
}
