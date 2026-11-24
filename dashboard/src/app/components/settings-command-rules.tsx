"use client";

// Settings → Guardrails: the terminal command prefixes saved with "Always
// allow" on a permission card. Commands starting with one run without a card.

import { useCallback, useEffect, useState } from "react";

interface CommandRule {
  id: number;
  prefix: string[];
  createdAt: string;
}

export default function SettingsCommandRules() {
  const [rules, setRules] = useState<CommandRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/hermes/terminal-rules", { cache: "no-store" });
      const payload = (await response.json()) as { rules?: CommandRule[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load the rules.");
      setRules(payload.rules ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the rules.");
      setRules((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: number) {
    setRemoving(id);
    try {
      const response = await fetch(`/api/hermes/terminal-rules?id=${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Could not remove that rule.");
      }
      setRules((current) => (current ?? []).filter((rule) => rule.id !== id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove that rule.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-4">
      <div>
        <p className="text-sm font-medium text-[var(--ink-heading)]">Always-allowed commands</p>
        <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
          Commands you approved with “Always allow”. Bread runs anything starting with one of
          these without asking. Commands that chain, redirect or delete still ask every time.
        </p>
      </div>
      {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
      {rules === null ? (
        <p className="text-xs text-[var(--ink-muted)]">Checking…</p>
      ) : rules.length === 0 ? (
        <p className="text-xs text-[var(--ink-muted)]">None yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 py-2">
              <code className="min-w-0 truncate text-xs text-[var(--ink)]">{rule.prefix.join(" ")}</code>
              <button
                type="button"
                onClick={() => void remove(rule.id)}
                disabled={removing !== null}
                className="neu-button shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs disabled:opacity-60"
              >
                {removing === rule.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
