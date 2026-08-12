"use client";

// The "how this agent runs by default" form, without a shell around it.
//
// It is a body rather than a dialog because every agent's settings live in one
// panel: agents that already had a setup dialog (Agent Reach's channels, the Socials Manager's
// accounts, TradingAgents' environment) get this rendered inside it, and the
// agents that had none get the generic dialog next door. One agent, one settings
// button, one panel.
//
// Every control is drawn from the agent's entry in the settings catalog, so
// adding an option to an agent is one entry in that file and nothing here.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  agentSettingDefaults,
  findConfigurableAgent,
  isDefaultAgentSettings,
  normalizeAgentSettings,
  type AgentSettingField,
  type AgentSettingValues,
  type Dimensions,
} from "@/lib/agent-settings/catalog.ts";
import { announceAgentSettingsChanged } from "@/lib/agent-settings/client.ts";

const fieldClass =
  "neu-inset w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--botanical)]/15";
const primaryButton =
  "neu-button-accent rounded-xl border border-[var(--botanical)] bg-[var(--botanical)] px-4 py-2 text-sm font-medium text-[var(--paper-raised)] transition hover:bg-[var(--botanical-hover)] disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButton =
  "neu-button rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] px-4 py-2 text-sm text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:cursor-not-allowed disabled:opacity-45";

