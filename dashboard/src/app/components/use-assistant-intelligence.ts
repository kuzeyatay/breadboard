"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MODEL, normalizeAssistantModelId } from "@/lib/ai-models";
import {
  ASSISTANT_REASONING_EFFORTS,
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from "@/lib/assistant-reasoning";
import {
  clampIntelligenceMode,
  toIntelligenceModes,
  type IntelligenceMode,
} from "@/lib/intelligence-modes";
import { loadAssistantModelCatalog } from "@/lib/assistant-model-catalog-client";
import { ASSISTANT_MODELS_CHANGED_EVENT } from "@/app/components/use-assistant-models";
import {
  loadAssistantModelHealth,
  loadAssistantPreferences,
  patchAssistantPreferences,
} from "@/lib/assistant-bootstrap-client";

export const ASSISTANT_MODEL_STORAGE_KEY = "breadboard:assistant-model";
export const ASSISTANT_EFFORT_STORAGE_KEY = "breadboard:assistant-reasoning-effort";
/** The effort last chosen per model, so switching back restores that depth. */
export const ASSISTANT_EFFORT_BY_MODEL_STORAGE_KEY =
  "breadboard:assistant-reasoning-effort-by-model";
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

function isEffort(value: unknown): value is AssistantReasoningEffort {
  return (
    typeof value === "string" &&
    ASSISTANT_REASONING_EFFORTS.includes(value as AssistantReasoningEffort)
  );
}

function normalizeRememberedEfforts(value: unknown): Record<string, AssistantReasoningEffort> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, AssistantReasoningEffort] => isEffort(entry[1]),
    ),
  );
}

function localRememberedEfforts(): Record<string, AssistantReasoningEffort> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ASSISTANT_EFFORT_BY_MODEL_STORAGE_KEY);
    return raw ? normalizeRememberedEfforts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export interface ModelFailoverNotice {
  preferredModel: string;
  servingModel: string;
  usingFallback: boolean;
  reason: string;
  resetsInSeconds: number;
}

/** How often the picker re-checks whether the chosen model came back. */
const HEALTH_POLL_MS = 60_000;

