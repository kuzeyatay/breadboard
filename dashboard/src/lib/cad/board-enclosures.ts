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

import type { CadDesignFallback } from "./design-service.ts";
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

/** Classify shape/function before writing a CAD prompt or choosing a fallback. */
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
    if (!componentRecords.some((record) => identifiers.some((id) => record.includes(id)))) {
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

/**
 * A known-good, editable *simple enclosure* when the model call fails.
 *
 * This is intentionally a real CadQuery program rather than a fake preview:
 * it goes through the same isolated OpenCascade build, validation and export
 * pipeline as model-written CAD. It is intentionally unavailable for mounts,
 * mechanisms, wearables and optomechanical products: substituting a box for an
 * unsupported product is worse than reporting that the design is incomplete.
 */
export function enclosureFallbackFromDesign(
  input: EnclosureBriefInput & {
    process: "fdm" | "sla" | "sls" | "unknown";
    wallThickness: number;
    clearance: number;
    printerBed: { x: number; y: number; z: number };
  },
): CadDesignFallback | null {
  if (physicalDesignKind(input.userBrief) !== "simple-enclosure") return null;
  const footprint = BOARD_FOOTPRINTS[input.controllerDefinitionId];
  const boardLength = footprint?.length ?? 60;
  const boardWidth = footprint?.width ?? 35;
  const boardHeight = footprint?.height ?? 15;
  const wall = input.wallThickness;
  const clearance = input.clearance;
  const floor = wall;
  const lid = Math.max(wall, 1.2);
  const boardClearance = Math.max(clearance, 0.25);
  const extraHeight = input.prototypeType === "breadboard" ? 12 : 5;
  // Ten millimetres of margin leaves real corner space for closure bosses;
  // the former 4 mm margin could not hold a screw boss outside the PCB.
  const assemblyMargin = 10;
  const innerLength = boardLength + boardClearance * 2 + assemblyMargin;
  const innerWidth = boardWidth + boardClearance * 2 + assemblyMargin;
  const innerHeight = boardHeight + extraHeight;
  const outerLength = innerLength + wall * 2;
  const outerWidth = innerWidth + wall * 2;
  const shellHeight = innerHeight + floor;
  const serviceOpeningWidth = footprint?.connectors.length
    ? Math.min(
        innerWidth - 2,
        footprint.connectors.reduce((sum, connector) => sum + connector.width, 0) +
          Math.max(0, footprint.connectors.length - 1) * 3 +
          clearance * 2,
      )
    : 0;
  const serviceOpeningHeight = footprint?.connectors.length
    ? Math.max(...footprint.connectors.map((connector) => connector.height)) + clearance * 2
    : 0;
  const serviceOpeningCentre = footprint?.connectors.length
    ? Math.max(...footprint.connectors.map((connector) => connector.centreAboveBoard)) + floor
    : 0;
  const boardPocketHeight = 2;
  const boardPocketRail = Math.max(1.2, wall * 0.55);
  const closureScrewDiameter = 2.7;
  const closureBossDiameter = Math.max(6, closureScrewDiameter + 3);
  const closureBossInset = closureBossDiameter / 2 + 0.8;
  const title = `${input.designTitle} enclosure`;

  const parameters: Record<string, number | string | boolean> = {
    board_length: boardLength,
    board_width: boardWidth,
    board_height: boardHeight,
    wall: wall,
    clearance: boardClearance,
    assembly_margin: assemblyMargin,
    floor: floor,
    lid_thickness: lid,
    inner_height: innerHeight,
    board_pocket_height: boardPocketHeight,
    board_pocket_rail: boardPocketRail,
    closure_screw_diameter: closureScrewDiameter,
    closure_boss_diameter: closureBossDiameter,
    closure_boss_inset: closureBossInset,
    service_opening_width: serviceOpeningWidth,
    service_opening_height: serviceOpeningHeight,
    service_opening_centre: serviceOpeningCentre,
  };
  const parameter = (
    id: string,
    label: string,
    value: number | boolean,
    source: "default" | "derived",
    description: string,
  ) => ({
    id,
    label,
    value,
    ...(typeof value === "number" ? { unit: "mm", minimum: 0.1 } : {}),
    editable: source === "default",
    source,
    description,
  });

  const source = `import cadquery as cq

DEFAULT_PARAMS = ${JSON.stringify(parameters, null, 2).replaceAll("true", "True").replaceAll("false", "False")}

def build_model(params):
    p = dict(DEFAULT_PARAMS)
    p.update(params or {})
    wall = float(p["wall"])
    floor = float(p["floor"])
    clearance = float(p["clearance"])
    assembly_margin = float(p["assembly_margin"])
    inner_l = float(p["board_length"]) + 2.0 * clearance + assembly_margin
    inner_w = float(p["board_width"]) + 2.0 * clearance + assembly_margin
    inner_h = float(p["inner_height"])
    outer_l = inner_l + 2.0 * wall
    outer_w = inner_w + 2.0 * wall
    shell_h = inner_h + floor

    outer = cq.Workplane("XY").box(outer_l, outer_w, shell_h, centered=(True, True, False))
    cavity = cq.Workplane("XY").box(inner_l, inner_w, inner_h + wall, centered=(True, True, False)).translate((0, 0, floor))
    shell = outer.cut(cavity)

    # controller_retention: a sliding PCB pocket holds the board laterally;
    # the retained lid prevents it lifting out after assembly.
    pocket_h = float(p["board_pocket_height"])
    rail_t = float(p["board_pocket_rail"])
    board_l = float(p["board_length"])
    board_w = float(p["board_width"])
    rail_y = board_w / 2.0 + clearance + rail_t / 2.0
    rail_l = board_l + 2.0 * clearance
    left_rail = cq.Workplane("XY").box(rail_l, rail_t, pocket_h, centered=(True, True, False)).translate((0, -rail_y, floor))
    right_rail = cq.Workplane("XY").box(rail_l, rail_t, pocket_h, centered=(True, True, False)).translate((0, rail_y, floor))
    rear_stop = cq.Workplane("XY").box(rail_t, board_w + 2.0 * clearance + 2.0 * rail_t, pocket_h, centered=(True, True, False)).translate((rail_l / 2.0, 0, floor))
    shell = shell.union(left_rail).union(right_rail).union(rear_stop)

    # closure_retention: four screw bosses in the enclosure corners, outside
    # the PCB pocket. The lid has matching clearance holes below.
    screw_d = float(p["closure_screw_diameter"])
    boss_d = float(p["closure_boss_diameter"])
    boss_inset = float(p["closure_boss_inset"])
    boss_points = [
        (-inner_l / 2.0 + boss_inset, -inner_w / 2.0 + boss_inset),
        (-inner_l / 2.0 + boss_inset, inner_w / 2.0 - boss_inset),
        (inner_l / 2.0 - boss_inset, -inner_w / 2.0 + boss_inset),
        (inner_l / 2.0 - boss_inset, inner_w / 2.0 - boss_inset),
    ]
    for bx, by in boss_points:
        boss = cq.Workplane("XY").center(bx, by).circle(boss_d / 2.0).extrude(shell_h)
        bore = cq.Workplane("XY").center(bx, by).circle(screw_d / 2.0).extrude(shell_h + wall)
        shell = shell.union(boss).cut(bore)

    opening_w = float(p["service_opening_width"])
    opening_h = float(p["service_opening_height"])
    if opening_w > 0.0 and opening_h > 0.0:
        cutter = cq.Workplane("XY").box(3.0 * wall, opening_w, opening_h, centered=(True, True, True)).translate((-outer_l / 2.0, 0, float(p["service_opening_centre"])))
        shell = shell.cut(cutter)

    lid_t = float(p["lid_thickness"])
    lid = cq.Workplane("XY").box(outer_l, outer_w, lid_t, centered=(True, True, False)).translate((0, 0, shell_h + 0.05))
    for bx, by in boss_points:
        lid_bore = cq.Workplane("XY").center(bx, by).circle(screw_d / 2.0 + 0.15).extrude(lid_t + 1.0).translate((0, 0, shell_h))
        lid = lid.cut(lid_bore)
    return {"shell": shell, "lid": lid}
`;

  return {
    name: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120),
    units: "mm",
    parameters,
    source,
    note: `Deterministic fallback for: ${input.userBrief}`.slice(0, 2_000),
    designSpec: {
      name: title,
      description:
        `A parametric two-part enclosure sized around the ${input.controllerName}.`,
      units: "mm",
      manufacturingProcess: input.process,
      parameters: [
        parameter("board_length", "Board length", boardLength, "derived", "Measured controller PCB length."),
        parameter("board_width", "Board width", boardWidth, "derived", "Measured controller PCB width."),
        parameter("board_height", "Board height", boardHeight, "derived", "Measured maximum controller height."),
        parameter("wall", "Wall thickness", wall, "default", "Manufacturing-process wall default."),
        parameter("clearance", "Board clearance", boardClearance, "default", "Clearance around each board edge."),
        parameter("assembly_margin", "Assembly margin", assemblyMargin, "derived", "Total extra length and width reserved outside the controller for retention and closure features."),
        parameter("floor", "Floor thickness", floor, "derived", "Matches the wall thickness."),
        parameter("lid_thickness", "Lid thickness", lid, "default", "Removable top plate thickness."),
        parameter("inner_height", "Internal height", innerHeight, "derived", "Board height plus wiring allowance."),
        parameter("board_pocket_height", "Board pocket height", boardPocketHeight, "default", "Height of the PCB guide rails and rear stop."),
        parameter("board_pocket_rail", "Board pocket rail thickness", boardPocketRail, "derived", "Side-rail thickness for controller retention."),
        parameter("closure_screw_diameter", "Closure screw clearance", closureScrewDiameter, "default", "Clearance diameter for four M2.5 lid screws."),
        parameter("closure_boss_diameter", "Closure boss diameter", closureBossDiameter, "derived", "Material around each lid-screw hole."),
        parameter("closure_boss_inset", "Closure boss inset", closureBossInset, "derived", "Boss-centre offset from each internal corner."),
        parameter("service_opening_width", "Service opening width", serviceOpeningWidth, "derived", "Combined front connector access."),
        parameter("service_opening_height", "Service opening height", serviceOpeningHeight, "derived", "Tallest front connector plus clearance."),
        parameter("service_opening_centre", "Service opening centre", serviceOpeningCentre, "derived", "Opening centre above the enclosure floor."),
      ],
      components: [
        { id: "shell", name: "Electronics shell", quantity: 1, bodyRole: "primary" },
        { id: "lid", name: "Removable lid", quantity: 1, bodyRole: "lid" },
        { id: input.controllerDefinitionId || "controller", name: input.controllerName, quantity: 1, bodyRole: "reference" },
        ...input.peripherals
          .filter((peripheral) => peripheral.mechanical)
          .map((peripheral) => ({ id: peripheral.definitionId, name: peripheral.name, quantity: 1, bodyRole: "reference" as const })),
        { id: "m2_5_lid_screws", name: "M2.5 lid screws", quantity: 4, bodyRole: "reference" },
      ],
      constraints: [
        { id: "wall", type: "wall-thickness", description: "All primary walls meet the manufacturing-process default.", expected: wall, unit: "mm" },
        { id: "board_fit", type: "clearance", description: "The controller envelope has clearance on every horizontal edge.", expected: boardClearance, unit: "mm" },
        { id: "controller_retention", type: "fit", description: "Side rails, a rear stop and the installed lid retain the controller in a serviceable board pocket.", expected: boardClearance, unit: "mm" },
        { id: "closure_retention", type: "hole", description: "Four M2.5 screws through the lid engage corner bosses in the shell.", expected: closureScrewDiameter, unit: "mm" },
      ],
      assumptions: [
        ...(!footprint
          ? [{ id: "board_envelope", description: `A ${boardLength} × ${boardWidth} × ${boardHeight} mm board envelope was assumed.`, reason: "No measured footprint exists for this controller.", userEditable: true }]
          : []),
        { id: "peripheral_space", description: `${extraHeight} mm of height above the controller is reserved for wiring and peripherals.`, reason: `The build style is ${input.prototypeType}.`, userEditable: true },
      ],
      exportSettings: {
        stlLinearTolerance: 0.05,
        stlAngularTolerance: 0.2,
        generateStep: true,
        generateStl: true,
        generateGlb: true,
        generate3mf: true,
      },
      declaredBoundingBox: {
        x: outerLength,
        y: outerWidth,
        z: shellHeight + lid + 0.05,
        tolerance: Math.max(0.5, clearance),
      },
      printerBed: input.printerBed,
    },
  };
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
