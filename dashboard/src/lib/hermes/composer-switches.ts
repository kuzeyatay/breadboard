// The app's on/off switches as an account setting.
//
// Each switch is a browser store backed by localStorage, which is keyed by
// origin — host *and* port. Runtime V2 hands the desktop dashboard a fresh
// loopback port on every launch, so after a Breadboard restart the app opens on
// an origin that has never seen the switches and every one of them reads as its
// default. The server copy is the authority that survives that: the stores
// write through to it on every change and hydrate from it on load.
//
// The record is partial on purpose. A key that was never set is absent, so the
// browser keeps its own default rather than a value nobody chose.
//
// `sunTheme` is the profile's "Sunrise to sunset" theme switch. It is not in the
// composer, but it is the same kind of thing — a boolean the browser used to
// keep per origin — so it rides the same column. See lib/app-theme.ts.

export const COMPOSER_SWITCH_KEYS = [
  "yoloMode",
  "agentMode",
  "superAgent",
  "directMode",
  "personalize",
  "sunTheme",
] as const;

export type ComposerSwitchKey = (typeof COMPOSER_SWITCH_KEYS)[number];

export type ComposerSwitches = Partial<Record<ComposerSwitchKey, boolean>>;

function isSwitchKey(value: string): value is ComposerSwitchKey {
  return (COMPOSER_SWITCH_KEYS as readonly string[]).includes(value);
}

/**
 * The switches from an untrusted object. Unknown keys and non-boolean values
 * make the whole record invalid (null) so a typo cannot be silently accepted
 * as "nothing to change".
 */
export function pickComposerSwitches(value: unknown): ComposerSwitches | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const switches: ComposerSwitches = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isSwitchKey(key) || typeof entry !== "boolean") return null;
    switches[key] = entry;
  }
  return switches;
}

/** The stored column, read forgivingly: a corrupt record is an empty one. */
export function parseComposerSwitches(raw: string | null | undefined): ComposerSwitches {
  if (!raw?.trim()) return {};
  try {
    return pickComposerSwitches(JSON.parse(raw)) ?? {};
  } catch {
    return {};
  }
}

/**
 * Apply a change on top of the stored record, keeping the coupling the
 * browser stores enforce: super agent needs the agent runtime and the
 * act-without-asking policy, and agent mode off takes super agent with it.
 * Enforced here as well so two surfaces racing their writes cannot leave the
 * account in a state no switch could have produced.
 */
export function mergeComposerSwitches(
  current: ComposerSwitches,
  patch: ComposerSwitches,
): ComposerSwitches {
  const next: ComposerSwitches = { ...current, ...patch };
  if (patch.superAgent === true) {
    next.agentMode = true;
    next.yoloMode = true;
  }
  if (patch.agentMode === false) {
    next.superAgent = false;
  }
  if (next.superAgent === true && next.agentMode === false) {
    next.superAgent = false;
  }
  return next;
}
