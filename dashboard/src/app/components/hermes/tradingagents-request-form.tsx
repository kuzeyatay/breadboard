"use client";

// The composer's input while TradingAgents is the selected agent.
//
// This agent takes no prompt. The cloned framework analyses one instrument on
// one date with a chosen set of analysts and a chosen debate depth, and there is
// nowhere in its graph for a sentence to go. So the message field is replaced by
// this form rather than left open to type into: an open field that quietly
// discards what you wrote would be worse than no field.
//
// Everything the form does not ask about — models, data vendors, report
// language — comes from the agent's settings page, loaded here so the run starts
// the way it was configured.

import { useCallback, useMemo, type ReactNode } from "react";
import {
  MAX_TRADINGAGENTS_ROUNDS,
  TRADINGAGENTS_ANALYSTS,
  isValidTicker,
  normalizeTicker,
  todayIso,
  validateTradingAgentsRequest,
  type TradingAgentsAnalyst,
  type TradingAgentsRequest,
} from "@/lib/tradingagents/identity.ts";

export interface TradingAgentsFormState {
  ticker: string;
  tradeDate: string;
  analysts: TradingAgentsAnalyst[];
  researchDepth: number;
  riskRounds: number;
  assetType: "stock" | "crypto";
}

/** What the form starts with before the stored settings arrive. */
export function initialTradingAgentsForm(): TradingAgentsFormState {
  return {
    ticker: "",
    tradeDate: todayIso(),
    analysts: TRADINGAGENTS_ANALYSTS.map((analyst) => analyst.key),
    researchDepth: 1,
    riskRounds: 1,
    assetType: "stock",
  };
}

/** The request a form state describes, or null while it is not runnable yet. */
export function tradingAgentsRequestFrom(
  form: TradingAgentsFormState,
): TradingAgentsRequest | null {
  const validated = validateTradingAgentsRequest(form);
  return validated.ok ? validated.request : null;
}

const inputClass =
  "neu-inset w-full rounded-xl border border-[var(--line)] bg-[var(--paper-surface)] px-2.5 py-1.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--botanical)]/15";

/**
 * One labelled control. Every field is exactly two rows tall — caption then
 * control — so the whole row lines up on one baseline however it wraps. A field
 * that grew a third row (a hint line) would push its own caption above the
 * others and out of the card, which is what this shape prevents.
 */
function Field({
  id,
  label,
  title,
  className = "",
  children,
}: {
  id: string;
  label: string;
  /** The explanation that would otherwise need a third row. */
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={id}
        title={title}
        className="text-[11px] font-medium leading-4 text-[var(--ink-heading)]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function RoundsField({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
}) {
  return (
    <Field id={id} label={label} title={hint} className="w-[4.5rem] shrink-0">
      <input
        id={id}
        type="number"
        min={1}
        max={MAX_TRADINGAGENTS_ROUNDS}
        value={value}
        disabled={disabled}
        title={hint}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(Number.isFinite(next) ? next : 1);
        }}
        className={`${inputClass} px-2 text-center`}
      />
    </Field>
  );
}

export default function TradingAgentsRequestForm({
  form,
  onChange,
  onSubmit,
  onOpenSettings,
  modelNote = "",
  disabled = false,
  busy = false,
}: {
  form: TradingAgentsFormState;
  onChange: (next: TradingAgentsFormState) => void;
  onSubmit: () => void;
  /** Opens the agent's settings panel, where the defaults live. */
  onOpenSettings?: () => void;
  /** Which models a run will use, when the settings pin them. */
  modelNote?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  // Purely controlled: the composer owns the request, seeds it from the stored
  // settings, and applies anything a pasted command carried. Keeping all of that
  // outside the form is what lets this component stay free of effects.
  const today = useMemo(() => todayIso(), []);
  const tickerLooksWrong = form.ticker.trim().length > 0 && !isValidTicker(form.ticker);
  const request = tradingAgentsRequestFrom(form);
  const ready = Boolean(request) && !disabled && !busy;

  const toggleAnalyst = useCallback(
    (key: TradingAgentsAnalyst) => {
      const next = form.analysts.includes(key)
        ? form.analysts.filter((analyst) => analyst !== key)
        : [...form.analysts, key];
      onChange({ ...form, analysts: next });
    },
    [form, onChange],
  );

  return (
    <div className="px-2 pb-1.5 pt-1">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-3">
        <div className="flex flex-wrap items-start gap-x-2.5 gap-y-2.5">
          <Field
            id="tradingagents-ticker"
            label="Symbol"
            className="min-w-[7.5rem] flex-[2_1_7.5rem]"
          >
            <input
              id="tradingagents-ticker"
              value={form.ticker}
              disabled={disabled}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder={form.assetType === "crypto" ? "BTC-USD" : "NVDA"}
              onChange={(event) =>
                onChange({ ...form, ticker: normalizeTicker(event.target.value) })
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                if (ready) onSubmit();
              }}
              className={`${inputClass} font-mono`}
              aria-invalid={tickerLooksWrong}
            />
          </Field>

          <Field
            id="tradingagents-date"
            label="Analysis date"
            className="min-w-[9rem] flex-[1_1_9rem]"
          >
            <input
              id="tradingagents-date"
              type="date"
              value={form.tradeDate}
              max={today}
              disabled={disabled}
              onChange={(event) => onChange({ ...form, tradeDate: event.target.value })}
              className={inputClass}
            />
          </Field>

          <Field id="tradingagents-asset" label="Asset" className="w-[6.5rem] shrink-0">
            <select
              id="tradingagents-asset"
              value={form.assetType}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...form,
                  assetType: event.target.value === "crypto" ? "crypto" : "stock",
                })
              }
              className={inputClass}
            >
              <option value="stock">Stock</option>
              <option value="crypto">Crypto</option>
            </select>
          </Field>

          <RoundsField
            id="tradingagents-depth"
            label="Research"
            hint="Rounds of bull-versus-bear debate before the manager rules."
            value={form.researchDepth}
            disabled={disabled}
            onChange={(next) => onChange({ ...form, researchDepth: next })}
          />
          <RoundsField
            id="tradingagents-risk"
            label="Risk"
            hint="Rounds the aggressive, conservative and neutral analysts argue."
            value={form.riskRounds}
            disabled={disabled}
            onChange={(next) => onChange({ ...form, riskRounds: next })}
          />
        </div>

        <fieldset className="mt-3">
          <legend className="text-[11px] font-medium text-[var(--ink-heading)]">Analysts</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {TRADINGAGENTS_ANALYSTS.map((analyst) => {
              const on = form.analysts.includes(analyst.key);
              return (
                <button
                  key={analyst.key}
                  type="button"
                  onClick={() => toggleAnalyst(analyst.key)}
                  disabled={disabled}
                  aria-pressed={on}
                  title={analyst.detail}
                  className={`rounded-full px-2.5 py-1 text-[11px] transition disabled:opacity-50 ${
                    on
                      ? "neu-selected bg-[var(--paper-strong)] text-[var(--botanical)]"
                      : "neu-button text-[var(--ink-muted)]"
                  }`}
                >
                  {analyst.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <p className="mt-2.5 text-[10px] leading-4 text-[var(--ink-muted)]">
          {tickerLooksWrong
            ? "That symbol is not one the data vendors can look up."
            : modelNote
              ? `Runs through ${modelNote}. `
              : "Runs through this chat's model. "}
          {tickerLooksWrong ? null : (
            <>
              Research output, not financial advice.
              {onOpenSettings ? (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="underline underline-offset-2 hover:text-[var(--botanical)]"
                  >
                    Change the defaults
                  </button>
                </>
              ) : null}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
