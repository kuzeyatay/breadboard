// The relay between Bread's mcp_call and the editor running in the user's browser.
// The editor's tools live in the page (WebMCP), so a call is queued here, picked up by
// the Video Studio page's long poll, run in the editor frame, and answered back.
import { markStudioSeen, studioPresence } from "./context.ts";

export interface BridgeCall { id: string; name: string; args: Record<string, unknown> }
interface Pending extends BridgeCall { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
interface UserBridge { queue: Pending[]; inflight: Map<string, Pending>; waiters: Set<() => void>; tools: unknown[] }

export class VideoStudioBridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

const bridges: Map<number, UserBridge> = ((globalThis as { __breadboardVideoStudioBridge?: Map<number, UserBridge> })
  .__breadboardVideoStudioBridge ??= new Map());

function bridgeFor(userId: number): UserBridge {
  let bridge = bridges.get(userId);
  if (!bridge) bridges.set(userId, bridge = { queue: [], inflight: new Map(), waiters: new Set(), tools: [] });
  return bridge;
}

let counter = 0;

/** Run one editor tool in the user's open Video Studio and wait for its answer. */
export function callStudio(userId: number, name: string, args: Record<string, unknown>, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<unknown> {
  if (!studioPresence(userId)) {
    return Promise.reject(new VideoStudioBridgeError("video_studio_closed",
      "Video Studio is not open. Ask the user to open it (the Video shortcut next to Crumbs, or Open in Video Studio on a video), then try again."));
  }
  const bridge = bridgeFor(userId);
  return new Promise((resolve, reject) => {
    const id = `${Date.now().toString(36)}-${(counter++).toString(36)}`;
    const settle = () => { bridge.queue = bridge.queue.filter(entry => entry.id !== id); bridge.inflight.delete(id); };
    const timer = setTimeout(() => { settle(); reject(new VideoStudioBridgeError("video_studio_timeout", `Video Studio did not answer ${name} in time.`)); }, options.timeoutMs ?? 120_000);
    options.signal?.addEventListener("abort", () => { clearTimeout(timer); settle(); reject(new VideoStudioBridgeError("video_studio_aborted", "The call was cancelled.")); }, { once: true });
    bridge.queue.push({ id, name, args, timer, resolve: value => { clearTimeout(timer); settle(); resolve(value); }, reject: error => { clearTimeout(timer); settle(); reject(error); } });
    for (const wake of bridge.waiters) wake();
  });
}

/** The page's long poll: calls waiting to run, or none after `waitMs`. */
export async function takeCalls(userId: number, waitMs = 25_000, signal?: AbortSignal): Promise<BridgeCall[]> {
  markStudioSeen(userId);
  const bridge = bridgeFor(userId);
  if (!bridge.queue.length) {
    await new Promise<void>(resolve => {
      const wake = () => { clearTimeout(timer); bridge.waiters.delete(wake); resolve(); };
      const timer = setTimeout(wake, waitMs);
      bridge.waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
    });
  }
  markStudioSeen(userId);
  if (signal?.aborted) return [];
  const taken = bridge.queue.splice(0);
  for (const call of taken) bridge.inflight.set(call.id, call);
  return taken.map(({ id, name, args }) => ({ id, name, args }));
}

export function completeCall(userId: number, id: string, outcome: { result?: unknown; error?: string }): boolean {
  const call = bridgeFor(userId).inflight.get(id);
  if (!call) return false;
  if (typeof outcome.error === "string") call.reject(new VideoStudioBridgeError("video_studio_tool_failed", outcome.error));
  else call.resolve(outcome.result);
  return true;
}

export function setStudioTools(userId: number, tools: unknown[]) { bridgeFor(userId).tools = tools; }
export function studioTools(userId: number): unknown[] { return bridgeFor(userId).tools; }

/** Rendered review frames and audio come back as data URLs; they stay out of the model's context. */
export function withoutMediaBytes(value: unknown): unknown {
  if (typeof value === "string") {
    const match = /^data:([\w/+.-]+);base64,/.exec(value);
    return match ? `[${match[1]}, ${Math.round((value.length - match[0].length) * 0.75 / 1024)} KiB, shown in Video Studio]` : value;
  }
  if (Array.isArray(value)) return value.map(withoutMediaBytes);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withoutMediaBytes(entry)]));
  return value;
}
