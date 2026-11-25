"use client";

import { useEffect, useState } from "react";
import { loadAssistantPreferences } from "@/lib/assistant-bootstrap-client";

/**
 * The account's "Intermediate responses" switch (Settings). On by default and
 * while the preference is still loading, matching the server's default.
 */
export function useIntermediateResponses(): boolean {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    let live = true;
    void loadAssistantPreferences()
      .then((preferences) => {
        const switches = preferences?.switches;
        if (!live || !switches || typeof switches !== "object") return;
        setEnabled((switches as Record<string, unknown>).intermediateResponses !== false);
      })
      .catch(() => { /* keep the default */ });
    return () => { live = false; };
  }, []);
  return enabled;
}
