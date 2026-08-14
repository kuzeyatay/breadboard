// Deterministic guardrails between model interpretation and compilation.
//
// Product interpretation may infer necessary subsystems, but it must not turn
// those inferences into claims that the person selected an exact purchasable
// part. This pass also keeps passive physical requirements out of the circuit.

import { componentDefinition } from "./components/index.ts";
import { resolveComponentPhrase } from "./resolver.ts";
import type { HardwareProjectRequest, RequestedPeripheral } from "./types.ts";

const PHYSICAL_WORDS =
  /\b(?:optic|optical|lens|collimat|combiner|waveguide|birdbath|mount|clip|clamp|bracket|holder|carrier|chassis|case|enclosure|housing|shell|frame|hinge|strap|flex|pcb|circuit board)\b/i;
const CAMERA_WORDS =
  /\b(?:camera|video|photo(?:graph)?|image capture|vision|scan|record|recogn(?:ise|ize|ition)|detect|see (?:the )?(?:room|world|environment|surroundings))\b/i;
const NEAR_EYE_WORDS =
  /\b(?:augmented[ -]?reality|near[ -]?eye|head[ -]?up display|hud|smart glasses?|ar glasses?)\b/i;
const EYEWEAR_WORDS = /\b(?:glasses|eyeglasses|spectacles|eyewear|goggles|visor)\b/i;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/\-]+/g, " ")
    .replace(/[^a-z0-9. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact user selection, not merely a shared generic word such as "battery". */
function namedInBrief(selection: string, brief: string): boolean {
  const haystack = ` ${normalize(brief)} `;
  const phrases = new Set([normalize(selection)]);
  const resolved = resolveComponentPhrase(selection);
  if (resolved.status === "resolved") {
    phrases.add(normalize(resolved.definition.id));
    phrases.add(normalize(resolved.definition.name));
    resolved.definition.aliases.forEach((alias) => phrases.add(normalize(alias)));
  }
  return [...phrases].some(
    (phrase) => phrase.length >= 3 && haystack.includes(` ${phrase} `),
  );
}

function isPhysicalPart(entry: RequestedPeripheral): boolean {
  const resolved = resolveComponentPhrase(entry.type);
  if (resolved.status === "resolved") {
    return (
      ["mechanical", "optical"].includes(resolved.definition.category) ||
      PHYSICAL_WORDS.test(entry.type)
    );
  }
  return PHYSICAL_WORDS.test(entry.type);
}

function isCamera(entry: RequestedPeripheral): boolean {
  const resolved = resolveComponentPhrase(entry.type);
  return (
    (resolved.status === "resolved" &&
      /\b(?:camera|vision)\b/i.test(
        [
          resolved.definition.id,
          resolved.definition.name,
          ...resolved.definition.aliases,
        ].join(" "),
      )) ||
    /\bcamera\b/i.test(entry.type)
  );
}

function appendUnique(
  parts: RequestedPeripheral[],
  entry: RequestedPeripheral,
): void {
  const key = normalize(entry.type);
  const existing = parts.find((part) => normalize(part.type) === key);
  if (existing) {
    existing.quantity = Math.max(existing.quantity, entry.quantity);
    return;
  }
  parts.push(structuredClone(entry));
}

function hasDefinition(parts: RequestedPeripheral[], definitionId: string): boolean {
  return parts.some((part) => {
    const outcome = resolveComponentPhrase(part.type);
    return outcome.status === "resolved" && outcome.definition.id === definitionId;
  });
}

/**
 * Ground exact selections in the person's words and partition physical roles.
 * Necessary passive references may be inferred for a product; electrical
 * cameras and exact BOM preferences may not be silently invented.
 */
export function groundHardwareRequest(
  request: HardwareProjectRequest,
  userBrief: string,
): HardwareProjectRequest {
  const physicalParts: RequestedPeripheral[] = [];
  const misplacedInputs: RequestedPeripheral[] = [];
  const misplacedOutputs: RequestedPeripheral[] = [];
  for (const part of request.physicalParts ?? []) {
    if (isPhysicalPart(part)) {
      const outcome = resolveComponentPhrase(part.type);
      const inferredPassiveRequirement =
        outcome.status === "resolved" &&
        ["mechanical", "optical"].includes(outcome.definition.category);
      if (inferredPassiveRequirement || namedInBrief(part.type, userBrief)) {
        appendUnique(physicalParts, part);
      }
      continue;
    }
    if (isCamera(part) && !CAMERA_WORDS.test(userBrief)) continue;
    const outcome = resolveComponentPhrase(part.type);
    const inputCategory =
      outcome.status === "resolved" &&
      ["sensor", "control", "input"].includes(outcome.definition.category);
    appendUnique(inputCategory ? misplacedInputs : misplacedOutputs, part);
  }

  const partition = (entries: RequestedPeripheral[]): RequestedPeripheral[] => {
    const electrical: RequestedPeripheral[] = [];
    for (const entry of entries) {
      if (isPhysicalPart(entry)) {
        appendUnique(physicalParts, entry);
        continue;
      }
      if (isCamera(entry) && !CAMERA_WORDS.test(userBrief)) continue;
      appendUnique(electrical, entry);
    }
    return electrical;
  };

  const inputs = partition([...request.inputs, ...misplacedInputs]);
  const outputs = partition([...request.outputs, ...misplacedOutputs]);
  const preferredComponents: string[] = [];
  for (const preference of request.constraints.preferredComponents) {
    if (!namedInBrief(preference, userBrief)) continue;
    const physical = { type: preference, quantity: 1 };
    if (isPhysicalPart(physical)) appendUnique(physicalParts, physical);
    else preferredComponents.push(preference);
  }

  // A near-eye eyewear product necessarily needs this passive physical chain.
  // These catalogue entries are requirement references, not claims that a
  // particular vendor optic has been selected or optically validated.
  if (NEAR_EYE_WORDS.test(userBrief) && EYEWEAR_WORDS.test(userBrief)) {
    if (!hasDefinition(outputs, "micro-oled-display")) {
      const display = componentDefinition("micro-oled-display");
      if (display) appendUnique(outputs, { type: display.id, quantity: 1 });
    }
    for (const definitionId of [
      "ar-focusing-lens",
      "optical-combiner-waveguide",
      "eyeglass-temple-clip",
    ]) {
      if (hasDefinition(physicalParts, definitionId)) continue;
      const definition = componentDefinition(definitionId);
      if (definition) appendUnique(physicalParts, { type: definition.id, quantity: 1 });
    }
  }

  return {
    ...request,
    inputs,
    outputs,
    physicalParts,
    power: {
      ...request.power,
      ...(request.power.part && namedInBrief(request.power.part, userBrief)
        ? { part: request.power.part }
        : { part: undefined }),
    },
    constraints: {
      ...request.constraints,
      preferredComponents,
    },
  };
}
