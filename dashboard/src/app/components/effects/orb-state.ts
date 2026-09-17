import type { OrbState } from "thinking-orbs";

/**
 * The volumetric orbs, and only those, for the status-line orb.
 *
 * `thinking-orbs` ships nine states. Seven of them read as a sphere seen in
 * the round — particles on tilted orbits, a scan meridian crossing a dotted
 * globe, bands and strands wrapping a body. Two do not: `breathing` is a
 * face-on ring and `shaping` is a flat outline morphing circle → triangle →
 * square. Those two are excluded here; the status line uses the spherical
 * set, and since 2026-09-15 always `composing`. `breathing` is not unused:
 * it is the generic loading mark (`components/breadboard-loader.tsx`), which
 * reaches the library directly rather than through `<ThinkingOrb>`.
 *
 * Nothing in the library enforces that, so the exclusion lives in this type: a
 * state outside this list cannot be passed to `<ThinkingOrb>`.
 */
export const VOLUMETRIC_ORB_STATES = [
  "working",
  "searching",
  "solving",
  "listening",
  "connecting",
  "weaving",
  "composing",
] as const satisfies readonly OrbState[];

export type VolumetricOrbState = (typeof VOLUMETRIC_ORB_STATES)[number];

const VOLUMETRIC = new Set<string>(VOLUMETRIC_ORB_STATES);

export function isVolumetricOrbState(value: unknown): value is VolumetricOrbState {
  return typeof value === "string" && VOLUMETRIC.has(value);
}

/**
 * Which orb a live status line would deserve, matched on its words.
 *
 * The chat no longer uses this — its orb is pinned to `composing` — but it is
 * kept for a surface that wants the label-matched orb.
 *
 * The chat's activity label is free text assembled from tool names, agent
 * names and lifecycle beats (see `hermes/activity-panel.tsx`), so this matches
 * on the words that actually recur there rather than on a closed enum. First
 * match wins, so the more specific verbs are listed before the general ones.
 */
// Stems, anchored at the start of a word only: the labels are written in the
// present participle ("Searching the web", "Reading the PDF"), so a closing
// \b would match none of them.
const LABEL_ORBS: ReadonlyArray<readonly [RegExp, VolumetricOrbState]> = [
  [/\b(search|brows|googl|look(ing)? up|research|fetch|crawl|web)/i, "searching"],
  [/\b(listen|voice|speech|transcrib|record|dictat|hearing)/i, "listening"],
  [/\b(connect|start|launch|waiting|queue|prepar|loading|attach|sync)/i, "connecting"],
  [/\b(writ|draft|compos|answer|summar|render|format|reply)/i, "composing"],
  [/\b(build|generat|creat|weav|assembl|design|edit|apply|install)/i, "weaving"],
  [/\b(solv|comput|calculat|analys|analyz|reason|plan|review|check|test|debug|reading)/i, "solving"],
];

/**
 * `working` is the default beat: it is what plain "Thinking" gets, and the
 * fallback for any label none of the patterns claim.
 */
export function orbStateForLabel(label: string | undefined): VolumetricOrbState {
  if (!label) return "working";
  for (const [pattern, state] of LABEL_ORBS) {
    if (pattern.test(label)) return state;
  }
  return "working";
}
