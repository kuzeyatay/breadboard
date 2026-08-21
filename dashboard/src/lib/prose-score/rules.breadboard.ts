/**
 * Breadboard tuning on top of the vendored soundshuman rule pack.
 *
 * The base pack was written for blog posts and marketing copy. A learning
 * garden is technical prose about physics, signals and hardware, where several
 * blacklisted words are the correct term for a real thing: an estimator is
 * robust, a wiring harness is a harness, an electron has an effective mass, a
 * result is statistically significant, and a linear system has a unique
 * solution. Scoring those as slop teaches the gate to reward vaguer writing.
 *
 * Each entry below drops a finding only when the surrounding text shows the
 * technical sense. Nothing here can add a finding, so the profile can only make
 * the score more forgiving, never harsher - and every exemption is one line to
 * delete if it turns out to be too generous.
 */

/** Drop a finding when `context` matches within `window` characters of it. */
export interface RuleExemption {
  /** Finding id, matched case-insensitively (e.g. "vocab:robust", "em-dash"). */
  appliesTo: string;
  /** Regex source tested against the surrounding window. */
  context: string;
  /** Characters of context on each side. Default 160. */
  window?: number;
  note: string;
}

export interface RuleProfile {
  name: string;
  note: string;
  /** Finding ids dropped unconditionally. */
  disable: string[];
  exemptions: RuleExemption[];
}

export const BREADBOARD_PROFILE: RuleProfile = {
  name: "breadboard-technical",
  note:
    "Learning-garden prose: technical senses of blacklisted words are spared, " +
    "and the rule-of-three detector is off because enumerating three physical " +
    "quantities is ordinary technical writing, not a rhetorical tic.",
  disable: ["oxford-triple"],
  exemptions: [
    {
      appliesTo: "vocab:robust",
      context:
        "\\b(control|controller|estimat\\w*|statistic\\w*|regression|optimi[sz]\\w*|stability|stable|noise|outlier)\\b",
      note: "robust control, robust estimator, robust to noise",
    },
    {
      appliesTo: "vocab:harness",
      context: "\\b(wire|wiring|cable|cabling|connector|loom|pinout|breakout)\\b",
      note: "a wiring harness is a physical part; this repo designs them",
    },
    {
      appliesTo: "vocab:harnessing",
      context: "\\b(wire|wiring|cable|cabling|connector|loom|pinout)\\b",
      note: "as above",
    },
    {
      appliesTo: "vocab:catalyst",
      context:
        "\\b(chemical|chemistry|reaction|catalysis|catalytic|enzyme|electrode|reagent)\\b",
      note: "chemistry, not the metaphor",
    },
    {
      appliesTo: "vocab:catalyze",
      context: "\\b(chemical|chemistry|reaction|catalysis|enzyme|reagent)\\b",
      note: "as above",
    },
    {
      appliesTo: "vocab:leverage",
      context:
        "\\b(financial|debt|margin|lever arm|torque|mechanical advantage|fulcrum)\\b",
      note: "leverage as a physical or financial quantity",
    },
    {
      appliesTo: "vocab:significant",
      context:
        "\\b(statistical\\w*|significance level|p-value|p ?[<=] ?0|confidence interval|null hypothesis|figures?)\\b",
      note: "statistical significance, significant figures",
    },
    {
      appliesTo: "vocab:effective",
      context:
        "\\beffective (mass|resistance|impedance|potential|length|area|capacitance|inductance|permittivity|permeability|temperature|field|charge|index|width|volume|value|number|aperture)\\b",
      window: 60,
      note: "effective mass, effective resistance and friends",
    },
    {
      appliesTo: "vocab:unique",
      context:
        "\\b(solution|solutions|factori[sz]ation|decomposition|determined|existence|uniqueness|eigenvalue)\\b",
      note: "existence and uniqueness of a solution",
    },
    {
      appliesTo: "vocab:essential",
      context: "\\b(singularity|singularities|spectrum|supremum)\\b",
      note: "essential singularity, essential spectrum",
    },
    {
      appliesTo: "vocab:cadence",
      context: "\\b(clock|timing|sampling|pulse|refresh|duty cycle)\\b",
      note: "cadence of a clock or sampling loop",
    },
    {
      appliesTo: "em-dash",
      context: "\\d\\s*[\\u2013\\u2014]\\s*\\d",
      window: 6,
      note: "an en dash between two numbers is a range, not an em dash tic",
    },
    {
      appliesTo: "inline-header-list",
      context:
        "[-+*]\\s+\\*\\*\\[S\\d+\\](?:\\s*,\\s*\\[S\\d+\\])*\\*\\*:",
      window: 2,
      note: "a bold source-citation key is bibliography structure, not an inline prose heading",
    },
  ],
};

/**
 * Build the `filterFinding` hook the engine takes. Returns undefined when the
 * profile is empty, so the caller pays nothing for the plain upstream run.
 */
export function buildFindingFilter(
  profile: RuleProfile | null,
): ((finding: { id: string; index: number; match: string }, prepared: string) => boolean) | undefined {
  if (!profile) return undefined;

  const disabled = new Set(profile.disable.map((id) => id.toLowerCase()));
  const exemptions = profile.exemptions.map((e) => ({
    appliesTo: e.appliesTo.toLowerCase(),
    re: new RegExp(e.context, "i"),
    window: e.window ?? 160,
  }));
  if (!disabled.size && !exemptions.length) return undefined;

  return (finding, prepared) => {
    const id = finding.id.toLowerCase();
    if (disabled.has(id)) return false;
    for (const e of exemptions) {
      if (e.appliesTo !== id) continue;
      const start = Math.max(0, finding.index - e.window);
      const end = Math.min(
        prepared.length,
        finding.index + finding.match.length + e.window,
      );
      if (e.re.test(prepared.slice(start, end))) return false;
    }
    return true;
  };
}
