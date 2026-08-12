// Reading a physical constraint out of the words the request already carries.
//
// None of the electrical rules can see this one. An Arduino Uno is a perfectly
// correct board for an accelerometer and a small OLED, and it is also
// 68.6 × 53.4 × 15 mm — which is a wrong answer to "clips onto my glasses".
// The pin allocator, the voltage checks and the current budget all pass such a
// design, so the constraint has to be read from the language instead.
//
// The words are taken from the request rather than from the chat message. A
// modification recompiles from the stored request, so a constraint the first
// pass found has to survive into every later revision without being restated.

import type { HardwareProjectRequest, PrototypeType } from "./types.ts";

/**
 * Things a project is worn on, carried in, or held. Each one implies the board
 * has to be small; none of them is a word that means something else in
 * electronics, which is why "cap" (capacitor), "hat" (a Pi HAT) and "ring"
 * (o-ring, ring buffer) are deliberately absent.
 */
const WORN_OR_CARRIED =
  /\b(?:wearables?|worn|body-worn|wrist|wristband|wristwatch|smartwatch|bracelet|glasses|spectacles|eyeglasses|goggles|visor|helmet|headset|headband|earpiece|earbuds?|pendant|necklace|lanyard|badge|armband|gloves?|shoes?|backpack|keychain|keyring|handheld|hand-held|belt)\b/i;

/** Smallness said outright. "mini" is left out: it names boards, not sizes. */
const COMPACT =
  /\b(?:tiny|miniature|compact|pocket[- ]?sized?|palm[- ]sized|low[- ]profile|lightweight|as small as possible|as light as possible)\b/i;

/**
 * Fastening the build onto something else. Written with a following
 * preposition so an alligator clip and a clip lead cannot match.
 */
const ATTACHED =
  /\b(?:clips?[- ](?:on|onto|to)\b|clip-on\b|snaps?\s+(?:on|onto|to)\b|straps?\s+(?:to|onto|around)\b|slides?\s+onto\b|attach(?:es|ed|able)?\s+(?:it\s+)?(?:to|onto)\b)/gi;

/**
 * Where "attach to" means wiring rather than mounting. "Attach the sensor to
 * pin 3" is not a request for a bracket.
 */
const ELECTRICAL_TARGET =
  /^\s*(?:the|a|an|my|your|its?|them|each|every)?\s*(?:pin|pins|gpio|header|headers|board|breadboard|perfboard|pcb|rail|rails|bus|wire|wires|lead|leads|terminal|terminals|connector|connectors|ground|gnd|vcc|vin|3v3|5v|net|nets|node|trace|d\d+|a\d+|gpio\d+)\b/i;

/** A build medium the person actually named, rather than the model's default. */
const EXPLICIT_BUILD_STYLE =
  /\b(?:solderless\s+)?breadboard\b|\b(?:perfboard|stripboard|vero(?:board)?|point[- ]to[- ]point)\b|\b(?:pcb|printed\s+circuit\s+board|custom\s+board|flex\s+pcb|rigid[- ]flex)\b/i;

export interface SizeConstraint {
  /** The build has to be physically small — worn, clipped on, or handheld. */
  constrained: boolean;
  /** The words that said so, so a decision can quote what it read. */
  evidence: string | null;
}

const UNCONSTRAINED: SizeConstraint = { constrained: false, evidence: null };

/** Does this text describe something that has to be small enough to wear or carry? */
export function detectSizeConstraint(text: string): SizeConstraint {
  for (const pattern of [WORN_OR_CARRIED, COMPACT]) {
    const match = pattern.exec(text);
    if (match) return { constrained: true, evidence: match[0].toLowerCase() };
  }
  for (const match of text.matchAll(ATTACHED)) {
    const following = text.slice(match.index + match[0].length);
    if (ELECTRICAL_TARGET.test(following)) continue;
    return { constrained: true, evidence: match[0].toLowerCase() };
  }
  return UNCONSTRAINED;
}

/**
 * The same question asked of a whole request. The title and purpose are the
 * two fields that hold the person's own description of the thing being built;
 * the peripheral list holds part names, which say nothing about its shape.
 */
export function requestSizeConstraint(request: HardwareProjectRequest): SizeConstraint {
  return detectSizeConstraint([request.title ?? "", request.purpose].join(" "));
}

/**
 * Replace the interpretation model's generic breadboard default when it would
 * make the requested object physically impossible to wear or clip on.
 *
 * A command flag and build-style words in the brief are both treated as an
 * explicit user choice. The helper is intended for new projects only: stored
 * revisions have already resolved this default and must keep their build style.
 */
export function preferPcbForPortableRequest(
  request: HardwareProjectRequest,
  input: {
    userBrief: string;
    explicitPrototypeType: PrototypeType | null;
  },
): HardwareProjectRequest {
  if (input.explicitPrototypeType || request.prototypeType !== "breadboard") return request;
  if (EXPLICIT_BUILD_STYLE.test(input.userBrief)) return request;

  const constrained =
    requestSizeConstraint(request).constrained || detectSizeConstraint(input.userBrief).constrained;
  return constrained ? { ...request, prototypeType: "pcb" } : request;
}
