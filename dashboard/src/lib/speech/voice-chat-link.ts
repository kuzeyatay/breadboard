import type { VoiceMessage } from './voice-conversation';
import type { SpokenExchange } from './chatgpt-voice';
import type { ChatNotificationTarget } from '../chat-notification-inbox';
import { parseVoiceScreenContext, type VoiceScreenContext } from './voice-screen-context.ts';

export interface VoiceChatSnapshot {
  notificationTarget?: ChatNotificationTarget | null;
  messages: readonly VoiceMessage[];
  busy: boolean;
  clarification?: { requestId: string; question: string } | null;
  /** The chat can save ChatGPT voice exchanges handed to it. */
  recordable?: boolean;
  /** The originating composer permits personal greeting suggestions. */
  personalizedGreeting?: boolean;
}

function spokenExchange(value: unknown): value is SpokenExchange {
  const row = value as SpokenExchange | null;
  return Boolean(row) && typeof row!.clientMessageId === 'string' && row!.clientMessageId.length <= 200 &&
    typeof row!.user === 'string' && typeof row!.assistant === 'string' && row!.user.length + row!.assistant.length <= 200_000;
}

const channelName = (key: string) => `breadboard:voice-chat:${key}`;
const targets = new Map<string, () => HTMLElement | null>();
let focusedKey: string | undefined;

export function activeVoiceChatKey(): string | undefined {
  const visible = [...targets].filter(([, element]) => {
    const node = element();
    return node?.getClientRects().length && !node.closest('[inert], [hidden], [aria-hidden="true"]');
  });
  return visible.find(([, element]) => element() === document.activeElement)?.[0]
    ?? visible.find(([key]) => key === focusedKey)?.[0]
    ?? (visible.length === 1 ? visible[0][0] : undefined);
}

/** A detached voice view delegates to the originating composer, including for
 * a blank chat whose durable id does not exist until its first spoken turn. */
export function createVoiceChatHost(initial: VoiceChatSnapshot, send: (text: string, screen?: VoiceScreenContext) => void | Promise<void>, element?: () => HTMLElement | null, interrupt?: () => void,
  record?: (exchange: SpokenExchange) => Promise<void>) {
  const key = crypto.randomUUID();
  const channel = new BroadcastChannel(channelName(key));
  let snapshot = initial;
  let client: string | null = null;
  let closed = false;
  const received = new Set<string>();
  // ChatGPT voice exchanges, saved in the order they were said.
  let recording = Promise.resolve();
  const focus = () => { if (element?.() === document.activeElement) focusedKey = key; };
  if (element) { targets.set(key, element); document.addEventListener('focusin', focus); }
  const post = (type: string, extra = {}) => { if (!closed) channel.postMessage({ type, client, ...extra }); };
  channel.onmessage = ({ data }) => {
    if (!data || typeof data.client !== 'string') return;
    if (data.type === 'connect') {
      if (client && client !== data.client) post('closed');
      client = data.client;
      post('snapshot', { snapshot });
    } else if (data.client === client) {
      if (data.type === 'disconnect') { client = null; return; }
      if (data.type === 'ping') post('alive');
      if (data.type === 'interrupt' && snapshot.busy && !snapshot.clarification) interrupt?.();
      if (data.type === 'send' && typeof data.id === 'string' && !received.has(data.id) &&
          typeof data.text === 'string' && data.text.trim() && data.text.length <= 20_000) {
        received.add(data.id);
        if (received.size > 128) received.delete(received.values().next().value!);
        const screen = parseVoiceScreenContext(data.screen);
        void Promise.resolve().then(() => send(data.text, screen)).catch(error => post('send-error', { message: error instanceof Error ? error.message : 'The spoken request could not be sent.' }));
      }
      if (data.type === 'record' && record && spokenExchange(data.exchange) && !received.has(data.exchange.clientMessageId)) {
        const exchange = data.exchange;
        received.add(exchange.clientMessageId);
        if (received.size > 128) received.delete(received.values().next().value!);
        recording = recording.then(() => record(exchange)).catch(error => post('send-error', { message: error instanceof Error ? error.message : 'Part of the conversation could not be saved.' }));
      }
    }
  };
  return {
    key,
    update(next: VoiceChatSnapshot) { snapshot = next; if (client) post('snapshot', { snapshot }); },
    close() {
      if (closed) return;
      if (client) post('closed');
      closed = true;
      channel.close();
      targets.delete(key);
      if (element) document.removeEventListener('focusin', focus);
      if (focusedKey === key) focusedKey = undefined;
    },
  };
}

/** A missing host is a disconnected chat, never permission to create another. */
export function connectVoiceChat(key: string, onSnapshot: (snapshot: VoiceChatSnapshot) => void, onClosed: () => void, onError?: (message: string) => void) {
  const client = crypto.randomUUID();
  const channel = new BroadcastChannel(channelName(key));
  let connected = false;
  let closed = false;
  let lastSeen = Date.now();
  const post = (type: string, extra = {}) => channel.postMessage({ type, client, ...extra });
  const close = () => {
    if (closed) return;
    if (connected) post('disconnect');
    closed = true;
    clearInterval(heartbeat);
    channel.close();
  };
  const disconnect = () => { close(); onClosed(); };
  channel.onmessage = ({ data }) => {
    if (closed || data?.client !== client) return;
    lastSeen = Date.now();
    if (data.type === 'closed') { disconnect(); return; }
    if (data.type === 'send-error' && typeof data.message === 'string') onError?.(data.message);
    if (data.type === 'snapshot' && Array.isArray(data.snapshot?.messages) && typeof data.snapshot.busy === 'boolean') {
      connected = true;
      onSnapshot(data.snapshot);
    }
  };
  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > 10_000) { disconnect(); return; }
    post(connected ? 'ping' : 'connect');
  }, 2000);
  post('connect');
  return {
    interrupt() { if (connected && !closed) post('interrupt'); },
    send(text: string, screen?: VoiceScreenContext) { if (connected && !closed) post('send', { id: crypto.randomUUID(), text, screen: parseVoiceScreenContext(screen) }); },
    /** Hands a ChatGPT voice exchange to the chat to save. */
    async record(exchange: SpokenExchange) {
      if (!connected || closed) throw new Error('The original chat is no longer connected.');
      post('record', { exchange });
    },
    close,
  };
}
