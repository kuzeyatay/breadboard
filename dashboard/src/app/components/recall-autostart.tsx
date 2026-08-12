"use client";

// Capture that resumes because Breadboard opened.
//
// The recorder is owned by the dashboard rather than the desktop supervisor
// precisely because opting into it is per user, and the supervisor starts
// before anyone has signed in. So the "Breadboard opened" signal has to come
// from a page that knows who is looking at it: one POST per app load, silently
// ignored when nobody is signed in, and answered by a route that declines when
// this user has not asked for it. Nothing here decides anything — the server
// does, from settings this component never reads.

import { useEffect } from "react";

/** Marks this tab as having already announced the app opening. */
const ANNOUNCED_KEY = "breadboard:recall-autostart";

export default function RecallAutoStart() {
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(ANNOUNCED_KEY) === "1") return;
      window.sessionStorage.setItem(ANNOUNCED_KEY, "1");
    } catch {
      // Storage the browser refuses costs only the once-per-tab guard; the
      // route is idempotent, so asking twice starts nothing twice.
    }
    void fetch("/api/recall/autostart", { method: "POST", cache: "no-store" }).catch(() => {
      // Signed out, Recall switched off, engine not installed — every one of
      // these is a state Settings → Recall already explains in full, and none
      // of them is worth interrupting whatever the user opened the app to do.
    });
  }, []);

  return null;
}
