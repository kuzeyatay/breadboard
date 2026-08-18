#!/usr/bin/env node

/**
 * W2-3E / WORKSPACE_MATERIAL_ISOLATION and AGENT_RUN_CARD_MATERIAL.
 *
 * Two assertions about the shared neumorphic material. Both are written as
 * substring or slice checks over source text, but both stand for a real
 * invariant, so both are re-asked against the artefact that actually decides
 * the outcome: the parsed rule set of the shipped stylesheet, and the class
 * vocabulary the whole family of inline agent-run cards is built from.
 *
 *   1. A workspace material utility must be visual only. If `.bb-neu-tray` set
 *      `overflow` or `transform`, composing it onto a panel would silently
 *      change that panel's motion or layout. That is a real defect, and it is
 *      a property of the RULE, not of a text window between two markers.
 *
 *   2. The Socials Manager card must read as one of the family. What proves
 *      that is not a literal in one file — a class can arrive from a shared
 *      child — but whether the card is built from the same shared vocabulary
 *      every other inline agent-run card uses, and whether the classes it uses
 *      are real material defined in the stylesheet.
 *
 * Run from `dashboard/`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const outPath = path.resolve(process.argv[2] ?? "shared-material-arbitration.json");
const dashboardRoot = process.cwd();
const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");

const css = read("src/app/globals.css");

// --- a real rule parser, so a "rule" means a selector and its declarations --
//
// Comments are stripped first, then top-level blocks are split by brace depth
// so an at-rule's nested body is walked rather than mistaken for a declaration
// list. This is what makes the check a statement about `.bb-neu-*` rules
// instead of a statement about a slice of the file.
function parseRules(styleSheet) {
  const withoutComments = styleSheet.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const walk = (text, prefix) => {
    let index = 0;
    let selectorStart = 0;
    let depth = 0;
    let blockStart = -1;
    while (index < text.length) {
      const character = text[index];
      if (character === "{") {
        if (depth === 0) blockStart = index;
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          const selector = text.slice(selectorStart, blockStart).trim();
          const body = text.slice(blockStart + 1, index);
          if (selector.startsWith("@")) {
            walk(body, `${prefix}${selector} `);
          } else if (selector) {
            rules.push({ selector, context: prefix.trim(), body });
          }
          selectorStart = index + 1;
        }
      }
      index += 1;
    }
  };
  walk(withoutComments, "");
  return rules;
}

const rules = parseRules(css);

/** Declarations, ignoring anything nested inside a value's parentheses. */
function declarations(body) {
  const found = [];
  let depth = 0;
  let current = "";
  for (const character of body) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === ";" && depth === 0) {
      found.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) found.push(current.trim());
  return found
    .map((entry) => {
      const colon = entry.indexOf(":");
      return colon === -1 ? null : { property: entry.slice(0, colon).trim(), value: entry.slice(colon + 1).trim() };
    })
    .filter(Boolean);
}

const MOTION_OR_LAYOUT = new Set([
  "transform",
  "translate",
  "width",
  "height",
  "position",
  "overflow",
  "pointer-events",
  "visibility",
  "z-index",
]);

// --- 1. workspace material isolation, per rule ---------------------------
const materialRules = rules.filter((rule) => /(^|[\s,>+~])\.bb-neu-[a-z0-9-]+/.test(rule.selector));
const materialViolations = [];
for (const rule of materialRules) {
  for (const declaration of declarations(rule.body)) {
    if (MOTION_OR_LAYOUT.has(declaration.property.toLowerCase())) {
      materialViolations.push({
        selector: rule.selector,
        context: rule.context || null,
        property: declaration.property,
        value: declaration.value.slice(0, 80),
      });
    }
  }
}

// What the failing assertion's own text window sweeps up, for comparison. The
// window runs from a comment to a marker far below it, so it collects whatever
// happens to be written in between.
const windowStart = css.indexOf("Breadboard workspace materials");
const windowEnd = css.indexOf("\n.neu-progress-track", windowStart);
const textWindow = css.slice(windowStart, windowEnd);
const windowRules = parseRules(textWindow);
const windowHits = [];
for (const rule of windowRules) {
  for (const declaration of declarations(rule.body)) {
    if (MOTION_OR_LAYOUT.has(declaration.property.toLowerCase())) {
      windowHits.push({ selector: rule.selector, property: declaration.property });
    }
  }
}
const windowSweepsNonMaterialRules = [
  ...new Set(windowHits.filter((hit) => !/\.bb-neu-/.test(hit.selector)).map((hit) => hit.selector)),
];

// --- 2. agent-run card material, across the whole family -----------------
const cardDirectory = path.join(dashboardRoot, "src/app/components/hermes");
const inlineCards = fs
  .readdirSync(cardDirectory)
  .filter((name) => /^inline-.*-run\.tsx$/.test(name))
  .sort();

const classesIn = (source) => {
  const found = new Set();
  for (const match of source.matchAll(/\b(bb-agent-run-[a-z0-9-]+|neu-[a-z0-9-]+)\b/g)) found.add(match[1]);
  return found;
};

const cardVocabulary = inlineCards.map((name) => ({
  card: name,
  classes: [...classesIn(read(`src/app/components/hermes/${name}`))].sort(),
}));

const socials = cardVocabulary.find((entry) => entry.card === "inline-socials-manager-run.tsx");
const siblings = cardVocabulary.filter((entry) => entry.card !== "inline-socials-manager-run.tsx");

/** A class is shared material if more than one card in the family uses it. */
const usageCount = new Map();
for (const entry of cardVocabulary) {
  for (const className of entry.classes) usageCount.set(className, (usageCount.get(className) ?? 0) + 1);
}
const sharedVocabulary = [...usageCount.entries()]
  .filter(([, count]) => count > 1)
  .map(([className]) => className)
  .sort();

