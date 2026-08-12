import {
  ASSISTANT_REASONING_EFFORTS,
  DEFAULT_ASSISTANT_REASONING_EFFORT,
  type AssistantReasoningEffort,
} from './assistant-reasoning.ts';

/**
 * The "intelligence modes" shown in the Intelligence menu.
 *
 * Which modes exist is a property of the *active model*, not of the UI: a
 * GPT-5.6 model accepts the full ladder up to Ultra, `gpt-5.1` stops at High,
 * Claude maps three levels onto thinking budgets, and a local Ollama model has
 * no notion of reasoning at all. ChatMock reports the honoured levels per model
 * on `/v1/models`; this module turns that list into labelled options.
 *
 * Offering a level the model ignores would be a control that silently does
 * nothing, so an unknown or empty list yields no modes rather than a default
 * ladder.
 */

export interface IntelligenceMode {
  value: AssistantReasoningEffort;
  label: string;
  detail: string;
}

const MODE_COPY: Record<AssistantReasoningEffort, { label: string; detail: string }> = {
  none: { label: 'None', detail: 'No reasoning pass' },
  low: { label: 'Light', detail: 'Quick, light reasoning' },
  medium: { label: 'Medium', detail: 'Balanced reasoning' },
  high: { label: 'High', detail: 'Deeper thinking' },
  xhigh: { label: 'Extra high', detail: 'Extended thinking' },
  max: { label: 'Ultra', detail: 'Maximum reasoning depth' },
};

/** Ladder order, weakest first. Drives how modes are listed and clamped. */
const LADDER: AssistantReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

function isEffort(value: unknown): value is AssistantReasoningEffort {
  return (
    typeof value === 'string' &&
    ASSISTANT_REASONING_EFFORTS.includes(value as AssistantReasoningEffort)
  );
}

/** Normalize the raw `reasoning_efforts` list ChatMock reports for a model. */
export function toIntelligenceModes(efforts: readonly unknown[] | undefined | null): IntelligenceMode[] {
  if (!Array.isArray(efforts)) return [];
  const supported = new Set(efforts.filter(isEffort));
  return LADDER.filter((effort) => supported.has(effort)).map((effort) => ({
    value: effort,
    ...MODE_COPY[effort],
  }));
}

/**
 * Keep a selected mode valid when the active model changes.
 *
 * Switching from GPT-5.6 (Ultra) to Claude (High) must not leave "Ultra"
 * selected — ChatMock would drop it and the UI would claim a depth that is not
 * being used. Falls to the nearest weaker level, then the strongest available.
 */
export function clampIntelligenceMode(
  current: AssistantReasoningEffort,
  modes: readonly IntelligenceMode[],
): AssistantReasoningEffort | null {
  if (modes.length === 0) return null;
  if (modes.some((mode) => mode.value === current)) return current;

  const currentRank = LADDER.indexOf(current);
  const weaker = [...modes]
    .reverse()
    .find((mode) => LADDER.indexOf(mode.value) <= currentRank);
  if (weaker) return weaker.value;

  const strongest = modes[modes.length - 1];
  return strongest ? strongest.value : null;
}

/** The mode a freshly selected model should start on. */
export function defaultIntelligenceMode(
  modes: readonly IntelligenceMode[],
): AssistantReasoningEffort | null {
  return clampIntelligenceMode(DEFAULT_ASSISTANT_REASONING_EFFORT, modes);
}
