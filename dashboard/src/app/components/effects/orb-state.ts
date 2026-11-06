import type { OrbState } from "thinking-orbs";

/**
 * The volumetric orbs, and only those, for the status-line orb.
 *
 * `thinking-orbs` ships nine states. Seven of them read as a sphere seen in
 * the round — particles on tilted orbits, a scan meridian crossing a dotted
 * globe, bands and strands wrapping a body. Two do not: `breathing` is a
 * face-on ring and `shaping` is a flat outline morphing circle → triangle →
 * square. Those two are excluded here; the status line uses the spherical
 * set, with `composing` reserved for Thinking. `breathing` is not unused:
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
 * Which orb a live status line uses, matched on its activity words.
 *
 * The chat's activity label is free text assembled from tool names, agent
 * names and lifecycle beats (see `hermes/activity-panel.tsx`), so this matches
 * on the words that actually recur there rather than on a closed enum. The
 * earliest activity word wins: "Planning research" is planning, and "Building
 * a web page" is building, even though both mention a search-related word.
 */
// Stems, anchored at the start of a word only: the labels are written in the
// present participle ("Searching the web", "Reading the PDF"), so a closing
// \b would match none of them.
const LABEL_ORBS: ReadonlyArray<readonly [RegExp, VolumetricOrbState]> = [
  [/^thinking\b/i, "composing"],
  [/\b(search|brows|googl|look(ing)? up|research|fetch|crawl|web|find)/i, "searching"],
  [/\b(listen|voice|speech|transcrib|dictat|hearing|record(?:ing)?\s+(?:audio|voice|speech|meeting))/i, "listening"],
  [/\b(connect|start|launch|wait|queu|prepar|load|attach|sync|delegat)/i, "connecting"],
  [/\b(writ|draft|compos|answer|summar|render|format|reply|work|run|process|record)/i, "working"],
  [/\b(build|generat|creat|weav|assembl|design|edit|apply|install)/i, "weaving"],
  [/\b(solv|comput|calculat|analys|analyz|reason|plan|review|check|test|debug|read|inspect|choos)/i, "solving"],
];

/**
 * An absent label means Thinking, matching the status row's default. Other
 * unrecognised activities get `working`, keeping the sash exclusive to Thinking.
 */
export function orbStateForLabel(label: string | undefined): VolumetricOrbState {
  const activity = label?.trim();
  if (!activity) return "composing";
  let state: VolumetricOrbState = "working";
  let firstMatch = Infinity;
  for (const [pattern, candidate] of LABEL_ORBS) {
    const match = pattern.exec(activity);
    if (match && match.index < firstMatch) {
      state = candidate;
      firstMatch = match.index;
    }
  }
  return state;
}
