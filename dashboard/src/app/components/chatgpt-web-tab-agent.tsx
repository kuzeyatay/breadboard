"use client";

// The page that lends the desktop's browser to ChatMock's "OpenAI (web)" provider.
//
// ChatMock drives chatgpt.com over the shell's CDP port, but it has no way to
// ask the shell for a tab: the shell has no HTTP surface and the runtime keeps
// each service's control token separate. A Breadboard page does have a way —
// the preload bridge — so one page stands in as the relay. It long-polls
// ChatMock (through this dashboard's own route) for "open the ChatGPT tab"
// requests, asks the shell, and posts back the tab's DevTools target.
//
// One page, not every page: a Web Lock makes the first Breadboard page the
// relay and the rest wait, so a dozen open tabs cost one idle connection, and
// when the relay's page closes the lock passes on. The loop is deliberately
// quiet — when ChatMock is down or nobody is signed in it backs off and says
// nothing; Settings → Accounts is where that state is explained.

import { getSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  chatgptWebTabRelayAvailable,
  requestChatgptWebTabInDesktop,
} from "@/lib/desktop-browser-tabs";

const LOCK_NAME = "breadboard:chatgpt-web-tab-relay";
const POLL_WAIT_SECONDS = 25;
const IDLE_PAUSE_MS = 500;
const ERROR_BACKOFF_MS = 10_000;
const DENIED_BACKOFF_MS = 60_000;

interface TabRequestRow {
  nonce: string;
  foreground: boolean;
  /** ChatMock's page stopped answering; the shell is to build a new one. */
  reset?: boolean;
  /** Which of ChatMock's pages: "interactive" (chat) or "batch" (Learn, council). */
  lane?: string;
}

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

async function relayOnce(
  nonce: string,
  foreground: boolean,
  reset: boolean,
  lane: string | undefined,
  cdpPort: { value: number | null },
) {
  const asked = requestChatgptWebTabInDesktop(foreground, reset, lane);
  const result = asked ? await asked : { ok: false as const, error: "this page has no desktop bridge" };
  if (result.ok) cdpPort.value = result.cdpPort;
  // The shell's `lane` echo goes back as it came: its presence is how ChatMock
  // learns that this shell keeps a page per lane.
  const answer = result.ok
    ? { nonce, cdpPort: result.cdpPort, targetId: result.targetId, ...(typeof result.lane === "string" ? { lane: result.lane } : {}) }
    : { nonce, error: result.error };
  await fetch("/api/chatmock/openaiweb/tab-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answer),
    // Not tied to the loop's signal: a navigation mid-relay must not drop an
    // answer the shell already produced.
    keepalive: true,
  }).catch(() => {
    // ChatMock will time the request out on its own; nothing more to say.
  });
}

async function relayLoop(signal: AbortSignal): Promise<void> {
  const cdpPort = { value: null as number | null };
  while (!signal.aborted) {
    let response: Response;
    try {
      const params = new URLSearchParams({ wait: String(POLL_WAIT_SECONDS) });
      if (cdpPort.value) params.set("cdpPort", String(cdpPort.value));
      response = await fetch(`/api/chatmock/openaiweb/tab-requests?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
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
    const payload = (await response.json().catch(() => null)) as { requests?: TabRequestRow[] } | null;
    const rows = Array.isArray(payload?.requests) ? payload.requests : [];
    for (const row of rows) {
      if (signal.aborted) return;
      if (typeof row?.nonce !== "string") continue;
      await relayOnce(
        row.nonce,
        row.foreground === true,
        row.reset === true,
        typeof row.lane === "string" && row.lane ? row.lane : undefined,
        cdpPort,
      );
    }
    if (rows.length === 0) await sleep(IDLE_PAUSE_MS, signal);
  }
}

export default function ChatgptWebTabAgent() {
  // The root layout survives client navigation; a tab that opened on the
  // sign-in page starts relaying once the session exists.
  const pathname = usePathname();

  useEffect(() => {
    if (!chatgptWebTabRelayAvailable()) return;
    const controller = new AbortController();
    const { signal } = controller;

    void (async () => {
      const session = await getSession().catch(() => null);
      if (!session || signal.aborted) return;
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      if (locks && typeof locks.request === "function") {
        // Held until this page goes away; the next page in line takes over.
        await locks.request(LOCK_NAME, { signal }, () => relayLoop(signal)).catch(() => {});
      } else {
        await relayLoop(signal);
      }
    })();

    return () => controller.abort();
  }, [pathname]);

  return null;
}
