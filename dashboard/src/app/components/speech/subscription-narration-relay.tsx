"use client";

// Reads agent narration in the ChatGPT subscription voice.
//
// Agents that make videos ask the server for narration, but the subscription
// voice is a WebRTC session only a page can open. This component runs in the
// desktop's voice window - always loaded, hidden until summoned, and allowed
// to start audio without a click - and long-polls the server for scripts.
// Each one is recorded with the same verified buffered reading the MP3
// download uses, never played aloud, and posted back as a WAV.
//
// One window, not every page: a Web Lock keeps a single reader even if a
// second voice window ever loads. When subscription speech is not selected
// the page still polls, and answers with the reason; the server then reads
// the lines with Voicebox.

import { useEffect } from "react";
import { subscriptionSpeech } from "@/lib/speech/subscription-client";

const LOCK_NAME = "breadboard:subscription-narration-relay";
const POLL_WAIT_SECONDS = 25;
const ERROR_BACKOFF_MS = 10_000;
const DENIED_BACKOFF_MS = 60_000;
const SHORT_POLL_MS = 1_000;
const IDLE_PAUSE_MS = 500;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function answer(id: string, body: Blob | { error: string }) {
  await fetch(`/api/speech/narration-relay?id=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": body instanceof Blob ? "audio/wav" : "application/json" },
    body: body instanceof Blob ? body : JSON.stringify(body),
  }).catch(() => {
    // The server times the job out and falls back on its own.
  });
}

async function read(id: string, text: string, signal: AbortSignal) {
  try {
    const audio = await subscriptionSpeech({ text }, signal);
    if (!(audio instanceof Blob) || audio.size === 0) throw new Error("The ChatGPT voice returned no audio.");
    await answer(id, audio);
  } catch (error) {
    if (signal.aborted) return;
    await answer(id, { error: error instanceof Error ? error.message : "The ChatGPT voice could not read it." });
  }
}

async function relayLoop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    const asked = Date.now();
    let response: Response;
    try {
      response = await fetch(`/api/speech/narration-relay?wait=${POLL_WAIT_SECONDS}`, { cache: "no-store", signal });
    } catch {
      if (signal.aborted) return;
      await sleep(ERROR_BACKOFF_MS, signal);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      await sleep(DENIED_BACKOFF_MS, signal);
      continue;
    }
    if (!response.ok) {
      await sleep(ERROR_BACKOFF_MS, signal);
      continue;
    }
    const payload = (await response.json().catch(() => null)) as { job?: { id?: unknown; text?: unknown } | null } | null;
    const job = payload?.job;
    if (job && typeof job.id === "string" && typeof job.text === "string") {
      // One reading at a time: each holds a subscription voice slot.
      await read(job.id, job.text, signal);
    } else if (Date.now() - asked < SHORT_POLL_MS) {
      await sleep(IDLE_PAUSE_MS, signal);
    }
  }
}

export default function SubscriptionNarrationRelay() {
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks && typeof locks.request === "function") {
      void locks.request(LOCK_NAME, { signal }, () => relayLoop(signal)).catch(() => {});
    } else {
      void relayLoop(signal);
    }
    return () => controller.abort();
  }, []);
  return null;
}
