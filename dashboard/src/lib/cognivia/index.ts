// Cognivia, made innate to every Breadboard turn that touches mental health.
//
// Cognivia (Chen et al., *A Cognitive Behavioral Therapy Copilot for
// Evidence-Based Mental Healthcare*; cloned at <repo>/Cognivia) is a CBT
// copilot built on one claim: a supportive answer is worth more when it names
// the *cognitive distortion* in what the person said and answers that with a
// technique, rather than offering sympathy and stopping. The paper's pipeline
// is distortion identification followed by rational response generation, both
// grounded in a triplet dataset curated from CBT literature.
//
// Two halves make it innate here:
//   1. `hermes-config/system/cognivia.md` carries the durable discipline — the
//      copilot stance, the boundaries, the crisis rule, the instruction never
//      to narrate any of it. It ships only on turns this module engages, so a
//      question about TypeScript pays nothing for it.
//   2. This module decides whether a turn is mental-health related at all, in
//      which register, and which distortions the user's own wording suggests.
//      `cogniviaSection` renders the discipline plus that per-turn evidence.
//
// The clone is a live dependency, not a citation. The distortion taxonomy and
// the reference triplets are read out of `Cognivia/data/*.xlsx` at request
// time, so pulling the clone changes what Breadboard says. The upstream
// artifact that is *not* reachable — the LoRA fine-tune, which is served from
// Aliyun Model Studio behind an API key the paper's authors hold — is the one
// part not used: the method transfers through the prompt and the dataset, and
// the model behind the turn stays Breadboard's own.
//
// Upstream is CC BY-NC 4.0. Nothing here redistributes the dataset; it is read
// from the clone on the machine that already has it.

import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import { readXlsxGrid } from "../document-structure/xlsx.ts";

export type CogniviaRegister =
  | "none"
  /** Self-harm, suicidality, or immediate danger. Safety first, no analysis. */
  | "crisis"
  /** The user is describing their own struggle. The full copilot answers. */
  | "personal_distress"
  /** A factual question *about* mental health. Answered as fact, warmly. */
  | "informational";

export interface CogniviaClassification {
  register: CogniviaRegister;
  score: number;
  signals: string[];
  /** Canonical distortion names suggested by the wording, strongest first. */
  distortions: string[];
  /** The distress described belongs to someone the user is talking about. */
  thirdParty: boolean;
}

export interface CogniviaInput {
  userText: string | undefined | null;
}

export function cogniviaEnabled(): boolean {
  const raw = process.env.ENABLE_COGNIVIA?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function cogniviaRoot(): string {
  const configured = process.env.COGNIVIA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(repositoryRoot(), "Cognivia");
}

// --- the clone --------------------------------------------------------------

export interface DistortionEntry {
  name: string;
  definition: string;
  /** The emotions upstream associates with the pattern, where it records any. */
  emotions: string;
}

export interface CognitiveTriplet {
  thought: string;
  distortion: string;
  rationalResponse: string;
  /** The CBT text the row was curated from. */
  source: string;
}

/**
 * The eleven distortions, as Burns defines them and as upstream's workbook
 * lists them. Embedded so a missing clone degrades to a working turn rather
 * than to a generic one; the clone's own table wins whenever it is readable.
 */
const FALLBACK_TAXONOMY: readonly DistortionEntry[] = [
  {
    name: "All-or-nothing thinking",
    definition: "You look at things in absolute, black-and-white categories.",
    emotions: "",
  },
  {
    name: "Overgeneralization",
    definition: "You view a negative event as a never-ending pattern of defeat.",
    emotions: "",
  },
  { name: "Mental filter", definition: "You dwell on the negatives.", emotions: "" },
  {
    name: "Discounting the positives",
    definition: "You insist that your accomplishments or positive qualities do not count.",
    emotions: "",
  },
  {
    name: "Mind reading",
    definition:
      "You assume that people are reacting negatively to you when there is no definite evidence.",
    emotions: "",
  },
  {
    name: "Fortune telling",
    definition: "You arbitrarily predict that things will turn out badly.",
    emotions: "Anxiety",
  },
  {
    name: "Magnification or minimization",
    definition: "You blow things way out of proportion or you shrink their importance.",
    emotions: "",
  },
  {
    name: "Emotional reasoning",
    definition: "You reason from how you feel: I feel like an idiot, so I really must be one.",
    emotions: "",
  },
  {
    name: "Should statements",
    definition:
      "You criticize yourself or other people with shoulds, oughts, musts and have tos.",
    emotions: "Guilt, Frustration",
  },
  {
    name: "Labeling",
    definition:
      "Instead of saying I made a mistake, you tell yourself I am a jerk, or a fool, or a loser.",
    emotions: "Anger, Frustration, Low self-esteem",
  },
  {
    name: "Personalization and blame",
    definition:
      "You blame yourself for something you were not entirely responsible for, or you blame other people and deny your role in the problem.",
    emotions: "Guilt, Shame, Inadequacy",
  },
];

interface CachedDataset {
  mtimeMs: number;
  taxonomy: DistortionEntry[];
  triplets: CognitiveTriplet[];
}

// Keyed by resolved path, so pointing COGNIVIA_DIR at another checkout can
// never be served a stale read.
const datasetCache = new Map<string, CachedDataset>();

export function cogniviaDatasetPath(): string {
  return path.join(cogniviaRoot(), "data", "CBT_Cognitive_Triplet_Dataset.xlsx");
}

/** "1.All-or-nothing thinking" and "All-or-nothing thinking " are one label. */
function normalizeLabel(raw: string): string {
  return raw.replace(/^\s*\d+\s*[.、)]\s*/, "").replace(/\s+/g, " ").trim();
}

