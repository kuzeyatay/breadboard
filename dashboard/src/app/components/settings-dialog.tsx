"use client";

import { useEffect, useRef, useState } from "react";
import SettingsAgentMemory from "@/app/components/settings-agent-memory";
import SettingsChatgptAccount from "@/app/components/settings-chatgpt-account";

export type SettingsTab = "account" | "memory";

interface SettingsDialogProps {
  onClose: () => void;
  initialTab?: SettingsTab;
}

const TABS: Array<{ value: SettingsTab; label: string; description: string }> = [
  {
    value: "account",
    label: "Account",
    description: "The ChatGPT account the model runs on.",
  },
  {
    value: "memory",
    label: "Memory",
    description: "What the agent carries between chats.",
  },
];

export default function SettingsDialog({ onClose, initialTab = "account" }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
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
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  const activeTab = TABS.find((item) => item.value === tab) ?? TABS[0];

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-[rgba(15,26,22,0.72)] px-4 py-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="neu-dialog flex max-h-[min(46rem,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--paper-raised)] text-[var(--ink)]"
      >
        <div className="flex items-start justify-between gap-3 px-6 pb-4 pt-5">
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

        <div className="px-6">
          <div className="neu-segmented inline-flex rounded-xl p-1" role="tablist" aria-label="Settings sections">
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                id={`settings-tab-${item.value}`}
                aria-selected={tab === item.value}
                aria-controls={`settings-panel-${item.value}`}
                onClick={() => setTab(item.value)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
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

        <div
          id={`settings-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4"
        >
          {tab === "account" ? <SettingsChatgptAccount /> : <SettingsAgentMemory />}
        </div>
      </div>
    </div>
  );
}
