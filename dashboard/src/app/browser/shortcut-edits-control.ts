"use client";

import { validShortcutEdits, type ShortcutEdit } from "@/lib/shortcut-edits";

export function shortcutEditsControl(ownerKey: string) {
  const endpoint = `/api/profile/shortcut-edits?${new URLSearchParams({ ownerKey })}`;
  return {
    async read(): Promise<ShortcutEdit[]> {
      const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      if (!response.ok || !validShortcutEdits(data.edits)) throw new Error("Couldn’t load your shortcut changes.");
      return data.edits;
    },
    async write(edits: ShortcutEdit[]): Promise<boolean> {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }), signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      return response.ok && validShortcutEdits(data.edits);
    },
  };
}
