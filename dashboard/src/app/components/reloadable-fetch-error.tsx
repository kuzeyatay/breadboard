"use client";

import { RefreshCw } from "lucide-react";

interface ReloadableFetchErrorProps {
  message: string;
  onReload: () => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Keeps recoverable loading failures compact and actionable. The visible
 * message and reload control stay in one row so a bare "Failed to fetch"
 * never leaves the user at a dead end.
 */
export default function ReloadableFetchError({
  message,
  onReload,
  label = "Reload",
  className = "",
  disabled = false,
}: ReloadableFetchErrorProps) {
  return (
    <div
      role="alert"
      className={`flex items-center justify-center gap-2 text-[#9a4438] ${className}`}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onReload}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="neu-button-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current/25 text-current transition hover:bg-[var(--paper-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--botanical)] disabled:cursor-wait disabled:opacity-50"
      >
        <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${disabled ? "animate-spin motion-reduce:animate-none" : ""}`} />
      </button>
    </div>
  );
}
