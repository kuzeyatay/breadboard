"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_MODEL, GLOBAL_MODEL_SENTINEL, normalizeAssistantModelId } from "@/lib/ai-models";
import { ASSISTANT_REASONING_EFFORTS, DEFAULT_ASSISTANT_REASONING_EFFORT, type AssistantReasoningEffort } from "@/lib/assistant-reasoning";
import { clampIntelligenceMode, toIntelligenceModes } from "@/lib/intelligence-modes";
import { loadAssistantModelCatalog } from "@/lib/assistant-model-catalog-client";
import { ASSISTANT_MODELS_CHANGED_EVENT } from "@/app/components/use-assistant-models";
import { invalidateAssistantPreferences, loadAssistantModelHealth, loadAssistantPreferences, type AssistantPreferencesPayload } from "@/lib/assistant-bootstrap-client";

// These keys mirror only the profile default. Local picks use separate keys.
export const ASSISTANT_MODEL_STORAGE_KEY = "breadboard:assistant-model";
export const ASSISTANT_FALLBACK_MODEL_STORAGE_KEY = "breadboard:assistant-fallback-model";
export const ASSISTANT_EFFORT_STORAGE_KEY = "breadboard:assistant-reasoning-effort";
export const ASSISTANT_EFFORT_BY_MODEL_STORAGE_KEY = "breadboard:assistant-reasoning-effort-by-model";
// The active chat picker and its initial value are shared across renderers.
export const ASSISTANT_CURRENT_SELECTION_STORAGE_KEY = "breadboard:assistant-current-selection";
const CHAT_STARTUP_STORAGE_KEY = "breadboard:chat-startup-selection";
export const ASSISTANT_INTELLIGENCE_EVENT = "breadboard:assistant-intelligence-change";
const OVERRIDE_PREFIX = "breadboard:intelligence-override:";
const transientOverrides = new Map<string, string>();
const unsavedStorage = new Map<string, string | null>();
// Independent controls keep the preference they loaded with.
let startupModel: string | null = null;
let startupEffort: string | null = null;

function isEffort(value: unknown): value is AssistantReasoningEffort {
  return typeof value === "string" && ASSISTANT_REASONING_EFFORTS.includes(value as AssistantReasoningEffort);
}

function normalizeRememberedEfforts(value: unknown): Record<string, AssistantReasoningEffort> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, AssistantReasoningEffort] => isEffort(entry[1])));
}

function readStorage(key: string): string | null {
  if (unsavedStorage.has(key)) return unsavedStorage.get(key) ?? null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    unsavedStorage.delete(key);
  } catch { unsavedStorage.set(key, value); }
}

