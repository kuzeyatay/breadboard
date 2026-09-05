// The Telegram gateway loop: drain the connection, run each message through the
// Breadboard chat pipeline, send the answer back.
//
// Like the scheduled-chat scheduler and the WhatsApp gateway, this lives in the
// Next.js server process — Breadboard's only long-lived process — and is started
// from src/instrumentation-node.ts. Work is serialized per Telegram chat so a
// burst of messages cannot open two turns on one conversation (the transcript
// reserves adjacent slots and would reject the second), while different chats
// still run concurrently.

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
  __breadboardTelegramChains?: Map<string, Promise<void>>;
};

const globals = globalThis as ServiceGlobals;

function chains(): Map<string, Promise<void>> {
  if (!globals.__breadboardTelegramChains) globals.__breadboardTelegramChains = new Map();
  return globals.__breadboardTelegramChains;
}

/** Queue work behind anything already running for the same Telegram chat. */
function serialize(chatId: string, work: () => Promise<void>): void {
  const queue = chains();
  const previous = queue.get(chatId) ?? Promise.resolve();
  const next = previous.then(work, work).finally(() => {
    if (queue.get(chatId) === next) queue.delete(chatId);
  });
  queue.set(chatId, next);
}

async function handleMessage(message: TelegramInboundMessage): Promise<void> {
  const gateway = getTelegramGateway();
  const { deliverTelegramFollowUps, routeTelegramMessage } = await import("./inbound.ts");
  const messages = await store();

  // Telegram replays unacknowledged updates on reconnect; one id may only ever
  // produce one turn.
  if (!messages.claimMessage(message.messageId)) return;

  const outcome = await routeTelegramMessage(message, { store: messages });
  if (outcome.status === "ignored") {
    // Surfacing who was turned away is what makes the allowlist usable: the panel
    // offers to admit them instead of asking for a numeric id nobody knows.
    if (outcome.reason === "not_allowed") gateway.noteBlockedSender(message);
    return;
  }
  try {
    await gateway.sendMessage(message.chatId, outcome.reply);
    if (outcome.status === "replied" && outcome.delegatedFollowUp) {
      await deliverTelegramFollowUps(
        outcome.delegatedFollowUp,
        (reply) => gateway.sendMessage(message.chatId, reply),
      );
    }
  } catch {
    // A failed delivery leaves the answer in the durable transcript, which is
    // where the user can still read it. Retrying risks duplicate replies.
  }
}

async function pollOnce(): Promise<void> {
  const gateway = getTelegramGateway();
  if (gateway.currentState() !== "connected") return;
  for (const message of gateway.drainMessages()) {
    if (!message.chatId) continue;
    // Answering takes a full agent turn, so the indicator is set before the work
    // is queued rather than after it reaches the front of the queue.
    void gateway.sendTyping(message.chatId);
    serialize(message.chatId, () => handleMessage(message));
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
