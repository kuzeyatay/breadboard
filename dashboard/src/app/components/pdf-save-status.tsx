"use client";

import { useEffect, useReducer } from "react";
import { pendingPdfSaves, subscribePdfSaves } from "@/lib/pdf-save-client";

export default function PdfSaveStatus() {
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => subscribePdfSaves(refresh), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!pendingPdfSaves().length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const pending = pendingPdfSaves();
  if (!pending.length) return null;
  return <div className="fixed bottom-4 left-4 z-[10000] max-w-sm rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs text-[var(--ink)] shadow-sm" aria-live="polite">
    {pending.map(queue => <p key={queue.url} role={queue.snapshot.state === "error" ? "alert" : "status"}>
      {queue.snapshot.state === "error" ? <>
        Could not save {queue.title}: {queue.snapshot.error}{" "}
        <button type="button" className="cursor-pointer underline" onClick={() => { void queue.flush(); }}>Retry saving</button>
      </> : `Saving ${queue.title} in the background…`}
    </p>)}
  </div>;
}