/** When this record's model was chosen by hand; 0 for one that was inherited. */
function pickedAt(record: Record<string, unknown>): number {
  const value = record.picked ?? record.at;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Forget the shared pick so every surface falls back to the profile default. */
export function clearCurrentAssistantSelection(): void {
  if (typeof window === "undefined") return;
  writeStorage(ASSISTANT_CURRENT_SELECTION_STORAGE_KEY, null);
  window.dispatchEvent(new Event(ASSISTANT_INTELLIGENCE_EVENT));
}

function parseRecord(value: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Publish a confirmed profile default. Saved chat selections and Learn picks stay intact. */
export function applySavedAssistantIntelligence(data: AssistantPreferencesPayload): void {
  const model = normalizeAssistantModelId(data.model);
  if (!model || typeof window === "undefined") return;
  if (startupModel === null) {
    startupModel = model;
    startupEffort = isEffort(data.reasoningEffort) ? data.reasoningEffort : DEFAULT_ASSISTANT_REASONING_EFFORT;
  }
  const chatStartup = data.chatStartup;
  if (chatStartup && normalizeAssistantModelId(chatStartup.model) && isEffort(chatStartup.reasoningEffort)) {
    writeStorage(CHAT_STARTUP_STORAGE_KEY, JSON.stringify(chatStartup));
  }
  writeStorage(ASSISTANT_MODEL_STORAGE_KEY, model);
  const fallbackModel = normalizeAssistantModelId(data.fallbackModel);
  if (fallbackModel) writeStorage(ASSISTANT_FALLBACK_MODEL_STORAGE_KEY, fallbackModel);
  if (isEffort(data.reasoningEffort)) writeStorage(ASSISTANT_EFFORT_STORAGE_KEY, data.reasoningEffort);
  writeStorage(ASSISTANT_EFFORT_BY_MODEL_STORAGE_KEY, JSON.stringify(normalizeRememberedEfforts(data.reasoningEffortByModel)));
  window.dispatchEvent(new Event(ASSISTANT_INTELLIGENCE_EVENT));
}

export interface ModelFailoverNotice {
  preferredModel: string;
  servingModel: string;
  usingFallback: boolean;
  reason: string;
  resetsInSeconds: number;
}

export interface AssistantIntelligenceScope {
  /** A surface or Learn draft. No scope means an independent component instance. */
  scope?: string;
  /** Omit for a standalone control; null is an unstarted chat. */
  sessionId?: string | number | null;
  /** Only a chat created from this draft may inherit its override. */
  createdSessionId?: string | number | null;
  /** Temporary chats keep their override in memory only. */
  persist?: boolean;
  /**
   * Chat surfaces share one current selection: a model picked in the terminal
   * is the model the garden workspace opens with, and the other way round. Off
   * by default - a Learn draft, a scheduled chat and the profile panel each
   * own their pick, and nothing they do moves anyone else's.
   */
  shared?: boolean;
}

const SERVER_SNAPSHOT = JSON.stringify([null, null, null, null, null, null]);

export function useAssistantIntelligence(options: AssistantIntelligenceScope = {}) {
  const [instanceId] = useState(() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const surface = options.scope ?? `instance:${instanceId}`;
  const draftKey = `${OVERRIDE_PREFIX}${surface}:draft:${instanceId}`;
  const key = options.sessionId === undefined
    ? `${OVERRIDE_PREFIX}${surface}`
    : options.sessionId === null ? draftKey
      : `${OVERRIDE_PREFIX}${surface}:chat:${options.sessionId}`;
  const persist = options.persist ?? options.scope !== undefined;
  const sharesSelection = options.shared === true;
  const readOverride = useCallback((target: string) => transientOverrides.get(target) ?? (persist && target !== draftKey ? readStorage(target) : null), [draftKey, persist]);
  const writeOverride = useCallback((target: string, value: string | null) => {
    transientOverrides.delete(target);
    if (persist && target !== draftKey) {
      writeStorage(target, value);
    } else if (value === null) transientOverrides.delete(target);
    else transientOverrides.set(target, value);
    window.dispatchEvent(new Event(ASSISTANT_INTELLIGENCE_EVENT));
  }, [draftKey, persist]);
  const previousKey = useRef(key);
  useLayoutEffect(() => {
    if (previousKey.current === draftKey && key !== draftKey && options.sessionId != null &&
      options.sessionId === options.createdSessionId) {
      const draft = readOverride(draftKey);
      if (draft && !readOverride(key)) writeOverride(key, draft);
      writeOverride(draftKey, null);
    }
    previousKey.current = key;
  }, [draftKey, key, options.createdSessionId, options.sessionId, readOverride, writeOverride]);

  const subscribe = useCallback((listener: () => void) => {
    window.addEventListener(ASSISTANT_INTELLIGENCE_EVENT, listener);
    const onStorage = (event: StorageEvent) => {
      // A pick in another window reaches this one as a storage event.
      if (event.key === null) unsavedStorage.clear();
      else unsavedStorage.delete(event.key);
      if (event.key === null || [ASSISTANT_MODEL_STORAGE_KEY, ASSISTANT_FALLBACK_MODEL_STORAGE_KEY, ASSISTANT_EFFORT_STORAGE_KEY, ASSISTANT_EFFORT_BY_MODEL_STORAGE_KEY].includes(event.key)) invalidateAssistantPreferences();
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ASSISTANT_INTELLIGENCE_EVENT, listener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const getSnapshot = useCallback(() => JSON.stringify([
    startupModel, startupEffort,
    readStorage(ASSISTANT_EFFORT_BY_MODEL_STORAGE_KEY), readOverride(key),
    sharesSelection ? readStorage(ASSISTANT_CURRENT_SELECTION_STORAGE_KEY) : null,
    sharesSelection ? readStorage(CHAT_STARTUP_STORAGE_KEY) : null,
  ]), [key, readOverride, sharesSelection]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  const [defaultModel, defaultEffort, defaultEffortsRaw, overrideRaw, sharedRaw, chatStartupRaw] = useMemo(() => JSON.parse(snapshot) as (string | null)[], [snapshot]);
  const override = useMemo(() => parseRecord(overrideRaw), [overrideRaw]);
  const shared = useMemo(() => parseRecord(sharedRaw), [sharedRaw]);
  const chatStartup = useMemo(() => parseRecord(chatStartupRaw), [chatStartupRaw]);
  // A private pick stays in its window. Regular chat surfaces always use
  // the shared picker, including chats with overrides saved by older builds.
  const scopedIsCurrent = !sharesSelection || (!persist && pickedAt(override) > 0 && pickedAt(override) >= pickedAt(shared));
  const model = (scopedIsCurrent ? normalizeAssistantModelId(override.model) : null)
    ?? normalizeAssistantModelId(shared.model)
    ?? normalizeAssistantModelId(chatStartup.model)
    ?? normalizeAssistantModelId(defaultModel) ?? DEFAULT_MODEL;
  const sharedEffort = isEffort(shared.reasoningEffort) ? shared.reasoningEffort : null;
  const chosenEffort = (scopedIsCurrent && isEffort(override.reasoningEffort)) ? override.reasoningEffort
    : sharedEffort ?? (isEffort(chatStartup.reasoningEffort) ? chatStartup.reasoningEffort
      : isEffort(defaultEffort) ? defaultEffort : DEFAULT_ASSISTANT_REASONING_EFFORT);

  useEffect(() => {
    let cancelled = false;
    void loadAssistantPreferences().then((data) => {
      if (!cancelled && data) applySavedAssistantIntelligence(data);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const [effortsByModel, setEffortsByModel] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let cancelled = false;
    const load = async (force = false) => {
      try {
        const rows = await loadAssistantModelCatalog({ force });
        if (!cancelled && Array.isArray(rows)) setEffortsByModel(Object.fromEntries(rows.flatMap((row) =>
          typeof row.id === "string" ? [[row.id, Array.isArray(row.reasoning_efforts) ? row.reasoning_efforts : []]] : [],
        )));
      } catch { /* Keep the picker usable while the catalog is unavailable. */ }
    };
    void load();
    const refresh = () => void load(true);
    window.addEventListener(ASSISTANT_MODELS_CHANGED_EVENT, refresh);
    return () => { cancelled = true; window.removeEventListener(ASSISTANT_MODELS_CHANGED_EVENT, refresh); };
  }, []);
  const intelligenceModes = useMemo(() => toIntelligenceModes(effortsByModel[model]), [effortsByModel, model]);
  // Clamping a local choice must never persist a different profile preference.
  const reasoningEffort = clampIntelligenceMode(chosenEffort, intelligenceModes) ?? chosenEffort;

  useLayoutEffect(() => {
    // Only independent conversations keep a copy of their inherited choice.
    if (sharesSelection || options.sessionId == null || !normalizeAssistantModelId(defaultModel)) return;
    // Read again because the draft-transfer layout effect may have just saved
    // a different choice for this newly created chat.
    const current = parseRecord(readOverride(key));
    if (normalizeAssistantModelId(current.model)) return;
    writeOverride(key, JSON.stringify({ ...current, model, reasoningEffort }));
  }, [defaultModel, key, model, options.sessionId, readOverride, reasoningEffort, sharesSelection, writeOverride]);

  // A pick is published for every other chat surface to open with. Scopes that
  // do not persist - a temporary chat, the profile panel's own preview - keep
  // their choice to themselves.
  const publish = useCallback((chosenModel: string, effort: AssistantReasoningEffort, at: number) => {
    if (!persist || !sharesSelection) return;
    writeStorage(ASSISTANT_CURRENT_SELECTION_STORAGE_KEY, JSON.stringify({ model: chosenModel, reasoningEffort: effort, at }));
  }, [persist, sharesSelection]);
  const resetModel = useCallback(() => {
    // "Use my default" is an instruction about every surface, not just this one.
    if (persist && sharesSelection) writeStorage(ASSISTANT_CURRENT_SELECTION_STORAGE_KEY, null);
    writeOverride(key, null);
  }, [key, persist, sharesSelection, writeOverride]);
  const setModel = useCallback((value: string) => {
    if (value === GLOBAL_MODEL_SENTINEL) { resetModel(); return; }
    const normalized = normalizeAssistantModelId(value);
    if (!normalized || ["chat", "auto"].includes(normalized.toLowerCase())) return;
    const current = parseRecord(readOverride(key));
    const remembered = {
      ...normalizeRememberedEfforts(parseRecord(defaultEffortsRaw)),
      ...normalizeRememberedEfforts(current.reasoningEffortByModel),
      [model]: reasoningEffort,
    };
    const effort = remembered[normalized] ?? reasoningEffort;
    const at = Date.now();
    publish(normalized, effort, at);
    writeOverride(key, JSON.stringify({ model: normalized,
      reasoningEffort: effort, reasoningEffortByModel: remembered, picked: at }));
  }, [defaultEffortsRaw, key, model, publish, readOverride, reasoningEffort, resetModel, writeOverride]);
  const setReasoningEffort = useCallback((value: AssistantReasoningEffort) => {
    if (!isEffort(value)) return;
    const current = parseRecord(readOverride(key));
    const at = Date.now();
    publish(model, value, at);
    // The model is published rather than pinned here: an effort change is not
    // a change of model, and a draft that never picked one still follows along.
    writeOverride(key, JSON.stringify({ ...current, reasoningEffort: value, picked: at,
      reasoningEffortByModel: { ...normalizeRememberedEfforts(current.reasoningEffortByModel), [model]: value } }));
  }, [key, model, publish, readOverride, writeOverride]);

  const [failover, setFailover] = useState<ModelFailoverNotice | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const data = await loadAssistantModelHealth() as { failover?: ModelFailoverNotice | null } | null;
        if (!cancelled) setFailover(data?.failover ?? null);
      } catch { /* Health is advisory. */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return { model, setModel, resetModel, reasoningEffort, setReasoningEffort, intelligenceModes,
    failover: failover?.preferredModel === model ? failover : null };
}
