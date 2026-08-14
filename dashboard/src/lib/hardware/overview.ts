// What the design actually is, in words, derived from the design alone.
//
// The overview has to answer "which part is doing what, and how is it reached"
// without rerunning the compiler — a stored blueprint is reopened straight from
// its serialised HardwareDesign. So every sentence here is read back off the
// component instances, the nets and the library definitions. Nothing is
// invented, and no pin name is written down: a pin label is always looked up
// from the definition the net connection points at.

import { componentDefinitionForDesign } from "./components/index.ts";
import { isContactOnly } from "./electrical.ts";
import { netStyle } from "./net-style.ts";
import type {
  ComponentDefinition,
  ComponentInstance,
  ElectricalNet,
  HardwareDesign,
  NetRole,
  PowerEstimate,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface OverviewGroupMeta {
  id: string;
  label: string;
  /** What this group of parts contributes to the project as a whole. */
  blurb: string;
}

const GROUP_ORDER: OverviewGroupMeta[] = [
  {
    id: "control",
    label: "Control",
    blurb: "Runs the firmware, owns every pin assignment and powers the rest of the board.",
  },
  {
    id: "sensing",
    label: "Sensing",
    blurb: "Turns something physical into a number the controller can read.",
  },
  {
    id: "input",
    label: "Input",
    blurb: "How a person tells the circuit what to do.",
  },
  {
    id: "output",
    label: "Output",
    blurb: "How the circuit shows a result or acts on the world.",
  },
  {
    id: "communication",
    label: "Communication",
    blurb: "Carries data off the board.",
  },
  {
    id: "storage",
    label: "Storage",
    blurb: "Holds data across a power cycle.",
  },
  {
    id: "power",
    label: "Power",
    blurb: "Where the energy comes from and how it reaches each part.",
  },
  {
    id: "support",
    label: "Support parts",
    blurb: "Added by the compiler so the parts above are safe to use, or to build on.",
  },
];

const GROUP_BY_CATEGORY: Record<string, string> = {
  controller: "control",
  sensor: "sensing",
  input: "input",
  display: "output",
  indicator: "output",
  actuator: "output",
  communication: "communication",
  storage: "storage",
  "power-source": "power",
  passive: "support",
  semiconductor: "support",
  interface: "support",
  prototyping: "support",
};

function groupIdFor(category: string): string {
  return GROUP_BY_CATEGORY[category] ?? "support";
}

// ---------------------------------------------------------------------------
// Per-part role
// ---------------------------------------------------------------------------

export interface PartRole {
  componentId: string;
  reference: string;
  name: string;
  value?: string;
  category: string;
  groupId: string;
  /** What this part accomplishes in this project. One sentence. */
  job: string;
  /** How the controller reaches it, in real references and pin labels. */
  link: string;
  /** Which rail feeds it. */
  supply: string;
  /** Typical draw, or an honest note when the library has no figure. */
  draw: string;
  /** I²C address, when the compiler assigned one. */
  address?: string;
  /** The compiler inserted this part; it was not asked for. */
  automatic: boolean;
  netIds: string[];
}

export interface OverviewGroup extends OverviewGroupMeta {
  parts: PartRole[];
}

export interface RailSummary {
  netId: string;
  name: string;
  voltage?: number;
  /** Typical load on this rail, when the compiler measured one. */
  typicalLoadMa?: number;
  /** References fed by the rail, controller excluded. */
  references: string[];
}

export interface BusSummary {
  netIds: string[];
  label: string;
  /** "U1 GPIO21 → U2 SDA" style endpoints. */
  links: string[];
  references: string[];
}

export interface DesignOverview {
  controller: {
    componentId: string;
    reference: string;
    name: string;
    logicVoltage?: number;
  } | null;
  groups: OverviewGroup[];
  rails: RailSummary[];
  busses: BusSummary[];
  power: {
    source: string;
    typicalMa?: number;
    maximumMa?: number;
    /** References whose draw the library does not document. */
    undocumented: string[];
  };
  cost: {
    total?: number;
    /** False when at least one line has no price, so the total is a floor. */
    complete: boolean;
  };
  counts: {
    /** Every placed item, breadboard and rails included. */
    placed: number;
    /** Lines you would actually order. */
    orderable: number;
    nets: number;
    connections: number;
    automatic: number;
  };
}

const POWERLIKE: NetRole[] = ["power", "ground"];

function pinLabelOf(definition: ComponentDefinition | null, pinId: string): string {
  return definition?.pins.find((pin) => pin.id === pinId)?.label ?? pinId;
}

/** First sentence of a description, without the trailing full stop doubled. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const stop = trimmed.indexOf(". ");
  const sentence = stop === -1 ? trimmed : trimmed.slice(0, stop + 1);
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

function busLabelFor(roles: Set<NetRole>): string | null {
  if (roles.has("i2c-sda") || roles.has("i2c-scl")) return "I²C bus";
  if (roles.has("spi-clock") || roles.has("spi-data") || roles.has("chip-select")) return "SPI bus";
  if (roles.has("uart-tx") || roles.has("uart-rx")) return "UART link";
  return null;
}

/**
 * How the controller reaches this part. Signals that do not touch the
 * controller directly — everything behind a level converter or a driver — are
 * named through the part that does sit between them, rather than pretending
 * there is a direct wire.
 */
function describeLink(input: {
  instance: ComponentInstance;
  definition: ComponentDefinition | null;
  nets: ElectricalNet[];
  controllerId: string | null;
  byId: Map<string, ComponentInstance>;
  definitionOf: (id: string) => ComponentDefinition | null;
}): string {
  const signalNets = input.nets.filter((net) => !POWERLIKE.includes(net.role));
  if (!signalNets.length) {
    const powered = input.nets.some((net) => net.role === "power");
    return powered
      ? "No signal wires — it only sits across the supply."
      : "No electrical net of its own.";
  }

  const roles = new Set(signalNets.map((net) => net.role));
  const links: string[] = [];
  for (const net of signalNets) {
    const own = net.connections.filter(
      (connection) => connection.componentId === input.instance.id,
    );
    const other =
      net.connections.find((connection) => connection.componentId === input.controllerId) ??
      net.connections.find((connection) => connection.componentId !== input.instance.id);
    const farInstance = other ? input.byId.get(other.componentId) : undefined;
    const farDefinition = farInstance ? input.definitionOf(farInstance.definitionId) : null;
    for (const connection of own) {
      const near = pinLabelOf(input.definition, connection.pinId);
      links.push(
        farInstance && other
          ? `${farInstance.reference} ${pinLabelOf(farDefinition, other.pinId)} → ${near}`
          : `${near} on ${net.name}`,
      );
    }
  }

  const bus = busLabelFor(roles);
  if (bus) return `Shares the ${bus}: ${links.join(", ")}.`;
  // "other" is the compiler's catch-all; naming it adds nothing a reader can use.
  const kind = [...new Set(
    [...roles].filter((role) => role !== "other").map((role) => netStyle(role).label.toLowerCase()),
  )];
  return kind.length ? `${links.join(", ")} (${kind.join(" and ")}).` : `${links.join(", ")}.`;
}

const POWER_SOURCE_TEXT: Record<string, string> = {
  usb: "USB",
  battery: "a battery",
  "external-supply": "an external supply",
  unknown: "USB",
};

/** What the controller itself does: which rails it sources, which nets it drives. */
function describeControllerLink(nets: ElectricalNet[]): string {
  const rails = nets.filter((net) => net.role === "power").map((net) => net.name);
  const signals = nets.filter((net) => !POWERLIKE.includes(net.role)).map((net) => net.name);
  const shown = signals.slice(0, 4).join(", ");
  const rest = signals.length - 4;
  const drives = signals.length
    ? `drives ${shown}${rest > 0 ? ` and ${rest} more` : ""}`
    : "drives no signal net";
  return rails.length ? `Sources ${rails.join(" and ")}; ${drives}.` : `${drives[0].toUpperCase()}${drives.slice(1)}.`;
}

function describeSupply(nets: ElectricalNet[]): string {
  const rails = nets.filter((net) => net.role === "power");
  const grounded = nets.some((net) => net.role === "ground");
  if (!rails.length) {
    return grounded ? "Ground only — it takes no supply of its own." : "No supply connection.";
  }
  const named = rails
    .map((net) => (net.nominalVoltage === undefined ? net.name : `${net.name} (${net.nominalVoltage} V)`))
    .join(" and ");
  return grounded ? `${named}, returning through ground.` : `${named}.`;
}

/**
 * Order matters here. A resistor and a diode both have nothing but passive
 * pins, so the contact-only test would claim their figures are contact
 * ratings — true of a switch, wrong of either of those.
 */
function describeDraw(definition: ComponentDefinition | null): string {
  if (!definition) return "Draw unknown — the part is not in the library.";
  if (definition.category === "prototyping") {
    return "Not a load; it carries current rather than consuming it.";
  }
  if (definition.rules.requiresCurrentLimiting) {
    return "Draw is set by its series resistor, not by a datasheet figure.";
  }
  if (definition.category === "passive") {
    return "Its draw follows the voltage across it, not a datasheet figure.";
  }
  if (definition.category === "semiconductor") {
    return "Passes the load current; its own draw is negligible.";
  }
  if (isContactOnly(definition)) return "No continuous draw; its rating is a contact rating.";
  const typical = definition.electrical.typicalCurrentMa;
  if (typical === undefined) return "Draw is not documented in the library.";
  const maximum = definition.electrical.maximumCurrentMa;
  return maximum !== undefined && maximum !== typical
    ? `${typical} mA typical, up to ${maximum} mA.`
    : `${typical} mA typical.`;
}

/**
 * Fall back to the figures embedded in the summary for designs stored before
 * the compiler carried its estimate forward. A missing figure stays missing
 * rather than being guessed at.
 */
function readLegacyEstimate(design: HardwareDesign): Pick<
  PowerEstimate,
  "totalTypicalMa" | "totalMaximumMa"
> | null {
  const power = design.decisions.find((decision) => decision.category === "Power");
  const both = power ? /about ([\d.]+) mA typical and ([\d.]+) mA worst case/.exec(power.rationale) : null;
  if (both) {
    return { totalTypicalMa: Number(both[1]), totalMaximumMa: Number(both[2]) };
  }
  const typical = /about ([\d.]+) mA typical/.exec(design.summary);
  if (typical) {
    const value = Number(typical[1]);
    return { totalTypicalMa: value, totalMaximumMa: value };
  }
  return null;
}

export function designOverview(design: HardwareDesign): DesignOverview {
  const definitionOf = (id: string) => componentDefinitionForDesign(design, id);
  const byId = new Map(design.components.map((instance) => [instance.id, instance]));
  const netsByComponent = new Map<string, ElectricalNet[]>();
  let connections = 0;
  for (const net of design.nets) {
    for (const connection of net.connections) {
      connections += 1;
      const list = netsByComponent.get(connection.componentId) ?? [];
      if (!list.includes(net)) list.push(net);
      netsByComponent.set(connection.componentId, list);
    }
  }

  const controllerInstance =
    design.components.find(
      (instance) => definitionOf(instance.definitionId)?.category === "controller",
    ) ?? null;
  const controllerDefinition = controllerInstance
    ? definitionOf(controllerInstance.definitionId)
    : null;

  const parts: PartRole[] = design.components.map((instance) => {
    const definition = definitionOf(instance.definitionId);
    const nets = netsByComponent.get(instance.id) ?? [];
    const category = definition?.category ?? "support";
    const isController = instance.id === controllerInstance?.id;
    const bomLine = design.bom.find(
      (item) => item.componentDefinitionId === instance.definitionId,
    );
    // The compiler's reason for inserting a part *is* that part's job, and it
    // is written to be read whole — trimming it to a sentence loses the point
    // ("M1 is inductive." on its own explains nothing). A library description
    // is prose about the part in general, so there the first sentence is what
    // belongs in a card.
    const job = instance.additionReason
      ? instance.additionReason
      : definition
        ? firstSentence(definition.description)
        : firstSentence(bomLine?.purpose ?? "Not described in the component library.");

    return {
      componentId: instance.id,
      reference: instance.reference,
      name: instance.name,
      ...(instance.value ? { value: instance.value } : {}),
      category,
      groupId: groupIdFor(category),
      job,
      link: isController
        ? describeControllerLink(nets)
        : describeLink({
            instance,
            definition,
            nets,
            controllerId: controllerInstance?.id ?? null,
            byId,
            definitionOf,
          }),
      supply: isController
        ? `Fed from ${POWER_SOURCE_TEXT[design.request.power.source] ?? design.request.power.source}.`
        : describeSupply(nets),
      draw: describeDraw(definition),
      ...(typeof instance.properties.i2cAddress === "string"
        ? { address: instance.properties.i2cAddress }
        : {}),
      automatic: Boolean(instance.automaticallyAdded),
      netIds: nets.map((net) => net.id),
    } satisfies PartRole;
  });

  const groups: OverviewGroup[] = GROUP_ORDER.map((meta) => ({
    ...meta,
    parts: parts.filter((part) => part.groupId === meta.id),
  })).filter((group) => group.parts.length > 0);

  const estimate = design.powerEstimate ?? null;
  const legacy = estimate ? null : readLegacyEstimate(design);

  const rails: RailSummary[] = design.nets
    .filter((net) => net.role === "power")
    .map((net) => {
      const load = estimate?.perRailTypicalMa[net.id];
      return {
        netId: net.id,
        name: net.name,
        ...(net.nominalVoltage === undefined ? {} : { voltage: net.nominalVoltage }),
        ...(load === undefined ? {} : { typicalLoadMa: Math.round(load * 10) / 10 }),
        references: net.connections
          .map((connection) => byId.get(connection.componentId))
          .filter(
            (instance): instance is ComponentInstance =>
              Boolean(instance) && instance!.id !== controllerInstance?.id,
          )
          .map((instance) => instance.reference)
          .filter((reference, index, list) => list.indexOf(reference) === index),
      } satisfies RailSummary;
    });

  const busGroups = new Map<string, ElectricalNet[]>();
  for (const net of design.nets) {
    const label = busLabelFor(new Set([net.role]));
    if (!label) continue;
    busGroups.set(label, [...(busGroups.get(label) ?? []), net]);
  }
  const busses: BusSummary[] = [...busGroups].map(([label, nets]) => {
    const references = new Set<string>();
    const links: string[] = [];
    for (const net of nets) {
      const endpoints = net.connections
        .map((connection) => {
          const instance = byId.get(connection.componentId);
          if (!instance) return null;
          references.add(instance.reference);
          const definition = definitionOf(instance.definitionId);
          return `${instance.reference} ${pinLabelOf(definition, connection.pinId)}`;
        })
        .filter((entry): entry is string => Boolean(entry));
      if (endpoints.length) links.push(`${net.name}: ${endpoints.join(" · ")}`);
    }
    return {
      label,
      netIds: nets.map((net) => net.id),
      links,
      references: [...references].filter((reference) => reference !== controllerInstance?.reference),
    } satisfies BusSummary;
  });

  const priced = design.bom.filter((item) => item.estimatedTotalPrice !== undefined);
  const total = priced.reduce((sum, item) => sum + (item.estimatedTotalPrice ?? 0), 0);

  const undocumented = (estimate?.unknownComponentIds ?? [])
    .map((id) => byId.get(id)?.reference)
    .filter((reference): reference is string => Boolean(reference));

  return {
    controller: controllerInstance
      ? {
          componentId: controllerInstance.id,
          reference: controllerInstance.reference,
          name: controllerInstance.name,
          ...(controllerDefinition?.electrical.logicVoltage === undefined
            ? {}
            : { logicVoltage: controllerDefinition.electrical.logicVoltage }),
        }
      : null,
    groups,
    rails,
    busses,
    power: {
      source: design.request.power.source === "unknown" ? "usb" : design.request.power.source,
      ...(estimate
        ? { typicalMa: estimate.totalTypicalMa, maximumMa: estimate.totalMaximumMa }
        : legacy
          ? { typicalMa: legacy.totalTypicalMa, maximumMa: legacy.totalMaximumMa }
          : {}),
      undocumented,
    },
    cost: {
      ...(priced.length ? { total: Math.round(total * 100) / 100 } : {}),
      complete: priced.length === design.bom.length,
    },
    counts: {
      placed: design.components.length,
      orderable: design.bom.length,
      nets: design.nets.length,
      connections,
      automatic: design.components.filter((instance) => instance.automaticallyAdded).length,
    },
  };
}
