// The deterministic circuit compiler.
//
// It takes a validated HardwareProjectRequest plus resolved library parts and
// produces components and nets. No language model participates: every pin,
// every net, every automatically inserted support part and every recorded
// reason is decided by the code below.

import { boardVolumeMm3, describeBoardFootprint } from "../cad/board-enclosures.ts";
import { componentDefinition, controllerProfile, isController } from "./components/index.ts";
import { isContactOnly, ledDriveCurrentMa, levelShiftDecision } from "./electrical.ts";
import { requestSizeConstraint } from "./form-factor.ts";
import { PinAllocator, pinConstantName, type PinAssignment } from "./pin-allocator.ts";
import {
  controllerFootprint,
  resolveComponentPhrase,
  resolveController,
  selectController,
  smallestWearableController,
  type ResolvedPeripheral,
} from "./resolver.ts";
import type {
  ComponentDefinition,
  ComponentInstance,
  ControllerProfile,
  DesignDecision,
  ElectricalNet,
  HardwareProjectRequest,
  NetRole,
} from "./types.ts";

export interface CompilerNote {
  rule: string;
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  componentIds: string[];
  netIds: string[];
  remediation?: string;
}

export type PeripheralInterfaceKind =
  | "i2c"
  | "spi"
  | "uart"
  | "digital"
  | "analog"
  | "pwm"
  | "passive"
  | "none";

export interface PeripheralSignal {
  /**
   * The peripheral pin this controller pin serves. For a load switched by a
   * driver stage this is `DRIVER_GATE_PIN_ID`, the control point the compiler
   * created rather than a pin printed on the part.
   */
  peripheralPinId: string;
  assignment: PinAssignment;
  /** The signal crosses a voltage domain through a level converter. */
  viaLevelShifter?: boolean;
  /** The controller switches this load through a driver, not directly. */
  viaDriver?: boolean;
}

export interface PeripheralPlacement {
  instance: ComponentInstance;
  definition: ComponentDefinition;
  interfaceKind: PeripheralInterfaceKind;
  signalPins: PeripheralSignal[];
  supplyNetId: string | null;
  supplyVoltage: number | null;
  i2cAddress?: string;
}

export interface CurrentEstimate {
  /** Sum of documented loads; a lower bound when unknownComponentIds is non-empty. */
  totalTypicalMa: number;
  /** Documented worst-case loads; a lower bound when unknownComponentIds is non-empty. */
  totalMaximumMa: number;
  /** Per-rail typical load, keyed by net id. */
  perRailTypicalMa: Record<string, number>;
  /** Active parts whose draw is undocumented or cannot be assigned to a supply rail. */
  unknownComponentIds: string[];
}

export interface CompiledCircuit {
  controllerInstance: ComponentInstance;
  controllerDefinition: ComponentDefinition;
  profile: ControllerProfile;
  components: ComponentInstance[];
  nets: ElectricalNet[];
  decisions: DesignDecision[];
  notes: CompilerNote[];
  assignments: PinAssignment[];
  peripherals: PeripheralPlacement[];
  groundNetId: string;
  railNetIdByVoltage: Record<string, string>;
  currentEstimate: CurrentEstimate;
  /** Source-backed definitions available only to this blueprint. */
  scopedDefinitions: readonly ComponentDefinition[];
}

const REFERENCE_PREFIXES: Record<string, string> = {
  controller: "U",
  sensor: "U",
  display: "U",
  interface: "U",
  storage: "U",
  communication: "U",
  "power-source": "BT",
  indicator: "D",
  semiconductor: "D",
  passive: "R",
  input: "SW",
  actuator: "M",
  prototyping: "BB",
};

/** Conventional designators that do not follow from the category alone. */
const REFERENCE_PREFIX_BY_DEFINITION: Record<string, string> = {
  capacitor: "C",
  "relay-module-5v": "K",
  potentiometer: "RV",
  "mosfet-logic-level": "Q",
};

/** Gate pull-down for a low-side switch. Holds the load off through a reset. */
const GATE_PULLDOWN_VALUE = "100 kΩ";

/** Pin ids the compiler creates for a driver stage rather than reading off a part. */
export const DRIVER_GATE_PIN_ID = "GATE";

interface SupportPart {
  definitionId: string;
  reference: string;
  value: string;
  reason: string;
  connections: Array<{ pinId: string; netId: string }>;
}

/** One level converter board and how many of its four channels are spoken for. */
interface ShifterEntry {
  support: SupportPart;
  reference: string;
  lowVoltage: number;
  highVoltage: number;
  channelsUsed: number;
}

/** LED series resistor by supply rail. Both are safe, common shop values. */
const LED_RESISTOR_BY_VOLTAGE: Array<{ voltage: number; value: string }> = [
  { voltage: 5, value: "330 Ω" },
  { voltage: 3.3, value: "220 Ω" },
];

class NetBuilder {
  private readonly nets = new Map<string, ElectricalNet>();

  ensure(id: string, name: string, role: NetRole, nominalVoltage?: number): ElectricalNet {
    const existing = this.nets.get(id);
    if (existing) return existing;
    const net: ElectricalNet = {
      id,
      name,
      role,
      ...(nominalVoltage === undefined ? {} : { nominalVoltage }),
      connections: [],
    };
    this.nets.set(id, net);
    return net;
  }

  connect(netId: string, componentId: string, pinId: string): void {
    const net = this.nets.get(netId);
    if (!net) return;
    if (
      net.connections.some(
        (connection) => connection.componentId === componentId && connection.pinId === pinId,
      )
    ) {
      return;
    }
    net.connections.push({ componentId, pinId });
  }

  get(netId: string): ElectricalNet | null {
    return this.nets.get(netId) ?? null;
  }

  list(): ElectricalNet[] {
    return [...this.nets.values()];
  }
}

function railNetId(voltage: number): string {
  return `net_${String(voltage).replace(".", "v").replace(/[^0-9a-z]/gi, "")}`;
}

function railNetName(voltage: number): string {
  return `+${voltage}V`;
}

export interface CompileInput {
  request: HardwareProjectRequest;
  /** Peripherals already resolved by ../hardware/resolver.ts, in request order. */
  resolved: ResolvedPeripheral[];
  scopedDefinitions?: readonly ComponentDefinition[];
}

