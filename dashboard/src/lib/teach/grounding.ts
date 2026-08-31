// Finding, on the screen as it is now, the thing a step describes.
//
// This is the hinge the whole feature turns on. The demonstration knows that a
// click landed at a pixel inside a window that was that size on that monitor
// that afternoon. None of that survives contact with a second run. What does
// survive is what the control said: a button labeled "Search" is still a button
// labeled "Search" after the window moves, the screen resolution changes, the
// list reorders, or the application ships a redesign that moves it.
//
// So grounding scores live accessibility elements against the step's written
// description, and reports honestly when it is not sure -- an ambiguous match is
// handed up to be settled by the model or by a person, never guessed at.
//
// Pure functions only, so the scoring can be tested without a desktop.

import type { ObservedElement } from "./types.ts";

export interface GroundingHints {
  /** The step's action, so an editable field beats a label for a `type` step. */
  action?: string;
  /** Values supplied at run time, so a target naming an input can match its value. */
  inputs?: Record<string, string>;
}

export interface GroundingResult {
  element: ObservedElement | null;
  candidates: ObservedElement[];
  confident: boolean;
  score: number;
  reason: string;
}

const CONFIDENT_SCORE = 90;
const CONFIDENT_MARGIN = 25;
const MAX_CANDIDATES = 12;

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "to",
  "for",
  "with",
  "and",
  "or",
  "labeled",
  "labelled",
  "titled",
  "named",
  "called",
  "button",
  "field",
  "input",
  "box",
  "icon",
  "control",
  "element",
  "containing",
  "showing",
]);

/** Roles as a description spells them, mapped onto what UI Automation reports. */
const ROLE_SYNONYMS: Record<string, string[]> = {
  button: ["Button", "SplitButton"],
  link: ["Hyperlink"],
  hyperlink: ["Hyperlink"],
  checkbox: ["CheckBox"],
  radio: ["RadioButton"],
  radiobutton: ["RadioButton"],
  toggle: ["CheckBox", "Button"],
  tab: ["Tab", "TabItem"],
  tabitem: ["TabItem"],
  menuitem: ["MenuItem"],
  menu: ["MenuItem"],
  textfield: ["Edit", "Document"],
  text: ["Text", "Edit", "Document"],
  edit: ["Edit", "Document"],
  input: ["Edit", "Document"],
  field: ["Edit", "Document"],
  combobox: ["ComboBox"],
  dropdown: ["ComboBox"],
  select: ["ComboBox"],
  listitem: ["ListItem", "DataItem"],
  row: ["ListItem", "DataItem", "TreeItem"],
  cell: ["DataItem", "Text"],
  treeitem: ["TreeItem"],
  slider: ["Slider"],
  document: ["Document"],
};

export function extractQuotedText(target: string): string | null {
  const match = target.match(/["“”']([^"“”']{1,160})["“”']/u);
  return match ? match[1].trim() : null;
}

export function extractRole(target: string): string | null {
  const normalized = target.toLowerCase();
  for (const role of Object.keys(ROLE_SYNONYMS)) {
    const spaced = role.replace(/([a-z])([a-z]+)/u, "$1$2");
    if (
      new RegExp(`\\b${spaced}\\b`, "u").test(normalized) ||
      new RegExp(`\\b${role.replace(/(item|box|field|button)$/u, " $1")}\\b`, "u").test(normalized)
    ) {
      return role;
    }
  }
  return null;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, " ").trim();
}

function roleMatches(role: string | null, elementRole: string | undefined): boolean {
  if (!role || !elementRole) return false;
  const accepted = ROLE_SYNONYMS[role];
  return Array.isArray(accepted) && accepted.includes(elementRole);
}

/**
 * Substitute run-time values into a target description.
 *
 * A target may name an input rather than a literal -- "the row containing
 * {{customer_name}}" -- and grounding it means looking for Bob's row on this
 * run, not the Alice row the demonstration happened to click.
 */
export function resolvePlaceholders(value: string, inputs: Record<string, string>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu, (whole, name: string) => {
    const replacement = inputs[name];
    return replacement === undefined ? whole : replacement;
  });
}

