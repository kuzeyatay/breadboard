"use client";

import { retryTextHighlightSaves } from "@/lib/text-highlight-client";
import { useState } from "react";

export function TextHighlightSaveStatus({ error, className = "px-4 py-2 text-xs text-gray-400" }: { error: string | null; className?: string }) {
  const [saving, setSaving] = useState(false);
  async function retry() {
    setSaving(true);
    try { await retryTextHighlightSaves(); }
    finally { setSaving(false); }
  }
  if (!error) return null;
  return <p role="status" className={className}>
    {error}{" "}<button type="button"
      className="pointer-events-auto cursor-pointer rounded px-2 py-1 underline [-webkit-app-region:no-drag] focus-visible:outline-2 disabled:cursor-wait"
      disabled={saving} aria-busy={saving} onClick={retry}>{saving ? "Saving…" : "Retry saving"}</button>
  </p>;
}
