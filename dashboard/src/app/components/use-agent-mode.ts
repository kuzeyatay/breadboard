"use client";

// Two coupled chat modes, stored in the browser beside YOLO mode.
//
// Agent mode is what sends a message through the Hermes agent runtime: the task
// planner, the capability broker, tools, memory, artifacts. It is ON by default,
// because the assistant is an agent first. Switched off, the chat becomes a
// plain provider chat — the message and the transcript go straight to the model
// and nothing can act.
//
// Super agent is agent mode with the whole inventory opened up: every reviewed
// skill selected for the turn, every connection's tools allowed, workflows
// runnable, and the specialist roster in front of it, the way the Chief of Staff
// persona works. It has no meaning without the runtime, so the two settings are
// coupled here rather than in the components that read them: turning super agent
// on turns agent mode on, and turning agent mode off turns super agent off.

import { useSyncExternalStore } from "react";
import { setYoloModeEnabled } from "./use-yolo-mode.ts";
import {
  persistComposerSwitch,
  registerComposerSwitch,
} from "./composer-switch-preferences.ts";

const AGENT_MODE_KEY = "breadboard:agent-mode";
const SUPER_AGENT_KEY = "breadboard:super-agent";
const CHANGE_EVENT = "breadboard:agent-mode-change";

// Fallbacks for a browser context where localStorage throws (private mode, a
// blocked origin). The UI still reflects the switch through the local event.
let agentModeMemory = true;
let superAgentMemory = false;

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Kept in memory only; the change event below still updates this tab.
  }
}

/** Whether this turn should run on the Hermes agent runtime. Defaults to on. */
export function isAgentModeEnabled(): boolean {
  return readFlag(AGENT_MODE_KEY, agentModeMemory);
}

/** Whether this turn should run with the full super-agent inventory. */
export function isSuperAgentEnabled(): boolean {
  // Super agent is meaningless without the runtime, so a stored `true` left
  // behind by an older build never outranks agent mode being off.
  return readFlag(SUPER_AGENT_KEY, superAgentMemory) && isAgentModeEnabled();
}

function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === AGENT_MODE_KEY || event.key === SUPER_AGENT_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function applyAgentMode(enabled: boolean): void {
  agentModeMemory = enabled;
  writeFlag(AGENT_MODE_KEY, enabled);
  if (!enabled) {
    superAgentMemory = false;
    writeFlag(SUPER_AGENT_KEY, false);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function applySuperAgent(enabled: boolean): void {
  superAgentMemory = enabled;
  writeFlag(SUPER_AGENT_KEY, enabled);
  if (enabled) {
    agentModeMemory = true;
    writeFlag(AGENT_MODE_KEY, true);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Exported so the coupling can be exercised without rendering a component. */
export function setAgentModeEnabled(enabled: boolean): void {
  applyAgentMode(enabled);
  persistComposerSwitch("agentMode", enabled);
  if (!enabled) persistComposerSwitch("superAgent", false);
}

export function setSuperAgentEnabled(enabled: boolean): void {
  applySuperAgent(enabled);
  if (enabled) {
    // Super Agent orchestrates private workers and cannot stop at their
    // permission cards, so enabling it also enables the shared bypass policy.
    setYoloModeEnabled(true);
    persistComposerSwitch("agentMode", true);
  }
  persistComposerSwitch("superAgent", enabled);
}

// Hydrated from the account on load: the localStorage copy belongs to one
// origin, and the desktop dashboard's origin changes on every launch. The
// account record already carries the coupling, so each flag applies alone.
registerComposerSwitch("agentMode", applyAgentMode);
registerComposerSwitch("superAgent", applySuperAgent);

// The setters are module-level and already stable, so they are returned as they
// are rather than wrapped in a hook that would only re-derive the same identity.
export function useAgentMode(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, isAgentModeEnabled, () => true);
  return [enabled, setAgentModeEnabled] as const;
}

export function useSuperAgent(): readonly [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribe,
    isSuperAgentEnabled,
    () => false,
  );
  return [enabled, setSuperAgentEnabled] as const;
}
