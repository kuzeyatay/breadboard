"use client";

import { useEffect, useState } from "react";

import {
  clickyDesktopControl,
  publishClickyNotification,
  type ClickyDesktopControl,
  type ClickyLauncherState,
} from "@/lib/clicky/desktop-control.ts";

/**
 * A native-app navbar seat. It stays absent on the web and on unsupported
 * systems, just as the Browser seat stays absent when the desktop bridge is not
 * available. An unbuilt checkout opens in Xcode so the first click is useful.
 */
export default function ClickyShortcut() {
  const [control, setControl] = useState<ClickyDesktopControl | null>(null);
  const [state, setState] = useState<ClickyLauncherState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const desktop = clickyDesktopControl();
    if (!desktop) return;
    let active = true;
    void desktop
      .read()
      .then((next) => {
        if (!active) return;
        setControl(() => desktop);
        setState(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!control || !state?.supported) return null;

  const opensProject = !state.available && state.projectAvailable;
  const title = opensProject
    ? "Build Clicky — open its project in Xcode"
    : "Launch Clicky";

  async function activate() {
    if (!control || !state || busy) return;
    setBusy(true);
    try {
      const result = opensProject
        ? await control.openProject()
        : await control.launch();
      setState(result.state);
      publishClickyNotification(
        result.message,
        result.ok ? "success" : "error",
      );
    } catch {
      publishClickyNotification(
        "Breadboard could not reach the Clicky launcher.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void activate()}
      className="flex items-center gap-1.5 text-xs text-gray-400 transition-colors hover:text-white disabled:opacity-60"
      title={title}
      aria-label={title}
      aria-busy={busy}
      disabled={busy}
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 3.5 12.2 20l2-6.2 5.8-2.7L5 3.5Z" />
        <path d="m14.1 13.9 4.2 4.2" />
      </svg>
      {busy ? "Opening…" : "Clicky"}
    </button>
  );
}
