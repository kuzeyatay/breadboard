"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { NotchActivityPayload, NotchActivitySession, NotchProviderId } from "@/lib/usage-notch";

const EMPTY: NotchActivityPayload = { captured_at: "", providers: {} };
const STATES = new Set(["working", "waiting", "complete", "idle"]);

function session(value: unknown): value is NotchActivitySession {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<NotchActivitySession>;
  return typeof row.id === "string" && typeof row.name === "string" && typeof row.detail === "string"
    && typeof row.since === "string" && typeof row.state === "string" && STATES.has(row.state);
}

function payload(value: unknown): NotchActivityPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NotchActivityPayload>;
  if (typeof candidate.captured_at !== "string" || !candidate.providers || typeof candidate.providers !== "object") return null;
  const providers: NotchActivityPayload["providers"] = {};
  for (const id of ["anthropic", "chatgpt", "google"] as NotchProviderId[]) {
    const rows = candidate.providers[id];
    if (Array.isArray(rows)) providers[id] = rows.filter(session);
  }
  return { captured_at: candidate.captured_at, providers };
}

/** Activity is local and cheap, so it follows Codenotch's two-second cadence. */
export function useAgentActivity() {
  const [activity, setActivity] = useState<NotchActivityPayload>(EMPTY);
  const pending = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (pending.current || document.hidden) return;
    const controller = new AbortController();
    pending.current = controller;
    try {
      const response = await fetch("/api/agent-activity", {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
      });
      if (!response.ok) return;
      const next = payload(await response.json());
      if (next && !controller.signal.aborted) setActivity(next);
    } catch {
      // Preserve the last real state through a transient local read failure.
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, []);

  useEffect(() => {
    if (!document.hidden) void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      pending.current?.abort();
      pending.current = null;
    };
  }, [refresh]);

  return activity;
}
