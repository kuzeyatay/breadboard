"use client";

import {
  usageReserveModelLabel,
  type DisplayUsageLimitReserve,
  type DisplayUsageLimitWindow,
} from "@/lib/usage-limit-display";

export function planLabel(plan: string | undefined): string {
  const trimmed = (plan ?? "").trim();
  if (!trimmed) return "ChatGPT";
  return `ChatGPT ${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function clampPercent(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

function formatDuration(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const days = Math.floor(clamped / 86400);
  const hours = Math.floor((clamped % 86400) / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const parts = [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean);
  return parts.join(" ") || "<1m";
}

function remainingResetSeconds(
  capturedAt: string | undefined,
  window: DisplayUsageLimitWindow,
  now: number,
): number | null {
  if (window.resets_in_seconds === undefined || !capturedAt) return null;
  const capturedMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedMs)) return Math.max(0, Number(window.resets_in_seconds));
  return Math.max(0, Math.floor((capturedMs + Number(window.resets_in_seconds) * 1000 - now) / 1000));
}

/**
 * What a spent plan means in practice: OpenAI moves the account onto a
 * reserve pool served by a smaller model. Said once, above the meters, so the
 * 100% bar below reads as "on reserve" rather than "cut off".
 */
export function ReserveNotice({
  reserve,
  plan,
  primary,
  capturedAt,
  now,
  light,
}: {
  reserve: DisplayUsageLimitReserve;
  plan?: string;
  primary?: DisplayUsageLimitWindow;
  capturedAt?: string;
  now: number;
  light: boolean;
}) {
  const name = usageReserveModelLabel(reserve.model);
  const resetSeconds = primary ? remainingResetSeconds(capturedAt, primary, now) : null;
  const reserveUsed = reserve.primary ? clampPercent(reserve.primary.used_percent) : null;
  if (reserve.active) {
    return (
      <div
        data-usage-reserve="active"
        className={`rounded-lg border px-2.5 py-2 ${light ? "border-[#d9c58a] bg-[#fbf6e6] text-[#5d4a00]" : "border-amber-700/60 bg-amber-950/30 text-amber-200"}`}
      >
        <p className="font-medium">{name} reserve is active</p>
        <p className={`mt-0.5 ${light ? "text-[#6f5c14]" : "text-amber-200/80"}`}>
          Your {planLabel(plan)} limit is spent
          {resetSeconds !== null ? ` and resets in ${formatDuration(resetSeconds)}` : ""}. Until
          then ChatGPT answers with {name} from its reserve pool
          {reserveUsed !== null ? ` (${(100 - reserveUsed).toFixed(0)}% of it left)` : ""}.
        </p>
      </div>
    );
  }
  if (reserve.limit_reached) {
    return (
      <p data-usage-reserve="spent" className={light ? "text-[var(--danger)]" : "text-red-300"}>
        The {name} reserve is spent as well.
      </p>
    );
  }
  return (
    <p data-usage-reserve="idle" className={light ? "text-[var(--ink-muted)]" : "text-gray-600"}>
      When the plan limit is reached, ChatGPT switches to {name} from a reserve pool.
    </p>
  );
}
