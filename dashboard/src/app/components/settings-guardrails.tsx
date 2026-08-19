"use client";

// Settings → Guardrails: mask PII (emails, phone numbers, card numbers, IBANs,
// IP addresses, US SSNs, plus your own regex patterns) out of messages before
// they leave Breadboard over WhatsApp or Telegram.
//
// Modeled on settings-whatsapp.tsx's toggle idiom: one status-poll-free view
// over /api/guardrails, a checkbox, a JSON textarea for custom patterns, and a
// "try it" box that calls the same masking code the real send path uses
// (POST /api/guardrails), so what you see here is what a real message gets.

import { useCallback, useEffect, useState } from "react";

interface CustomPiiPattern {
  name: string;
  regex: string;
  replacement: string;
}

interface GuardrailSettings {
  scrubOutbound: boolean;
  customPatterns: CustomPiiPattern[];
}

interface PiiFinding {
  type: string;
  start: number;
  end: number;
  text: string;
}

/** A small shield mark, in the same line weight as the rest of Settings. */
export function ShieldIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3.5 5 6v5.2c0 4.4 2.9 7.8 7 9.3 4.1-1.5 7-4.9 7-9.3V6l-7-2.5Z" />
      <path d="m9.25 12 1.9 1.9 3.6-3.8" />
    </svg>
  );
}

async function readSettings(): Promise<GuardrailSettings | null> {
  const response = await fetch("/api/guardrails", { cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json()) as { settings?: GuardrailSettings };
  return payload.settings ?? null;
}

function formatPatterns(patterns: CustomPiiPattern[]): string {
  return JSON.stringify(patterns, null, 2);
}

export default function SettingsGuardrails() {
  const [settings, setSettings] = useState<GuardrailSettings | null>(null);
  const [patternsDraft, setPatternsDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tryText, setTryText] = useState("");
  const [tryResult, setTryResult] = useState<{ masked: string; findings: PiiFinding[] } | null>(null);
  const [tryBusy, setTryBusy] = useState(false);
  const [tryError, setTryError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await readSettings().catch(() => null);
    if (next) setSettings(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleScrub = useCallback(
    async (scrubOutbound: boolean) => {
      setBusy("toggle");
      setError(null);
      try {
        const response = await fetch("/api/guardrails", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scrubOutbound }),
        });
        const payload = (await response.json()) as { settings?: GuardrailSettings; error?: string };
        if (!response.ok) {
          setError(payload.error || "That did not work.");
          return;
        }
        if (payload.settings) setSettings(payload.settings);
      } catch {
        setError("Breadboard could not reach the guardrails service.");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const savePatterns = useCallback(async () => {
    if (patternsDraft === null) return;
    setBusy("patterns");
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(patternsDraft);
    } catch {
      setError("That is not valid JSON.");
      setBusy(null);
      return;
    }
    try {
      const response = await fetch("/api/guardrails", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customPatterns: parsed }),
      });
      const payload = (await response.json()) as { settings?: GuardrailSettings; error?: string };
      if (!response.ok) {
        setError(payload.error || "That did not work.");
        return;
      }
      if (payload.settings) setSettings(payload.settings);
      setPatternsDraft(null);
    } catch {
      setError("Breadboard could not reach the guardrails service.");
    } finally {
      setBusy(null);
    }
  }, [patternsDraft]);

  const runTry = useCallback(async () => {
    setTryBusy(true);
    setTryError(null);
    setTryResult(null);
    let customPatterns: unknown;
    if (patternsDraft !== null) {
      try {
        customPatterns = JSON.parse(patternsDraft);
      } catch {
        setTryError("Fix the custom pattern JSON before trying it.");
        setTryBusy(false);
        return;
      }
    }
    try {
      const response = await fetch("/api/guardrails", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: tryText, ...(customPatterns !== undefined ? { customPatterns } : {}) }),
      });
      const payload = (await response.json()) as {
        masked?: string;
        findings?: PiiFinding[];
        error?: string;
      };
      if (!response.ok) {
        setTryError(payload.error || "That did not work.");
        return;
      }
      setTryResult({ masked: payload.masked ?? "", findings: payload.findings ?? [] });
    } catch {
      setTryError("Breadboard could not reach the guardrails service.");
    } finally {
      setTryBusy(false);
    }
  }, [tryText, patternsDraft]);

  if (settings === null) {
    return <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Checking…</p>;
  }

  const patternsValue = patternsDraft ?? formatPatterns(settings.customPatterns);

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_32%,var(--line))] bg-[var(--paper-raised)] px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-4">
        <div>
          <p className="text-sm font-medium text-[var(--ink-heading)]">Mask PII in outbound messages</p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            Replaces emails, phone numbers, card numbers, IBANs, IP addresses and US Social
            Security numbers with tokens like <code>&lt;EMAIL_ADDRESS&gt;</code> before a
            WhatsApp or Telegram reply is sent. Runs locally — nothing leaves this machine to
            do it.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <input
            type="checkbox"
            checked={settings.scrubOutbound}
            onChange={(event) => void toggleScrub(event.target.checked)}
            disabled={busy !== null}
          />
          Scrub PII from outbound messages
        </label>
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-4">
        <div>
          <p className="text-sm font-medium text-[var(--ink-heading)]">Custom patterns</p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            A JSON list of <code>{"{ name, regex, replacement }"}</code>. Matches are replaced
            with <code>&lt;replacement&gt;</code>. Applied alongside the built-in detectors
            whenever scrubbing is on.
          </p>
        </div>
        <textarea
          value={patternsValue}
          onChange={(event) => setPatternsDraft(event.target.value)}
          rows={6}
          spellCheck={false}
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 font-mono text-xs text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
          placeholder={formatPatterns([{ name: "Employee ID", regex: "EMP-\\d{6}", replacement: "EMPLOYEE_ID" }])}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void savePatterns()}
            disabled={busy !== null || patternsDraft === null}
            className="neu-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {busy === "patterns" ? "Saving…" : "Save patterns"}
          </button>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-4">
        <p className="text-sm font-medium text-[var(--ink-heading)]">Try it</p>
        <textarea
          value={tryText}
          onChange={(event) => setTryText(event.target.value)}
          rows={3}
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
          placeholder="Paste a message to see what would be masked…"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void runTry()}
            disabled={tryBusy || !tryText.trim()}
            className="neu-button-accent rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            {tryBusy ? "Checking…" : "Preview mask"}
          </button>
        </div>
        {tryError ? <p className="text-xs text-[var(--danger)]">{tryError}</p> : null}
        {tryResult ? (
          <div className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2">
            <p className="whitespace-pre-wrap text-sm text-[var(--ink)]">{tryResult.masked}</p>
            {tryResult.findings.length > 0 ? (
              <p className="text-[11px] text-[var(--ink-muted)]">
                {tryResult.findings.length} match{tryResult.findings.length === 1 ? "" : "es"}:{" "}
                {tryResult.findings.map((f) => f.type).join(", ")}
              </p>
            ) : (
              <p className="text-[11px] text-[var(--ink-muted)]">No PII detected.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
