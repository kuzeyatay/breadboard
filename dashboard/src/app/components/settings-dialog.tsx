"use client";

import { useEffect, useRef, useState } from "react";
import SettingsAgentMemory from "@/app/components/settings-agent-memory";
import SettingsAccounts from "@/app/components/settings-accounts";
import SettingsConnections from "@/app/components/settings-connections";
import SettingsMessaging from "@/app/components/settings-messaging";
import SettingsMcp from "@/app/components/settings-mcp";
import SettingsProviders from "@/app/components/settings-providers";
import SettingsRecall from "@/app/components/settings-recall";
import SettingsSpeech from "@/app/components/settings-speech";
import SettingsVoiceCalibration from "@/app/components/settings-voice-calibration";

export type SettingsTab =
  | "account"
  | "connections"
  | "mcp"
  | "memory"
  | "voice"
  | "speech"
  | "messaging"
  | "recall";

interface SettingsDialogProps {
  onClose: () => void;
  initialTab?: SettingsTab;
  presentation?: "modal" | "popover";
  /** Keeps loaded tab state warm while the popover is closed. */
  open?: boolean;
}

const TABS: Array<{ value: SettingsTab; label: string; description: string }> = [
  {
    value: "account",
    label: "Accounts",
    description:
      "Every account Breadboard is signed in to, and the ones it can still reach models through.",
  },
  {
    value: "connections",
    label: "Connections",
    description: "External apps agents may act through when you ask.",
  },
  {
    value: "mcp",
    label: "MCP",
    description: "Tool servers agents may use when you select them.",
  },
  {
    value: "memory",
    label: "Memory",
    description: "What the agent carries between chats.",
  },
  {
    value: "voice",
    label: "Tone",
    description: "Calibrate answers to how you write.",
  },
  {
    value: "speech",
    label: "Voice",
    description: "Choose local voices, read responses aloud, and dictate messages.",
  },
  {
    value: "messaging",
    label: "Messaging",
    description: "Reach Breadboard from WhatsApp or Telegram.",
  },
  {
    value: "recall",
    label: "Recall",
    description: "What this computer remembers about your day, and who may read it.",
  },
];

export default function SettingsDialog({
  onClose,
  initialTab = "account",
  presentation = "modal",
  open = true,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<SettingsTab>>(
    () => new Set([initialTab]),
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const modal = presentation === "modal";
    if (modal) {
      document.body.style.overflow = "hidden";
      closeRef.current?.focus();
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (!modal || event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (modal) {
        document.body.style.overflow = previousOverflow;
        previouslyFocused?.focus();
      }
    };
  }, [open, presentation]);

  const activeTab = TABS.find((item) => item.value === tab) ?? TABS[0];

  const selectTab = (next: SettingsTab) => {
    setTab(next);
    setVisitedTabs((current) => {
      if (current.has(next)) return current;
      return new Set([...current, next]);
    });
  };

  const panel = (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={presentation === "modal" ? "true" : undefined}
        aria-labelledby="settings-dialog-title"
        className={`${open ? "flex" : "hidden"} ${presentation === "modal"
          ? "bb-modal-panel neu-dialog max-h-[min(46rem,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border text-[var(--ink)]"
          : "neu-popover absolute bottom-0 right-full z-50 mr-2 max-h-[min(42rem,calc(100vh-2rem))] w-[min(42rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--ink)] shadow-2xl"}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-4 pt-5">
          <div className="min-w-0">
            <h2
              id="settings-dialog-title"
              className="text-lg font-semibold leading-6 text-[var(--ink-heading)]"
            >
              Settings
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{activeTab.description}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="neu-button-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)]"
          >
            <svg aria-hidden className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* The strip is fixed furniture: it stays put while the panel under it
            scrolls, and it never scrolls sideways itself — a section you cannot
            see is a section you will not find. `shrink-0` here and on the header
            is what keeps that true; without it both are flex items that give up
            their height to a tall panel, and the strip is squeezed to a sliver.
            Now that accounts and providers are one section the labels fit on a
            line, and if a narrow window ever leaves them short they wrap onto a
            second one rather than being clipped. */}
        <div className="shrink-0 px-6">
          <div
            className="neu-segmented flex w-full flex-wrap gap-1 rounded-xl p-1"
            role="tablist"
            aria-label="Settings sections"
          >
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                id={`settings-tab-${item.value}`}
                aria-selected={tab === item.value}
                aria-controls={`settings-panel-${item.value}`}
                onClick={() => selectTab(item.value)}
                className={`flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition ${
                  tab === item.value
                    ? "text-[var(--ink-heading)]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
          {visitedTabs.has("account") ? (
            <div
              id="settings-panel-account"
              role="tabpanel"
              aria-labelledby="settings-tab-account"
              hidden={tab !== "account"}
            >
              {/* One list of accounts, with its own add picker, above the
                  services that back them. Neither section sends the reader to
                  the other any more: the two buttons that did were a round
                  trip that signed nothing in. */}
              {/* The rule between the two halves belongs to the providers
                  half, which draws it itself. Held here, it was a line hanging
                  over an empty space for as long as that half was still
                  loading. */}
              <div className="space-y-5">
                <SettingsAccounts />
                <SettingsProviders />
              </div>
            </div>
          ) : null}
          {visitedTabs.has("connections") ? (
            <div
              id="settings-panel-connections"
              role="tabpanel"
              aria-labelledby="settings-tab-connections"
              hidden={tab !== "connections"}
            >
              <SettingsConnections />
            </div>
          ) : null}
          {visitedTabs.has("mcp") ? (
            <div
              id="settings-panel-mcp"
              role="tabpanel"
              aria-labelledby="settings-tab-mcp"
              hidden={tab !== "mcp"}
            >
              <SettingsMcp />
            </div>
          ) : null}
          {visitedTabs.has("memory") ? (
            <div
              id="settings-panel-memory"
              role="tabpanel"
              aria-labelledby="settings-tab-memory"
              hidden={tab !== "memory"}
            >
              <SettingsAgentMemory />
            </div>
          ) : null}
          {visitedTabs.has("speech") ? (
            <div
              id="settings-panel-speech"
              role="tabpanel"
              aria-labelledby="settings-tab-speech"
              hidden={tab !== "speech"}
            >
              <SettingsSpeech />
            </div>
          ) : null}
          {visitedTabs.has("messaging") ? (
            <div
              id="settings-panel-messaging"
              role="tabpanel"
              aria-labelledby="settings-tab-messaging"
              hidden={tab !== "messaging"}
            >
              <SettingsMessaging />
            </div>
          ) : null}
          {visitedTabs.has("recall") ? (
            <div
              id="settings-panel-recall"
              role="tabpanel"
              aria-labelledby="settings-tab-recall"
              hidden={tab !== "recall"}
            >
              <SettingsRecall />
            </div>
          ) : null}
          {visitedTabs.has("voice") ? (
            <div
              id="settings-panel-voice"
              role="tabpanel"
              aria-labelledby="settings-tab-voice"
              hidden={tab !== "voice"}
            >
              <SettingsVoiceCalibration />
            </div>
          ) : null}
        </div>
      </div>
  );

  if (presentation === "popover") return panel;

  if (!open) return null;

  return (
    <div
      className="bb-modal-backdrop fixed inset-0 z-[130] flex items-center justify-center px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {panel}
    </div>
  );
}
