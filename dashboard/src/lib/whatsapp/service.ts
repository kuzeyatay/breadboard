// The WhatsApp gateway loop: drain the bridge, run each message through the
// Breadboard chat pipeline, send the answer back.
//
// Like the scheduled-chat scheduler, this lives in the Next.js server process —
// Breadboard's only long-lived process — and is started from
// src/instrumentation-node.ts. Work is serialized per WhatsApp chat so a burst of
// messages cannot open two turns on one conversation (the transcript reserves
// adjacent slots and would reject the second), while different chats still run
// concurrently.

import {
  getWhatsAppBridge,
  type WhatsAppBridgeSnapshot,
  type WhatsAppInboundMessage,
} from "./bridge.ts";
import { whatsAppFeatureEnabled, whatsAppTimings } from "./config.ts";

// The store and the router are imported lazily throughout this module: it is
// reached from src/instrumentation-node.ts at boot, and `inbound.ts` pulls in the
// whole conversation/runtime stack. A failure to load that stack must degrade
// WhatsApp, not stop the server from starting. `bridge.ts` above uses node
// built-ins only, so it is safe to load eagerly.
async function store() {
  return (await import("./instance.ts")).getWhatsAppStore();
}

type ServiceGlobals = typeof globalThis & {
  __breadboardWhatsAppPoll?: ReturnType<typeof setInterval>;
  __breadboardWhatsAppPolling?: boolean;
  __breadboardWhatsAppChains?: Map<string, Promise<void>>;
  __breadboardWhatsAppAutostarted?: boolean;
};

const globals = globalThis as ServiceGlobals;

function chains(): Map<string, Promise<void>> {
  if (!globals.__breadboardWhatsAppChains) globals.__breadboardWhatsAppChains = new Map();
  return globals.__breadboardWhatsAppChains;
}

/** Queue work behind anything already running for the same WhatsApp chat. */
function serialize(chatId: string, work: () => Promise<void>): void {
  const queue = chains();
  const previous = queue.get(chatId) ?? Promise.resolve();
  const next = previous.then(work, work).finally(() => {
    if (queue.get(chatId) === next) queue.delete(chatId);
  });
  queue.set(chatId, next);
}

async function handleMessage(message: WhatsAppInboundMessage): Promise<void> {
  const bridge = getWhatsAppBridge();
  const { routeWhatsAppMessage } = await import("./inbound.ts");
  const messages = await store();

  // WhatsApp redelivers on reconnect; one id may only ever produce one turn.
  if (!messages.claimMessage(message.messageId)) return;

  await bridge.sendTyping(message.chatId);
  const outcome = await routeWhatsAppMessage(message, { store: messages });
  if (outcome.status === "ignored") return;
  try {
    await bridge.sendMessage(message.chatId, outcome.reply);
  } catch {
    // A failed delivery leaves the answer in the durable transcript, which is
    // where the user can still read it. Retrying risks duplicate replies.
  }
}

async function pollOnce(): Promise<void> {
  const bridge = getWhatsAppBridge();
  if (bridge.currentState() !== "connected") return;
  const messages = await bridge.drainMessages();
  for (const message of messages) {
    if (!message.chatId) continue;
    serialize(message.chatId, () => handleMessage(message));
  }
}

/** Start the process-wide drain loop. Safe to call repeatedly (dev hot reloads). */
export function startWhatsAppGatewayLoop(): void {
  if (globals.__breadboardWhatsAppPoll) return;
  const tick = async () => {
    if (globals.__breadboardWhatsAppPolling) return;
    globals.__breadboardWhatsAppPolling = true;
    try {
      await pollOnce();
    } catch {
      // A failed drain is retried on the next tick; the bridge keeps the queue.
    } finally {
      globals.__breadboardWhatsAppPolling = false;
    }
  };
  const timer = setInterval(() => void tick(), whatsAppTimings().pollIntervalMs);
  timer.unref();
  globals.__breadboardWhatsAppPoll = timer;
}

/**
 * Begin pairing. Returns as soon as the bridge is generating QR codes; the panel
 * polls the status endpoint for the image. On a successful scan the link is
 * recorded and the gateway comes up on its own, so the user never has to press
 * a second button.
 */
export async function startWhatsAppPairing(userId: number): Promise<WhatsAppBridgeSnapshot> {
  const settings = await store();
  settings.claimOwner(userId);
  const bridge = getWhatsAppBridge();

  bridge.setPairedListener((outcome) => {
    if (outcome.status !== "connected") return;
    settings.recordLink({ number: outcome.number, name: outcome.name });
    void startWhatsAppGateway().catch(() => {
      // Reported through status; the user can retry from the Terminal panel.
    });
  });

  // Deliberately not awaited: pairing only finishes when the QR is scanned.
  void bridge.startPairing().catch(() => undefined);

  // Give the bridge a moment to produce its first QR so the panel can render
  // something immediately instead of an empty box.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && bridge.snapshot().qr === null) {
    if (bridge.currentState() === "error") break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return bridge.snapshot();
}

export async function cancelWhatsAppPairing(): Promise<WhatsAppBridgeSnapshot> {
  const bridge = getWhatsAppBridge();
  bridge.setPairedListener(null);
  await bridge.cancelPairing();
  return bridge.snapshot();
}

/** Stop the bridge and delete the linked-device credentials. */
export async function unlinkWhatsApp(): Promise<WhatsAppBridgeSnapshot> {
  const bridge = getWhatsAppBridge();
  bridge.setPairedListener(null);
  await bridge.unlink();
  (await store()).clearLink();
  return bridge.snapshot();
}

/** Connect the bridge using the stored settings, then keep draining it. */
export async function startWhatsAppGateway(): Promise<WhatsAppBridgeSnapshot> {
  const settings = (await store()).settings();
  const bridge = getWhatsAppBridge();
  await bridge.startGateway(settings.mode, settings.allowedNumbers);
  startWhatsAppGatewayLoop();
  return bridge.snapshot();
}

export async function stopWhatsAppGateway(): Promise<WhatsAppBridgeSnapshot> {
  const bridge = getWhatsAppBridge();
  await bridge.stopGateway();
  return bridge.snapshot();
}

/**
 * Reconnect a previously linked device on boot, so messages sent while the app
 * was closed are answered as soon as it opens. Never throws: a failed autostart
 * is reported through the status endpoint, not by breaking server startup.
 */
export function autostartWhatsAppGateway(): void {
  if (globals.__breadboardWhatsAppAutostarted) return;
  globals.__breadboardWhatsAppAutostarted = true;
  if (!whatsAppFeatureEnabled()) return;

  setTimeout(() => {
    void (async () => {
      try {
        const settings = (await store()).settings();
        if (!settings.autostart || settings.ownerUserId === null) return;
        const bridge = getWhatsAppBridge();
        if (!bridge.snapshot().paired) return;
        await startWhatsAppGateway();
      } catch {
        // Status reports the error; the user can reconnect from the Terminal.
      }
    })();
  }, 8_000).unref?.();
}