/**
 * Reads the curated workbook, re-reading whenever its mtime changes so a
 * `git pull` of the clone takes effect without restarting the dashboard.
 * A missing or unreadable workbook yields the embedded taxonomy and no
 * exemplars, which is the fallback path rather than an error.
 */
function readDataset(): { taxonomy: DistortionEntry[]; triplets: CognitiveTriplet[] } {
  const file = cogniviaDatasetPath();
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    datasetCache.delete(file);
    return { taxonomy: [...FALLBACK_TAXONOMY], triplets: [] };
  }
  const cached = datasetCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) {
    return { taxonomy: cached.taxonomy, triplets: cached.triplets };
  }

  let taxonomy: DistortionEntry[] = [];
  let triplets: CognitiveTriplet[] = [];
  try {
    const grid = readXlsxGrid(fs.readFileSync(file));
    for (const sheet of grid.sheets) {
      const header = (sheet.rows[0] ?? []).map((cell) => cell.toLowerCase());
      const body = sheet.rows.slice(1);
      // The definition sheet is the taxonomy: number, name, definition, emotion.
      if (header.some((cell) => cell.includes("definition"))) {
        taxonomy = body.flatMap((row) => {
          const name = normalizeLabel(row[1] ?? "");
          const definition = (row[2] ?? "").trim();
          if (!name || !definition) return [];
          return [{ name, definition, emotions: (row[3] ?? "").trim() }];
        });
        continue;
      }
      // The seed sheet is the triplets: thought, distortion, response, resource.
      if (header.some((cell) => cell.includes("thought"))) {
        triplets = body.flatMap((row) => {
          const thought = (row[0] ?? "").trim();
          const distortion = normalizeLabel(row[1] ?? "");
          const rationalResponse = (row[2] ?? "").trim();
          if (!thought || !distortion) return [];
          return [
            {
              thought,
              // Roughly half the seed rows carry a numeric cross-reference into
              // the source text rather than a written response. A row is still
              // a labelled thought without one, which is what this module uses.
              rationalResponse: /[a-z]{4}/i.test(rationalResponse) ? rationalResponse : "",
              distortion,
              source: (row[3] ?? "").trim(),
            },
          ];
        });
      }
    }
  } catch {
    taxonomy = [];
    triplets = [];
  }

  if (!taxonomy.length) taxonomy = [...FALLBACK_TAXONOMY];
  datasetCache.set(file, { mtimeMs, taxonomy, triplets });
  return { taxonomy, triplets };
}

export function cogniviaTaxonomy(): DistortionEntry[] {
  return readDataset().taxonomy;
}

/**
 * A seed row is usable as an exemplar when the thought is something a person
 * said about themselves. The workbook is curated from CBT literature, so some
 * rows are the book's narration about a patient rather than the patient's own
 * words, and those calibrate nothing.
 */
