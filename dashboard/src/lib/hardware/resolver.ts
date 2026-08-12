// Turning the words in a request into definitions from the component library.
//
// Resolution is deterministic and total: a phrase either maps to exactly one
// library part, maps ambiguously (reported, never guessed), or does not map at
// all (reported as unsupported). The model never supplies a definition.

import {
  BOARD_FOOTPRINTS,
  boardVolumeMm3,
  describeBoardFootprint,
  type BoardFootprint,
} from "../cad/board-enclosures.ts";
import { COMPONENT_DEFINITIONS, componentDefinition, isController } from "./components/index.ts";
import type { ComponentDefinition, RequestedPeripheral } from "./types.ts";

export type ResolutionOutcome =
  | { status: "resolved"; definition: ComponentDefinition; matchedOn: string }
  | { status: "ambiguous"; candidates: ComponentDefinition[] }
  | { status: "unsupported" };

export interface ResolvedPeripheral {
  requested: RequestedPeripheral;
  role: "input" | "output";
  outcome: ResolutionOutcome;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Singularise the trailing word so "two LEDs" and "an LED" resolve alike. */
function singularize(value: string): string {
  return value.replace(/\b([a-z]{3,})(?:es|s)\b$/i, (match, stem: string) =>
    match.toLowerCase().endsWith("ses") ? `${stem}s` : stem,
  );
}

interface IndexEntry {
  key: string;
  definition: ComponentDefinition;
}

const searchIndex: IndexEntry[] = COMPONENT_DEFINITIONS.flatMap((definition) => {
  const keys = new Set<string>([
    normalize(definition.id),
    normalize(definition.name),
    ...definition.aliases.map(normalize),
  ]);
  return [...keys]
    .filter(Boolean)
    .map((key) => ({ key, definition }));
});

function uniqueDefinitions(entries: IndexEntry[]): ComponentDefinition[] {
  const seen = new Map<string, ComponentDefinition>();
  for (const entry of entries) seen.set(entry.definition.id, entry.definition);
  return [...seen.values()];
}

/**
 * Resolve one phrase. Exact alias matches win outright; otherwise the longest
 * alias contained in the phrase wins, which is what makes "a 128x64 OLED
 * display" resolve to the SSD1306 without a fuzzy matcher.
 */
export function resolveComponentPhrase(phrase: string): ResolutionOutcome {
  const normalized = singularize(normalize(phrase));
  if (!normalized) return { status: "unsupported" };

  const exact = searchIndex.filter((entry) => entry.key === normalized);
  if (exact.length) {
    const definitions = uniqueDefinitions(exact);
    return definitions.length === 1
      ? { status: "resolved", definition: definitions[0], matchedOn: normalized }
      : { status: "ambiguous", candidates: definitions };
  }

  const contained = searchIndex
    .filter((entry) => {
      if (entry.key.length < 3) return false;
      return new RegExp(`(?:^|\\s)${escapeRegExp(entry.key)}(?:\\s|$)`).test(normalized);
    })
    .sort((left, right) => right.key.length - left.key.length);

  if (!contained.length) return { status: "unsupported" };

  const bestLength = contained[0].key.length;
  let tied = contained.filter((entry) => entry.key.length === bestLength);
  // English puts the head noun last: "breadboard power rails" is a kind of
  // power rail, not a kind of breadboard. When two aliases of the same length
  // both appear, the one at the end of the phrase is the one being named.
  const trailing = tied.filter((entry) => normalized.endsWith(entry.key));
  if (trailing.length) tied = trailing;

  const best = uniqueDefinitions(tied);
  return best.length === 1
    ? { status: "resolved", definition: best[0], matchedOn: tied[0].key }
    : { status: "ambiguous", candidates: best };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve an explicitly named controller, never substituting a different one. */
export function resolveController(phrase: string | undefined): ResolutionOutcome | null {
  if (!phrase?.trim()) return null;
  const outcome = resolveComponentPhrase(phrase);
  if (outcome.status === "resolved") {
    return isController(outcome.definition.id)
      ? outcome
      : { status: "unsupported" };
  }
  if (outcome.status === "ambiguous") {
    const controllers = outcome.candidates.filter((candidate) => isController(candidate.id));
    if (controllers.length === 1) {
      return { status: "resolved", definition: controllers[0], matchedOn: phrase };
    }
    return controllers.length ? { status: "ambiguous", candidates: controllers } : { status: "unsupported" };
  }
  return outcome;
}

export function resolvePeripherals(
  peripherals: RequestedPeripheral[],
  role: "input" | "output",
): ResolvedPeripheral[] {
  return peripherals.map((requested) => ({
    requested,
    role,
    outcome: resolveComponentPhrase(requested.type),
  }));
}

/** A measured board, paired with the definition it belongs to. */
export interface MeasuredBoard {
  definition: ComponentDefinition;
  footprint: BoardFootprint;
}

/** Every controller whose real size is on record, smallest bounding box first. */
export function measuredControllers(): MeasuredBoard[] {
  return COMPONENT_DEFINITIONS.filter(
    (definition) => isController(definition.id) && BOARD_FOOTPRINTS[definition.id],
  )
    .map((definition) => ({ definition, footprint: BOARD_FOOTPRINTS[definition.id]! }))
    .sort((left, right) => boardVolumeMm3(left.footprint) - boardVolumeMm3(right.footprint));
}

/** The measurements of one board, when they are on record. */
export function controllerFootprint(definitionId: string): BoardFootprint | null {
  return BOARD_FOOTPRINTS[definitionId] ?? null;
}

/**
 * The smallest board that can carry a wearable build: physically least, and
 * 3.3 V so a single lithium cell feeds it without a boost converter. Derived
 * from the library and the footprint table rather than named here, so adding a
 * smaller board is enough to change the answer.
 */
export function smallestWearableController(
  requiredCommunication: string[] = [],
): MeasuredBoard | null {
  const requiredRadios = requiredCommunication.filter(
    (entry) => entry === "wifi" || entry === "bluetooth",
  );
  return (
    measuredControllers().find(
      (board) =>
        board.definition.electrical.logicVoltage === 3.3 &&
        requiredRadios.every((radio) => board.definition.interfaces.includes(radio)),
    ) ?? null
  );
}

function needsRadio(communication: string[]): boolean {
  return communication.some((entry) => entry === "wifi" || entry === "bluetooth");
}

/**
 * Pick a controller when the user did not name one.
 *
 * Two passes. The first is electrical: Wi-Fi and 3.3 V logic when the project
 * needs a network or a 3.3 V-only sensor, an Uno when everything on the bus is
 * 5 V, and the cheapest 3.3 V board otherwise. The second is physical, and it
 * overrides the first, because a level converter is a 13 × 17 mm part the
 * compiler can add later while a board that does not fit on a pair of glasses
 * is not something any later step can shrink.
 */
export function selectController(input: {
  peripherals: ComponentDefinition[];
  communication: string[];
  beginnerFriendly: boolean;
  /** The build has to be small enough to wear, clip on, or hold. */
  sizeConstrained?: boolean;
  /** The words that said so, quoted back into the rationale. */
  sizeEvidence?: string | null;
}): { definition: ComponentDefinition; rationale: string } {
  const electrical = selectByElectricalNeeds(input);
  if (!input.sizeConstrained) return electrical;

  const quoted = input.sizeEvidence ? `"${input.sizeEvidence}"` : "the brief";
  const compact = smallestWearableController(input.communication);
  if (!compact && needsRadio(input.communication)) {
    return {
      definition: electrical.definition,
      rationale: `${electrical.rationale} ${quoted} asks for something small, and no compact 3.3 V board in the library supports every requested radio.`,
    };
  }
  if (!compact || compact.definition.id === electrical.definition.id) return electrical;

  const current = controllerFootprint(electrical.definition.id);
  if (current && boardVolumeMm3(current) <= boardVolumeMm3(compact.footprint)) {
    return electrical;
  }

  return {
    definition: compact.definition,
    rationale: `${quoted} describes something worn or carried, so the smallest board on record was chosen: ${describeBoardFootprint(
      compact.footprint,
    )}${needsRadio(input.communication) ? ", with the requested radio built in" : ""}${
      current
        ? `, against ${describeBoardFootprint(current)} for the ${electrical.definition.name} the electrical rules alone would have picked`
        : ""
    }. Its 3.3 V logic also runs straight from one lithium cell.`,
  };
}

function selectByElectricalNeeds(input: {
  peripherals: ComponentDefinition[];
  communication: string[];
  beginnerFriendly: boolean;
}): { definition: ComponentDefinition; rationale: string } {
  const needsNetwork = needsRadio(input.communication);
  if (needsNetwork) {
    return {
      definition: componentDefinition("esp32-devkit-v1")!,
      rationale: "The project needs Wi-Fi or Bluetooth, which this board has built in.",
    };
  }

  const requiresThreeVolt = input.peripherals.some(
    (definition) =>
      typeof definition.electrical.maximumSupplyVoltage === "number" &&
      definition.electrical.maximumSupplyVoltage < 5,
  );
  if (requiresThreeVolt) {
    return {
      definition: componentDefinition("esp32-devkit-v1")!,
      rationale:
        "At least one part is 3.3 V only, so a 3.3 V board avoids a level shifter on every signal.",
    };
  }

  const fiveVoltOnly = input.peripherals.some(
    (definition) =>
      typeof definition.electrical.minimumSupplyVoltage === "number" &&
      definition.electrical.minimumSupplyVoltage >= 4.5 &&
      definition.electrical.logicVoltage === 5,
  );
  if (fiveVoltOnly) {
    return {
      definition: componentDefinition("arduino-uno")!,
      rationale:
        "The chosen parts use 5 V logic, so a 5 V board keeps every signal in one voltage domain.",
    };
  }

  return input.beginnerFriendly
    ? {
        definition: componentDefinition("arduino-uno")!,
        rationale:
          "No board was specified and nothing needs a network, so the most widely documented beginner board was chosen.",
      }
    : {
        definition: componentDefinition("esp32-devkit-v1")!,
        rationale: "No board was specified; this one offers the most GPIO and built-in radios.",
      };
}