export function compileCircuit(input: CompileInput): CompiledCircuit {
  const scopedDefinitions = input.scopedDefinitions ?? [];
  const notes: CompilerNote[] = [];
  const decisions: DesignDecision[] = [];
  const nets = new NetBuilder();
  const components: ComponentInstance[] = [];
  const references = new Map<string, number>();
  // Declared up here because power sourcing runs before the peripheral loop and
  // creates instances and support parts of its own.
  const supportParts: SupportPart[] = [];
  /** Why a library part the compiler considered was left out, keyed by its id. */
  const omissionReasons = new Map<string, string>();
  /**
   * Set once a cell is actually fitted, which is what makes USB-only rails
   * unusable. A battery that was asked for but did not fit leaves the design
   * drawn for USB, where those rails are live again.
   */
  let batteryFitted = false;
  let instanceCounter = 0;

  const nextReference = (category: string, definitionId?: string): string => {
    const prefix =
      (definitionId ? REFERENCE_PREFIX_BY_DEFINITION[definitionId] : undefined) ??
      REFERENCE_PREFIXES[category] ??
      "U";
    const next = (references.get(prefix) ?? 0) + 1;
    references.set(prefix, next);
    return `${prefix}${next}`;
  };

  // ---- peripherals ---------------------------------------------------------
  const usable = input.resolved.filter((entry) => entry.outcome.status === "resolved");
  for (const entry of input.resolved) {
    if (entry.outcome.status === "ambiguous") {
      notes.push({
        rule: "UNSUPPORTED_COMPONENT",
        severity: "error",
        title: `"${entry.requested.type}" matches more than one part`,
        message: `The phrase "${entry.requested.type}" matches ${entry.outcome.candidates
          .map((candidate) => candidate.name)
          .join(", ")}. It was left out rather than guessed.`,
        componentIds: [],
        netIds: [],
        remediation: `Name the part exactly, for example "${entry.outcome.candidates[0].name}".`,
      });
    }
    if (entry.outcome.status === "unsupported") {
      notes.push({
        rule: "UNSUPPORTED_COMPONENT",
        severity: "error",
        title: `"${entry.requested.type}" is not in the component library`,
        message: `No part in the library matches "${entry.requested.type}", so it could not be wired or validated.`,
        componentIds: [],
        netIds: [],
        remediation:
          "Choose a supported part, or treat this blueprint as a starting point and add the part by hand.",
      });
    }
  }

  const peripheralDefinitions = usable.flatMap((entry) =>
    entry.outcome.status === "resolved" && !isController(entry.outcome.definition.id)
      ? [entry.outcome.definition]
      : [],
  );

  // ---- controller ----------------------------------------------------------
  // How big the finished thing is allowed to be is part of choosing the board,
  // and it is read from the request rather than inferred from the parts: no
  // combination of sensors says "this hangs off a pair of glasses".
  const sizeConstraint = requestSizeConstraint(input.request);
  let controllerWasNamed = false;
  const requestedController = resolveController(input.request.controller, scopedDefinitions);
  let controllerDefinition: ComponentDefinition;
  if (requestedController?.status === "resolved") {
    controllerWasNamed = true;
    controllerDefinition = requestedController.definition;
    decisions.push({
      category: "Controller",
      selection: controllerDefinition.name,
      rationale: "The board was named in the request, so it was kept exactly as asked.",
    });
  } else {
    if (requestedController) {
      notes.push({
        rule: "UNSUPPORTED_COMPONENT",
        severity: "warning",
        title: `"${input.request.controller}" is not a supported board`,
        message: `The requested board "${input.request.controller}" is not in the component library, so a supported board was chosen instead.`,
        componentIds: [],
        netIds: [],
        remediation: "Ask for an Arduino Uno, an ESP32 DevKit, or a Raspberry Pi Pico.",
      });
    }
    // A controller named among the peripherals still counts as an explicit ask.
    const inlineController = usable.find(
      (entry) => entry.outcome.status === "resolved" && isController(entry.outcome.definition.id),
    );
    if (inlineController && inlineController.outcome.status === "resolved") {
      controllerWasNamed = true;
      controllerDefinition = inlineController.outcome.definition;
      decisions.push({
        category: "Controller",
        selection: controllerDefinition.name,
        rationale: "The board was named in the request, so it was kept exactly as asked.",
      });
    } else {
      const selected = selectController({
        peripherals: peripheralDefinitions,
        communication: input.request.communication,
        beginnerFriendly: input.request.constraints.beginnerFriendly,
        sizeConstrained: sizeConstraint.constrained,
        sizeEvidence: sizeConstraint.evidence,
      });
      controllerDefinition = selected.definition;
      decisions.push({
        category: "Controller",
        selection: controllerDefinition.name,
        rationale: selected.rationale,
      });
    }
  }

  // A board the size rules would not have picked is worth saying out loud. It
  // is never overridden — a named board is kept exactly as asked — but the
  // person who asks for a wearable Uno should hear how big an Uno is. A note,
  // not a warning: the circuit is sound, and only its physical suitability is
  // in question, so this must not turn a buildable design into one that reads
  // as needing attention.
  if (sizeConstraint.constrained) {
    const chosen = controllerFootprint(controllerDefinition.id);
    const compact = smallestWearableController();
    if (
      compact &&
      compact.definition.id !== controllerDefinition.id &&
      chosen &&
      boardVolumeMm3(chosen) > boardVolumeMm3(compact.footprint)
    ) {
      notes.push({
        rule: "FORM_FACTOR_MISMATCH",
        severity: "info",
        title: `${controllerDefinition.name} is large for something ${sizeConstraint.evidence ? `described as ${sizeConstraint.evidence}` : "worn or carried"}`,
        message: `${controllerDefinition.name} measures ${describeBoardFootprint(
          chosen,
        )}. ${compact.definition.name} does the same job in ${describeBoardFootprint(
          compact.footprint,
        )}${
          controllerWasNamed
            ? ", and the named board was kept because it was asked for by name."
            : ", but it was ruled out by another requirement above."
        }`,
        componentIds: ["cmp_controller"],
        netIds: [],
        remediation: `Ask for a ${compact.definition.name} if the size matters more than the reason this board was chosen.`,
      });
    }
  }

  const profile = controllerProfile(controllerDefinition.id)!;
  const allocator = new PinAllocator(controllerDefinition, profile);

  const controllerInstance: ComponentInstance = {
    id: "cmp_controller",
    definitionId: controllerDefinition.id,
    reference: nextReference("controller"),
    name: controllerDefinition.name,
    quantity: 1,
    properties: {
      logicVoltage: profile.logicVoltage,
      framework: profile.firmware.framework,
    },
  };
  components.push(controllerInstance);

  // ---- power and ground ----------------------------------------------------
  const groundNet = nets.ensure("net_gnd", "GND", "ground", 0);
  for (const groundPinId of profile.groundPinIds.slice(0, 1)) {
    nets.connect(groundNet.id, controllerInstance.id, groundPinId);
    allocator.reserve({
      controllerPinId: groundPinId,
      purpose: "ground",
      componentId: null,
      netId: groundNet.id,
    });
  }

  const railNetIdByVoltage: Record<string, string> = {};
  const railInUse = new Set<number>();

  const ensureRail = (voltage: number): string => {
    const id = railNetId(voltage);
    const rail = profile.rails.find((candidate) => candidate.voltage === voltage);
    nets.ensure(id, railNetName(voltage), "power", voltage);
    if (rail && !railInUse.has(voltage)) {
      nets.connect(id, controllerInstance.id, rail.pinId);
      allocator.reserve({
        controllerPinId: rail.pinId,
        purpose: "power",
        componentId: null,
        netId: id,
      });
    }
    railInUse.add(voltage);
    railNetIdByVoltage[String(voltage)] = id;
    return id;
  };

  /** Pick the rail a part should sit on, honouring its documented window. */
  const chooseRail = (
    definition: ComponentDefinition,
  ): { voltage: number; netId: string; withinRange: boolean } => {
    const minimum = definition.electrical.minimumSupplyVoltage;
    const maximum = definition.electrical.maximumSupplyVoltage;
    const typical = definition.electrical.typicalSupplyVoltage;
    // A rail that only exists while a USB cable is attached cannot feed a part
    // in a build that runs from a cell. Excluded before the voltage window is
    // considered, because a part on a dead rail is not a lesser fit — it is a
    // circuit that stops working the moment the cable comes out.
    const usableRails = batteryFitted
      ? profile.rails.filter((rail) => !rail.usbOnly)
      : profile.rails;
    const searchable = usableRails.length ? usableRails : profile.rails;
    const candidates = searchable.filter(
      (rail) =>
        (minimum === undefined || rail.voltage >= minimum) &&
        (maximum === undefined || rail.voltage <= maximum),
    );
    // A part whose logic level follows its own supply belongs on the rail the
    // controller's logic sits on, when that is allowed. Putting it anywhere else
    // buys a level shifter for no reason.
    const followsSupply =
      definition.electrical.logicVoltage === undefined &&
      definition.pins.some((pin) =>
        ["digital-input", "digital-output", "digital-io", "open-drain"].includes(
          pin.electricalType,
        ),
      );
    if (followsSupply) {
      const matched = candidates.find((rail) => rail.voltage === profile.logicVoltage);
      if (matched) {
        return {
          voltage: matched.voltage,
          netId: ensureRail(matched.voltage),
          withinRange: true,
        };
      }
    }
    if (candidates.length) {
      const best = candidates.reduce((left, right) =>
        Math.abs(right.voltage - (typical ?? left.voltage)) <
        Math.abs(left.voltage - (typical ?? left.voltage))
          ? right
          : left,
      );
      return { voltage: best.voltage, netId: ensureRail(best.voltage), withinRange: true };
    }
    // Nothing fits: still place it on the closest rail the supply actually
    // powers, so the design is drawable and the validator can explain exactly
    // why it is wrong — a voltage the part dislikes beats a rail that is off.
    const fallback = searchable.reduce((left, right) =>
      Math.abs(right.voltage - (typical ?? 5)) < Math.abs(left.voltage - (typical ?? 5))
        ? right
        : left,
    );
    return { voltage: fallback.voltage, netId: ensureRail(fallback.voltage), withinRange: false };
  };

  // ---- battery power -------------------------------------------------------
  // A portable build needs something feeding the board's input pin, and a
  // switch in that line so it can be turned off without unplugging a cell.
  // Only a battery whose voltage the board's own input accepts is fitted;
  // otherwise the run says so rather than shipping a design that browns out.
  const supplyInputPin = controllerDefinition.pins.find((candidate) =>
    candidate.functions.includes("supply-vin"),
  );
  if (input.request.power.source === "battery" && supplyInputPin) {
    const minimum = controllerDefinition.electrical.minimumSupplyVoltage;
    const maximum = controllerDefinition.electrical.maximumSupplyVoltage ?? supplyInputPin.maximumVoltage;
    const requestedPower = input.request.power.part
      ? resolveComponentPhrase(input.request.power.part, scopedDefinitions)
      : null;
    const requestedDefinition =
      requestedPower?.status === "resolved" ? requestedPower.definition : null;
    const candidateIds = [
      ...(requestedDefinition ? [requestedDefinition.id] : []),
      "lipo-battery-1200mah",
      "battery-holder-4aa",
    ].filter((id, index, ids) => ids.indexOf(id) === index);
    const candidates = candidateIds
      .map((id) => componentDefinition(id, scopedDefinitions))
      .filter((candidate): candidate is ComponentDefinition => Boolean(candidate))
      .filter((candidate) => {
        const voltage = candidate.electrical.typicalSupplyVoltage ?? 0;
        const hasCellOutput = candidate.pins.some(
          (pin) =>
            pin.electricalType === "power-output" && pin.functions.includes("supply-battery"),
        );
        const hasGround = candidate.pins.some((pin) => pin.electricalType === "ground");
        const isCell =
          candidate.category === "power-source" &&
          hasCellOutput &&
          hasGround &&
          !candidate.pins.some((pin) => pin.electricalType === "power-input");
        return (
          isCell &&
          (minimum === undefined || voltage >= minimum) &&
          (maximum === undefined || voltage <= maximum)
        );
      });
    const battery = candidates[0];
    if (!battery) {
      // Recorded so that, if one of these cells was also named as a preferred
      // part, the report can say why it is missing instead of just that it is.
      for (const id of ["lipo-battery-1200mah", "battery-holder-4aa"]) {
        omissionReasons.set(
          id,
          `its voltage is outside ${controllerDefinition.name}'s ${supplyInputPin.label} input range`,
        );
      }
      notes.push({
        rule: "UNSUPPORTED_COMPONENT",
        severity: "warning",
        title: "No battery in the library matches this board's input",
        message: `${controllerDefinition.name} wants ${minimum ?? "?"}–${
          maximum ?? "?"
        } V on ${supplyInputPin.label}, and neither the 3.7 V lithium cell nor the 6 V AA pack falls inside that. The design is drawn for USB power.`,
        componentIds: [controllerInstance.id],
        netIds: [],
        remediation:
          "Power it over USB, use a 9 V supply on the barrel jack, or choose a board that runs from a single cell such as the Raspberry Pi Pico.",
      });
    } else {
      batteryFitted = true;
      const voltage = battery.electrical.typicalSupplyVoltage!;
      const batteryPositivePin = battery.pins.find(
        (pin) =>
          pin.electricalType === "power-output" && pin.functions.includes("supply-battery"),
      )!;
      const batteryGroundPin = battery.pins.find((pin) => pin.electricalType === "ground")!;
      const batteryReference = nextReference(battery.category, battery.id);
      const switchReference = nextReference("input", "slide-switch");
      const cellNetId = "net_vbat_cell";
      const switchedNetId = "net_vbat";
      nets.ensure(cellNetId, "VBAT_CELL", "power", voltage);
      nets.ensure(switchedNetId, "VBAT", "power", voltage);

      instanceCounter += 1;
      const batteryId = `cmp_${instanceCounter}`;
      components.push({
        id: batteryId,
        definitionId: battery.id,
        reference: batteryReference,
        name: battery.name,
        quantity: 1,
        properties: { railVoltage: voltage },
        automaticallyAdded: true,
        additionReason: `The project is battery powered, and ${voltage} V suits ${controllerDefinition.name}'s ${supplyInputPin.label} input.`,
      });
      nets.connect(cellNetId, batteryId, batteryPositivePin.id);
      nets.connect(groundNet.id, batteryId, batteryGroundPin.id);

      supportParts.push({
        definitionId: "slide-switch",
        reference: switchReference,
        value: "",
        reason: `${switchReference} breaks the battery line so the project can be switched off without disconnecting a cell.`,
        connections: [
          { pinId: "1", netId: cellNetId },
          { pinId: "2", netId: switchedNetId },
        ],
      });

      nets.connect(switchedNetId, controllerInstance.id, supplyInputPin.id);
      allocator.reserve({
        controllerPinId: supplyInputPin.id,
        purpose: "power",
        componentId: batteryId,
        netId: switchedNetId,
      });
      decisions.push({
        category: "Power",
        selection: `${batteryReference} ${battery.name} through ${switchReference}`,
        rationale: `${voltage} V is inside ${controllerDefinition.name}'s ${supplyInputPin.label} range, so the board's own regulator makes the rails from it.`,
      });
    }
  }

  // ---- prototyping hardware -----------------------------------------------
  if (input.request.prototypeType === "breadboard") {
    const board = componentDefinition("breadboard-830")!;
    components.push({
      id: "cmp_breadboard",
      definitionId: board.id,
      reference: nextReference("prototyping"),
      name: board.name,
      quantity: 1,
      properties: {},
      automaticallyAdded: true,
      additionReason: "A breadboard build needs a board to hold the parts and distribute power.",
    });
  }

  // ---- i2c bus -------------------------------------------------------------
  const i2cDevices = usable.filter(
    (entry) =>
      entry.outcome.status === "resolved" &&
      !isController(entry.outcome.definition.id) &&
      entry.outcome.definition.interfaces.includes("i2c") &&
      entry.outcome.definition.pins.some((pin) => pin.functions.includes("i2c-sda")),
  );

  let sdaNetId: string | null = null;
  let sclNetId: string | null = null;
  if (i2cDevices.length) {
    if (!profile.i2c) {
      notes.push({
        rule: "INVALID_CONTROLLER_PIN",
        severity: "error",
        title: "This board has no I²C bus the compiler can use",
        message: `${controllerDefinition.name} has no I²C pins recorded in the component library, so the I²C devices could not be wired.`,
        componentIds: [controllerInstance.id],
        netIds: [],
      });
    } else {
      sdaNetId = nets.ensure("net_i2c_sda", "I2C_SDA", "i2c-sda", profile.logicVoltage).id;
      sclNetId = nets.ensure("net_i2c_scl", "I2C_SCL", "i2c-scl", profile.logicVoltage).id;
      const sda = allocator.reserve({
        controllerPinId: profile.i2c.sdaPinId,
        purpose: "i2c-sda",
        componentId: null,
        netId: sdaNetId,
        constantName: "PIN_I2C_SDA",
      });
      const scl = allocator.reserve({
        controllerPinId: profile.i2c.sclPinId,
        purpose: "i2c-scl",
        componentId: null,
        netId: sclNetId,
        constantName: "PIN_I2C_SCL",
      });
      if (sda.ok) nets.connect(sdaNetId, controllerInstance.id, profile.i2c.sdaPinId);
      if (scl.ok) nets.connect(sclNetId, controllerInstance.id, profile.i2c.sclPinId);
      decisions.push({
        category: "I²C bus",
        selection: `${allocator.pin(profile.i2c.sdaPinId)?.label ?? profile.i2c.sdaPinId} (SDA) and ${
          allocator.pin(profile.i2c.sclPinId)?.label ?? profile.i2c.sclPinId
        } (SCL)`,
        rationale: `${i2cDevices.length} device${
          i2cDevices.length === 1 ? "" : "s"
        } share one bus on the board's hardware I²C pins.`,
      });
    }
  }

  // ---- spi bus -------------------------------------------------------------
  const spiDevices = usable.filter(
    (entry) =>
      entry.outcome.status === "resolved" &&
      !isController(entry.outcome.definition.id) &&
      entry.outcome.definition.interfaces.includes("spi") &&
      !entry.outcome.definition.interfaces.includes("i2c") &&
      entry.outcome.definition.pins.some((pin) => pin.functions.includes("spi-sck")),
  );
  let spiNets: { sck: string; mosi: string; miso: string } | null = null;
  if (spiDevices.length) {
    if (!profile.spi) {
      notes.push({
        rule: "INVALID_CONTROLLER_PIN",
        severity: "error",
        title: "This board has no hardware SPI bus the compiler can use",
        message: `${controllerDefinition.name} has no SPI pins recorded in the component library.`,
        componentIds: [controllerInstance.id],
        netIds: [],
      });
    } else {
      spiNets = {
        sck: nets.ensure("net_spi_sck", "SPI_SCK", "spi-clock", profile.logicVoltage).id,
        mosi: nets.ensure("net_spi_mosi", "SPI_MOSI", "spi-data", profile.logicVoltage).id,
        miso: nets.ensure("net_spi_miso", "SPI_MISO", "spi-data", profile.logicVoltage).id,
      };
      const busPins: Array<[string, keyof typeof spiNets, PinAssignment["purpose"], string]> = [
        [profile.spi.sckPinId, "sck", "spi-sck", "PIN_SPI_SCK"],
        [profile.spi.mosiPinId, "mosi", "spi-mosi", "PIN_SPI_MOSI"],
        [profile.spi.misoPinId, "miso", "spi-miso", "PIN_SPI_MISO"],
      ];
      for (const [pinId, key, purpose, constantName] of busPins) {
        const reserved = allocator.reserve({
          controllerPinId: pinId,
          purpose,
          componentId: null,
          netId: spiNets[key],
          constantName,
        });
        if (reserved.ok) nets.connect(spiNets[key], controllerInstance.id, pinId);
        else {
          notes.push({
            rule: "DUPLICATE_PIN_ASSIGNMENT",
            severity: "error",
            title: "The SPI bus could not take its hardware pin",
            message: reserved.reason,
            componentIds: [controllerInstance.id],
            netIds: [spiNets[key]],
          });
        }
      }
    }
  }

  // ---- peripherals ---------------------------------------------------------
  const peripherals: PeripheralPlacement[] = [];
  const takenI2cAddresses = new Set<string>();
  const hardwareUarts = [
    ...(profile.uart ? [profile.uart] : []),
    ...(profile.additionalUarts ?? []),
  ];
  let uartsUsed = 0;


  // ---- level translation ---------------------------------------------------
  const shifters: ShifterEntry[] = [];

  /**
   * Take one channel of a converter that bridges these two domains, adding a
   * board when none has a free channel. Each board's LV and HV pins are tied to
   * the two rails once, so a design needing four translated signals still buys
   * exactly one part.
   */
  const allocateShifterChannel = (
    lowVoltage: number,
    highVoltage: number,
  ): { entry: ShifterEntry; lowPin: string; highPin: string } => {
    let entry = shifters.find(
      (candidate) =>
        candidate.lowVoltage === lowVoltage &&
        candidate.highVoltage === highVoltage &&
        candidate.channelsUsed < 4,
    );
    if (!entry) {
      const definition = componentDefinition("logic-level-converter")!;
      const reference = nextReference(definition.category, definition.id);
      const support: SupportPart = {
        definitionId: definition.id,
        reference,
        value: `${lowVoltage} V ↔ ${highVoltage} V`,
        reason: `Signals cross between the ${lowVoltage} V and ${highVoltage} V domains, which neither side tolerates directly.`,
        connections: [
          { pinId: "LV", netId: ensureRail(lowVoltage) },
          { pinId: "HV", netId: ensureRail(highVoltage) },
          { pinId: "GNDL", netId: groundNet.id },
          { pinId: "GNDH", netId: groundNet.id },
        ],
      };
      supportParts.push(support);
      entry = { support, reference, lowVoltage, highVoltage, channelsUsed: 0 };
      shifters.push(entry);
      decisions.push({
        category: "Level translation",
        selection: `${reference} ${definition.name}`,
        rationale: `${lowVoltage} V and ${highVoltage} V parts share this design, so their signals pass through a converter instead of being wired together.`,
      });
    }
    entry.channelsUsed += 1;
    const channel = entry.channelsUsed;
    return { entry, lowPin: `LV${channel}`, highPin: `HV${channel}` };
  };

  /** Route one signal through a converter channel and return both net ids. */
  const routeThroughShifter = (input: {
    netIdBase: string;
    netName: string;
    role: NetRole;
    lowVoltage: number;
    highVoltage: number;
  }): { lowNetId: string; highNetId: string; reference: string } => {
    const channel = allocateShifterChannel(input.lowVoltage, input.highVoltage);
    const lowNetId = `${input.netIdBase}_lv`;
    const highNetId = `${input.netIdBase}_hv`;
    nets.ensure(lowNetId, `${input.netName}_${input.lowVoltage}V`, input.role, input.lowVoltage);
    nets.ensure(highNetId, `${input.netName}_${input.highVoltage}V`, input.role, input.highVoltage);
    channel.entry.support.connections.push(
      { pinId: channel.lowPin, netId: lowNetId },
      { pinId: channel.highPin, netId: highNetId },
    );
    return { lowNetId, highNetId, reference: channel.entry.reference };
  };

  /**
   * The bus segment for I²C devices in one non-controller voltage domain. Two
   * channels carry SDA and SCL, and every device in that domain shares them, so
   * a second 3.3 V sensor on a 5 V board costs no extra hardware.
   */
  const i2cSegments = new Map<
    string,
    { sdaNetId: string; sclNetId: string; reference: string }
  >();
  const i2cSegmentFor = (
    lowVoltage: number,
    highVoltage: number,
    deviceOnLowSide: boolean,
  ): { sdaNetId: string; sclNetId: string; reference: string } => {
    const key = `${lowVoltage}:${highVoltage}`;
    const cached = i2cSegments.get(key);
    if (cached) return cached;

    const deviceVoltage = deviceOnLowSide ? lowVoltage : highVoltage;
    const bridge = (line: "SDA" | "SCL", busNetId: string, role: NetRole) => {
      const channel = allocateShifterChannel(lowVoltage, highVoltage);
      const segmentNetId = `net_i2c_${line.toLowerCase()}_${String(deviceVoltage).replace(".", "v")}`;
      nets.ensure(segmentNetId, `I2C_${line}_${deviceVoltage}V`, role, deviceVoltage);
      channel.entry.support.connections.push(
        { pinId: deviceOnLowSide ? channel.highPin : channel.lowPin, netId: busNetId },
        { pinId: deviceOnLowSide ? channel.lowPin : channel.highPin, netId: segmentNetId },
      );
      return { netId: segmentNetId, reference: channel.entry.reference };
    };

    const sda = bridge("SDA", sdaNetId!, "i2c-sda");
    const scl = bridge("SCL", sclNetId!, "i2c-scl");
    const segment = { sdaNetId: sda.netId, sclNetId: scl.netId, reference: sda.reference };
    i2cSegments.set(key, segment);
    return segment;
  };

  for (const entry of usable) {
    if (entry.outcome.status !== "resolved") continue;
    const definition = entry.outcome.definition;
    if (isController(definition.id)) continue;

    for (let copy = 0; copy < Math.max(1, entry.requested.quantity); copy += 1) {
      instanceCounter += 1;
      const instanceId = `cmp_${instanceCounter}`;
      const reference = nextReference(definition.category, definition.id);
      const instance: ComponentInstance = {
        id: instanceId,
        definitionId: definition.id,
        reference,
        name: definition.name,
        quantity: 1,
        properties: {},
      };
      components.push(instance);

      const placement: PeripheralPlacement = {
        instance,
        definition,
        interfaceKind: "none",
        signalPins: [],
        supplyNetId: null,
        supplyVoltage: null,
      };

      // Supply and ground for anything that has power pins.
      const supplyPin = definition.pins.find((pin) => pin.electricalType === "power-input");
      const groundPins = definition.pins.filter((pin) => pin.electricalType === "ground");
      if (supplyPin) {
        const rail = chooseRail(definition);
        nets.connect(rail.netId, instanceId, supplyPin.id);
        placement.supplyNetId = rail.netId;
        placement.supplyVoltage = rail.voltage;
        instance.properties.supplyVoltage = rail.voltage;
        if (!rail.withinRange) instance.properties.supplyOutOfRange = true;
      }
      for (const groundPin of groundPins) {
        if (groundPin.functions.includes("optional")) continue;
        nets.connect(groundNet.id, instanceId, groundPin.id);
      }

      // Wiring one ordinary signal pin: allocate a controller pin, route it
      // through a converter when the domains differ, and record the assignment.
      const wireSignalPin = (pin: (typeof definition.pins)[number]): void => {
        const wantsPwm = pin.functions.includes("pwm");
        const wantsAnalog =
          pin.electricalType === "analog-output" || pin.functions.includes("analog-out");
        const kind = wantsAnalog ? "analog" : wantsPwm ? "pwm" : "digital";
        if (placement.interfaceKind === "none") {
          placement.interfaceKind = wantsAnalog ? "analog" : wantsPwm ? "pwm" : "digital";
        }
        const netId = `net_sig_${reference.toLowerCase()}_${pin.id.toLowerCase()}`;
        const role: NetRole = wantsAnalog ? "analog" : "digital";
        // None of the boards in the library are tolerant above their own
        // logic level, so the pin's ceiling is the board's logic voltage.
        const shift = levelShiftDecision({
          devicePinType: pin.electricalType,
          devicePinMaximumVoltage: pin.maximumVoltage,
          deviceLogicVoltage: definition.electrical.logicVoltage,
          deviceSupplyVoltage: placement.supplyVoltage,
          controllerLogicVoltage: profile.logicVoltage,
          controllerPinMaximumVoltage: profile.logicVoltage,
        });
        const shifted =
          shift.needed && shift.lowVoltage !== undefined && shift.highVoltage !== undefined;

        let controllerNetId = netId;
        let deviceNetId = netId;
        let shifterReference = "";
        if (shifted) {
          const routed = routeThroughShifter({
            netIdBase: netId,
            netName: `${reference}_${pin.id}`,
            role,
            lowVoltage: shift.lowVoltage!,
            highVoltage: shift.highVoltage!,
          });
          const controllerOnLowSide = profile.logicVoltage === shift.lowVoltage;
          controllerNetId = controllerOnLowSide ? routed.lowNetId : routed.highNetId;
          deviceNetId = controllerOnLowSide ? routed.highNetId : routed.lowNetId;
          shifterReference = routed.reference;
        } else {
          nets.ensure(netId, `${reference}_${pin.id}`, role, profile.logicVoltage);
        }

        const allocated = allocator.allocate(kind, {
          purpose: kind === "analog" ? "analog" : wantsPwm ? "pwm" : "digital",
          componentId: instanceId,
          peripheralPinId: pin.id,
          netId: controllerNetId,
          constantName: pinConstantName(reference, pin.id),
        });
        if (!allocated.ok) {
          notes.push({
            rule: "REQUIRED_PIN_UNCONNECTED",
            severity: "error",
            title: `${reference} ${pin.label} could not be connected`,
            message: allocated.reason,
            componentIds: [instanceId],
            netIds: [controllerNetId],
            remediation: "Remove a part, or choose a board with more pins of that kind.",
          });
          return;
        }
        nets.connect(controllerNetId, controllerInstance.id, allocated.pin.id);
        nets.connect(deviceNetId, instanceId, pin.id);
        if (shifterReference) instance.properties.levelShiftedBy = shifterReference;
        placement.signalPins.push({
          peripheralPinId: pin.id,
          assignment: allocator.assignmentFor(allocated.pin.id)!,
          ...(shifted ? { viaLevelShifter: true } : {}),
        });
      };

      /** Pins that still need a controller pin after the bus wiring is done. */
      const unwiredSignalPins = (exclude: ReadonlySet<string>) =>
        definition.pins.filter(
          (pin) =>
            !exclude.has(pin.id) &&
            !pin.functions.includes("optional") &&
            !pin.functions.includes("not-connected") &&
            pin.electricalType !== "power-input" &&
            pin.electricalType !== "ground" &&
            pin.electricalType !== "power-output" &&
            pin.electricalType !== "passive",
        );

      // Interface wiring.
      if (
        sdaNetId &&
        sclNetId &&
        definition.interfaces.includes("i2c") &&
        definition.pins.some((pin) => pin.functions.includes("i2c-sda"))
      ) {
        placement.interfaceKind = "i2c";
        const sdaPin = definition.pins.find((pin) => pin.functions.includes("i2c-sda"))!;
        const sclPin = definition.pins.find((pin) => pin.functions.includes("i2c-scl"))!;
        const sdaAssignment = allocator.assignmentFor(profile.i2c!.sdaPinId)!;
        const sclAssignment = allocator.assignmentFor(profile.i2c!.sclPinId)!;

        // A device in a different voltage domain gets its own bus segment behind
        // a converter rather than being tied to the controller's bus directly.
        const shift = levelShiftDecision({
          devicePinType: sdaPin.electricalType,
          devicePinMaximumVoltage: sdaPin.maximumVoltage,
          deviceLogicVoltage: definition.electrical.logicVoltage,
          deviceSupplyVoltage: placement.supplyVoltage,
          controllerLogicVoltage: profile.logicVoltage,
          controllerPinMaximumVoltage: allocator.pin(profile.i2c!.sdaPinId)?.maximumVoltage,
        });
        if (shift.needed && shift.lowVoltage !== undefined && shift.highVoltage !== undefined) {
          const deviceOnLowSide = shift.lowVoltage !== profile.logicVoltage;
          const segment = i2cSegmentFor(shift.lowVoltage, shift.highVoltage, deviceOnLowSide);
          nets.connect(segment.sdaNetId, instanceId, sdaPin.id);
          nets.connect(segment.sclNetId, instanceId, sclPin.id);
          instance.properties.levelShiftedBy = segment.reference;
        } else {
          nets.connect(sdaNetId, instanceId, sdaPin.id);
          nets.connect(sclNetId, instanceId, sclPin.id);
        }
        placement.signalPins.push(
          {
            peripheralPinId: sdaPin.id,
            assignment: sdaAssignment,
            ...(shift.needed ? { viaLevelShifter: true } : {}),
          },
          {
            peripheralPinId: sclPin.id,
            assignment: sclAssignment,
            ...(shift.needed ? { viaLevelShifter: true } : {}),
          },
        );

        const addresses = definition.rules.i2cAddresses ?? [];
        const free = addresses.find((address) => !takenI2cAddresses.has(address));
        if (free) {
          takenI2cAddresses.add(free);
          placement.i2cAddress = free;
          instance.properties.i2cAddress = free;
          if (addresses.indexOf(free) > 0) {
            notes.push({
              rule: "I2C_ADDRESS_CONFLICT",
              severity: "info",
              title: `${reference} must be set to its alternate I²C address`,
              message: `${definition.name} defaults to ${addresses[0]}, which another device on this bus already uses. ${reference} is assigned ${free}.`,
              componentIds: [instanceId],
              netIds: [sdaNetId],
              remediation: `Change ${reference} to ${free} on the board itself before wiring it — on most modules that means moving a solder blank or tying the address pin.`,
            });
          }
        } else if (addresses.length) {
          notes.push({
            rule: "I2C_ADDRESS_CONFLICT",
            severity: "error",
            title: `${reference} has no free I²C address`,
            message: `${definition.name} can only answer on ${addresses.join(
              " or ",
            )}, and every one of those is already used on this bus.`,
            componentIds: [instanceId],
            netIds: [sdaNetId],
            remediation:
              "Use fewer devices of this type on one bus, or put the extra device on a second I²C bus or a multiplexer.",
          });
        }
      } else if (
        spiNets &&
        definition.interfaces.includes("spi") &&
        definition.pins.some((pin) => pin.functions.includes("spi-sck"))
      ) {
        placement.interfaceKind = "spi";
        for (const [functionName, netId] of [
          ["spi-sck", spiNets.sck],
          ["spi-mosi", spiNets.mosi],
          ["spi-miso", spiNets.miso],
        ] as const) {
          const pin = definition.pins.find((candidate) => candidate.functions.includes(functionName));
          if (pin) nets.connect(netId, instanceId, pin.id);
        }
        const busPinIds = new Set(
          definition.pins
            .filter((candidate) =>
              candidate.functions.some((name) => name.startsWith("spi-")),
            )
            .map((candidate) => candidate.id),
        );
        const csPin = definition.pins.find((pin) => pin.functions.includes("spi-cs"));
        if (csPin) {
          const netId = `net_cs_${reference.toLowerCase()}`;
          nets.ensure(netId, `CS_${reference}`, "chip-select", profile.logicVoltage);
          const allocated = allocator.allocate("digital", {
            purpose: "spi-cs",
            componentId: instanceId,
            peripheralPinId: csPin.id,
            netId,
            constantName: pinConstantName(reference, "CS"),
          });
          if (allocated.ok) {
            nets.connect(netId, controllerInstance.id, allocated.pin.id);
            nets.connect(netId, instanceId, csPin.id);
            placement.signalPins.push({
              peripheralPinId: csPin.id,
              assignment: allocator.assignmentFor(allocated.pin.id)!,
            });
          } else {
            notes.push({
              rule: "REQUIRED_PIN_UNCONNECTED",
              severity: "error",
              title: `${reference} could not be given a chip-select pin`,
              message: allocated.reason,
              componentIds: [instanceId],
              netIds: [netId],
              remediation: "Free a digital pin, or choose a board with more GPIO.",
            });
          }
        }
        // A display or a reader usually needs more than the four bus wires:
        // data/command, reset and busy lines are ordinary GPIO.
        for (const pin of unwiredSignalPins(busPinIds)) wireSignalPin(pin);
      } else if (
        definition.interfaces.includes("uart") &&
        definition.pins.some((pin) => pin.functions.includes("uart-tx"))
      ) {
        placement.interfaceKind = "uart";
        const uart = hardwareUarts[uartsUsed];
        if (!uart) {
          notes.push({
            rule: "INVALID_CONTROLLER_PIN",
            severity: "error",
            title: `${reference} has no hardware serial port left`,
            message: hardwareUarts.length
              ? `${controllerDefinition.name} has ${hardwareUarts.length} hardware serial port${
                  hardwareUarts.length === 1 ? "" : "s"
                } and ${uartsUsed} ${uartsUsed === 1 ? "is" : "are"} already taken, not counting the one the USB console uses.`
              : `${controllerDefinition.name} has no UART pins recorded in the component library.`,
            componentIds: [instanceId, controllerInstance.id],
            netIds: [],
            remediation:
              "Use a board with more hardware serial ports — an Arduino Mega has four — or drive this device with SoftwareSerial, accepting its lower reliable speed.",
          });
        } else {
          uartsUsed += 1;
          const deviceRx = definition.pins.find((pin) => pin.functions.includes("uart-rx"));
          const deviceTx = definition.pins.find((pin) => pin.functions.includes("uart-tx"));
          // Crossed on purpose: the controller talks into the device's
          // receiver. Each direction crosses the domain on its own, so each is
          // checked and routed through a converter independently.
          const wireUartLine = (
            direction: "tx" | "rx",
            controllerPinId: string,
            devicePin: (typeof definition.pins)[number] | undefined,
          ): void => {
            if (!devicePin) return;
            const netIdBase = `net_uart_${direction}_${reference.toLowerCase()}`;
            const netName = `UART_${direction.toUpperCase()}_${reference}`;
            const role: NetRole = direction === "tx" ? "uart-tx" : "uart-rx";
            const shift = levelShiftDecision({
              devicePinType: devicePin.electricalType,
              devicePinMaximumVoltage: devicePin.maximumVoltage,
              deviceLogicVoltage: definition.electrical.logicVoltage,
              deviceSupplyVoltage: placement.supplyVoltage,
              controllerLogicVoltage: profile.logicVoltage,
              controllerPinMaximumVoltage: profile.logicVoltage,
            });
            const shifted =
              shift.needed && shift.lowVoltage !== undefined && shift.highVoltage !== undefined;

            let controllerNetId = netIdBase;
            let deviceNetId = netIdBase;
            if (shifted) {
              const routed = routeThroughShifter({
                netIdBase,
                netName,
                role,
                lowVoltage: shift.lowVoltage!,
                highVoltage: shift.highVoltage!,
              });
              const controllerOnLowSide = profile.logicVoltage === shift.lowVoltage;
              controllerNetId = controllerOnLowSide ? routed.lowNetId : routed.highNetId;
              deviceNetId = controllerOnLowSide ? routed.highNetId : routed.lowNetId;
              instance.properties.levelShiftedBy = routed.reference;
            } else {
              nets.ensure(netIdBase, netName, role, profile.logicVoltage);
            }

            const reserved = allocator.reserve({
              controllerPinId,
              purpose: direction === "tx" ? "uart-tx" : "uart-rx",
              componentId: instanceId,
              peripheralPinId: devicePin.id,
              netId: controllerNetId,
              constantName: pinConstantName(reference, direction.toUpperCase()),
            });
            if (!reserved.ok) {
              notes.push({
                rule: "DUPLICATE_PIN_ASSIGNMENT",
                severity: "error",
                title: `${reference} could not take its serial pin`,
                message: reserved.reason,
                componentIds: [instanceId, controllerInstance.id],
                netIds: [controllerNetId],
              });
              return;
            }
            nets.connect(controllerNetId, controllerInstance.id, controllerPinId);
            nets.connect(deviceNetId, instanceId, devicePin.id);
            placement.signalPins.push({
              peripheralPinId: devicePin.id,
              assignment: allocator.assignmentFor(controllerPinId)!,
              ...(shifted ? { viaLevelShifter: true } : {}),
            });
          };

          wireUartLine("tx", uart.txPinId, deviceRx);
          wireUartLine("rx", uart.rxPinId, deviceTx);
        }
      } else if (definition.id === "push-button") {
        // One terminal to a digital pin with the controller's internal pull-up,
        // the other straight to ground. No external resistor is needed.
        placement.interfaceKind = "digital";
        const netId = `net_sig_${reference.toLowerCase()}_1`;
        nets.ensure(netId, `${reference}_SIGNAL`, "digital", profile.logicVoltage);
        const allocated = allocator.allocate("digital", {
          purpose: "digital",
          componentId: instanceId,
          peripheralPinId: "1",
          netId,
          constantName: pinConstantName(reference, "SIGNAL"),
        });
        if (allocated.ok) {
          nets.connect(netId, controllerInstance.id, allocated.pin.id);
          nets.connect(netId, instanceId, "1");
          nets.connect(groundNet.id, instanceId, "2");
          instance.properties.usesInternalPullup = true;
          placement.signalPins.push({
            peripheralPinId: "1",
            assignment: allocator.assignmentFor(allocated.pin.id)!,
          });
        } else {
          notes.push({
            rule: "REQUIRED_PIN_UNCONNECTED",
            severity: "error",
            title: `${reference} could not be given a digital pin`,
            message: allocated.reason,
            componentIds: [instanceId],
            netIds: [netId],
          });
        }
      } else if (isContactOnly(definition)) {
        // A matrix keypad or a latching switch: bare contacts, no supply. Each
        // terminal gets its own pin, except a designated common, which returns
        // to ground so the controller's internal pull-ups do the rest.
        placement.interfaceKind = "digital";
        instance.properties.usesInternalPullup = true;
        for (const contact of definition.pins) {
          if (contact.functions.includes("optional")) continue;
          if (contact.functions.includes("common") || contact.electricalType === "ground") {
            nets.connect(groundNet.id, instanceId, contact.id);
            continue;
          }
          const netId = `net_sig_${reference.toLowerCase()}_${contact.id.toLowerCase()}`;
          nets.ensure(netId, `${reference}_${contact.id}`, "digital", profile.logicVoltage);
          const allocated = allocator.allocate("digital", {
            purpose: "digital",
            componentId: instanceId,
            peripheralPinId: contact.id,
            netId,
            constantName: pinConstantName(reference, contact.id),
          });
          if (!allocated.ok) {
            notes.push({
              rule: "REQUIRED_PIN_UNCONNECTED",
              severity: "error",
              title: `${reference} ${contact.label} could not be connected`,
              message: allocated.reason,
              componentIds: [instanceId],
              netIds: [netId],
              remediation: "Choose a board with more digital pins, or use fewer keys.",
            });
            continue;
          }
          nets.connect(netId, controllerInstance.id, allocated.pin.id);
          nets.connect(netId, instanceId, contact.id);
          placement.signalPins.push({
            peripheralPinId: contact.id,
            assignment: allocator.assignmentFor(allocated.pin.id)!,
          });
        }
      } else if (definition.rules.requiresDriver) {
        // A load the controller must not switch directly: the part sits between
        // a rail and a low-side MOSFET, and the controller only drives the gate.
        placement.interfaceKind = "pwm";
        const returnPin = definition.pins.find(
          (pin) => pin.functions.includes("switched-return"),
        );
        if (!returnPin) {
          notes.push({
            rule: "UNSUPPORTED_COMPONENT",
            severity: "error",
            title: `${reference} needs a driver but has no switched terminal`,
            message: `${definition.name} is marked as needing a driver, but the component library does not say which of its pins the driver switches.`,
            componentIds: [instanceId],
            netIds: [],
          });
        } else {
          applyLowSideDriver({
            instance,
            definition,
            placement,
            returnPinId: returnPin.id,
            nets,
            allocator,
            profile,
            controllerInstance,
            reference,
            supportParts,
            nextReference,
            groundNetId: groundNet.id,
            notes,
          });
        }
      } else {
        // Plain digital / analog / PWM parts. Passive two-lead parts are wired
        // by the support-part rules instead, never by generic allocation.
        for (const pin of unwiredSignalPins(new Set())) wireSignalPin(pin);
      }

      // ---- automatic support parts ----------------------------------------
      if (definition.rules.requiresCurrentLimiting) {
        applyLedResistor({
          instance,
          definition,
          placement,
          nets,
          allocator,
          profile,
          controllerInstance,
          reference,
          supportParts,
          nextReference,
          groundNetId: groundNet.id,
          notes,
        });
      }

      if (
        definition.rules.requiresPullups &&
        definition.id !== "push-button" &&
        placement.interfaceKind !== "i2c" &&
        placement.signalPins.length
      ) {
        applyDataPullup({
          definition,
          placement,
          supportParts,
          nextReference,
          railVoltage: placement.supplyVoltage ?? profile.logicVoltage,
          ensureRail,
        });
      }

      if (definition.rules.requiresDecoupling) {
        const capacitorReference = nextReference("passive", "capacitor");
        supportParts.push({
          definitionId: "capacitor",
          reference: capacitorReference,
          value: "100 nF",
          reason: `${definition.name} needs a decoupling capacitor across its supply pins.`,
          connections: [
            { pinId: "1", netId: placement.supplyNetId ?? ensureRail(profile.logicVoltage) },
            { pinId: "2", netId: groundNet.id },
          ],
        });
      }

      peripherals.push(placement);
    }
  }

  // ---- I²C pull-ups --------------------------------------------------------
  if (sdaNetId && sclNetId) {
    const modulesWithPullups = peripherals.filter(
      (placement) =>
        placement.interfaceKind === "i2c" && placement.definition.rules.requiresPullups === false,
    );
    if (!modulesWithPullups.length) {
      const railVoltage = peripherals.find((placement) => placement.interfaceKind === "i2c")
        ?.supplyVoltage ?? profile.logicVoltage;
      const railId = ensureRail(railVoltage);
      for (const [netId, label] of [
        [sdaNetId, "SDA"],
        [sclNetId, "SCL"],
      ] as const) {
        const reference = nextReference("passive");
        supportParts.push({
          definitionId: "resistor",
          reference,
          value: "4.7 kΩ",
          reason: `No device on this I²C bus carries its own pull-ups, so ${label} needs one to the ${railVoltage} V rail.`,
          connections: [
            { pinId: "1", netId },
            { pinId: "2", netId: railId },
          ],
        });
      }
    }
  }

  // ---- power rails ---------------------------------------------------------
  if (input.request.prototypeType === "breadboard") {
    let railIndex = 0;
    for (const voltage of [...railInUse].sort((left, right) => right - left)) {
      railIndex += 1;
      const definition = componentDefinition("power-rails")!;
      const instanceId = `cmp_rails_${railIndex}`;
      components.push({
        id: instanceId,
        definitionId: definition.id,
        reference: `PR${railIndex}`,
        name: `${definition.name} (${voltage} V)`,
        quantity: 1,
        properties: { railVoltage: voltage },
        automaticallyAdded: true,
        additionReason: `Every part on the ${voltage} V rail is fed from these bus strips rather than from a controller pin.`,
      });
      nets.connect(railNetIdByVoltage[String(voltage)], instanceId, "POS");
      nets.connect(groundNet.id, instanceId, "NEG");
    }
  }

  // ---- materialise support parts ------------------------------------------
  for (const support of supportParts) {
    const definition = componentDefinition(support.definitionId)!;
    instanceCounter += 1;
    const instanceId = `cmp_${instanceCounter}`;
    components.push({
      id: instanceId,
      definitionId: definition.id,
      reference: support.reference,
      name: definition.name,
      value: support.value,
      quantity: 1,
      properties: { value: support.value },
      automaticallyAdded: true,
      additionReason: support.reason,
    });
    for (const connection of support.connections) {
      nets.connect(connection.netId, instanceId, connection.pinId);
    }
  }

  // ---- parts the request asked for, and parts it ruled out -----------------
  // A preferred part is not a hint the compiler may drop in silence. Once the
  // circuit is complete, anything that was named and is not in it gets a line
  // in the validation list with the reason, so the gap between what was asked
  // for and what was built is never left for the reader to notice.
  const presentDefinitionIds = new Set(components.map((instance) => instance.definitionId));
  if (input.request.power.part) {
    const phrase = input.request.power.part;
    const outcome = resolveComponentPhrase(phrase, scopedDefinitions);
    if (outcome.status !== "resolved") {
      notes.push({
        rule: "REQUESTED_POWER_PART_MISSING",
        severity: "warning",
        title: `The requested power part "${phrase}" is not in this design`,
        message:
          outcome.status === "ambiguous"
            ? `The requested power part "${phrase}" matches more than one library entry, so none was selected automatically.`
            : `No safely compilable power-source definition matches "${phrase}", so the compiler used only a compatible library power path.`,
        componentIds: [],
        netIds: [],
        remediation:
          "Review the saved online research and verify the cell, protection, charger, connector, current rating, and controller input range before selecting it.",
      });
    } else if (!presentDefinitionIds.has(outcome.definition.id)) {
      notes.push({
        rule: "REQUESTED_POWER_PART_MISSING",
        severity: "warning",
        title: `${outcome.definition.name} was requested but is not in this design`,
        message: `The requested power part was not fitted because ${
          omissionReasons.get(outcome.definition.id) ??
          "it is not a directly compatible protected cell for this controller input"
        }.`,
        componentIds: [],
        netIds: [],
        remediation:
          "Choose a protected cell within the controller input range and verify its charger and protection circuit.",
      });
    }
  }
  for (const phrase of input.request.constraints.preferredComponents) {
    const outcome = resolveComponentPhrase(phrase, scopedDefinitions);
    if (outcome.status === "unsupported") {
      notes.push({
        rule: "PREFERRED_COMPONENT_MISSING",
        severity: "warning",
        title: `"${phrase}" was asked for but is not in the component library`,
        message: `The request named "${phrase}" as a preferred part. Nothing in the library matches that name, so the design was built without it.`,
        componentIds: [],
        netIds: [],
        remediation: "Name a part the library knows, or design that part of the circuit by hand.",
      });
      continue;
    }
    if (outcome.status === "ambiguous") {
      notes.push({
        rule: "PREFERRED_COMPONENT_MISSING",
        severity: "warning",
        title: `"${phrase}" could mean more than one part`,
        message: `The request named "${phrase}" as a preferred part, and it matches ${outcome.candidates
          .map((candidate) => candidate.name)
          .join(", ")}. None was chosen, because guessing between them would be inventing a decision.`,
        componentIds: [],
        netIds: [],
        remediation: "Name exactly one of those parts.",
      });
      continue;
    }
    if (presentDefinitionIds.has(outcome.definition.id)) continue;
    const reason = omissionReasons.get(outcome.definition.id);
    notes.push({
      rule: "PREFERRED_COMPONENT_MISSING",
      severity: "warning",
      title: `${outcome.definition.name} was asked for but is not in this design`,
      message: reason
        ? `The request named ${outcome.definition.name} as a preferred part. It was considered and left out because ${reason}.`
        : `The request named ${outcome.definition.name} as a preferred part, and nothing in the compiled circuit uses it. The compiler only fits parts the wiring requires, so a preference on its own does not place one.`,
      componentIds: [],
      netIds: [],
      remediation: reason
        ? "Resolve the reason above, or accept the design as drawn without it."
        : `List ${outcome.definition.name} among the project's inputs or outputs if it has to be part of the build.`,
    });
  }

  for (const phrase of input.request.constraints.forbiddenComponents) {
    const outcome = resolveComponentPhrase(phrase, scopedDefinitions);
    if (outcome.status !== "resolved") continue;
    if (!presentDefinitionIds.has(outcome.definition.id)) continue;
    const instances = components.filter(
      (instance) => instance.definitionId === outcome.definition.id,
    );
    notes.push({
      rule: "FORBIDDEN_COMPONENT_PRESENT",
      severity: "warning",
      title: `${outcome.definition.name} was ruled out but the circuit needs it`,
      message: `The request forbade ${outcome.definition.name}, and the compiled circuit contains ${instances
        .map((instance) => instance.reference)
        .join(", ")}${
        instances[0]?.additionReason ? `. ${instances[0].additionReason}` : "."
      }`,
      componentIds: instances.map((instance) => instance.id),
      netIds: [],
      remediation:
        "Change the parts or the board that made this necessary, or lift the restriction.",
    });
  }

  const currentEstimate = estimateCurrent({
    controllerDefinition,
    logicVoltage: profile.logicVoltage,
    peripherals,
  });

  return {
    controllerInstance,
    controllerDefinition,
    profile,
    components,
    nets: nets.list(),
    decisions,
    notes,
    assignments: allocator.list(),
    peripherals,
    groundNetId: groundNet.id,
    railNetIdByVoltage,
    currentEstimate,
    scopedDefinitions,
  };
}

