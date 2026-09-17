"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHAT_MODEL_SENTINEL,
  GLOBAL_MODEL_SENTINEL,
  NO_MODEL_SENTINEL,
  formatAssistantModelName,
  groupAssistantModels,
  normalizeAssistantModelId,
} from "@/lib/ai-models";
import {
  loadAssistantPreferences,
  patchAssistantPreferences,
} from "@/lib/assistant-bootstrap-client";
import {
  applySavedAssistantIntelligence,
  clearCurrentAssistantSelection,
  useAssistantIntelligence,
} from "@/app/components/use-assistant-intelligence";
import { useAssistantModels } from "@/app/components/use-assistant-models";

export default function DefaultModelPanel() {
  const { model, failover } = useAssistantIntelligence({ scope: "profile-default", persist: false });
  const { models, modelsLoading } = useAssistantModels({ eager: true });
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadAssistantPreferences()
      .then((data) => {
        if (cancelled) return;
        if (!data || !normalizeAssistantModelId(data.model)) {
          throw new Error("The default model could not be loaded.");
        }
        applySavedAssistantIntelligence(data);
        setReady(true);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "The default model could not be loaded.");
        }
      });
    return () => { cancelled = true; };
  }, [loadAttempt]);

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
      const data = await patchAssistantPreferences({ model: normalized });
      // Changing the default is a deliberate statement about every surface, so
      // it clears the pick the composers have been sharing until now.
      clearCurrentAssistantSelection();
      applySavedAssistantIntelligence(data);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The default model could not be saved.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="neu-surface-raised rounded-2xl border border-gray-800 p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-white">Default model</h2>
        <p id="default-model-description" className="mt-0.5 text-xs text-gray-500">
          Used by background tasks, including Thought Topology, and whenever a chat
          or Learn run has no model selected. Chat and Learn choices override this default.
          {" "}Choose “No default model” to make tasks that require this default fail.
        </p>
      </header>
      <label className="block">
        <span className="sr-only">Default model</span>
        <select
          aria-label="Default model"
          aria-describedby="default-model-description"
          aria-busy={saving || (!ready && !error)}
          value={model}
          disabled={saving || !ready}
          onChange={(event) => void choose(event.target.value)}
          className="neu-button w-full rounded-xl border border-gray-800 bg-transparent px-3 py-2 text-sm text-gray-200 disabled:opacity-40"
        >
          <option value={NO_MODEL_SENTINEL}>No default model</option>
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
            ? "No default model selected. Tasks that require it will fail."
            : `${formatAssistantModelName(model)} is your default model.`}`
          : error ? "Default model unavailable." : "Loading…"}
      </p>
      {ready && failover?.usingFallback && failover.preferredModel === model ? (
        <p className="mt-2 text-xs leading-5 text-gray-400">
          Using {formatAssistantModelName(failover.servingModel)} temporarily while{" "}
          {formatAssistantModelName(model)} is unavailable.
          {failover.reason ? ` ${failover.reason}` : ""}
        </p>
      ) : null}
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
