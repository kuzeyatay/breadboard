"use client";

import { useState } from "react";
import { openSystemMicrophoneSettings, type MicrophoneFix } from "@/lib/speech/microphone-access";

interface MicrophonePermissionHelpProps {
  fix: MicrophoneFix;
  /** Runs the microphone request again, once the user has changed a setting. */
  onRetry: () => void;
  retryLabel?: string;
}

const primaryButton =
  "neu-button-accent w-full rounded-xl border border-[var(--botanical-hover)] bg-[var(--botanical)] px-3 py-1.5 text-[11px] font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:cursor-wait disabled:opacity-55";
const secondaryButton =
  "neu-button w-full rounded-xl border border-[var(--line)] px-3 py-1.5 text-[11px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50";
const inlineButton =
  "neu-button shrink-0 rounded-lg border border-[var(--line)] px-2 py-1 text-[10px] font-medium text-[var(--ink)] transition hover:bg-[var(--paper-strong)]";

/**
 * The way out of a blocked microphone, rather than the news that it is blocked.
 *
 * The panel is ordered by how much work each route costs the user: the single
 * button that finishes it sits first and carries the accent, everything else is
 * quieter. When only a manual trip will do, the steps are numbered and the
 * address is copyable, because browsers refuse to open their own settings pages
 * from a link — and when even the opener fails it says so and names the manual
 * route, since a button that does nothing is what sent the user here.
 */
export default function MicrophonePermissionHelp({
  fix,
  onRetry,
  retryLabel = "Try again",
}: MicrophonePermissionHelpProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function openSettings() {
    setOpening(true);
    setStatus(null);
    const opened = await openSystemMicrophoneSettings();
    setOpening(false);
    setStatus(
      opened
        ? "System settings opened — it may be behind this window."
        : `Breadboard could not open system settings. ${
            fix.action?.manual ?? "Open your system's microphone privacy settings by hand."
          }`,
    );
  }

  async function copyAddress() {
    if (!fix.copy) return;
    try {
      await navigator.clipboard.writeText(fix.copy.value);
      setStatus("Address copied — paste it into a new tab.");
    } catch {
      setStatus(`Copy this into a new tab: ${fix.copy.value}`);
    }
  }

  // Asking again is the fix in exactly one case, and then it leads.
  const retryLeads = fix.retryLabel !== null;

  return (
    <div className="space-y-2.5">
      <p className="pr-4 text-[12px] font-semibold leading-5 text-[var(--ink-heading)]">{fix.headline}</p>

      <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-[1.45] text-[var(--ink)] marker:text-[var(--ink-muted)]">
        {fix.steps.map((step) => (
          <li key={step} className="pl-0.5">
            {step}
          </li>
        ))}
      </ol>

      {fix.copy ? (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">{fix.copy.label}</p>
          <div className="flex items-center gap-1.5">
            <code className="neu-inset min-w-0 flex-1 truncate rounded-lg border px-2 py-1 font-mono text-[10px] text-[var(--ink)]">
              {fix.copy.value}
            </code>
            <button type="button" onClick={() => void copyAddress()} className={inlineButton}>
              Copy
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5 pt-0.5">
        {retryLeads ? (
          <button type="button" onClick={onRetry} className={primaryButton}>
            {fix.retryLabel}
          </button>
        ) : null}
        {fix.action ? (
          <button
            type="button"
            onClick={() => void openSettings()}
            disabled={opening}
            className={retryLeads ? secondaryButton : primaryButton}
          >
            {opening ? "Opening settings…" : fix.action.label}
          </button>
        ) : null}
        {retryLeads ? null : (
          <button type="button" onClick={onRetry} className={secondaryButton}>
            {retryLabel}
          </button>
        )}
      </div>

      {status ? (
        <p role="status" className="text-[10px] leading-4 text-[var(--ink-muted)]">
          {status}
        </p>
      ) : null}
      {fix.detail ? (
        <p className="text-[10px] leading-4 text-[var(--ink-muted)]">{fix.detail}</p>
      ) : null}
    </div>
  );
}
