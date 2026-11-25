import "server-only";

// Subscription speech for callers that have no page: agent narration.
//
// The ChatGPT subscription voice is a WebRTC session, and only a Breadboard
// page can hold one. The desktop keeps such a page alive for the whole app
// session - the voice companion window (`/voice`), hidden until summoned and
// allowed to start audio without a click - so it stands in as the relay. It
// long-polls here for scripts, records each one with the same verified
// buffered reading the MP3 download uses, and posts the WAV back.
//
// The queue lives in this process's memory on purpose: a job is only useful
// while the request that asked for it is still waiting, and a dashboard restart
// ends both. When no relay page has polled recently the request fails at once,
// so the caller can fall back to Voicebox instead of waiting out a timeout.

import { randomUUID } from "node:crypto";
import { RouteError } from "@/lib/server-auth";

/** A relay that has not polled within this window is treated as gone. */
const RELAY_FRESH_MS = 45_000;
/** How long a queued script may wait for the relay to pick it up. */
const CLAIM_TIMEOUT_MS = 20_000;
/** A reading takes roughly real time; allow generously for verification re-reads. */
const READ_BASE_MS = 90_000;
const READ_PER_CHARACTER_MS = 200;
export const NARRATION_RELAY_MAX_WAIT_SECONDS = 25;
export const NARRATION_RELAY_MAX_AUDIO_BYTES = 40 * 1024 * 1024;

export class NarrationRelayUnavailableError extends Error {}

interface Job {
  id: string;
  userId: number;
  text: string;
  claimed: boolean;
  resolve(audio: Uint8Array): void;
  reject(error: Error): void;
}

interface RelayState {
  jobs: Job[];
  pending: Map<string, Job>;
  waiters: Map<number, Set<() => void>>;
  lastPoll: Map<number, number>;
}

// One queue per process, kept across module reloads in development.
const STATE_KEY = Symbol.for("breadboard.speech.narrationRelay");
const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: RelayState };
const state: RelayState = (globalState[STATE_KEY] ??= {
  jobs: [],
  pending: new Map(),
  waiters: new Map(),
  lastPoll: new Map(),
});

function wake(userId: number) {
  const waiters = state.waiters.get(userId);
  if (!waiters) return;
  state.waiters.delete(userId);
  for (const waiter of waiters) waiter();
}

/** Whether a relay page for this user is polling right now. */
export function narrationRelayAvailable(userId: number, now = Date.now()): boolean {
  const last = state.lastPoll.get(userId);
  return last !== undefined && now - last < RELAY_FRESH_MS;
}

/**
 * Have the user's relay page read `text` in their subscription voice.
 * Resolves with WAV bytes; rejects with NarrationRelayUnavailableError when no
 * page is there to read it.
 */
export function readWithSubscriptionVoice(
  userId: number,
  text: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!narrationRelayAvailable(userId)) {
    return Promise.reject(new NarrationRelayUnavailableError(
      "No Breadboard voice window is open to read with the ChatGPT voice.",
    ));
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    let claimTimer: ReturnType<typeof setTimeout> | undefined;
    let readTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(claimTimer);
      clearTimeout(readTimer);
      signal?.removeEventListener("abort", onAbort);
      state.pending.delete(job.id);
      const queued = state.jobs.indexOf(job);
      if (queued >= 0) state.jobs.splice(queued, 1);
    };
    const job: Job = {
      id: randomUUID(),
      userId,
      text,
      claimed: false,
      resolve(audio) { finish(); resolve(audio); },
      reject(error) { finish(); reject(error); },
    };
    const onAbort = () => job.reject(new RouteError(499, "The narration request was cancelled."));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    claimTimer = setTimeout(() => {
      if (!job.claimed) {
        job.reject(new NarrationRelayUnavailableError("The Breadboard voice window did not pick up the narration."));
      }
    }, CLAIM_TIMEOUT_MS);
    readTimer = setTimeout(
      () => job.reject(new Error("The ChatGPT voice did not finish reading the narration in time.")),
      CLAIM_TIMEOUT_MS + READ_BASE_MS + text.length * READ_PER_CHARACTER_MS,
    );
    state.pending.set(job.id, job);
    state.jobs.push(job);
    wake(userId);
  });
}

/** The relay page's long poll: the next script for this user, claimed, or null. */
export async function claimNarrationJob(
  userId: number,
  waitSeconds: number,
  signal?: AbortSignal,
): Promise<{ id: string; text: string } | null> {
  const deadline = Date.now() + Math.max(0, Math.min(NARRATION_RELAY_MAX_WAIT_SECONDS, waitSeconds)) * 1000;
  for (;;) {
    state.lastPoll.set(userId, Date.now());
    const job = state.jobs.find((candidate) => candidate.userId === userId && !candidate.claimed);
    if (job) {
      job.claimed = true;
      state.jobs.splice(state.jobs.indexOf(job), 1);
      return { id: job.id, text: job.text };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0 || signal?.aborted) return null;
    await new Promise<void>((resolve) => {
      const waiters = state.waiters.get(userId) ?? new Set<() => void>();
      state.waiters.set(userId, waiters);
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, remaining);
      signal?.addEventListener("abort", done, { once: true });
      waiters.add(done);
    });
  }
}

/** The relay page's answer. False when the job is unknown, not claimed, or not this user's. */
export function completeNarrationJob(
  userId: number,
  id: string,
  result: { audio: Uint8Array } | { error: string },
): boolean {
  const job = state.pending.get(id);
  if (!job || job.userId !== userId || !job.claimed) return false;
  state.lastPoll.set(userId, Date.now());
  if ("audio" in result) job.resolve(result.audio);
  else job.reject(new Error(result.error || "The ChatGPT voice could not read the narration."));
  return true;
}

/** Test seam. */
export function resetNarrationRelayForTests() {
  for (const job of state.pending.values()) job.reject(new Error("reset"));
  state.jobs.length = 0;
  state.pending.clear();
  state.waiters.clear();
  state.lastPoll.clear();
}
