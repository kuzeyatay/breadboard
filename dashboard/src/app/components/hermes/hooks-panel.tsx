"use client";

import { useState } from "react";

export default function HooksPanel() {
  const [creating, setCreating] = useState(false);

  return (
    <section
      aria-label="Hooks"
      className="flex h-full min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]"
    >
      <header className="shrink-0 border-b border-[var(--line)] px-4 pb-3 pt-4">
        <h2 className="text-lg font-semibold text-[var(--ink-heading)]">Hooks</h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Create automations that react when something happens.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="neu-surface-subtle flex min-h-56 flex-col items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--paper-raised)] px-6 py-10 text-center">
          {creating ? (
            <>
              <h3 className="text-base font-semibold text-[var(--ink-heading)]">New hook</h3>
              <p className="mt-1 max-w-sm text-sm text-[var(--ink-muted)]">
                Hook creation will be configured here.
              </p>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="neu-button mt-5 rounded-xl px-4 py-2 text-sm font-medium"
              >
                Back
              </button>
            </>
          ) : (
            <>
              <h3 className="text-base font-semibold text-[var(--ink-heading)]">No hooks yet</h3>
              <p className="mt-1 max-w-sm text-sm text-[var(--ink-muted)]">
                Create a hook to automatically run an action when an event occurs.
              </p>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="neu-button-primary mt-5 rounded-xl px-4 py-2 text-sm font-semibold"
              >
                + New hook
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
