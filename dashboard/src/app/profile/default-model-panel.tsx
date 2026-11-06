"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHAT_MODEL_SENTINEL,
  DEFAULT_MODEL,
  GLOBAL_MODEL_SENTINEL,
  NO_MODEL_SENTINEL,
  formatAssistantModelName,
  groupAssistantModels,
  normalizeAssistantModelId,
} from "@/lib/ai-models";
import {
  loadAssistantPreferences,
  invalidateAssistantPreferences,
  patchAssistantPreferences,
} from "@/lib/assistant-bootstrap-client";
import {
  applySavedAssistantIntelligence,
  ASSISTANT_MODEL_STORAGE_KEY,
  ASSISTANT_FALLBACK_MODEL_STORAGE_KEY,
  ASSISTANT_INTELLIGENCE_EVENT,
} from "@/app/components/use-assistant-intelligence";
import { useAssistantModels } from "@/app/components/use-assistant-models";

export default function DefaultModelPanel() {
  return <ModelPreferencePanel kind="default" />;
}

export function FallbackModelPanel() {
  return <ModelPreferencePanel kind="fallback" />;
}

function ModelPreferencePanel({ kind }: { kind: "default" | "fallback" }) {
  const isFallback = kind === "fallback";
  const title = isFallback ? "Fallback model" : "Default model";
  const field = isFallback ? "fallbackModel" : "model";
  const [model, setModel] = useState(DEFAULT_MODEL);
  const { models, modelsLoading } = useAssistantModels({ eager: true });
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const storageKey = isFallback ? ASSISTANT_FALLBACK_MODEL_STORAGE_KEY : ASSISTANT_MODEL_STORAGE_KEY;
    const syncSaved = () => {
      try {
        const selected = normalizeAssistantModelId(window.localStorage.getItem(storageKey));
        if (selected) setModel(selected);
      } catch { /* The confirmed response still works without browser storage. */ }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey) return;
      invalidateAssistantPreferences();
      syncSaved();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(ASSISTANT_INTELLIGENCE_EVENT, syncSaved);
    void loadAssistantPreferences()
      .then((data) => {
        if (cancelled) return;
        const selected = normalizeAssistantModelId(data?.[field]);
        if (!data || !selected) {
          throw new Error(`The ${kind} model could not be loaded.`);
        }
        setModel(selected);
        applySavedAssistantIntelligence(data);
        setReady(true);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : `The ${kind} model could not be loaded.`);
        }
      });
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ASSISTANT_INTELLIGENCE_EVENT, syncSaved);
    };
  }, [field, isFallback, kind, loadAttempt]);

  const options = useMemo(() => {
    const ids = models.includes(model) ? models : [model, ...models];
    return groupAssistantModels(ids.filter(
      (id) => id !== CHAT_MODEL_SENTINEL && id !== GLOBAL_MODEL_SENTINEL && id !== NO_MODEL_SENTINEL,
    ));
  }, [models, model]);

  async function choose(value: string) {
    const normalized = normalizeAssistantModelId(value);
    if (!normalized || normalized === model || !ready || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const data = await patchAssistantPreferences({ [field]: normalized });
      const selected = normalizeAssistantModelId(data[field]);
      if (!selected) throw new Error(`The saved ${kind} model could not be read. Please retry.`);
      setModel(selected);
      applySavedAssistantIntelligence(data);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `The ${kind} model could not be saved.`);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p id={`${kind}-model-description`} className="mt-0.5 text-xs text-gray-500">
          {isFallback
            ? "Used when a model fails, for background tasks, or when no model is selected. Choose “No fallback model” to turn this off."
            : "The model selected when Breadboard starts. Changes apply on the next start; your current model selection stays as it is."}
        </p>
      </header>
      <label className="block">
        <span className="sr-only">{title}</span>
        <select
          aria-label={title}
          aria-describedby={`${kind}-model-description`}
          aria-busy={saving || (!ready && !error)}
          value={model}
          disabled={saving || !ready}
          onChange={(event) => void choose(event.target.value)}
          className="neu-button w-full rounded-xl border border-gray-800 bg-transparent px-3 py-2 text-sm text-gray-200 disabled:opacity-40"
        >
          <option value={NO_MODEL_SENTINEL}>No {kind} model</option>
          {options.map((group) => (
            <optgroup key={group.vendorId} label={group.vendorLabel}>
              {group.models.map((id) => (
                <option key={id} value={id}>{formatAssistantModelName(id)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p role="status" className="mt-2 text-xs text-gray-400">
        {saving ? "Saving…" : ready
          ? `${saved ? "Saved. " : ""}${model === NO_MODEL_SENTINEL
            ? isFallback ? "Fallback is disabled." : "No model will be selected at startup."
            : `${formatAssistantModelName(model)} is your ${kind} model.`}`
          : error ? `${title} unavailable.` : "Loading…"}
      </p>
      {error ? (
        <div className="mt-2 text-xs text-[#a45f56]">
          <p role="alert">{error}</p>
          {!ready ? (
            <button
              type="button"
              className="mt-1 underline underline-offset-2"
              onClick={() => { setError(null); setLoadAttempt((attempt) => attempt + 1); }}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {modelsLoading ? (
        <p className="mt-2 text-[10px] text-gray-600">Refreshing the model list…</p>
      ) : null}
    </section>
  );
}