/**
 * An LED is never driven straight off a pin. The controller pin drives a series
 * resistor, the resistor drives the anode, and the cathode returns to ground.
 */
function applyLedResistor(input: {
  instance: ComponentInstance;
  definition: ComponentDefinition;
  placement: PeripheralPlacement;
  nets: NetBuilder;
  allocator: PinAllocator;
  profile: ControllerProfile;
  controllerInstance: ComponentInstance;
  reference: string;
  supportParts: SupportPart[];
  nextReference: (category: string) => string;
  groundNetId: string;
  notes: CompilerNote[];
}): void {
  const { instance, definition, nets, allocator, profile, controllerInstance, reference } = input;
  const anodes = definition.pins.filter((pin) => pin.functions.includes("anode"));
  const cathode = definition.pins.find((pin) => pin.functions.includes("cathode"));
  const value =
    LED_RESISTOR_BY_VOLTAGE.find((entry) => entry.voltage === profile.logicVoltage)?.value ??
    "330 Ω";
  const values: string[] = [];

  // One drive pin and one resistor per colour: an RGB package is three LEDs
  // sharing a cathode, and each needs its own limiting.
  for (const anode of anodes) {
    const slug = `${reference.toLowerCase()}_${anode.id.toLowerCase()}`;
    const driveNetId = `net_sig_${slug}_drive`;
    const anodeNetId = `net_sig_${slug}_anode`;
    const label = anodes.length > 1 ? `${reference}_${anode.id}` : reference;
    nets.ensure(driveNetId, `${label}_DRIVE`, "digital", profile.logicVoltage);
    nets.ensure(anodeNetId, `${label}_ANODE`, "digital", profile.logicVoltage);

    const allocated = allocator.allocate("pwm", {
      purpose: "pwm",
      componentId: instance.id,
      peripheralPinId: anode.id,
      netId: driveNetId,
      constantName: pinConstantName(reference, anodes.length > 1 ? anode.id : "ANODE"),
    });
    if (!allocated.ok) {
      input.notes.push({
        rule: "REQUIRED_PIN_UNCONNECTED",
        severity: "error",
        title: `${reference} ${anode.label} could not be given a drive pin`,
        message: allocated.reason,
        componentIds: [instance.id],
        netIds: [driveNetId],
      });
      continue;
    }
    nets.connect(driveNetId, controllerInstance.id, allocated.pin.id);
    input.placement.signalPins.push({
      peripheralPinId: anode.id,
      assignment: allocator.assignmentFor(allocated.pin.id)!,
    });

    const resistorReference = input.nextReference("passive");
    input.supportParts.push({
      definitionId: "resistor",
      reference: resistorReference,
      value,
      reason: `${reference}${
        anodes.length > 1 ? ` ${anode.label}` : ""
      } has no current limiting of its own, so a ${value} series resistor sits between the controller pin and the anode.`,
      connections: [
        { pinId: "1", netId: driveNetId },
        { pinId: "2", netId: anodeNetId },
      ],
    });
    nets.connect(anodeNetId, instance.id, anode.id);
    values.push(value);
  }

  if (cathode) nets.connect(input.groundNetId, instance.id, cathode.id);
  input.placement.interfaceKind = "digital";
  if (values.length) instance.properties.seriesResistor = values[0];
}