export function scoreElement(
  element: ObservedElement,
  target: string,
  hints: GroundingHints = {},
): number {
  const quoted = extractQuotedText(target);
  const role = extractRole(target);
  const targetTokens = tokens(target);

  const name = element.name ?? "";
  const value = element.value ?? "";
  const automationId = element.automationId ?? "";

  let score = 0;
  let matchedText = false;

  if (quoted) {
    const wanted = normalize(quoted);
    const candidates = [name, value, automationId].map(normalize).filter(Boolean);
    if (candidates.some((candidate) => candidate === wanted)) {
      score += 100;
      matchedText = true;
    } else {
      // Containment is credited in proportion to how much of the label it
      // accounts for. "Search" is most of "Search" and half of "Search tabs",
      // and treating those as equally good is how a replay clicks the browser's
      // tab-search icon when it meant the page's Search button.
      let best = 0;
      for (const candidate of candidates) {
        if (candidate.includes(wanted)) best = Math.max(best, wanted.length / candidate.length);
        else if (wanted.includes(candidate)) best = Math.max(best, candidate.length / wanted.length);
      }
      if (best > 0) {
        score += Math.round(62 * best);
        matchedText = true;
      }
    }
  }

  const elementTokens = new Set([...tokens(name), ...tokens(value), ...tokens(automationId)]);
  if (targetTokens.length > 0 && elementTokens.size > 0) {
    const overlap = targetTokens.filter((token) => elementTokens.has(token)).length;
    if (overlap > 0) matchedText = true;
    // Balanced both ways on purpose: a label that contains every word of the
    // target plus three of its own is a worse match than one that is exactly
    // those words, and counting only the target's side cannot tell them apart.
    const recall = overlap / targetTokens.length;
    const precision = overlap / elementTokens.size;
    const balanced = overlap === 0 ? 0 : (2 * recall * precision) / (recall + precision);
    score += Math.round(balanced * 45);
  }

  // A target that quotes a label is naming that label. An element that shares
  // none of it is not the thing, however well its role fits: without this, a
  // step looking for the "Customer name" field grounds on the browser's address
  // bar purely because both are editable, and the run types into it.
  if (quoted && !matchedText) score -= 60;

  if (roleMatches(role, element.role)) score += 25;
  else if (role && element.role) score -= 12;

  // A step that types needs somewhere to type. A label that happens to share the
  // field's words is the classic wrong answer here.
  if (hints.action === "type") {
    if (element.role === "Edit" || element.role === "Document" || element.role === "ComboBox") score += 22;
    else if (element.role === "Text") score -= 30;
  }
  if (hints.action === "click" && element.role === "Text") score -= 8;

  if (element.enabled === false) score -= 25;
  if (element.isPassword) score += 0; // neither helps nor hurts; the field is still the field

  const area = (element.width ?? 0) * (element.height ?? 0);
  if (area === 0) score -= 15;

  return score;
}

/**
 * Pick the element a step means, or say that it is not clear.
 *
 * `confident` is the important half of the answer. A best score that only
 * narrowly beats the runner-up means two things on screen match the
 * description, and picking one silently is how a replay clicks the wrong row.
 */
export function groundTarget(
  target: string,
  elements: readonly ObservedElement[],
  hints: GroundingHints = {},
): GroundingResult {
  const resolved = hints.inputs ? resolvePlaceholders(target, hints.inputs) : target;
  if (elements.length === 0) {
    return {
      element: null,
      candidates: [],
      confident: false,
      score: 0,
      reason: "Nothing on the current screen could be read.",
    };
  }

  const scored = elements
    .map((element) => ({ element, score: scoreElement(element, resolved, hints) }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  const runnerUp = scored[1];
  const candidates = scored
    .filter((entry) => entry.score > 20)
    .slice(0, MAX_CANDIDATES)
    .map((entry) => entry.element);

  if (best.score < 45) {
    return {
      element: null,
      candidates,
      confident: false,
      score: best.score,
      reason: `Nothing on screen matches ${JSON.stringify(resolved)}.`,
    };
  }

  const margin = runnerUp ? best.score - runnerUp.score : Number.POSITIVE_INFINITY;
  const confident = best.score >= CONFIDENT_SCORE && margin >= CONFIDENT_MARGIN;

  return {
    element: best.element,
    candidates,
    confident,
    score: best.score,
    reason: confident
      ? `Matched ${best.element.describe}.`
      : `Several controls could be ${JSON.stringify(resolved)}; the closest is ${best.element.describe}.`,
  };
}

/**
 * Whether the screen now shows what a step said it would.
 *
 * Deliberately cheap and textual: it answers "is the expected text visible" and
 * nothing more. Anything subtler is escalated to the model rather than guessed,
 * because a verification that quietly returns true is worse than none.
 */
export function expectationVisible(
  expectation: string,
  elements: readonly ObservedElement[],
  inputs: Record<string, string> = {},
): { satisfied: boolean; evidence?: string } {
  const resolved = normalize(resolvePlaceholders(expectation, inputs));
  const quoted = extractQuotedText(expectation);
  const wanted = quoted ? normalize(resolvePlaceholders(quoted, inputs)) : null;

  for (const element of elements) {
    const haystack = [element.name, element.value]
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .map(normalize);
    if (wanted && haystack.some((entry) => entry.includes(wanted))) {
      return { satisfied: true, evidence: element.describe };
    }
  }

  const wantedTokens = tokens(resolved);
  if (wantedTokens.length === 0) return { satisfied: false };
  const visible = new Set<string>();
  for (const element of elements) {
    for (const token of tokens(`${element.name ?? ""} ${element.value ?? ""}`)) visible.add(token);
  }
  const overlap = wantedTokens.filter((token) => visible.has(token)).length;
  // Most of the expectation's meaningful words being on screen is evidence; a
  // couple of them is a coincidence.
  return overlap / wantedTokens.length >= 0.7 ? { satisfied: true } : { satisfied: false };
}
