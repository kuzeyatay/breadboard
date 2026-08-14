// The Hardware Blueprint → Parametric CAD hand-off.
//
// When a hardware brief asks for a case, the blueprint run calls the CAD agent
// rather than growing a second enclosure generator of its own. Everything here
// is the translation between the two: what the compiled circuit physically is,
// and what the person said they wanted around it.
//
// The board figures below are source-controlled measurements from each board's
// own mechanical drawing. A conservative enclosure allowance is permitted only
// when the same record labels it as an assumption, so it cannot look like a
// measured figure.

import type { CADValidationIssue, ParametricCADArtifact } from "./types.ts";

export interface BoardFootprint {
  /** PCB length along X, in millimetres. */
  length: number;
  /** PCB width along Y, in millimetres. */
  width: number;
  /** Tallest populated-board envelope, or the allowance explained below. */
  height: number;
  /**
   * Present when `height` is an enclosure allowance rather than a published
   * mechanical measurement. Any text shown to a person must carry this note.
   */
  heightAssumption?: string;
  /** Mounting-hole pattern, centre to centre, when the board has one. */
  mountingHoles?: { spacingX: number; spacingY: number; diameter: number };
  /** Connectors that need an opening, with the face they sit on. */
  connectors: Array<{
    name: string;
    face: "front" | "rear" | "left" | "right" | "top";
    width: number;
    height: number;
    /** Height of the opening's centre above the PCB's bottom face. */
    centreAboveBoard: number;
    /** Present when the opening is a configurable allowance, not a drawing measurement. */
    assumption?: string;
  }>;
}

/**
 * Keyed by the component-library definition id the hardware compiler uses.
 * Figures are from each board's published mechanical drawing unless the
 * individual entry explicitly labels an enclosure allowance as an assumption.
 */
export const BOARD_FOOTPRINTS: Record<string, BoardFootprint> = {
  "seeed-xiao-esp32c3": {
    length: 21,
    width: 17.8,
    height: 4,
    heightAssumption:
      "Seeed publishes the 21 x 17.8 mm plan dimensions but not a populated-board height; 4 mm is a conservative enclosure allowance, not a measured figure.",
    connectors: [
      {
        name: "USB-C",
        face: "front",
        width: 9,
        height: 3.5,
        centreAboveBoard: 2,
        assumption:
          "This is a conservative USB-C clearance opening; verify it against the populated board before printing.",
      },
    ],
  },
  "esp32-devkit-v1": {
    length: 51.5,
    width: 28.3,
    height: 13.0,
    connectors: [
      {
        name: "Micro-USB",
        face: "front",
        width: 8.0,
        height: 3.0,
        centreAboveBoard: 3.2,
      },
    ],
  },
  "arduino-uno": {
    length: 68.6,
    width: 53.4,
    height: 15.0,
    mountingHoles: { spacingX: 48.3, spacingY: 27.9, diameter: 3.2 },
    connectors: [
      { name: "USB-B", face: "front", width: 12.0, height: 11.0, centreAboveBoard: 7.0 },
      { name: "Barrel jack", face: "front", width: 9.0, height: 11.0, centreAboveBoard: 7.0 },
    ],
  },
  "raspberry-pi-pico": {
    length: 51.0,
    width: 21.0,
    height: 4.0,
    mountingHoles: { spacingX: 47.0, spacingY: 11.4, diameter: 2.1 },
    connectors: [
      { name: "Micro-USB", face: "front", width: 8.0, height: 3.0, centreAboveBoard: 1.6 },
    ],
  },
  "arduino-nano": {
    length: 45.0,
    width: 18.0,
    height: 7.0,
    connectors: [
      { name: "Mini-USB", face: "front", width: 8.0, height: 4.0, centreAboveBoard: 3.0 },
    ],
  },
  "arduino-mega": {
    length: 101.52,
    width: 53.3,
    height: 15.3,
    connectors: [
      { name: "USB-B", face: "front", width: 12.0, height: 11.0, centreAboveBoard: 7.0 },
      { name: "Barrel jack", face: "front", width: 9.0, height: 11.0, centreAboveBoard: 7.0 },
    ],
  },
};

/**
 * The bounding volume of a board, for comparing one against another.
 *
 * Board choice reads this as well as the enclosure generator: "small enough to
 * wear" is a claim about these millimetres, and there should be exactly one
 * place they are written down.
 */
export function boardVolumeMm3(footprint: BoardFootprint): number {
  return footprint.length * footprint.width * footprint.height;
}

/** Quote the recorded envelope and carry any assumption alongside the number. */
export function describeBoardFootprint(footprint: BoardFootprint): string {
  return `${footprint.length} × ${footprint.width} × ${footprint.height} mm${
    footprint.heightAssumption ? ` (${footprint.heightAssumption})` : ""
  }`;
}

/** A container around the circuit: the thing most people say out loud. */
const ENCLOSURE_WORDS =
  /\b(?:enclosure|case|casing|housing|shell|box(?:es)?|cover|lid|chassis|bezel|faceplate|mount(?:ing)? plate|bracket|clip|clip-on|holder|cradle|carrier|sled|mounting tab)\b/i;