/**
 * A load that must not hang off a controller pin gets a low-side switch: the
 * load sits between its rail and the MOSFET drain, the source returns to
 * ground, and the controller drives the gate through a pull-down that keeps the
 * load off while the board resets. An inductive load also gets its flyback
 * diode across it, cathode to the positive rail.
 */
function applyLowSideDriver(input: {
  instance: ComponentInstance;
  definition: ComponentDefinition;
  placement: PeripheralPlacement;
  returnPinId: string;
  nets: NetBuilder;
  allocator: PinAllocator;
  profile: ControllerProfile;
  controllerInstance: ComponentInstance;
  reference: string;
  supportParts: SupportPart[];
  nextReference: (category: string, definitionId?: string) => string;
  groundNetId: string;
  notes: CompilerNote[];
}): void {
  const { instance, nets, allocator, controllerInstance, reference } = input;
  const slug = reference.toLowerCase();
  const gateNetId = `net_gate_${slug}`;
  const drainNetId = `net_drain_${slug}`;
  nets.ensure(gateNetId, `${reference}_GATE`, "digital", input.profile.logicVoltage);
  nets.ensure(drainNetId, `${reference}_SWITCHED`, "other", input.placement.supplyVoltage ?? undefined);

  const allocated = allocator.allocate("pwm", {
    purpose: "pwm",
    componentId: instance.id,
    peripheralPinId: DRIVER_GATE_PIN_ID,
    netId: gateNetId,
    constantName: pinConstantName(reference, "GATE"),
  });
  if (!allocated.ok) {
    input.notes.push({
      rule: "REQUIRED_PIN_UNCONNECTED",
      severity: "error",
      title: `${reference} could not be given a gate-drive pin`,
      message: allocated.reason,
      componentIds: [instance.id],
      netIds: [gateNetId],
    });
    return;
  }
  nets.connect(gateNetId, controllerInstance.id, allocated.pin.id);
  nets.connect(drainNetId, instance.id, input.returnPinId);
  input.placement.signalPins.push({
    peripheralPinId: DRIVER_GATE_PIN_ID,
    assignment: allocator.assignmentFor(allocated.pin.id)!,
    viaDriver: true,
  });

  const mosfetReference = input.nextReference("semiconductor", "mosfet-logic-level");
  input.supportParts.push({
    definitionId: "mosfet-logic-level",
    reference: mosfetReference,
    value: "",
    reason: `${reference} draws far more than a controller pin can supply, so ${mosfetReference} switches it on the low side and the pin only drives the gate.`,
    connections: [
      { pinId: "G", netId: gateNetId },
      { pinId: "D", netId: drainNetId },
      { pinId: "S", netId: input.groundNetId },
    ],
  });
  instance.properties.switchedBy = mosfetReference;

  const pulldownReference = input.nextReference("passive");
  input.supportParts.push({
    definitionId: "resistor",
    reference: pulldownReference,
    value: GATE_PULLDOWN_VALUE,
    reason: `A ${GATE_PULLDOWN_VALUE} pull-down holds ${mosfetReference} off while the board is resetting, so ${reference} cannot run on its own at power-up.`,
    connections: [
      { pinId: "1", netId: gateNetId },
      { pinId: "2", netId: input.groundNetId },
    ],
  });

  if (input.definition.rules.requiresFlybackDiode && input.placement.supplyNetId) {
    const diodeReference = input.nextReference("semiconductor", "diode-1n4007");
    input.supportParts.push({
      definitionId: "diode-1n4007",
      reference: diodeReference,
      value: "",
      reason: `${reference} is inductive. ${diodeReference} gives its collapsing current a path back to the rail instead of a spike into ${mosfetReference}.`,
      connections: [
        { pinId: "A", netId: drainNetId },
        { pinId: "K", netId: input.placement.supplyNetId },
      ],
    });
    instance.properties.flybackDiode = diodeReference;
  }
}

