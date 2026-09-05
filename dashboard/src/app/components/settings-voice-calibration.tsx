"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface VoiceProfileState {
  available: boolean;
  exists: boolean;
  content: string | null;
  template: string | null;
  updatedAt: string | null;
}

const RECOMMENDED_WORDS = 2000;

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })
    : null;
}

export default function SettingsVoiceCalibration() {
  const [state, setState] = useState<VoiceProfileState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "calibrate" | "append" | "save" | "delete">(null);

  // Draft samples the user is pasting in. Always at least one field.
  const [samples, setSamples] = useState<string[]>([""]);
  const [editing, setEditing] = useState(false);
  const [draftProfile, setDraftProfile] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/unslop/voice-profile", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as VoiceProfileState & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "The tone profile could not be loaded.");
      setState(payload);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The tone profile could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalWords = useMemo(
    () => samples.reduce((sum, text) => sum + countWords(text), 0),
    [samples],
  );
  const filledSamples = samples.filter((text) => text.trim().length > 0);

  function updateSample(index: number, value: string) {
    setSamples((current) => current.map((text, i) => (i === index ? value : text)));
  }
  function addSample() {
    setSamples((current) => (current.length >= 6 ? current : [...current, ""]));
  }
  function removeSample(index: number) {
    setSamples((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.length ? next : [""];
    });
  }

  async function submitSamples(mode: "calibrate" | "append") {
    if (filledSamples.length === 0) {
      setError("Add at least one text you wrote yourself.");
      return;
    }
    setBusy(mode);
    setError(null);
    try {
      const response = await fetch("/api/unslop/voice-profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ samples: filledSamples, mode }),
      });
      const payload = (await response.json().catch(() => ({}))) as VoiceProfileState & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "Calibration failed.");
      setState(payload);
      setSamples([""]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Calibration failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    setBusy("save");
    setError(null);
    try {
      const response = await fetch("/api/unslop/voice-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: draftProfile }),
      });
      const payload = (await response.json().catch(() => ({}))) as VoiceProfileState & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "The profile could not be saved.");
      setState(payload);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The profile could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function removeProfile() {
    setBusy("delete");
    setError(null);
    try {
      const response = await fetch("/api/unslop/voice-profile", { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as VoiceProfileState & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "The profile could not be reverted.");
      setState(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The profile could not be reverted.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--ink-muted)]">Loading tone profile…</p>;
  }

  if (state && !state.available) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-[var(--ink-heading)]">Tone calibration</h3>
        <p className="neu-inset rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-6 text-center text-xs text-[var(--ink-muted)]">
          The unslop skill isn&apos;t installed. Clone it into the repo root (a{" "}
          <code className="font-mono">unslop/</code> folder) to calibrate your tone.
        </p>
      </div>
    );
  }

  const anyBusy = busy !== null;
  const updated = formatDate(state?.updatedAt ?? null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[var(--ink-heading)]">Tone calibration</h3>
          <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
            The default &ldquo;human&rdquo; tone is still someone else&apos;s. Paste a few things you
            wrote yourself and the model humanizes UI answers using your tone, not an averaged
            &ldquo;good style&rdquo;.
          </p>
        </div>
        {state?.exists ? (
          <span className="shrink-0 rounded-full bg-[var(--paper-strong)] px-2.5 py-1 text-[11px] text-[var(--botanical)]">
            Calibrated
          </span>
        ) : null}
      </div>

      {/* Current profile */}
      {state?.exists ? (
        <section className="neu-surface-subtle space-y-2 rounded-2xl border border-[var(--line)] bg-[var(--paper-surface)] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--ink-heading)]">
              Your profile{updated ? ` · updated ${updated}` : ""}
            </span>
            <div className="flex gap-1.5">
              {editing ? (
                <>
                  <button
                    type="button"
                    disabled={anyBusy}
                    onClick={() => void saveEdit()}
                    className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
                  >
                    {busy === "save" ? "Saving…" : "Save edits"}
                  </button>
                  <button
                    type="button"
                    disabled={anyBusy}
                    onClick={() => setEditing(false)}
                    className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={anyBusy}
                  onClick={() => {
                    setDraftProfile(state.content ?? "");
                    setEditing(true);
                  }}
                  className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                >
                  Edit by hand
                </button>
              )}
            </div>
          </div>
          {editing ? (
            <textarea
              value={draftProfile}
              onChange={(event) => setDraftProfile(event.target.value)}
              spellCheck={false}
              className="h-56 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] p-3 font-mono text-[11px] leading-5 text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
            />
          ) : (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] p-3 font-mono text-[11px] leading-5 text-[var(--ink-muted)]">
              {state.content}
            </pre>
          )}
        </section>
      ) : null}

      {/* Sample input */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-[var(--ink-heading)]">
            {state?.exists ? "Teach it another text" : "Your writing samples"}
          </span>
          <span
            className={`text-[11px] ${
              totalWords >= RECOMMENDED_WORDS || state?.exists
                ? "text-[var(--ink-muted)]"
                : "text-[#8a6f00]"
            }`}
          >
            ~{totalWords} words
            {state?.exists ? "" : ` · aim for ${RECOMMENDED_WORDS}+`}
          </span>
        </div>
        <p className="text-[11px] leading-5 text-[var(--ink-muted)]">
          Use 3–5 texts you wrote without AI, different genres if you can. Nothing is stored except
          the extracted profile.
        </p>

        <div className="space-y-2">
          {samples.map((text, index) => (
            <div key={index} className="relative">
              <textarea
                value={text}
                onChange={(event) => updateSample(index, event.target.value)}
                placeholder={`Paste a text you wrote (${index + 1})…`}
                spellCheck={false}
                className="h-28 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper-bg)] p-3 text-xs leading-5 text-[var(--ink)] outline-none focus:border-[var(--line-strong)]"
              />
              {samples.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeSample(index)}
                  aria-label={`Remove sample ${index + 1}`}
                  className="neu-button-icon absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
                >
                  <svg aria-hidden className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {samples.length < 6 ? (
            <button
              type="button"
              onClick={addSample}
              className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
            >
              + Add another text
            </button>
          ) : null}
          <div className="ml-auto flex gap-1.5">
            {state?.exists ? (
              <button
                type="button"
                disabled={anyBusy || filledSamples.length === 0}
                onClick={() => void submitSamples("append")}
                className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-3 py-1.5 text-xs text-[var(--ink)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
              >
                {busy === "append" ? "Learning…" : "Learn from this text"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={anyBusy || filledSamples.length === 0}
              onClick={() => void submitSamples("calibrate")}
              className="neu-button rounded-lg border border-[var(--botanical)] bg-[var(--botanical)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy === "calibrate"
                ? "Calibrating…"
                : state?.exists
                  ? "Recalibrate from scratch"
                  : "Calibrate to my style"}
            </button>
          </div>
        </div>
      </section>

      {state?.exists ? (
        <button
          type="button"
          disabled={anyBusy}
          onClick={() => void removeProfile()}
          className="neu-button rounded-lg border border-[var(--line-strong)] bg-[var(--paper-raised)] px-2.5 py-1 text-[11px] text-[var(--danger)] transition hover:bg-[var(--paper-strong)] disabled:opacity-50"
        >
          {busy === "delete" ? "Reverting…" : "Revert to default style"}
        </button>
      ) : null}

      {error ? (
        <p className="text-xs leading-5 text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}

      <p className="border-t border-[var(--line)] pt-3 text-[11px] leading-5 text-[var(--ink-muted)]">
        Calibration tunes conventions (em dash tolerance, quote style), keeps your pet words and
        quirks, and sets rhythm and registers. It will not enable invented facts, switch off the
        honesty rules, or imitate another named author. The profile is plain markdown you can edit
        above.
      </p>
    </div>
  );
}