export default function AgentRunDefaults({
  agentId,
  omit,
}: {
  agentId: string;
  /**
   * Fields the surrounding panel already offers in a richer form — the Socials Manager ticks
   * its networks in the account list itself, so showing a second control for
   * them here would be two answers to one question.
   */
  omit?: string[];
}) {
  const agent = useMemo(() => findConfigurableAgent(agentId), [agentId]);
  const fields = useMemo(
    () => (agent ? agent.fields.filter((field) => !omit?.includes(field.key)) : []),
    [agent, omit],
  );
  const [values, setValues] = useState<AgentSettingValues | null>(null);
  const [saved, setSaved] = useState<AgentSettingValues | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!agent) return;
      try {
        const response = await fetch(`/api/agent-settings/${agent.id}`, {
          cache: "no-store",
          signal,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          settings?: { values?: unknown };
        };
        if (!response.ok || payload.ok === false) throw new Error("These settings could not be read.");
        const normalized = normalizeAgentSettings(agent, payload.settings?.values);
        setValues(normalized);
        setSaved(normalized);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        // Still show the form — the defaults are the truth until a save lands.
        const defaults = agentSettingDefaults(agent);
        setValues(defaults);
        setSaved(defaults);
        setError(cause instanceof Error ? cause.message : "These settings could not be read.");
      }
    },
    [agent],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!agent) return null;

  const dirty =
    values !== null && saved !== null && JSON.stringify(values) !== JSON.stringify(saved);
  const atDefaults = values !== null && isDefaultAgentSettings(agent, values);

  function set(key: string, value: AgentSettingValues[string]) {
    setStatus("");
    setError("");
    setValues((current) => (current ? { ...current, [key]: value } : current));
  }

  async function submit(intent: "save" | "reset") {
    if (!agent || busy) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const response = await fetch(`/api/agent-settings/${agent.id}`, {
        method: intent === "save" ? "PUT" : "DELETE",
        headers: { "content-type": "application/json" },
        ...(intent === "save" ? { body: JSON.stringify({ values }) } : {}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        settings?: { values?: unknown };
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error ?? "These settings could not be saved.");
      }
      const normalized = normalizeAgentSettings(agent, payload.settings?.values);
      setValues(normalized);
      setSaved(normalized);
      // Chat hosts cache these per page load; tell them to read again.
      announceAgentSettingsChanged(agent.id);
      setStatus(
        intent === "save"
          ? "Saved. Runs started from now on use these values."
          : "Back to the shipped defaults.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "These settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (values === null) {
    return <p className="text-sm text-[var(--ink-muted)]">Reading your settings…</p>;
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit("save");
      }}
    >
      <p className="text-xs leading-5 text-[var(--ink-muted)]">
        {agent.appliesWhen} A flag typed into a message still wins for that message.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((field) => (
          <section
            key={field.key}
            className="neu-surface-subtle rounded-2xl border border-[var(--line)] p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-xs font-medium text-[var(--ink-heading)]">{field.label}</h4>
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">{field.help}</p>
              </div>
              {field.kind === "toggle" ? (
                <FieldControl
                  field={field}
                  value={values[field.key]}
                  onChange={(value) => set(field.key, value)}
                />
              ) : null}
            </div>
            {field.kind === "toggle" ? null : (
              <div className="mt-2">
                <FieldControl
                  field={field}
                  value={values[field.key]}
                  onChange={(value) => set(field.key, value)}
                />
              </div>
            )}
            {field.flag ? (
              <p className="mt-1.5 text-[10px] leading-4 text-[var(--ink-muted)]">
                Once: <span className="font-mono text-[var(--ink)]">{field.flag}</span>
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={primaryButton} disabled={busy || !dirty}>
          {busy ? "Saving…" : dirty ? "Save settings" : "Saved"}
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={busy || atDefaults}
          onClick={() => void submit("reset")}
        >
          Reset to defaults
        </button>
        {status ? (
          <p className="text-xs leading-5 text-[var(--botanical)]" role="status">
            {status}
          </p>
        ) : null}
        {error ? (
          <p className="text-xs leading-5 text-[#9a4e43] dark:text-[#efb4aa]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: AgentSettingField;
  value: AgentSettingValues[string];
  onChange: (value: AgentSettingValues[string]) => void;
}) {
  switch (field.kind) {
    case "select": {
      const current = typeof value === "string" ? value : field.default;
      return (
        <select
          className={fieldClass}
          aria-label={field.label}
          value={current}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    case "toggle": {
      const on = typeof value === "boolean" ? value : field.default;
      return (
        <button
          type="button"
          role="switch"
          aria-label={field.label}
          aria-checked={on}
          onClick={() => onChange(!on)}
          className={`neu-inset relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-[var(--botanical)]" : "bg-[var(--line-strong)]"}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-[var(--paper-raised)] shadow transition-transform ${on ? "translate-x-5" : ""}`}
          />
        </button>
      );
    }

    case "number": {
      const current = typeof value === "number" ? value : field.default;
      const unset = field.unsetValue !== undefined && current === field.unsetValue;
      return (
        <>
          <input
            className={fieldClass}
            type="number"
            aria-label={field.label}
            inputMode="numeric"
            min={field.unsetValue !== undefined ? Math.min(field.unsetValue, field.min) : field.min}
            max={field.max}
            step={1}
            value={current}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange(Number.isFinite(next) ? Math.trunc(next) : field.default);
            }}
          />
          <p className="mt-1 text-[10px] leading-4 text-[var(--ink-muted)]">
            {unset && field.unsetLabel ? field.unsetLabel : `${field.min}–${field.max}`}
          </p>
        </>
      );
    }

    case "text": {
      return (
        <input
          className={fieldClass}
          type="text"
          aria-label={field.label}
          maxLength={field.maxLength}
          placeholder={field.placeholder ?? ""}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }

    case "multiselect": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="neu-inset max-h-40 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] p-1.5">
          {field.options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[11px] text-[var(--ink)] hover:bg-[var(--paper-strong)]"
              >
                <input
                  type="checkbox"
                  className="accent-[var(--botanical)]"
                  checked={checked}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((entry) => entry !== option.value)
                        : [...selected, option.value],
                    )
                  }
                />
                {option.label}
              </label>
            );
          })}
        </div>
      );
    }

    case "dimensions": {
      const bed = (value ?? null) as Dimensions | null;
      const update = (axis: keyof Dimensions, raw: string) => {
        const parsed = Number(raw);
        const base: Dimensions = bed ?? { x: 0, y: 0, z: 0 };
        const next = { ...base, [axis]: Number.isFinite(parsed) ? Math.round(parsed) : 0 };
        // A partly typed volume is kept so the next axis can be filled in; it
        // only constrains a run once all three axes are set, which is what
        // saving normalizes it to.
        onChange(next.x || next.y || next.z ? next : null);
      };
      return (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {(["x", "y", "z"] as const).map((axis, index) => (
              <input
                key={axis}
                className={fieldClass}
                type="number"
                aria-label={`${field.label} ${field.axes[index]}`}
                placeholder={field.axes[index]}
                min={0}
                max={field.max}
                value={bed ? bed[axis] || "" : ""}
                onChange={(event) => update(axis, event.target.value)}
              />
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-[10px] leading-4 text-[var(--ink-muted)]">
              {bed ? `In ${field.unit}` : "Empty — parts are not constrained to a volume"}
            </p>
            {bed ? (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="text-[10px] text-[var(--botanical)] hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>
        </>
      );
    }
  }
}
