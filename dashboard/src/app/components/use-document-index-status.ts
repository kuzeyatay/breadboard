"use client";

// Whether the documents on the composer can be searched by page yet.
//
// Indexing starts when the upload responds and takes seconds to minutes, so a
// question asked immediately is answered from the whole inlined document while
// one asked a moment later is answered from retrieved pages. Both are honest
// answers and they are not the same answer — this is what lets the chip say
// which one is about to happen, instead of leaving it invisible.
//
// Polls only while something is actually pending, and stops for good once
// every document has settled.

import { useEffect, useRef, useState } from "react";

export interface DocumentIndexStatus {
  state: "off" | "pending" | "ready" | "failed" | "unsupported";
  pages: number;
  label: string;
  detail: string;
}

const POLL_MS = 2_500;

/** One frozen instance, so a composer with no documents never re-renders on it. */
const EMPTY: Record<string, DocumentIndexStatus> = {};

export function useDocumentIndexStatus(
  blobIds: readonly string[],
): Record<string, DocumentIndexStatus> {
  const [statuses, setStatuses] = useState<Record<string, DocumentIndexStatus>>({});
  // Joined rather than passed as an array so a new array identity with the same
  // ids does not restart the poll on every keystroke in the composer.
  const key = [...blobIds].sort().join(",");
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const ids = key ? key.split(",") : [];
    // Nothing to poll, and nothing to clear: with no ids the hook returns the
    // empty map below rather than writing one into state, which would be a
    // second render for a value that is already known at render time.
    if (ids.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      const entries = await Promise.all(
        ids.map(async (blobId): Promise<[string, DocumentIndexStatus] | null> => {
          try {
            const response = await fetch(
              `/api/chat-attachments/documents/${encodeURIComponent(blobId)}/index-status`,
            );
            if (!response.ok) return null;
            const body = (await response.json()) as DocumentIndexStatus;
            return [blobId, body];
          } catch {
            // A failed poll is not worth reporting: the chip simply keeps
            // whatever it last knew, and the turn works either way.
            return null;
          }
        }),
      );
      if (cancelled.current) return;

      const next: Record<string, DocumentIndexStatus> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setStatuses(next);

      // The only reason to ask again is something still being read.
      if (Object.values(next).some((status) => status.state === "pending")) {
        timer = setTimeout(() => void poll(), POLL_MS);
      }
    }

    void poll();
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [key]);

  return key ? statuses : EMPTY;
}
