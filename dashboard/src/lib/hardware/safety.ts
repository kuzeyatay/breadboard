// Scope limits for generated hardware.
//
// The agent builds ordinary low-voltage electronics. Requests that reach into
// mains wiring, medical or life-support equipment, weapons, or unsafe battery
// pack construction get a conceptual answer instead of build-ready wiring —
// there is no responsible way to hand somebody an automatically validated mains
// circuit and call it checked.

export type SafetyDecision =
  | { level: "supported" }
  | { level: "concept-only"; category: string; reason: string }
  | { level: "refused"; category: string; reason: string };

interface Pattern {
  category: string;
  level: "concept-only" | "refused";
  reason: string;
  expressions: RegExp[];
}

const PATTERNS: Pattern[] = [
  {
    category: "Mains electricity",
    level: "concept-only",
    reason:
      "Mains wiring can kill and is governed by electrical regulations. This blueprint stops at the low-voltage control side; the mains side belongs to a qualified electrician.",
    expressions: [
      /\b(?:mains|line voltage|wall (?:outlet|socket|power)|110\s*v(?:ac)?|120\s*v(?:ac)?|220\s*v(?:ac)?|230\s*v(?:ac)?|240\s*v(?:ac)?)\b/i,
      /\b(?:switch|control|wire)\b[^.]{0,40}\b(?:mains|household|domestic)\b/i,
    ],
  },
  {
    category: "High voltage",
    level: "concept-only",
    reason:
      "Anything above roughly 50 V needs insulation, clearance and protection choices that automated validation cannot check.",
    expressions: [
      /\bhigh[- ]voltage\b/i,
      /\b(?:[1-9]\d{2,})\s*(?:v|volts)\b/i,
      /\b(?:tesla coil|flyback transformer|cattle prod|stun|taser|electric fence)\b/i,
    ],
  },
  {
    category: "Medical or life-support equipment",
    level: "concept-only",
    reason:
      "Devices people depend on for their health are regulated and need clinical validation. A generated blueprint is not a medical device.",
    expressions: [
      /\b(?:life[- ]support|ventilator|defibrillat|pacemaker|insulin pump|dialysis|infusion pump|implant(?:able)?)\b/i,
      /\bmedical (?:device|grade|equipment)\b/i,
    ],
  },
  {
    category: "Safety-critical control",
    level: "concept-only",
    reason:
      "Brakes, steering, throttle and similar controls need redundancy and formal safety analysis, not a hobby-grade prototype.",
    expressions: [
      /\b(?:brake|steering|throttle|airbag|abs)\b[^.]{0,30}\b(?:control|controller|system|ecu)\b/i,
      /\b(?:drive[- ]by[- ]wire|safety[- ]critical)\b/i,
      /\b(?:elevator|lift|crane)\b[^.]{0,20}\bcontrol\b/i,
    ],
  },
  {
    category: "Battery pack construction",
    level: "concept-only",
    reason:
      "Building lithium packs without a proper BMS, cell matching and protection is a fire risk. Use a finished pack with built-in protection instead.",
    expressions: [
      /\b(?:18650|lipo|li[- ]?ion|lithium)\b[^.]{0,40}\b(?:pack|series|parallel|spot weld|charger circuit)\b/i,
      /\b(?:build|make|assemble)\b[^.]{0,30}\bbattery pack\b/i,
    ],
  },
  {
    category: "Weapons and explosives",
    level: "refused",
    reason: "This is outside what the agent will design.",
    expressions: [
      /\bdetonat\w*\b/i,
      /\b(?:blasting cap|initiator)\b/i,
      /\b(?:explosive|ordnance|warhead|ied)\b/i,
      /\b(?:weapon|gun|firearm|turret)\b[^.]{0,30}\b(?:trigger|fire control|targeting)\b/i,
    ],
  },
];

export function assessSafety(text: string): SafetyDecision {
  for (const pattern of PATTERNS) {
    if (pattern.expressions.some((expression) => expression.test(text))) {
      return pattern.level === "refused"
        ? { level: "refused", category: pattern.category, reason: pattern.reason }
        : { level: "concept-only", category: pattern.category, reason: pattern.reason };
    }
  }
  return { level: "supported" };
}

/** The notice every blueprint carries, whatever its status. */
export const VALIDATION_DISCLAIMER =
  "Automated validation checks this design against the component library and a fixed set of electrical rules. It does not replace reading each part's datasheet, measuring with a multimeter, powering up through a current-limited supply, or a qualified review where the stakes call for one.";