const definedInStylesheet = (className) =>
  rules.some((rule) => new RegExp(`\\.${className.replace(/-/g, "\\-")}(?![a-z0-9-])`).test(rule.selector));

const ASSERTED = [
  "bb-agent-run-card",
  "bb-agent-run-header",
  "bb-agent-run-icon",
  "bb-agent-run-pill",
  "bb-agent-run-inset",
  "bb-agent-run-panel",
  "neu-button",
  "neu-inset",
];
const assertedClassStatus = ASSERTED.map((className) => ({
  className,
  usedBySocialsCard: socials.classes.includes(className),
  usedByAnyInlineCard: (usageCount.get(className) ?? 0) > 0,
  cardsUsingIt: cardVocabulary.filter((entry) => entry.classes.includes(className)).length,
  definedInStylesheet: definedInStylesheet(className),
}));

const socialsSharedClasses = socials.classes.filter((className) => sharedVocabulary.includes(className));
const socialsUnknownClasses = socials.classes.filter((className) => !definedInStylesheet(className));
const brandHexColours = (read("src/app/components/hermes/inline-socials-manager-run.tsx").match(/#[0-9a-f]{6}/gi) ?? []);

// --- invariants ----------------------------------------------------------
const invariants = [];
const say = (name, holds, detail) => invariants.push({ name, holds, detail });

say(
  "no bb-neu-* workspace material rule declares a motion or layout property",
  materialViolations.length === 0,
  materialViolations.length
    ? JSON.stringify(materialViolations)
    : `${materialRules.length} material rules parsed, none set transform/translate/width/height/position/overflow/pointer-events/visibility/z-index`,
);
say(
  "the failing assertion's text window is not a rule set",
  windowSweepsNonMaterialRules.length > 0,
  `the window from "Breadboard workspace materials" to ".neu-progress-track" sweeps in non-material rules: ${JSON.stringify(windowSweepsNonMaterialRules)}`,
);
say(
  "the Socials Manager card is built from the shared agent-run vocabulary",
  socialsSharedClasses.length >= 5,
  `${socialsSharedClasses.length} of its ${socials.classes.length} classes are used by more than one inline agent-run card: ${JSON.stringify(socialsSharedClasses)}`,
);
say(
  "every class the Socials Manager card uses is real material defined in the stylesheet",
  socialsUnknownClasses.length === 0,
  socialsUnknownClasses.length ? JSON.stringify(socialsUnknownClasses) : "no undefined class names",
);
say(
  "the asserted classes that are missing are missing from the whole family, not just this card",
  assertedClassStatus
    .filter((entry) => !entry.usedBySocialsCard)
    .every((entry) => entry.usedByAnyInlineCard === false),
  JSON.stringify(
    assertedClassStatus.filter((entry) => !entry.usedBySocialsCard).map((entry) => ({
      className: entry.className,
      cardsUsingIt: entry.cardsUsingIt,
      definedInStylesheet: entry.definedInStylesheet,
    })),
  ),
);
// The previous invariant is left standing even though it breaks: it is the one
// that discovered `bb-agent-run-pill` is real but rare, which is exactly the
// distinction the assertion misses. This is the separate question of whether
// the classes the card lacks are family invariants at all.
const familyMajority = Math.ceil(cardVocabulary.length / 2);
const missingButRequired = assertedClassStatus
  .filter((entry) => !entry.usedBySocialsCard)
  .filter((entry) => entry.cardsUsingIt >= familyMajority);
say(
  "none of the classes the card lacks is a family invariant",
  missingButRequired.length === 0,
  `a class used by at least ${familyMajority} of ${cardVocabulary.length} cards would be one; ${JSON.stringify(
    assertedClassStatus
      .filter((entry) => !entry.usedBySocialsCard)
      .map((entry) => `${entry.className}: ${entry.cardsUsingIt}/${cardVocabulary.length}`),
  )}`,
);
say(
  "the card carries no brand hex colour",
  brandHexColours.length === 0,
  brandHexColours.length ? JSON.stringify(brandHexColours) : "none",
);

const allHold = invariants.every((entry) => entry.holds);

const summary = {
  generatedAt: new Date().toISOString(),
  subRoots: ["WORKSPACE_MATERIAL_ISOLATION", "AGENT_RUN_CARD_MATERIAL"],
  method:
    "The shipped stylesheet was parsed into rules and the declarations of every .bb-neu-* rule inspected; the inline agent-run card family was read as a vocabulary and each asserted class checked for use across the family and for a definition in the stylesheet.",
  workspaceMaterial: {
    materialRuleCount: materialRules.length,
    violations: materialViolations,
    textWindow: {
      lengthBytes: textWindow.length,
      motionOrLayoutHits: windowHits.length,
      nonMaterialSelectorsSweptIn: windowSweepsNonMaterialRules,
    },
  },
  agentRunCards: {
    family: cardVocabulary.map((entry) => entry.card),
    sharedVocabulary,
    socialsCardClasses: socials.classes,
    socialsSharedClasses,
    socialsUnknownClasses,
    assertedClassStatus,
    siblingCount: siblings.length,
    brandHexColours,
  },
  invariants,
  allInvariantsHold: allHold,
  brokenInvariants: invariants.filter((entry) => !entry.holds).map((entry) => entry.name),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

for (const entry of invariants) console.log(`  ${entry.holds ? "HOLDS " : "BROKEN"} ${entry.name}`);
console.log(`[shared-material] material rules parsed: ${materialRules.length}; violations: ${materialViolations.length}`);
console.log(`[shared-material] inline agent-run cards in family: ${cardVocabulary.length}`);