/**
 * Explicit requests for mechanical/CAD work should reach the general CAD agent
 * even when the requested shape is not an enclosure or mount. The hardware
 * agent still owns the circuit; these phrases ask it for a physical deliverable
 * as well.
 */
const EXPLICIT_CAD_REQUEST =
  /\b(?:cad|3d[- ]model|3d[- ]print(?:able|ed|ing)?|printable\s+(?:part|assembly|product)|solid\s+model|parametric\s+model|mechanical\s+(?:part|product|design|assembly))\b/i;

/**
 * Common non-enclosure jobs. This is intentionally a routing vocabulary, not a
 * capability list: once routed, the model-backed CadQuery agent can construct
 * arbitrary geometry rather than choosing from these nouns.
 */
const NON_ENCLOSURE_PHYSICAL =
  /\b(?:mechanism|gear(?:\s*(?:box|train))?|rack(?:\s+and\s+pinion)?|pinion|linkage|cam|ratchet|lead\s+screw|linear\s+actuator|hinge|pulley|crank|slider|impeller|propeller|manifold|duct|nozzle|knob|handle|wearable|wrist[- ]worn|headset|headband|earpiece|armband|helmet|glasses|eyeglasses|spectacles|goggles|visor|eyewear|temple|waveguide|combiner|collimator|birdbath|micro[- ]?oled)\b/i;

const PHYSICAL_PRODUCT_CONTEXT =
  /\b(?:wearable|wrist[- ]worn|headset|headband|earpiece|armband|smart\s+glasses|ar\s+glasses|near[- ]eye|heads?[- ]up\s+display)\b/i;

const PHYSICAL_DESIGN_ACTION =
  /\b(?:design(?:ed|ing)?|make|made|create(?:d|ing)?|model(?:led|ed|ing)?|print(?:ed|ing)?|fabricate(?:d|ing)?|construct(?:ed|ing)?|shape(?:d|ing)?|fit(?:ted|ting)?|align(?:ed|ing)?|integrate(?:d|ing)?|build|built)\b/gi;

const OBJECT_BOUNDARY = /\b(?:for|with|using|from|near|beside|inside|within|on|onto|at|by|when|while|that|which|who|whose|to\s+(?:sense|measure|monitor|control|detect|read))\b|[.!?;]/i;

/**
 * Holding the circuit onto something else, which is a physical part just as
 * plainly as a box is. Leaving this group out is why a brief that said the
 * thing attaches to a pair of glasses produced no CAD at all: it never used
 * one of the container words above.
 */
const ATTACHMENT_PHRASES =
  /\b(?:attach(?:es|ed|able)?\s+(?:it\s+)?(?:to|onto)|clips?\s+(?:on|onto|to)|snaps?\s+(?:on|onto|to)|straps?\s+(?:to|onto|around)|slides?\s+onto|fits?\s+(?:on|onto|over|around)|hangs?\s+(?:on|from)|mount(?:s|ed|ing)?\s+(?:on|onto|to)|worn\s+(?:on|around)|wearable)\b/gi;

/**
 * Where those phrases mean wiring, not mounting. "Attach the sensor to pin 3"
 * and "mount it on the breadboard" are not requests for a bracket.
 */
const ELECTRICAL_TARGET =
  /^\s*(?:the|a|an|my|your|its?|them)?\s*(?:pin|pins|gpio|header|headers|board|breadboard|perfboard|pcb|rail|rails|bus|wire|wires|lead|leads|terminal|terminals|connector|ground|gnd|vcc|vin|3v3|5v|net|node|trace|d\d+|a\d+)\b/i;

/**
 * Phrases where these words mean electronics or English, not a physical part.
 * They are removed before the search so "surface-mount parts", "in that case"
 * and "alligator clips" cannot be read as a request for a housing.
 */
const NOT_PHYSICAL =
  /\b(?:surface[- ]mount(?:ed|ing)?|smd|through[- ]hole|(?:alligator|crocodile|test)\s+clips?|clip\s+leads?|stand[- ]?alone|frame\s?rate|(?:in|for)\s+(?:this|that|which|any|either|the\s+worst|the\s+best)\s+case|(?:test|use|edge|corner|switch|lower|upper)[- ]cases?|case\s+statement|in\s+case\s+of)\b/gi;

const NEGATED_PHYSICAL =
  /\b(?:no|without|not(?:\s+just)?)\s+(?:(?:a|an|any)\s+)?(?:enclosure|case|casing|housing|box|lid|cover|shell|bracket|clip|holder|mount)(?:\s*(?:,\s*(?:(?:or|and)\s*)?|(?:or|and)\s+)(?:(?:a|an|any)\s+)?(?:enclosure|case|casing|housing|box|lid|cover|shell|bracket|clip|holder|mount))*/gi;

const NEGATED_CAD_REQUEST =
  /\b(?:no|without|not(?:\s+just)?)\s+(?:(?:a|an|any)\s+)?(?:cad|3d[- ]model|3d[- ]print(?:able|ed|ing)?|solid\s+model|parametric\s+model)(?:\s*(?:,\s*(?:(?:or|and)\s*)?|(?:or|and)\s+)(?:(?:a|an|any)\s+)?(?:cad|3d[- ]model|3d[- ]print(?:able|ed|ing)?|solid\s+model|parametric\s+model))*/gi;