function usableAsExemplar(triplet: CognitiveTriplet): boolean {
  const thought = triplet.thought;
  if (thought.length < 10 || thought.length > 220) return false;
  if (/\b(the patient|the client|the therapist|the author|this chapter)\b/i.test(thought)) {
    return false;
  }
  return /\b(i|i'm|i've|my|me|myself)\b/i.test(thought);
}

/**
 * Seed thoughts labelled with one distortion, closest to the user's wording
 * first. Ranking is lexical overlap, tie-broken by dataset order, so the same
 * message always draws the same exemplars.
 */
export function cogniviaExemplars(
  distortion: string,
  userText: string,
  limit = 3,
): CognitiveTriplet[] {
  const { triplets } = readDataset();
  const target = normalizeLabel(distortion).toLowerCase();
  const words = new Set(
    userText
      .toLowerCase()
      .split(/[^a-z']+/)
      .filter((word) => word.length > 3),
  );
  return triplets
    .map((triplet, index) => ({ triplet, index }))
    .filter(
      ({ triplet }) => triplet.distortion.toLowerCase() === target && usableAsExemplar(triplet),
    )
    .map((entry) => {
      let overlap = 0;
      for (const word of entry.triplet.thought.toLowerCase().split(/[^a-z']+/)) {
        if (word.length > 3 && words.has(word)) overlap += 1;
      }
      return { ...entry, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.triplet);
}

export function cogniviaDiagnostics(): {
  root: string;
  dataset: string;
  live: boolean;
  taxonomySize: number;
  exemplarCount: number;
} {
  const { taxonomy, triplets } = readDataset();
  return {
    root: cogniviaRoot(),
    dataset: cogniviaDatasetPath(),
    live: fs.existsSync(cogniviaDatasetPath()),
    taxonomySize: taxonomy.length,
    exemplarCount: triplets.length,
  };
}

// --- classification ---------------------------------------------------------

// Upstream's own labelling prompt asks the identifier to be "inclusive and
// lenient", and the asymmetry here runs the same way: engaging warmly with a
// message that turned out to be ordinary frustration costs a softer paragraph,
// while missing a person who is struggling costs the thing that mattered. The
// section handles the false positives by telling the model to answer the actual
// request when the message is really a technical one.

const CRISIS =
  /\b(kill(ing)? myself|kill me|end(ing)? my life|take my own life|suicid(e|al)|want(ing)? to die|don'?t want to (be alive|live|wake up|exist)|no reason to (live|go on)|better off (dead|without me)|hurt(ing)? myself|harm(ing)? myself|self.?harm|cut(ting)? myself|overdos(e|ing)|not safe (right now|tonight)|going to jump)\b/;

interface Rule {
  weight: number;
  signal: string;
  pattern: RegExp;
}

const DISTRESS_RULES: readonly Rule[] = [
  {
    weight: 4,
    signal: "first_person_feeling",
    pattern:
      /\bi(?:'m| am| feel| have been| keep feeling)\s+(?:so |really |very |completely |utterly |always |just )?(?:depressed|anxious|worthless|hopeless|helpless|empty|numb|panicking|panicked|overwhelmed|burnt out|burned out|miserable|broken|lonely|alone|useless|ashamed|guilty|a failure|a burden|a mess)\b/,
  },
  {
    weight: 4,
    signal: "self_attack",
    pattern:
      /\b(i hate (myself|my life)|i'?m such a (failure|loser|idiot|mess|disappointment)|nobody (likes|loves|cares about|wants) me|everyone (hates|resents) me|no one (cares|would notice))\b/,
  },
  {
    weight: 4,
    signal: "cannot_cope",
    pattern:
      /\b(i (can'?t|cannot|couldn'?t) (cope|take (it|this) anymore|handle (it|this) anymore|stop crying|get out of bed|face (it|this|them|work|anyone))|falling apart|breaking down|panic attacks?|anxiety attacks?|crying (all the time|every day|myself to sleep|constantly))\b/,
  },
  {
    weight: 3,
    signal: "own_condition",
    pattern:
      /\bmy (anxiety|depression|panic|ocd|ptsd|trauma|grief|burnout|breakdown|mental health|therapist|therapy|medication|meds)\b/,
  },
  {
    weight: 3,
    signal: "bereavement",
    pattern:
      /\b((my|our) (mum|mom|dad|father|mother|partner|wife|husband|friend|brother|sister|son|daughter|grandmother|grandfather|nan|granddad) (just )?(died|passed away)|i'?m grieving|grieving for|since (he|she|they) died)\b/,
  },
  {
    // Someone asking how to help a person who is struggling is a mental-health
    // turn as much as someone describing their own struggle, and the first
    // person rules above all miss it. The section tells the model whose
    // distress it is, so the answer is not aimed at the wrong person.
    weight: 3,
    signal: "third_party_distress",
    pattern:
      /\b(my (friend|mate|sister|brother|mum|mom|dad|father|mother|partner|wife|husband|son|daughter|colleague|coworker|student)|someone i know|a friend of mine)\b[^.?!]{0,90}\b(depress(ed|ion)|anxious|anxiety|suicidal|self.?harm(ing)?|struggling|not coping|worthless|hopeless|breakdown|grieving|panic attacks?|therapy|therapist|drinking again)\b/,
  },
  {
    weight: 2,
    signal: "struggling",
    pattern:
      /\b(i'?m (really )?struggling|struggling (with|to cope)|i'?m not okay|i'?m not doing well|everything (is|feels) too much|what'?s the point (of|in) )/,
  },
];

const TOPIC_RULES: readonly Rule[] = [
  {
    weight: 3,
    signal: "cbt_vocabulary",
    pattern:
      /\b(cognitive distortion|cognitive behaviou?ral therapy|\bcbt\b|thought record|behavioural activation|behavioral activation|exposure therapy|psychotherapy|counsell?ing|talking therapy)\b/,
  },
  {
    weight: 3,
    signal: "mental_health_topic",
    pattern:
      /\b(mental health|mental illness|depression|clinical anxiety|anxiety disorder|panic disorder|\bocd\b|\bptsd\b|bipolar|eating disorder|self.?harm|suicide prevention|psychiatrist|psychologist|therapist|antidepressants?|\bssri\b|burnout|imposter syndrome|self.?esteem|emotional regulation|coping (strategies|mechanisms|skills)|mindfulness|loneliness|grief)\b/,
  },
  {
    weight: 2,
    signal: "help_seeking",
    pattern:
      /\b(how do i (stop|deal with|cope with|get over) (feeling|my|the) |help me (feel|stop|cope)|is it normal to feel|why do i (feel|always feel))/,
  },
];

const THIRD_PARTY =
  /\b(my (friend|mate|sister|brother|mum|mom|dad|father|mother|partner|wife|husband|son|daughter|colleague|coworker|student|patient)|someone i know|a friend of mine|my friend'?s)\b/;

/**
 * Wording that suggests a distortion, mapped to the canonical name. This is the
 * deterministic half of upstream's identification stage: a cheap prefilter that
 * puts candidates in front of the model, never a diagnosis. The model verifies
 * each against what was actually said and drops the ones that do not fit.
 */
const DISTORTION_RULES: readonly { distortion: string; weight: number; pattern: RegExp }[] = [
  {
    distortion: "All-or-nothing thinking",
    weight: 3,
    pattern:
      /\b(i (always|never)|(never|always) (be|get|manage|be able)|completely (ruined|blown|failed)|total(ly)? (failure|disaster)|either .{2,30} or nothing|nothing (i do|ever) (works|goes right)|not (a )?(single|one) thing)\b/,
  },
  {
    distortion: "Overgeneralization",
    weight: 3,
    pattern:
      /\b(every (time|single time)|this always happens|it always ends|nobody ever|no one ever|it'?s always been|typical of (me|my luck)|story of my life)\b/,
  },
  {
    distortion: "Mental filter",
    weight: 2,
    pattern:
      /\b(all i can think about|can'?t stop thinking about (the|that) (one|mistake|comment)|the only thing i (notice|remember)|keep replaying)\b/,
  },
  {
    distortion: "Discounting the positives",
    weight: 3,
    pattern:
      /\b(doesn'?t (really )?count|that was just luck|anyone (could|would) have (done|managed)|they were just being (nice|polite)|it wasn'?t (really )?(me|my doing)|i (just )?got lucky)\b/,
  },
  {
    distortion: "Mind reading",
    weight: 3,
    pattern:
      /\b((they|he|she|everyone|people|my (boss|manager|team|friends)) (must )?(think|thinks|thought|assume|assumes|see me as|sees me as|are judging|is judging|hate|hates|resent)|i (just )?know (they|he|she) (think|thinks|hates))\b/,
  },
  {
    distortion: "Fortune telling",
    weight: 3,
    pattern:
      /\b(i'?ll never (be|get|find|make|manage)|it'?s (going to|gonna) (fail|go wrong|be a disaster)|i'?m going to (fail|lose|be fired|get fired)|there'?s no point (trying|applying|asking)|nothing will change|it will never (work|get better))\b/,
  },
  {
    distortion: "Magnification or minimization",
    weight: 2,
    pattern:
      /\b(worst thing (that|ever)|end of the world|a (complete )?(disaster|catastrophe)|my (whole )?(life|career) is (over|ruined)|blown (it|everything))\b/,
  },
  {
    distortion: "Emotional reasoning",
    weight: 3,
    pattern:
      /\b(i feel (like )?(a |an )?(failure|fraud|idiot|burden|loser|worthless|stupid|unlovable)|if i feel (this|like this) (way )?(then|it must)|feels true so it must|i feel it so it'?s)\b/,
  },
  {
    distortion: "Should statements",
    weight: 3,
    pattern:
      /\b(i (should|shouldn'?t|must|mustn'?t|ought to|have to) (have |be |already |know |handle |cope|feel)|should have (known|done|been|said)|i'?m supposed to be)\b/,
  },
  {
    distortion: "Labeling",
    weight: 3,
    pattern:
      /\b(i'?m (a|an|just a|such a) (failure|loser|idiot|fraud|burden|mess|disappointment|bad (parent|friend|partner|engineer|student))|i am worthless|i'?m useless)\b/,
  },
  {
    distortion: "Personalization and blame",
    weight: 3,
    pattern:
      /\b(it'?s (all )?my fault|i ruined (it|everything|their)|because of me|i should have (stopped|prevented|noticed)|if i (had|hadn'?t) .{2,40} (they|it) wouldn'?t)\b/,
  },
];

const TRIVIAL =
  /^(hi|hey|hello|yo|thanks|thank you|ok|okay|sure|cool|nice|got it|yes|no|nope|yep)[\s!.?]*$/i;

/**
 * Decides whether this turn is mental-health related, in which register, and
 * which distortions the wording suggests. A message matching nothing gets
 * `none` and no section, so ordinary turns pay nothing for the machinery.
 */
export function classifyCogniviaTurn(input: CogniviaInput): CogniviaClassification {
  const raw = (input.userText ?? "").trim();
  const empty: CogniviaClassification = {
    register: "none",
    score: 0,
    signals: [],
    distortions: [],
    thirdParty: false,
  };
  if (!raw || TRIVIAL.test(raw)) return empty;

  const text = raw.toLowerCase();
  const signals: string[] = [];

  const distortions = DISTORTION_RULES.filter((rule) => rule.pattern.test(text))
    .sort((a, b) => b.weight - a.weight)
    .map((rule) => rule.distortion)
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 3);

  if (CRISIS.test(text)) {
    return {
      register: "crisis",
      score: 10,
      signals: ["crisis"],
      distortions: [],
      thirdParty: THIRD_PARTY.test(text),
    };
  }

  let distress = 0;
  for (const rule of DISTRESS_RULES) {
    if (!rule.pattern.test(text)) continue;
    distress += rule.weight;
    signals.push(rule.signal);
  }
  let topic = 0;
  for (const rule of TOPIC_RULES) {
    if (!rule.pattern.test(text)) continue;
    topic += rule.weight;
    signals.push(rule.signal);
  }
  // Distortion wording alone never engages: "this build always breaks" is the
  // same sentence shape as "I always fail", and only one of them is about a
  // person. It adds weight to a turn that already reads as distress.
  if (distress > 0 && distortions.length) {
    distress += 1;
    signals.push("distorted_wording");
  }

  if (distress >= 3) {
    return {
      register: "personal_distress",
      score: distress + topic,
      signals,
      distortions,
      thirdParty: THIRD_PARTY.test(text),
    };
  }
  if (topic >= 2) {
    return {
      register: "informational",
      score: topic,
      signals,
      distortions: [],
      thirdParty: THIRD_PARTY.test(text),
    };
  }
  return empty;
}

// --- the section ------------------------------------------------------------

function discipline(): string {
  const file = path.join(repositoryRoot(), "hermes-config", "system", "cognivia.md");
  return fs.readFileSync(file, "utf8").trim();
}

function truncate(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

function renderCandidates(classification: CogniviaClassification, userText: string): string[] {
  if (!classification.distortions.length) return [];
  const taxonomy = cogniviaTaxonomy();
  const lines = ["", "Candidate distortions, prefiltered from their wording rather than diagnosed:"];
  for (const name of classification.distortions) {
    const entry = taxonomy.find(
      (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
    );
    // The workbook records which emotions a pattern tends to produce for some
    // of the eleven. Where it does, it is a check on the candidate: a person
    // who sounds guilty rather than anxious is probably not fortune telling.
    const emotions = entry?.emotions ? ` Often felt as: ${entry.emotions.toLowerCase()}.` : "";
    lines.push(`- ${name}: ${entry?.definition ?? ""}${emotions}`.trimEnd());
  }
  lines.push(
    "Test each against what they actually wrote. Drop the ones the evidence does not carry, add one they show that this list missed, and work with the single clearest pattern rather than all of them.",
  );

  // Only the labelled thoughts are shown, never the workbook's own rational
  // responses: that column is largely excerpted explanation from the source
  // texts rather than something said back to a person, and it would pull the
  // reply toward textbook narration. Identification is the half the seed data
  // calibrates well; the response is generated here, under the discipline
  // above, which is the same division upstream's own pipeline makes.
  const exemplars = cogniviaExemplars(classification.distortions[0], userText);
  if (exemplars.length) {
    const source = exemplars.find((exemplar) => exemplar.source)?.source;
    lines.push(
      "",
      `Thoughts labelled ${classification.distortions[0]} in the CBT Cognitive Triplet Dataset${
        source ? `, curated from ${source}` : ""
      }, as calibration for what the pattern looks like. Never quote them at the user.`,
    );
    for (const exemplar of exemplars) {
      lines.push(`- "${truncate(exemplar.thought, 200)}"`);
    }
  }
  return lines;
}

/**
 * The per-turn half of the integration: the durable discipline plus this
 * message's evidence, or null when the turn is not mental-health related.
 */
export function cogniviaSection(input: CogniviaInput): string | null {
  if (!cogniviaEnabled()) return null;
  const classification = classifyCogniviaTurn(input);
  if (classification.register === "none") return null;

  const userText = (input.userText ?? "").trim();
  const lines = [discipline(), "", "# cognivia_turn", `Register: ${classification.register}`];

  if (classification.register === "crisis") {
    lines.push(
      "This message carries a risk signal. Safety comes before every other instruction above: no distortion analysis, no exercise, no wall of resources. Respond to what they said, stay with them, and encourage contact with a person who can help now.",
      "If this is plainly hyperbole about something impersonal — a failing build, a lost afternoon — do not treat it as a crisis. Answer the real request and let the warmth be brief.",
    );
  } else if (classification.register === "informational") {
    lines.push(
      "They are asking about mental health rather than describing their own. Answer the question accurately and plainly, without therapeutic framing and without assuming the person asking is the person struggling. If the question turns personal later, the discipline above applies then.",
    );
  } else {
    if (classification.thirdParty) {
      lines.push(
        "The distress described may belong to someone they are talking about rather than to them. Answer for whoever it actually concerns, and do not analyze the user's own thinking uninvited.",
      );
    } else {
      lines.push(...renderCandidates(classification, userText));
      lines.push(
        "",
        "If this message is fundamentally a technical or practical request that merely carries frustration, answer the request first and keep the support brief and implicit.",
      );
    }
  }

  lines.push(
    "",
    "None of this is visible to the user. Do not name the register, the candidates, the dataset, or Cognivia, and do not restructure your reply around them.",
  );
  return lines.join("\n");
}
