"use client";

import type { ScheduledChatReceipt } from "@/lib/schedules/types.ts";
import { requestOpenSchedulesPanel } from "./schedule-client";

function receiptTiming(receipt: ScheduledChatReceipt): string {
  if (receipt.oneShot && receipt.nextRunAt) {
    const runAt = new Date(receipt.nextRunAt);
    if (!Number.isNaN(runAt.getTime())) {
      return `Once · ${runAt.toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
  }
  return receipt.cronDescription;
}

/** Compact transcript receipt modelled after Codex's scheduled-task card. */
export default function ScheduledChatReceiptCard({
  receipt,
}: {
  receipt: ScheduledChatReceipt;
}) {
  return (
    <div
      className="mt-4 flex min-h-20 items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3 text-left shadow-sm"
      data-testid="scheduled-chat-receipt"
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--paper)] text-[var(--ink-heading)]"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-5 w-5"
        >
          <circle cx="12" cy="12" r="8.25" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5v5l-3 2" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--ink-heading)]">
          {receipt.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
          {receiptTiming(receipt)}
        </p>
      </div>
      <button
        type="button"
        onClick={requestOpenSchedulesPanel}
        className="shrink-0 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-sm font-medium text-[var(--ink-heading)] transition-colors hover:bg-[var(--paper-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--line-strong)]"
      >
        Open
      </button>
    </div>
  );
}
