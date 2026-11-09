import { AUTH_CHANGED_EVENT } from '../auth-events.ts';
import type { PreparedVoiceOpener } from '../recommendations/voice-opener.ts';
import { parseVoiceOpenerContext, type VoiceOpenerContext } from './voice-opener-context.ts';

const GREETINGS = [
  "Hey! What's on your mind?",
  "I'm here. What can I help with?",
  "Hi there! What are we working on?",
  "Ready when you are. What's the plan?",
  "Hey! What would you like to do?",
  "I'm listening. Where should we start?",
  "Hello! What can we figure out together?",
  "You rang? What can I help with?",
  "Hey there! What's next?",
  "All ears. What have you got?",
  "Hi! Want to talk something through?",
  "Hey. Got a question, or something you'd like to make?",
  "Hello. Take your time—I'm here.",
  "Hey! Shall we pick something up or start fresh?",
  "Hi. What's the first thing you'd like to tackle?",
  "Hey there. Let's hear your idea.",
  "Hello! Need a hand with anything?",
  "Hi! We can work on something, or just chat.",
  "Hey. What's been on your mind today?",
  "Hi there. Where shall we begin?",
];
const HISTORY_KEY = 'breadboard:voice:greeting-history:v2';
const TOPIC_COOLDOWN_MS = 6 * 60 * 60_000;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
interface Topic { sourceIds: string[]; at: number }
export interface VoiceGreetingSuggestions { accountId: string; openers: PreparedVoiceOpener[] }
let recentGreetings: string[] = [];
const recentTopics = new Map<string, Topic[]>();

function browserStorage(): StorageLike | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return; }
}
function load(storage: StorageLike | undefined, key: string): unknown {
  try { return JSON.parse(storage?.getItem(key) ?? 'null'); } catch { return null; }
}
function save(storage: StorageLike | undefined, key: string, value: unknown) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* In-memory history still works. */ }
}

/** Synchronous choice: network and model latency can never hold the greeting. */
export function chooseVoiceGreeting(suggestions: VoiceGreetingSuggestions | null = null,
  options: { storage?: StorageLike; now?: number; random?: () => number; onSuggestion?: (context: VoiceOpenerContext) => void } = {}): string {
  const storage = options.storage ?? browserStorage();
  const now = options.now ?? Date.now();
  if (suggestions && /^\d{1,20}$/.test(suggestions.accountId) && Array.isArray(suggestions.openers)) {
    const key = `breadboard:voice:offered-topics:${suggestions.accountId}`;
    const stored = load(storage, key);
    const history = (Array.isArray(stored) ? stored : recentTopics.get(key) ?? []).filter((item): item is Topic =>
      item && Array.isArray(item.sourceIds) && item.sourceIds.every((id: unknown) => typeof id === 'string') &&
      Number.isFinite(item.at) && item.at <= now && now - item.at < TOPIC_COOLDOWN_MS).slice(-16);
    const offered = new Set(history.flatMap(item => item.sourceIds));
    const best = suggestions.openers.filter(item => item && parseVoiceOpenerContext(item) && typeof item.text === 'string' && item.text.length <= 180 &&
      /[?？]$/.test(item.text) && !/[\r\n<>`]|https?:\/\//i.test(item.text) &&
      Number.isInteger(item.score) && item.score >= 7 && item.score <= 8 &&
      item.expiresAt > now && item.expiresAt <= now + 180_000 &&
      Array.isArray(item.sourceIds) && item.sourceIds.length > 0 && item.sourceIds.length <= 3 &&
      item.sourceIds.every(id => typeof id === 'string' && id.length <= 500 && !offered.has(id)))
      .sort((a, b) => b.score - a.score)[0];
    if (best) {
      const next = [...history, { sourceIds: [...best.sourceIds], at: now }].slice(-16);
      recentTopics.set(key, next);
      if (recentTopics.size > 4) recentTopics.delete(recentTopics.keys().next().value!);
      save(storage, key, next);
      options.onSuggestion?.(parseVoiceOpenerContext(best)!);
      return best.text;
    }
  }
  const stored = load(storage, HISTORY_KEY);
  if (Array.isArray(stored)) recentGreetings = stored.filter(item => typeof item === 'string').slice(-6);
  if (!recentGreetings.length) {
    try { const previous = storage?.getItem('breadboard:voice:last-greeting'); if (previous) recentGreetings = [previous]; } catch { /* Optional migration. */ }
  }
  const choices = GREETINGS.filter(greeting => !recentGreetings.includes(greeting));
  const random = Math.max(0, Math.min(0.999999, (options.random ?? Math.random)()));
  const text = choices[Math.floor(random * choices.length)];
  recentGreetings = [...recentGreetings, text].slice(-6);
  save(storage, HISTORY_KEY, recentGreetings);
  return text;
}

/** Read only already-prepared terminal cards, alongside microphone setup.
 * The caller never awaits ready; a slow/missing cache means a varied hello. */
export function prepareVoiceGreeting(options: {
  personalized: () => boolean; signal: AbortSignal; fetcher?: typeof fetch;
  events?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  storage?: StorageLike;
}) {
  const events = options.events ?? (typeof window === 'undefined' ? undefined : window);
  const controller = new AbortController();
  let suggestions: VoiceGreetingSuggestions | null = null;
  let context: VoiceOpenerContext | undefined;
  let active = !options.signal.aborted;
  const cancel = () => {
    active = false; suggestions = null; controller.abort();
    options.signal.removeEventListener('abort', cancel);
    events?.removeEventListener(AUTH_CHANGED_EVENT, cancel);
  };
  options.signal.addEventListener('abort', cancel, { once: true });
  events?.addEventListener(AUTH_CHANGED_EVENT, cancel);
  const ready = (async () => {
    if (!active || !options.personalized()) return;
    try {
      const response = await (options.fetcher ?? fetch)('/api/recommendations', {
        method: 'GET', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1200)]),
      });
      if (!response.ok) return;
      const value = await response.json();
      if (active && options.personalized() && typeof value.accountId === 'string' && Array.isArray(value.openers)) suggestions = value;
    } catch { /* Never delay microphone readiness or replace it with an error. */ }
  })();
  return {
    ready, cancel,
    context: () => context,
    choose() {
      const available = active && options.personalized() ? suggestions : null;
      cancel();
      context = undefined;
      return chooseVoiceGreeting(available, { storage: options.storage, onSuggestion: value => { context = value; } });
    },
  };
}
