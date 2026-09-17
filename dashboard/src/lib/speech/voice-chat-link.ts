import type { VoiceMessage } from './voice-conversation';

export interface VoiceChatSnapshot {
  messages: readonly VoiceMessage[];
  busy: boolean;
  clarification?: { requestId: string; question: string } | null;
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
export function createVoiceChatHost(initial: VoiceChatSnapshot, send: (text: string) => void, element?: () => HTMLElement | null) {
  const key = crypto.randomUUID();
  const channel = new BroadcastChannel(channelName(key));
  let snapshot = initial;
  let client: string | null = null;
  const received = new Set<string>();
  const focus = () => { if (element?.() === document.activeElement) focusedKey = key; };
  if (element) { targets.set(key, element); document.addEventListener('focusin', focus); }
  const post = (type: string, extra = {}) => channel.postMessage({ type, client, ...extra });
  channel.onmessage = ({ data }) => {
    if (!data || typeof data.client !== 'string') return;
    if (data.type === 'connect') {
      if (client && client !== data.client) post('closed');
      client = data.client;
      post('snapshot', { snapshot });
    } else if (data.client === client) {
      if (data.type === 'disconnect') { client = null; return; }
      if (data.type === 'ping') post('alive');
      if (data.type === 'send' && typeof data.id === 'string' && !received.has(data.id) &&
          typeof data.text === 'string' && data.text.trim() && data.text.length <= 20_000) {
        received.add(data.id);
        if (received.size > 128) received.delete(received.values().next().value!);
        send(data.text);
      }
    }
  };
  return {
    key,
    update(next: VoiceChatSnapshot) { snapshot = next; if (client) post('snapshot', { snapshot }); },
    close() {
      if (client) post('closed');
      channel.close();
      targets.delete(key);
      if (element) document.removeEventListener('focusin', focus);
      if (focusedKey === key) focusedKey = undefined;
    },
  };
}

/** A missing host is a disconnected chat, never permission to create another. */
export function connectVoiceChat(key: string, onSnapshot: (snapshot: VoiceChatSnapshot) => void, onClosed: () => void) {
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
    send(text: string) { if (connected && !closed) post('send', { id: crypto.randomUUID(), text }); },
    close,
  };
}
