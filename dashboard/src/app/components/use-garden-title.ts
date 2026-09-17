"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeToGardenNameChanges } from "@/lib/garden-name-events";

/** Electron uses this document title for both the tab and the window caption. */
export function useGardenTitle(slug: string, name: string): void {
  const router = useRouter();

  useEffect(() => {
    document.title = name;
    return () => {
      document.title = "breadboard";
    };
  }, [name]);

  useEffect(() => subscribeToGardenNameChanges((change) => {
    if (change.slug !== slug || document.title === change.name) return;
    document.title = change.name;
    // Refresh the server-provided header too, including renames in other tabs.
    router.refresh();
  }), [router, slug]);
}
