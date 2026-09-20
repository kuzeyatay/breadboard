"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { matchesStarredMessage } from "@/lib/starred-messages-types";
import { saveMessageStar, useStarredMessages } from "./use-starred-messages";

export default function StarMessageButton({ conversationId, messageId, className }: {
  conversationId: string; messageId: string; className: string;
}) {
  const { messages, saving, loading } = useStarredMessages();
  const [error, setError] = useState<string | null>(null);
  const starred = messages.some((item) => matchesStarredMessage(item, conversationId, messageId));
  const label = starred ? "Unstar message" : "Star message";
  return <div className="relative flex">
    <button type="button" title={label} aria-label={label} aria-pressed={starred}
      disabled={saving || loading}
      className={`${className} disabled:opacity-40 ${starred ? "text-[var(--botanical)]" : ""}`}
      onClick={async () => {
        setError(null);
        try { await saveMessageStar(conversationId, messageId, !starred); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this star. Try again."); }
      }}>
      <Star className="h-4 w-4" strokeWidth={1.7} fill={starred ? "currentColor" : "none"} aria-hidden />
    </button>
    {error ? <div role="alert" className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-3 text-xs shadow-lg">
      <button type="button" className="float-right ml-2" onClick={() => setError(null)} aria-label="Dismiss star error">×</button>{error}
    </div> : null}
  </div>;
}