const NEGATED_PRODUCT_CONTEXT =
  /\b(?:no|without|not(?:\s+just)?)\s+(?:(?:a|an|any)\s+)?(?:wearable|wrist[- ]worn|headset|headband|earpiece|armband|smart\s+glasses|ar\s+glasses|near[- ]eye|heads?[- ]up\s+display)\b/gi;

const NEGATED_GENERAL_DESIGN = new RegExp(
  `\\b(?:do\\s+not|don't|not\\s+to|never)\\s+${PHYSICAL_DESIGN_ACTION.source}\\s+(?:(?:a|an|the|any|adjustable|parametric|printable|3d|mechanical|physical)\\s+){0,4}(?:${NON_ENCLOSURE_PHYSICAL.source}|${ENCLOSURE_WORDS.source})`,
  "gi",
);

function physicalSearchText(brief: string): string {
  return brief
    .replace(NOT_PHYSICAL, " ")
    .replace(NEGATED_GENERAL_DESIGN, " ")
    .replace(NEGATED_PHYSICAL, " ")
    .replace(NEGATED_CAD_REQUEST, " ")
    .replace(NEGATED_PRODUCT_CONTEXT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A mechanism noun is not itself a CAD request: a tachometer may merely sense
 * an existing gearbox. Require a nearby construction verb, with a deliberately
 * tighter window for the ambiguous word "build".
 */
function directedNonEnclosureRequest(searchable: string): boolean {
  const nounPattern = new RegExp(NON_ENCLOSURE_PHYSICAL.source, "gi");
  for (const noun of searchable.matchAll(nounPattern)) {
    if (noun.index === undefined) continue;
    const before = searchable.slice(0, noun.index);
    const after = searchable.slice(noun.index + noun[0].length);
    const actions = [...before.matchAll(PHYSICAL_DESIGN_ACTION)];
    const action = actions.at(-1);
    if (action?.index !== undefined) {
      const between = before.slice(action.index + action[0].length);
      const words = between.match(/[a-z0-9]+/gi)?.map((word) => word.toLowerCase()) ?? [];
      if (
        !OBJECT_BOUNDARY.test(between) &&
        words.length <= 4
      ) {
        return true;
      }
    }
    const passive = after.match(
      /^\s+(?:(?:(?:should|must|can|will)\s+be)|(?:is|are|was|were|be|to\s+be))\s+(?:designed|made|created|modelled|modeled|printed|fabricated|constructed|shaped|fitted|aligned|integrated|built)\b/i,
    );
    if (passive) return true;
  }
  return false;
}

/**
 * Does this hardware brief ask for something physical around the circuit?
 *
 * Flags win over prose: `--enclosure` asks for one whatever the sentence says,
 * `--no-enclosure` declines one. Everything else is read from the words — both
 * the container vocabulary and the fastening vocabulary, since a clip and a
 * strap are as much the CAD agent's work as a lid is.
 */
export function enclosureIntent(brief: string): {
  wanted: boolean;
  /** The brief with the enclosure flags stripped out. */
  remaining: string;
} {
  let forced: boolean | null = null;
  const remaining = brief
    .replace(/(?:^|\s)--no-enclosure\b/gi, () => {
      forced = false;
      return " ";
    })
    .replace(/(?:^|\s)--enclosure\b/gi, () => {
      forced = true;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  if (forced !== null) return { wanted: forced, remaining };

  const searchable = physicalSearchText(remaining);
  if (ENCLOSURE_WORDS.test(searchable)) return { wanted: true, remaining };
  if (
    EXPLICIT_CAD_REQUEST.test(searchable) ||
    PHYSICAL_PRODUCT_CONTEXT.test(searchable) ||
    directedNonEnclosureRequest(searchable)
  ) {
    return { wanted: true, remaining };
  }
  for (const match of searchable.matchAll(ATTACHMENT_PHRASES)) {
    const following = searchable.slice(match.index + match[0].length);
    if (!ELECTRICAL_TARGET.test(following)) return { wanted: true, remaining };
  }
  return { wanted: false, remaining };
}

export interface EnclosureBriefInput {
  /** The user's own words, so the CAD agent designs what they described. */
  userBrief: string;
  /** Human name of the compiled design, used to title the part. */
  designTitle: string;
  /** Library id of the controller the compiler chose. */
  controllerDefinitionId: string;
  controllerName: string;
  /** Every other part, so the agent knows what has to fit or poke through. */
  peripherals: Array<{
    name: string;
    definitionId: string;
    category?: string;
    mechanical?: {
      length: number;
      width: number;
      height: number;
      notes?: string;
      integration?: string[];
      functionalAxes?: string[];
      exposedRegions?: string[];
      massGrams?: number;
    };
  }>;
  prototypeType: "breadboard" | "perfboard" | "pcb";
}

/**
 * The physical job the Hardware Blueprint is handing to CAD.
 *
 * This is deliberately broader than "enclosure". The old hand-off collapsed
 * every product into a box around its controller, which is how an optical
 * wearable became a rectangular ESP32 case with a channel on its side.
 */
export type PhysicalDesignKind =
  | "simple-enclosure"
  | "mount"
  | "wearable-product"
  | "optomechanical-product"
  | "mechanism"
  | "freeform";

export interface PhysicalDesignRequirement {
  /** Stable id the CAD specification must repeat in a constraint id. */
  id: string;
  description: string;
  /** Each group needs at least one matching phrase in the specification/source. */
  evidenceGroups: string[][];
}

const OPTICAL_PRODUCT =
  /\b(?:ar|augmented[- ]reality|near[- ]eye|heads?[- ]up|hud|waveguide|combiner|collimator|birdbath|micro[- ]?oled)\b/i;
const EYEWEAR = /\b(?:glasses|eyeglasses|spectacles|goggles|visor|eyewear|temple|bridge)\b/i;
const WEARABLE =
  /\b(?:wearable|worn|wrist|watch|bracelet|headset|headband|earpiece|badge|armband|helmet|glove|shoe|belt|pendant)\b/i;
const MECHANISM =
  /\b(?:mechanism|gear(?:\s*(?:box|train))?|rack and pinion|linkage|cam|ratchet|lead screw|linear actuator|hinge|pulley|crank|slider)\b/i;
const MOUNT_ONLY =
  /\b(?:mount|bracket|clip|clamp|holder|cradle|adapter|fixture|jig|carrier|sled)\b/i;

/** Classify shape/function before writing the physical-design brief. */
export function physicalDesignKind(brief: string): PhysicalDesignKind {
  const searchable = physicalSearchText(brief);
  if (OPTICAL_PRODUCT.test(searchable) && EYEWEAR.test(searchable)) return "optomechanical-product";
  if (EYEWEAR.test(searchable) || WEARABLE.test(searchable)) return "wearable-product";
  if (MECHANISM.test(searchable)) return "mechanism";
  if (MOUNT_ONLY.test(searchable) || attachmentIntent(searchable)) return "mount";
  if (ENCLOSURE_WORDS.test(searchable)) return "simple-enclosure";
  return "freeform";
}

function requirementId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
}

/**
 * Requirements that kernel validity cannot prove. They are repeated verbatim
 * in the model brief, then checked before a Hardware Blueprint may publish the
 * CAD as its completed physical design.
 */
export function physicalDesignRequirements(
  input: EnclosureBriefInput,
): PhysicalDesignRequirement[] {
  const kind = physicalDesignKind(input.userBrief);
  const requirements: PhysicalDesignRequirement[] = [
    {
      id: "controller_retention",
      description: `Retain the ${input.controllerName} with bosses, rails, a pocket, or another explicit serviceable fixture; free space around a loose board is not retention.`,
      evidenceGroups: [
        ["controller_retention"],
        ["boss", "standoff", "retention rail", "board pocket", "board clamp", "board cradle"],
      ],
    },
  ];

  for (const peripheral of input.peripherals.filter((candidate) => candidate.mechanical)) {
    const id = `accommodate_${requirementId(peripheral.definitionId || peripheral.name)}`;
    requirements.push({
      id,
      description: `Represent and accommodate the catalog envelope of ${peripheral.name}; provide its required seat, aperture, keep-out, or retention feature rather than adding generic empty volume.`,
      evidenceGroups: [
        [id],
        [peripheral.definitionId.replaceAll("-", " "), peripheral.name],
        [
          "seat",
          "aperture",
          "keep out",
          "retention",
          "clamp",
          "pocket",
          "holder",
          "carrier",
          "mount",
          "routing",
          "clearance",
          "support",
        ],
      ],
    });
  }

  if (kind === "simple-enclosure") {
    requirements.push({
      id: "closure_retention",
      description: "A removable cover must have a real retention method and assembly clearance: screws, snaps, a captured lip/groove, hinge and latch, or an equivalent feature.",
      evidenceGroups: [
        ["closure_retention"],
        ["screw", "snap", "captured lip", "retention lip", "groove", "latch", "hinge", "dovetail"],
      ],
    });
  }

  if (kind === "mount" || kind === "wearable-product" || kind === "optomechanical-product") {
    requirements.push({
      id: "host_interface_retention",
      description: "The host interface needs positive retention; an open fixed-width channel is not a clip or clamp.",
      evidenceGroups: [
        ["host_interface_retention"],
        ["clamp", "snap", "latch", "strap", "retaining", "captured", "screw"],
      ],
    });
  }

  if (kind === "wearable-product" || kind === "optomechanical-product") {
    requirements.push({
      id: "wearable_fit_range",
      description: "Expose the measured host fit as an editable range and state that no universal wearable-frame dimensions exist.",
      evidenceGroups: [
        ["wearable_fit_range"],
        ["fit range", "minimum", "maximum", "adjustable"],
        ["temple", "frame", "host"],
      ],
    });
  }

  if (kind === "optomechanical-product") {
    requirements.push(
      {
        id: "display_mount",
        description: "Provide a retained microdisplay seat with a defined active-display direction.",
        evidenceGroups: [
          ["display_mount"],
          ["display", "micro oled", "microdisplay"],
          ["seat", "pocket", "holder", "carrier", "clamp"],
        ],
      },
      {
        id: "focusing_optic_mount",
        description: "Provide an adjustable focusing/collimating optic carrier rather than treating the lens as empty space.",
        evidenceGroups: [
          ["focusing_optic_mount"],
          ["lens", "collimator", "focusing optic"],
          ["barrel", "holder", "carrier", "seat", "thread"],
        ],
      },
      {
        id: "combiner_mount",
        description: "Provide a protected edge clamp or carrier for the transparent combiner/waveguide.",
        evidenceGroups: [
          ["combiner_mount"],
          ["combiner", "waveguide"],
          ["edge clamp", "carrier", "holder", "protected edge", "seat"],
        ],
      },
      {
        id: "optical_axis_alignment",
        description: "Declare the display-to-lens-to-combiner optical axis and editable eye relief/alignment dimensions.",
        evidenceGroups: [
          ["optical_axis_alignment"],
          ["optical axis"],
          ["eye relief", "eyebox"],
        ],
      },
    );
  }
  return requirements;
}

function normaliseCoverageText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COMPONENT_REFERENCE_STOP_WORDS = new Set([
  "reference",
  "envelope",
  "module",
  "assembly",
  "custom",
  "part",
  "component",
]);

function componentReferenceTokens(value: string): Set<string> {
  return new Set(
    normaliseCoverageText(value)
      .split(" ")
      .filter((token) => token.length > 1 && !COMPONENT_REFERENCE_STOP_WORDS.has(token)),
  );
}

/**
 * Model-created design specs often call a measured item `display_reference`
 * instead of repeating the compiler id `micro-oled-display`. Accept that
 * human-readable naming only when at least two distinctive tokens agree;
 * one generic word such as "optical" or "sensor" is not enough.
 */
function componentReferenceMatches(record: string, identifiers: string[]): boolean {
  if (identifiers.some((identifier) => record.includes(identifier))) return true;
  const recordTokens = componentReferenceTokens(record);
  return identifiers.some((identifier) => {
    const requestedTokens = componentReferenceTokens(identifier);
    const shared = [...requestedTokens].filter((token) => recordTokens.has(token)).length;
    const shorter = Math.min(requestedTokens.size, recordTokens.size);
    const required = Math.min(3, Math.max(2, Math.ceil(shorter * 0.6)));
    return shared >= required;
  });
}

/** Semantic acceptance gate used in addition to OpenCascade validation. */
export function physicalDesignCoverageIssues(
  input: EnclosureBriefInput,
  manifest: ParametricCADArtifact,
): CADValidationIssue[] {
  const constraintIds = new Set(
    manifest.designSpec.constraints.map((constraint) => constraint.id),
  );
  // Constraint prose says what the model intended; it is not proof that the
  // feature exists. Geometry evidence must come from body names or the actual
  // parametric program, otherwise copying the acceptance checklist into the
  // specification could make an unchanged box pass.
  const geometryText = normaliseCoverageText(
    `${JSON.stringify(manifest.designSpec.components)}\n${manifest.source}`,
  );
  const issues: CADValidationIssue[] = physicalDesignRequirements(input).flatMap((requirement) => {
    const missingConstraint = !constraintIds.has(requirement.id);
    const missingGeometryEvidence = requirement.evidenceGroups.slice(1).some(
      (group) =>
        !group.some((phrase) => geometryText.includes(normaliseCoverageText(phrase))),
    );
    const missing = missingConstraint || missingGeometryEvidence;
    return missing
      ? [
          {
            code: "MISSING_REQUIRED_FEATURE",
            severity: "error" as const,
            feature: requirement.id,
            message: `The geometry built, but it does not provide evidence for: ${requirement.description}`,
            repairHint: `Add the feature and record a constraint with id "${requirement.id}" before publishing this design.`,
          },
        ]
      : [];
  });

  const kind = physicalDesignKind(input.userBrief);
  const printable = manifest.designSpec.components.filter(
    (component) => component.bodyRole !== "reference",
  );
  if (
    kind !== "simple-enclosure" &&
    printable.length <= 2 &&
    printable.every((component) =>
      /\b(?:shell|lid|cover|case|box|enclosure)\b/i.test(`${component.id} ${component.name}`),
    )
  ) {
    issues.unshift({
      code: "PRODUCT_INTENT_COLLAPSED_TO_ENCLOSURE",
      severity: "error",
      feature: "physical_design_intent",
      message: `The requested ${kind.replaceAll("-", " ")} was reduced to enclosure bodies (${printable
        .map((component) => component.name)
        .join(", ")}). A shell and lid do not implement the requested product.`,
      repairHint: "Model the host interface and functional product bodies named in the acceptance requirements.",
    });
  }

  // A person holding several printed bodies cannot tell from the geometry which
  // one clamps what, or which screw to buy. That is part of the deliverable, so
  // a physical design that joins bodies or reserves bought parts is unfinished
  // until its assembly graph is both documented and internally consistent.
  const assembly = manifest.designSpec.assembly;
  const referenced = manifest.designSpec.components.filter(
    (component) => component.bodyRole === "reference",
  );
  const requiresAssembly =
    manifest.designSpec.components.length > 1 ||
    manifest.designSpec.components.some((component) => component.quantity > 1);
  if (requiresAssembly && (!assembly || assembly.steps.length === 0)) {
    issues.push({
      code: "ASSEMBLY_NOT_DOCUMENTED",
      severity: "error",
      feature: "assembly",
      message: `The design has ${printable.length} printed ${printable.length === 1 ? "body" : "bodies"}` +
        (referenced.length
          ? ` and ${referenced.length} bought/reference ${referenced.length === 1 ? "part" : "parts"}`
          : "") +
        ", but no ordered assembly steps say what attaches where.",
      repairHint:
        "Send `assembly` with cad_generate_model: an overview, the bought hardware with sizes and " +
        "quantities, and one ordered step per join, naming the component ids it brings together.",
    });
  }

  if (assembly?.steps.length) {
    const componentIdList = manifest.designSpec.components.map((component) => component.id);
    const hardwareIdList = assembly.hardware.map((item) => item.id);
    const componentIds = new Set(componentIdList);
    const hardwareIds = new Set(hardwareIdList);
    const usedComponents = new Set<string>();
    const usedHardware = new Set<string>();
    const graph = new Map<string, Set<string>>();
    const connect = (left: string, right: string) => {
      if (!graph.has(left)) graph.set(left, new Set());
      if (!graph.has(right)) graph.set(right, new Set());
      graph.get(left)!.add(right);
      graph.get(right)!.add(left);
    };

    const duplicateOrders = new Set<number>();
    const seenOrders = new Set<number>();
    const unknownParts = new Set<string>();
    const unknownHardware = new Set<string>();
    const emptySteps: number[] = [];
    for (const step of assembly.steps) {
      if (seenOrders.has(step.order)) duplicateOrders.add(step.order);
      seenOrders.add(step.order);
      if (!step.parts.length) emptySteps.push(step.order);

      const joinedComponents: string[] = [];
      for (const id of step.parts) {
        if (!componentIds.has(id)) {
          unknownParts.add(id);
          continue;
        }
        usedComponents.add(id);
        joinedComponents.push(id);
      }
      for (const id of step.hardware ?? []) {
        if (!hardwareIds.has(id)) {
          unknownHardware.add(id);
          continue;
        }
        usedHardware.add(id);
      }
      const uniqueJoinedComponents = [...new Set(joinedComponents)];
      for (let index = 1; index < uniqueJoinedComponents.length; index += 1) {
        connect(uniqueJoinedComponents[0]!, uniqueJoinedComponents[index]!);
      }
    }

    const duplicateIds = (ids: string[]) => {
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) duplicates.add(id);
        seen.add(id);
      }
      return [...duplicates].sort();
    };
    const duplicateComponentIds = duplicateIds(componentIdList);
    if (duplicateComponentIds.length) {
      issues.push({
        code: "ASSEMBLY_DUPLICATE_COMPONENT_IDS",
        severity: "error",
        feature: "assembly",
        actual: duplicateComponentIds,
        message: `Component ids must be unique before assembly can be interpreted: ${duplicateComponentIds.join(", ")}.`,
        repairHint: "Give every printed body and reference component one stable, unique id.",
      });
    }
    const duplicateHardwareIds = duplicateIds(hardwareIdList);
    if (duplicateHardwareIds.length) {
      issues.push({
        code: "ASSEMBLY_DUPLICATE_HARDWARE_IDS",
        severity: "error",
        feature: "assembly",
        actual: duplicateHardwareIds,
        message: `Assembly hardware ids must be unique: ${duplicateHardwareIds.join(", ")}.`,
        repairHint: "Merge identical BOM lines or assign distinct ids to genuinely different hardware.",
      });
    }
    if (unknownParts.size) {
      issues.push({
        code: "ASSEMBLY_UNKNOWN_PART_IDS",
        severity: "error",
        feature: "assembly",
        actual: [...unknownParts].sort(),
        message: `Assembly steps name unknown component ids: ${[...unknownParts].sort().join(", ")}.`,
        repairHint: "Use exact ids from designSpec.components in every assembly step.",
      });
    }
    if (unknownHardware.size) {
      issues.push({
        code: "ASSEMBLY_UNKNOWN_HARDWARE_IDS",
        severity: "error",
        feature: "assembly",
        actual: [...unknownHardware].sort(),
        message: `Assembly steps name undeclared hardware ids: ${[...unknownHardware].sort().join(", ")}.`,
        repairHint: "Declare each bought fastener, insert, pad or adhesive in assembly.hardware, then use that exact id.",
      });
    }
    if (emptySteps.length) {
      issues.push({
        code: "ASSEMBLY_EMPTY_STEPS",
        severity: "error",
        feature: "assembly",
        actual: emptySteps,
        message: `Assembly steps ${emptySteps.join(", ")} do not name a component, so they cannot say what attaches where.`,
        repairHint: "Name the exact component ids handled or joined in every step.",
      });
    }

    if (duplicateOrders.size) {
      issues.push({
        code: "ASSEMBLY_DUPLICATE_ORDER",
        severity: "error",
        feature: "assembly",
        actual: [...duplicateOrders].sort((left, right) => left - right),
        message: `Assembly step order values must be unique; repeated: ${[...duplicateOrders]
          .sort((left, right) => left - right)
          .join(", ")}.`,
        repairHint: "Renumber the steps into one unambiguous build order.",
      });
    }

    const unusedComponents = [...componentIds].filter((id) => !usedComponents.has(id));
    if (unusedComponents.length) {
      issues.push({
        code: "ASSEMBLY_UNUSED_COMPONENTS",
        severity: "error",
        feature: "assembly",
        actual: unusedComponents,
        message: `The assembly never says where these components go: ${unusedComponents.join(", ")}.`,
        repairHint: "Add an ordered step that names every printed body and every reference component it seats, retains or aligns.",
      });
    }

    const unusedHardware = [...hardwareIds].filter((id) => !usedHardware.has(id));
    if (unusedHardware.length) {
      issues.push({
        code: "ASSEMBLY_UNUSED_HARDWARE",
        severity: "error",
        feature: "assembly",
        actual: unusedHardware,
        message: `The hardware list includes items no assembly step uses: ${unusedHardware.join(", ")}.`,
        repairHint: "Use every listed item in a step, or remove it from assembly.hardware.",
      });
    }

    // Steps are edges in an attachment graph. Checking only their count allowed
    // two independently documented subassemblies to masquerade as one product.
    // Only component co-membership creates an edge. A BOM id such as `m3_screw`
    // can represent several physical screws, so using that same id in unrelated
    // steps is not proof that those subassemblies touch each other.
    if (!duplicateComponentIds.length && !unusedComponents.length && componentIds.size > 1) {
      const start = manifest.designSpec.components[0]!.id;
      const visited = new Set<string>([start]);
      const pending = [start];
      while (pending.length) {
        const current = pending.pop()!;
        for (const neighbour of graph.get(current) ?? []) {
          if (visited.has(neighbour)) continue;
          visited.add(neighbour);
          pending.push(neighbour);
        }
      }
      const disconnected = [...componentIds].filter((id) => !visited.has(id));
      if (disconnected.length) {
        issues.push({
          code: "ASSEMBLY_GRAPH_DISCONNECTED",
          severity: "error",
          feature: "assembly",
          actual: disconnected,
          message: `The documented steps leave a separate, unattached subassembly: ${disconnected.join(", ")}.`,
          repairHint: "Add the missing join between subassemblies and name both mating component ids and any hardware used.",
        });
      }
    }
  }

  const componentRecords = manifest.designSpec.components.map((component) =>
    `${component.id} ${component.name}`.toLowerCase().replace(/[^a-z0-9]+/g, " "),
  );
  const productBox = Object.values(manifest.measurements?.boundingBox ?? {})
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right);
  for (const peripheral of input.peripherals.filter((candidate) => candidate.mechanical)) {
    const identifiers = [peripheral.definitionId, peripheral.name].map((value) =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, " "),
    );
    if (!componentRecords.some((record) => componentReferenceMatches(record, identifiers))) {
      issues.push({
        code: "MISSING_COMPONENT_REFERENCE",
        severity: "error",
        feature: peripheral.definitionId,
        message: `${peripheral.name} has a catalog envelope but is absent from the CAD assembly specification.`,
        repairHint: `Add ${peripheral.definitionId} as a reference component and model its fixture/keep-out.`,
      });
    }

    const envelope = [
      peripheral.mechanical!.length,
      peripheral.mechanical!.width,
      peripheral.mechanical!.height,
    ].sort((left, right) => left - right);
    if (productBox.length === 3 && envelope.some((dimension, index) => dimension > productBox[index] + 0.1)) {
      issues.push({
        code: "COMPONENT_ENVELOPE_CANNOT_FIT",
        severity: "error",
        feature: peripheral.definitionId,
        expected: `${envelope.join(" × ")} mm envelope in some orientation`,
        actual: `${productBox.join(" × ")} mm built bounding box`,
        message: `${peripheral.name} cannot fit anywhere inside the built product bounding box in any orthogonal orientation.`,
        repairHint: "Re-layout the assembly around the catalog envelope and rebuild it.",
      });
    }
  }
  return issues;
}

