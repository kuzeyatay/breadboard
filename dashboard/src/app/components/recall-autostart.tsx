"use client";

// Capture that resumes because Breadboard opened.
//
// The native Runtime owns recording. The authenticated page announces its
// owner, then waits through first-run installation. The server checks saved
// capture preferences on every attempt, so switching off during setup wins.

import { getSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { announceRecallAutostart, RECALL_SETTINGS_CHANGED_EVENT } from "@/app/components/recall-autostart-lifecycle";

export default function RecallAutoStart() {
  // The root layout survives client navigation. Watching the path lets a tab
  // that opened on /auth/login retry after sign-in establishes the session.
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const deadline = Date.now() + 35 * 60_000;
    let onSettingsChanged = () => {};

    void getSession()
      .then(async (session) => {
        if (!active) return;
        if (!session?.user) return;
        const announce = async (force = false) => {
          if (!active) return;
          const attempt = ++generation;
          const settled = await announceRecallAutostart({
            session,
            storage: window.sessionStorage,
            fetchImpl: (input, init) => fetch(input, init),
            force,
          });
          if (active && attempt === generation && !settled && Date.now() < deadline) {
            retry = setTimeout(() => void announce(), 3_000);
          }
        };
        onSettingsChanged = () => {
          if (retry !== undefined) clearTimeout(retry);
          void announce(true);
        };
        window.addEventListener(RECALL_SETTINGS_CHANGED_EVENT, onSettingsChanged);
        await announce();
      })
      .catch(() => {
        // A missing session is deliberately quiet. Authenticated Recall state
        // and installation errors are explained by Settings → Recall.
      });

    return () => {
      active = false;
      if (retry !== undefined) clearTimeout(retry);
      window.removeEventListener(RECALL_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    };
  }, [pathname]);

  return null;
}
