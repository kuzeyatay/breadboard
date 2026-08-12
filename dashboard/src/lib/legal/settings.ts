// Translating the Legal Agent's stored settings into the shape a run takes.
//
// The settings catalog speaks the UI's vocabulary — "follow the chat" for an
// unset reasoning effort, a multiselect of skill ids, a turn count as a number
// field. None of that belongs in the bridge's job, so it is converted here and
// the runtime only ever sees a resolved request.
//
// The precedence rule is the one every agent keeps: a flag typed in the message
// beats a stored default. That is enforced by feeding these values into
// `parseLegalRequest` as its defaults, never by applying them afterwards.

import {
  DEFAULT_MAX_TURNS,
  LEGAL_EFFORTS,
  LEGAL_SKILL_IDS,
  MAX_MAX_TURNS,
  MIN_MAX_TURNS,
  type LegalEffort,
  type LegalRequest,
  type LegalSkillId,
} from "./identity.ts";

export interface LegalSettings {
  maxTurns: number;
  skills: LegalSkillId[];
  /** Null means "follow the chat's own reasoning effort". */
  effort: LegalEffort | null;
  allowShell: boolean;
  /** Seconds a single shell command may take before it is killed. */
  shellTimeout: number;
}

export const DEFAULT_LEGAL_SETTINGS: LegalSettings = {
  maxTurns: DEFAULT_MAX_TURNS,
  skills: [...LEGAL_SKILL_IDS],
  effort: null,
  allowShell: true,
  shellTimeout: 120,
};

const MIN_SHELL_TIMEOUT = 10;
const MAX_SHELL_TIMEOUT = 900;

function clamp(value: number, low: number, high: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, Math.round(value)));
}

function readNumber(value: unknown, low: number, high: number, fallback: number): number {
  if (typeof value === "number") return clamp(value, low, high, fallback);
  if (typeof value === "string" && value.trim()) {
    return clamp(Number(value), low, high, fallback);
  }
  return fallback;
}

function readSkills(value: unknown): LegalSkillId[] {
  if (!Array.isArray(value)) return [...DEFAULT_LEGAL_SETTINGS.skills];
  const kept = value.filter((entry): entry is LegalSkillId =>
    (LEGAL_SKILL_IDS as readonly string[]).includes(entry as string),
  );
  // An empty selection is a real choice — "no document skills" — and is kept.
  return [...new Set(kept)];
}

function readEffort(value: unknown): LegalEffort | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "max") return "xhigh";
  return (LEGAL_EFFORTS as readonly string[]).includes(normalized)
    ? (normalized as LegalEffort)
    : null;
}

/** Read one user's stored values, falling back to the defaults field by field. */
export function legalSettingsFrom(values: Record<string, unknown> | null | undefined): LegalSettings {
  if (!values) return { ...DEFAULT_LEGAL_SETTINGS };
  return {
    maxTurns: readNumber(
      values.maxTurns,
      MIN_MAX_TURNS,
      MAX_MAX_TURNS,
      DEFAULT_LEGAL_SETTINGS.maxTurns,
    ),
    skills: "skills" in values ? readSkills(values.skills) : [...DEFAULT_LEGAL_SETTINGS.skills],
    effort: readEffort(values.effort),
    allowShell: values.allowShell === undefined ? true : values.allowShell !== false,
    shellTimeout: readNumber(
      values.shellTimeout,
      MIN_SHELL_TIMEOUT,
      MAX_SHELL_TIMEOUT,
      DEFAULT_LEGAL_SETTINGS.shellTimeout,
    ),
  };
}

/** The defaults `parseLegalRequest` starts from, before any inline flag. */
export function requestDefaultsFrom(settings: LegalSettings): Partial<Omit<LegalRequest, "task">> {
  return {
    maxTurns: settings.maxTurns,
    skills: settings.skills,
    effort: settings.effort,
    allowShell: settings.allowShell,
  };
}
