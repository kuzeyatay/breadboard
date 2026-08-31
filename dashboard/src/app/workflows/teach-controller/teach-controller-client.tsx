"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  controlTeachSession,
  formatElapsed,
  loadTeachSession,
  TEACH_CHANNEL,
  type TeachChannelMessage,
} from "../teach/teach-client";
import type { TeachSessionSummary } from "@/lib/teach/types";

/** How long to wait for the tab holding the microphone before acting alone. */
const OWNER_TIMEOUT_MS = 4_000;
const STATE_POLL_MS = 2_000;

export default function TeachControllerClient({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<TeachSessionSummary["state"]>("recording");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastHeartbeat = useRef(0);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(TEACH_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<TeachChannelMessage>) => {
      const message = event.data;
      if (!message || message.sessionId !== sessionId || message.request) return;
      lastHeartbeat.current = Date.now();
      if (message.state) setState(message.state);
      if (typeof message.elapsedMs === "number") setElapsedMs(message.elapsedMs);
      if (typeof message.level === "number") setLevel(message.level);
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [sessionId]);

  // The session record is the fallback truth: if the owning tab stops
  // heartbeating, the controller still shows the real state rather than a frozen
  // timer that suggests a recording is running when it is not.
  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const view = await loadTeachSession(sessionId);
        if (cancelled) return;
        setState(view.session.state);
        if (Date.now() - lastHeartbeat.current > OWNER_TIMEOUT_MS) {
          setNote(
            view.session.state === "recording" || view.session.state === "paused"
              ? "The Breadboard window that started this is not answering."
              : null,
          );
        } else {
          setNote(null);
        }
      } catch {
        // A missed poll changes nothing on screen.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  const request = useCallback(
    async (action: "pause" | "resume" | "finish" | "cancel") => {
      channelRef.current?.postMessage({ sessionId, request: action } satisfies TeachChannelMessage);
      // Give the owning tab a moment to do it properly -- it is the one that can
      // stop the microphone and upload the narration. Only if it does not answer
      // does this window act on its own, which finishes the session without the
      // voice track rather than leaving a recorder running with nobody to stop it.
      const before = state;
      await new Promise((resolve) => setTimeout(resolve, OWNER_TIMEOUT_MS));
      try {
        const view = await loadTeachSession(sessionId);
        if (view.session.state !== before) return;
        setNote("Finishing without the narration — the Breadboard window did not answer.");
        await controlTeachSession(sessionId, action);
      } catch {
        setNote("That could not be done from here. Use the Breadboard window.");
      }
    },
    [sessionId, state],
  );

  const paused = state === "paused";
  const finished = !["recording", "paused", "preparing"].includes(state);

  return (
    <div
      className="flex h-screen w-screen select-none flex-col justify-between bg-[#141414] p-3 text-white"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2.5 w-2.5 rounded-full ${paused ? "bg-white/40" : "animate-pulse bg-red-500"}`}
        />
        <span className="font-mono text-sm tabular-nums">{formatElapsed(elapsedMs)}</span>
        <span className="relative ml-1 h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-emerald-400 transition-[width] duration-100"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </span>
      </div>

      <p className="text-[10px] leading-4 text-white/50">
        {note ?? (finished ? "This demonstration has ended." : "Recording your demonstration")}
      </p>

      <div
        className="flex items-center gap-1.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          type="button"
          disabled={finished}
          onClick={() => void request(paused ? "resume" : "pause")}
          className="flex-1 rounded-md border border-white/20 px-2 py-1.5 text-[11px] hover:bg-white/10 disabled:opacity-40"
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          disabled={finished}
          onClick={() => void request("finish")}
          className="flex-1 rounded-md bg-emerald-500/90 px-2 py-1.5 text-[11px] font-medium text-black hover:bg-emerald-400 disabled:opacity-40"
        >
          Finish
        </button>
        <button
          type="button"
          disabled={finished}
          onClick={() => void request("cancel")}
          className="rounded-md border border-white/20 px-2 py-1.5 text-[11px] text-red-300 hover:bg-white/10 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