export function useAssistantIntelligence() {
  const [model, setModelState] = useState(DEFAULT_MODEL);
  const [reasoningEffort, setReasoningEffortState] = useState(DEFAULT_ASSISTANT_REASONING_EFFORT);
  // Effort last chosen per model. Kept beside the active pair because the
  // ladders differ by model: moving to one that stops at High clamps the choice
  // down, and the depth chosen for the model you left must survive that.
  const rememberedEfforts = useRef<Record<string, AssistantReasoningEffort>>({});
  // Reasoning levels per model, as reported by ChatMock. Empty until loaded.
  const [effortsByModel, setEffortsByModel] = useState<Record<string, string[]>>({});
  const changedLocally = useRef(false);

  // Set while the chosen model is unavailable, so the UI can say which model
  // is standing in and for how long.
  const [failover, setFailover] = useState<ModelFailoverNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const data = await loadAssistantModelHealth() as { failover?: ModelFailoverNotice | null } | null;
        if (!cancelled) setFailover(data?.failover ?? null);
      } catch {
        // Health is advisory; a failed check must not itself raise an alarm.
      }
    };
    void check();
    // A plan window resets on its own, so keep checking rather than making the
    // reader reload to find out the model is back.
    const timer = window.setInterval(() => void check(), HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // The modes offered are a property of the active model, not of the UI.
  const intelligenceModes: IntelligenceMode[] = useMemo(
    () => toIntelligenceModes(effortsByModel[model]),
    [effortsByModel, model],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async (force = false) => {
      try {
        const rows = await loadAssistantModelCatalog({ force });
        if (cancelled || !Array.isArray(rows)) return;
        setEffortsByModel(
          Object.fromEntries(
            rows.flatMap((row: { id?: unknown; reasoning_efforts?: unknown }) =>
              typeof row?.id === "string"
                ? [[row.id, Array.isArray(row.reasoning_efforts) ? row.reasoning_efforts : []]]
                : [],
            ),
          ),
        );
      } catch {
        // No advertised modes: the menu shows none rather than a ladder the
        // model may not honour.
      }
    };
    void load();
    const handleCatalogChange = () => void load(true);
    window.addEventListener(ASSISTANT_MODELS_CHANGED_EVENT, handleCatalogChange);
    return () => {
      cancelled = true;
      window.removeEventListener(ASSISTANT_MODELS_CHANGED_EVENT, handleCatalogChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncFromStorage = (markChanged: boolean) => {
      if (markChanged) changedLocally.current = true;
      setModelState(localModel());
      setReasoningEffortState(localEffort());
      rememberedEfforts.current = localRememberedEfforts();
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
    loadAssistantPreferences()
      .then((data) => {
        if (cancelled || changedLocally.current || !data?.userPreference) return;
        const savedEfforts = normalizeRememberedEfforts(data.reasoningEffortByModel);
        rememberedEfforts.current = savedEfforts;
        window.localStorage.setItem(
          ASSISTANT_EFFORT_BY_MODEL_STORAGE_KEY,
          JSON.stringify(savedEfforts),
        );
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
    void patchAssistantPreferences(value).catch(() => undefined);
  }, []);

  /** Record the effort against a model and keep the local mirror in step. */
  const remember = useCallback((forModel: string, effort: AssistantReasoningEffort) => {
    rememberedEfforts.current = { ...rememberedEfforts.current, [forModel]: effort };
    window.localStorage.setItem(
      ASSISTANT_EFFORT_BY_MODEL_STORAGE_KEY,
      JSON.stringify(rememberedEfforts.current),
    );
  }, []);

  const setModel = useCallback((value: string) => {
    const normalized = normalizeAssistantModelId(value);
    if (!normalized) return;
    changedLocally.current = true;
    setModelState(normalized);
    window.localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, normalized);

    // Restore the depth this model was last used at. Sent in the same request
    // as the model so the two never race, and left out entirely for a model
    // never chosen before — the clamp below settles that case instead.
    const restored = rememberedEfforts.current[normalized];
    if (restored) {
      setReasoningEffortState(restored);
      window.localStorage.setItem(ASSISTANT_EFFORT_STORAGE_KEY, restored);
    }
    window.dispatchEvent(new CustomEvent(ASSISTANT_INTELLIGENCE_EVENT, {
      detail: { source: "local" },
    }));
    persist(restored ? { model: normalized, reasoningEffort: restored } : { model: normalized });

    // This selection *is* the background model: the one thing that asks
    // Breadboard for its default — Hermes, UI-TARS, OpenCode, deep research —
    // runs on. Settings shows it, but the Intelligence menu owns it.
    void fetch("/api/chatmock/default-model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: normalized }),
    }).catch(() => undefined);
  }, [persist]);

  const setReasoningEffort = useCallback((value: AssistantReasoningEffort) => {
    if (!ASSISTANT_REASONING_EFFORTS.includes(value)) return;
    changedLocally.current = true;
    setReasoningEffortState(value);
    window.localStorage.setItem(ASSISTANT_EFFORT_STORAGE_KEY, value);
    remember(model, value);
    window.dispatchEvent(new CustomEvent(ASSISTANT_INTELLIGENCE_EVENT, {
      detail: { source: "local" },
    }));
    persist({ reasoningEffort: value });
  }, [model, persist, remember]);

  // Switching from GPT-5.6 (Ultra) to Claude (High) must not leave "Ultra"
  // selected: ChatMock drops an unsupported effort, so the UI would be claiming
  // a depth that is not actually being used.
  useEffect(() => {
    if (intelligenceModes.length === 0) return;
    const clamped = clampIntelligenceMode(reasoningEffort, intelligenceModes);
    if (clamped && clamped !== reasoningEffort) setReasoningEffort(clamped);
  }, [intelligenceModes, reasoningEffort, setReasoningEffort]);

  return {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    /** Modes the active model honours. Empty means it has no reasoning notion. */
    intelligenceModes,
    /** Set when the chosen model is out of quota and a stand-in is serving. */
    failover,
  };
}