/**
 * Turn a compiled circuit into a brief the CAD agent can design from.
 *
 * The circuit contributes measurements; the user's own sentence contributes
 * intent. Both are passed through — the agent is told which is which so it can
 * report the board dimensions as given and its own choices as assumptions.
 */
export function enclosureBriefFromDesign(input: EnclosureBriefInput): string {
  const footprint = BOARD_FOOTPRINTS[input.controllerDefinitionId];
  const kind = physicalDesignKind(input.userBrief);
  const requirements = physicalDesignRequirements(input);
  const lines: string[] = [
    `Design the complete physical part or product requested around this compiled circuit: ${input.designTitle}.`,
    `Physical-design intent: ${kind}.`,
    "",
    "The person's request is the primary geometry requirement; do not reinterpret it as merely a box for the controller:",
    input.userBrief,
    "",
    "What the circuit is:",
    `- Controller: ${input.controllerName}`,
  ];

  if (footprint) {
    lines.push(
      footprint.heightAssumption
        ? `- Board footprint: ${footprint.length} × ${footprint.width} mm (published plan dimensions), with ${footprint.height} mm reserved for height. ${footprint.heightAssumption}`
        : `- Board footprint: ${footprint.length} × ${footprint.width} mm, ${footprint.height} mm tall including the tallest component. These are measured figures — treat them as given, not as assumptions.`,
    );
    if (footprint.mountingHoles) {
      lines.push(
        `- Board mounting holes: ${footprint.mountingHoles.spacingX} × ${footprint.mountingHoles.spacingY} mm centres, ${footprint.mountingHoles.diameter} mm diameter.`,
      );
    }
    for (const connector of footprint.connectors) {
      lines.push(
        `- ${connector.name} on the ${connector.face} face: opening ${connector.width} × ${connector.height} mm, centred ${connector.centreAboveBoard} mm above the board's underside.${
          connector.assumption ? ` ${connector.assumption}` : ""
        }`,
      );
    }
  } else {
    lines.push(
      `- The board's exact footprint is not in Breadboard's dimension table. Choose a size that fits a typical ${input.controllerName}, say so in the assumptions, and expose it as a parameter the person can correct.`,
    );
  }

  if (input.peripherals.length) {
    lines.push(`- Other parts: ${input.peripherals.map((part) => part.name).join(", ")}.`);
    for (const part of input.peripherals.filter((candidate) => candidate.mechanical)) {
      const size = part.mechanical!;
      lines.push(
        `- ${part.name} (${part.definitionId}) catalog envelope: ${size.length} × ${size.width} × ${size.height} mm.${size.notes ? ` ${size.notes}` : ""}`,
      );
      for (const requirement of size.integration ?? []) {
        lines.push(`  - Integration: ${requirement}`);
      }
      for (const axis of size.functionalAxes ?? []) {
        lines.push(`  - Functional axis/reference: ${axis}`);
      }
      if (size.exposedRegions?.length) {
        lines.push(`  - Keep exposed: ${size.exposedRegions.join(", ")}.`);
      }
      if (size.massGrams !== undefined) {
        lines.push(`  - Catalog mass: ${size.massGrams} g.`);
      }
    }
    const unknown = input.peripherals.filter((part) => !part.mechanical);
    if (unknown.length) {
      lines.push(
        `- No catalog envelope is recorded for ${unknown.map((part) => part.name).join(", ")}; leave configurable room and identify the assumption rather than inventing a precise cutout.`,
      );
    }
  }
  lines.push(
    `- Build style: ${input.prototypeType}. A breadboard build needs noticeably more internal height than a bare board.`,
  );

  lines.push("", "Acceptance requirements (use each exact id as a design-spec constraint id):");
  for (const requirement of requirements) {
    lines.push(`- ${requirement.id}: ${requirement.description}`);
  }

  lines.push("", "CAD hand-off rules:");
  lines.push(
    "- Model the requested product, its host interface, and its functional geometry. Do not default to a rectangular electronics box.",
    "- Add every catalog item with a mechanical envelope as a reference component in the design specification, and model the seat, aperture, keep-out, or retainer that integrates it.",
    "- Kernel validation proves that solids are geometrically valid; it does not prove that the product satisfies these acceptance requirements. Check both before answering.",
    "- Keep every assumed host dimension, fit range, alignment, and clearance editable and identify it as an assumption.",
  );
  if (kind === "simple-enclosure") {
    lines.push(
      "- A shell and removable cover are appropriate here. Retain the board on bosses/rails, preserve connector access, and give the cover a real captured lip, snap, screw, hinge/latch, or equivalent retention method.",
    );
  } else {
    lines.push(
      "- Use as many named printable bodies as the function requires. A shell and flat lid are not a substitute for a mount, mechanism, wearable assembly, optical carrier, or free-form product.",
    );
  }
  if (kind === "optomechanical-product") {
    lines.push(
      "- Treat the display, focusing optic, and combiner as an aligned optomechanical chain with explicit eye relief and adjustment. Reserve their measured envelopes, but do not claim that printed geometry validates an optical prescription, eyebox, safety, or human fit.",
      "- Keep mass close to the temple/bridge and keep the user's forward view clear. A controller-sized box in front of the lens is a failed product layout even if it is watertight.",
    );
  }
  return lines.join("\n");
}

function attachmentIntent(brief: string): boolean {
  const searchable = physicalSearchText(brief);
  if (/\b(?:clip|clip-on|strap|wearable|glasses|eyeglasses|spectacles|frame|bracket|holder|cradle|mount)\b/i.test(searchable)) {
    return true;
  }
  for (const match of searchable.matchAll(ATTACHMENT_PHRASES)) {
    const following = searchable.slice(match.index + match[0].length);
    if (!ELECTRICAL_TARGET.test(following)) return true;
  }
  return false;
}
