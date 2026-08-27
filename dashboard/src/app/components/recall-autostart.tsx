"use client";

// Capture that resumes because Breadboard opened.
//
// The recorder is owned by the dashboard rather than the desktop supervisor
// precisely because opting into it is per user, and the supervisor starts
// before anyone has signed in. So the "Breadboard opened" signal has to come
// from a page that knows who is looking at it: one POST per authenticated user
// per app load, and answered by a route that declines when this user has not
// asked for it. Nothing here decides anything — the server does, from settings
// this component never reads.

import { getSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { announceRecallAutostart } from "@/app/components/recall-autostart-lifecycle";

export default function RecallAutoStart() {
  // The root layout survives client navigation. Watching the path lets a tab
  // that opened on /auth/login retry after sign-in establishes the session.
  const pathname = usePathname();

  useEffect(() => {
    let active = true;

    void getSession()
      .then((session) => {
        if (!active) return;
        return announceRecallAutostart({
          session,
          storage: window.sessionStorage,
          fetchImpl: (input, init) => fetch(input, init),
        });
      })
      .catch(() => {
        // A missing session is deliberately quiet. Authenticated Recall state
        // and installation errors are explained by Settings → Recall.
      });

    return () => {
      active = false;
    };
  }, [pathname]);

  return null;
}