/** A single-wire open-drain data line (DHT22) needs a pull-up to its supply. */
function applyDataPullup(input: {
  definition: ComponentDefinition;
  placement: PeripheralPlacement;
  supportParts: SupportPart[];
  nextReference: (category: string) => string;
  railVoltage: number;
  ensureRail: (voltage: number) => string;
}): void {
  const dataPin = input.placement.signalPins[0];
  if (!dataPin) return;

  const reference = input.nextReference("passive");
  input.supportParts.push({
    definitionId: "resistor",
    reference,
    value: "10 kΩ",
    reason: `${input.definition.name} drives its data line open-drain, so it needs a 10 kΩ pull-up to its ${input.railVoltage} V supply.`,
    connections: [
      { pinId: "1", netId: dataPin.assignment.netId },
      { pinId: "2", netId: input.ensureRail(input.railVoltage) },
    ],
  });
}

function estimateCurrent(input: {
  controllerDefinition: ComponentDefinition;
  logicVoltage: number;
  peripherals: PeripheralPlacement[];
}): CurrentEstimate {
  let totalTypicalMa = input.controllerDefinition.electrical.typicalCurrentMa ?? 0;
  let totalMaximumMa =
    input.controllerDefinition.electrical.maximumCurrentMa ??
    input.controllerDefinition.electrical.typicalCurrentMa ??
    0;
  const perRailTypicalMa: Record<string, number> = {};
  const unknownComponentIds: string[] = [];

  for (const placement of input.peripherals) {
    const isPurePhysicalReference =
      placement.definition.rules.electricalPlaceholder !== true &&
      placement.definition.interfaces.length === 0 &&
      placement.definition.pins.length === 0;
    // Optical, mounting and enclosure references are not electrical loads.
    if (isPurePhysicalReference) continue;

    // An LED's draw is set by its series resistor, not by a datasheet figure.
    if (placement.definition.rules.requiresCurrentLimiting) {
      const drive = ledDriveCurrentMa({
        logicVoltage: input.logicVoltage,
        forwardVoltage: placement.definition.electrical.typicalSupplyVoltage,
        seriesResistorValue:
          typeof placement.instance.properties.seriesResistor === "string"
            ? placement.instance.properties.seriesResistor
            : undefined,
      });
      if (drive === null) {
        unknownComponentIds.push(placement.instance.id);
      } else {
        totalTypicalMa += drive;
        totalMaximumMa += drive;
      }
      continue;
    }

    const typical = placement.definition.electrical.typicalCurrentMa;
    const maximum = placement.definition.electrical.maximumCurrentMa ?? typical;
    if (typical === undefined) {
      // A part that consumes nothing is not "unknown" in a way that matters:
      // only parts that actually draw power are worth reporting.
      if (
        placement.definition.rules.electricalPlaceholder === true ||
        (placement.definition.category !== "passive" &&
          !isContactOnly(placement.definition))
      ) {
        unknownComponentIds.push(placement.instance.id);
      }
      continue;
    }
    totalTypicalMa += typical;
    totalMaximumMa += maximum ?? typical;
    if (placement.supplyNetId) {
      perRailTypicalMa[placement.supplyNetId] =
        (perRailTypicalMa[placement.supplyNetId] ?? 0) + typical;
    } else if (!isContactOnly(placement.definition)) {
      // Even a documented load is not accounted for electrically until it is
      // attached to a real rail. Keep it visible in the lower-bound warning.
      unknownComponentIds.push(placement.instance.id);
    }
  }

  return {
    totalTypicalMa: Math.round(totalTypicalMa * 10) / 10,
    totalMaximumMa: Math.round(totalMaximumMa * 10) / 10,
    perRailTypicalMa,
    unknownComponentIds,
  };
}

/** Convenience wrapper used by tests and the design orchestrator. */
export function resolveRequestPeripherals(
  request: HardwareProjectRequest,
  scopedDefinitions: readonly ComponentDefinition[] = [],
): ResolvedPeripheral[] {
  const build = (list: HardwareProjectRequest["inputs"], role: "input" | "output") =>
    list.map((requested) => ({
      requested,
      role,
      outcome: resolveComponentPhrase(requested.type, scopedDefinitions),
    }));
  return [...build(request.inputs, "input"), ...build(request.outputs, "output")];
}
