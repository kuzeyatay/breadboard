"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_MODEL, normalizeAssistantModelId } from "@/lib/ai-models";
import {
  ASSISTANT_REASONING_EFFORTS,
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "@/lib/assistant-reasoning";

export const ASSISTANT_MODEL_STORAGE_KEY = "breadboard:assistant-model";
export const ASSISTANT_EFFORT_STORAGE_KEY = "breadboard:assistant-reasoning-effort";
const ASSISTANT_INTELLIGENCE_EVENT = "breadboard:assistant-intelligence-change";

function localModel(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  return normalizeAssistantModelId(window.localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY))
    ?? DEFAULT_MODEL;
}

function localEffort(): AssistantReasoningEffort {
  if (typeof window === "undefined") return DEFAULT_ASSISTANT_REASONING_EFFORT;
  const value = window.localStorage.getItem(ASSISTANT_EFFORT_STORAGE_KEY);
  return value && ASSISTANT_REASONING_EFFORTS.includes(value as AssistantReasoningEffort)
    ? value as AssistantReasoningEffort
    : DEFAULT_ASSISTANT_REASONING_EFFORT;
}

export function useAssistantIntelligence() {
  const [model, setModelState] = useState(DEFAULT_MODEL);
  const [reasoningEffort, setReasoningEffortState] = useState(DEFAULT_ASSISTANT_REASONING_EFFORT);
  const changedLocally = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const syncFromStorage = (markChanged: boolean) => {
      if (markChanged) changedLocally.current = true;
      setModelState(localModel());
      setReasoningEffortState(localEffort());
    };
    const handlePreferenceEvent = (event: Event) => {
      const source = (event as CustomEvent<{ source?: string }>).detail?.source;
      syncFromStorage(source !== "server");
    };
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === ASSISTANT_MODEL_STORAGE_KEY ||
        event.key === ASSISTANT_EFFORT_STORAGE_KEY
      ) {
        syncFromStorage(true);
      }
    };

    syncFromStorage(false);
    window.addEventListener(ASSISTANT_INTELLIGENCE_EVENT, handlePreferenceEvent);
    window.addEventListener("storage", handleStorage);
    fetch("/api/assistant-preferences", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (cancelled || changedLocally.current || !data?.userPreference) return;
        const savedModel = normalizeAssistantModelId(data.model);
        if (savedModel) {
          setModelState(savedModel);
          window.localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, savedModel);
        }
        if (
          typeof data.reasoningEffort === "string" &&
          ASSISTANT_REASONING_EFFORTS.includes(data.reasoningEffort as AssistantReasoningEffort)
        ) {
          setReasoningEffortState(data.reasoningEffort as AssistantReasoningEffort);
          window.localStorage.setItem(ASSISTANT_EFFORT_STORAGE_KEY, data.reasoningEffort);
        }
        window.dispatchEvent(new CustomEvent(ASSISTANT_INTELLIGENCE_EVENT, {
          detail: { source: "server" },
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener(ASSISTANT_INTELLIGENCE_EVENT, handlePreferenceEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const persist = useCallback((value: { model?: string; reasoningEffort?: AssistantReasoningEffort }) => {
    void fetch("/api/assistant-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }).catch(() => undefined);
  }, []);

  const setModel = useCallback((value: string) => {
    const normalized = normalizeAssistantModelId(value);
    if (!normalized) return;
    changedLocally.current = true;
    setModelState(normalized);
    window.localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, normalized);
    window.dispatchEvent(new CustomEvent(ASSISTANT_INTELLIGENCE_EVENT, {
      detail: { source: "local" },
    }));
    persist({ model: normalized });
  }, [persist]);

  const setReasoningEffort = useCallback((value: AssistantReasoningEffort) => {
    if (!ASSISTANT_REASONING_EFFORTS.includes(value)) return;
    changedLocally.current = true;
    setReasoningEffortState(value);
    window.localStorage.setItem(ASSISTANT_EFFORT_STORAGE_KEY, value);
    window.dispatchEvent(new CustomEvent(ASSISTANT_INTELLIGENCE_EVENT, {
      detail: { source: "local" },
    }));
    persist({ reasoningEffort: value });
  }, [persist]);

  return { model, setModel, reasoningEffort, setReasoningEffort };
}
