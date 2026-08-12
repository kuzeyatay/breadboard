// Scope limits for generated parts.
//
// The agent designs ordinary printed parts: brackets, enclosures, adapters,
// spacers, mounts, knobs, replacement parts. Requests that reach into pressure
// containment, load-bearing lifting, human-supporting structures, vehicle
// controls, medical devices, mains electrical safety, or weapons get a design
// with an explicit engineering notice rather than a quiet "validated" — there is
// no responsible way to hand somebody a geometrically checked part and let them
// read that as a structural certification.
//
// The same three-level decision shape as the Hardware Blueprint agent's
// safety module, for the same reason: one vocabulary for scope across
// Breadboard's engineering agents.

export type CadSafetyDecision =
  | { level: "supported" }
  | { level: "engineering-review"; category: string; reason: string }
  | { level: "refused"; category: string; reason: string };

interface Pattern {
  category: string;
  level: "engineering-review" | "refused";
  reason: string;
  expressions: RegExp[];
}

const PATTERNS: Pattern[] = [
  {
    category: "Pressure or fluid containment",
    level: "engineering-review",
    reason:
      "A printed vessel fails by splitting along layer lines, and nothing measured here predicts burst pressure. Treat the geometry as a starting point for a part that a qualified engineer specifies and tests.",
    expressions: [
      /\b(?:pressure vessel|pressure tank|compressed (?:air|gas)|scuba|regulator body|accumulator)\b/i,
      /\b(?:gas|propane|butane|hydraulic|pneumatic)\b[^.]{0,30}\b(?:tank|cylinder|fitting|manifold|line|coupling)\b/i,
      /\b(?:hold|contain|store)\b[^.]{0,25}\b(?:pressuri[sz]ed|compressed)\b/i,
    ],
  },
  {
    category: "Load-bearing lifting equipment",
    level: "engineering-review",
    reason:
      "Anything that lifts a load over people needs a rated, tested component with a known safety factor. Layer adhesion in a printed part is not a design strength.",
    expressions: [
      /\b(?:hoist|crane|winch|sling|shackle|carabiner|climbing|rigging|lifting (?:eye|point|hook))\b/i,
      /\b(?:load[- ]bearing|weight[- ]bearing)\b/i,
      /\b(?:harness|anchor point|fall arrest|belay)\b/i,
    ],
  },
  {
    category: "Human-supporting or life-safety part",
    level: "engineering-review",
    reason:
      "A part that carries a person's weight or protects them in a failure needs certified materials and physical testing. Geometric validation says nothing about either.",
    expressions: [
      /\b(?:helmet|prosthe(?:sis|tic)|orthotic|wheelchair|walker|crutch|child seat|car seat)\b/i,
      /\b(?:step|ladder|stool|handrail|grab bar)\b[^.]{0,20}\b(?:support|weight|stand)\b/i,
      /\b(?:seat|chair|bench)\b[^.]{0,20}\b(?:mount|bracket|leg)\b/i,
    ],
  },
  {
    category: "Vehicle or aircraft control part",
    level: "engineering-review",
    reason:
      "Steering, braking, throttle, suspension and flight-control parts fail in ways that hurt people. These need a rated material, a fatigue analysis and a real test programme.",
    expressions: [
      /\b(?:steering|brake|braking|throttle|suspension|axle|wheel hub|drivetrain|control surface|propeller|rotor blade)\b/i,
      /\b(?:aircraft|aviation|drone)\b[^.]{0,25}\b(?:structural|load|mount|arm|frame)\b/i,
    ],
  },
  {
    category: "Medical device",
    level: "engineering-review",
    reason:
      "Devices people depend on for their health are regulated and need biocompatible materials, sterilisation validation and clinical review. A generated part is not a medical device.",
    expressions: [
      /\b(?:surgical|implant(?:able)?|catheter|syringe|cannula|dental (?:appliance|aligner)|splint|stent)\b/i,
      /\bmedical (?:device|grade|equipment)\b/i,
    ],
  },
  {
    category: "Mains electrical safety",
    level: "engineering-review",
    reason:
      "An enclosure around mains wiring must meet creepage, clearance, flammability and earthing requirements that no geometric check covers, and common printing filaments are not rated for it.",
    expressions: [
      /\b(?:mains|line voltage|wall (?:outlet|socket)|110\s*v(?:ac)?|120\s*v(?:ac)?|220\s*v(?:ac)?|230\s*v(?:ac)?|240\s*v(?:ac)?)\b/i,
      /\b(?:socket|plug|breaker|consumer unit|distribution board)\b[^.]{0,25}\b(?:enclosure|housing|cover|box)\b/i,
    ],
  },
  {
    category: "High-temperature containment",
    level: "engineering-review",
    reason:
      "Common printing polymers soften well below 100 °C and creep long before they melt. A part exposed to sustained heat needs a material selection this agent cannot make for you.",
    expressions: [
      /\b(?:furnace|kiln|exhaust manifold|engine bay|heat break|hotend block|soldering|molten)\b/i,
      /\b(?:boiling|steam|oven|autoclave)\b[^.]{0,25}\b(?:part|housing|holder|mount|enclosure)\b/i,
      /\b([2-9]\d{2,})\s*(?:°\s*c|deg(?:rees)? c|celsius)\b/i,
    ],
  },
  {
    category: "Weapons",
    level: "refused",
    reason: "This is outside what the agent designs.",
    expressions: [
      /\b(?:firearm|gun|rifle|pistol|receiver|magazine well|suppressor|silencer|bump stock|auto sear)\b/i,
      /\b(?:ammunition|cartridge|projectile|bullet)\b[^.]{0,25}\b(?:mould|mold|press|die)\b/i,
      /\b(?:explosive|detonat\w*|warhead|grenade)\b/i,
      /\b(?:knuckle duster|brass knuckles|switchblade)\b/i,
    ],
  },
];

export function assessCadSafety(text: string): CadSafetyDecision {
  for (const pattern of PATTERNS) {
    if (pattern.expressions.some((expression) => expression.test(text))) {
      return pattern.level === "refused"
        ? { level: "refused", category: pattern.category, reason: pattern.reason }
        : {
            level: "engineering-review",
            category: pattern.category,
            reason: pattern.reason,
          };
    }
  }
  return { level: "supported" };
}

/** The notice every CAD design carries, whatever its validation status. */
export const CAD_VALIDATION_DISCLAIMER =
  "Validation here is geometric: the solid is checked for validity, watertightness, declared dimensions, minimum feature sizes, mesh integrity and printer-bed fit. It is not a mechanical engineering verification — nothing here predicts strength, stiffness, fatigue life, thermal behaviour, sealing or safety factor. Print a test part and check the fit before you rely on it.";

/** Added on top of the standard notice when a request touches a flagged use. */
export function engineeringReviewNotice(decision: CadSafetyDecision): string | null {
  if (decision.level !== "engineering-review") return null;
  return `${decision.category}: ${decision.reason} This design is geometry only and must be reviewed by a qualified engineer before it is used for that purpose.`;
}
