// Deterministic electrical validation.
//
// Each rule is an independent function over the compiled circuit, so a rule can
// be reasoned about and tested on its own. A design is never called safe merely
// because compilation finished: status is derived from what these rules found.

import { componentDefinition } from "./components/index.ts";
import {
  describeLevelShift,
  isContactOnly,
  ledDriveCurrentMa,
  levelShiftDecision,
} from "./electrical.ts";
import type { CompiledCircuit, CompilerNote } from "./compiler.ts";
import type {
  ComponentDefinition,
  ComponentInstance,
  ElectricalNet,
  HardwareProjectRequest,
  HardwareProjectStatus,
  ValidationResult,
} from "./types.ts";

export const VALIDATION_RULES = [
  "POWER_VOLTAGE_OUT_OF_RANGE",
  "LOGIC_LEVEL_MISMATCH",
  "GPIO_OVERCURRENT",
  "ESTIMATED_SUPPLY_OVERCURRENT",
  "MISSING_GROUND",
  "MISSING_POWER",
  "REQUIRED_PIN_UNCONNECTED",
  "OUTPUT_OUTPUT_CONFLICT",
  "I2C_ADDRESS_CONFLICT",
  "I2C_PULLUPS_MISSING",
  "LED_RESISTOR_MISSING",
  "INDUCTIVE_LOAD_PROTECTION_MISSING",
  "GPIO_DRIVING_HIGH_CURRENT_LOAD",
  "DUPLICATE_PIN_ASSIGNMENT",
  "INVALID_CONTROLLER_PIN",
  "BOOT_STRAP_PIN_WARNING",
  "ELECTRICAL_PLACEHOLDER",
  "MISSING_PRODUCT_REQUIREMENT",
  "PHYSICAL_DESIGN_INCOMPLETE",
  "UNSUPPORTED_COMPONENT",
  "UNKNOWN_ELECTRICAL_VALUE",
  "EMPTY_DESIGN",
  "PREFERRED_COMPONENT_MISSING",
  "FORBIDDEN_COMPONENT_PRESENT",
  "FORM_FACTOR_MISMATCH",
] as const;

export type ValidationRule = (typeof VALIDATION_RULES)[number];

/**
 * What each rule checks, phrased so the validation view can say why a finding
 * exists rather than showing a bare rule name. Kept next to the rules so a new
 * rule without an explanation is obvious.
 */
const RULE_DESCRIPTIONS: Record<ValidationRule, string> = {
  POWER_VOLTAGE_OUT_OF_RANGE:
    "Every part's supply pin sits within the minimum and maximum voltage its datasheet allows.",
  LOGIC_LEVEL_MISMATCH:
    "No signal drives a pin past its own maximum voltage, and no input is left below its high threshold.",
  GPIO_OVERCURRENT: "No single controller pin is asked to source or sink more than it is rated for.",
  ESTIMATED_SUPPLY_OVERCURRENT:
    "The total typical draw stays inside the budget of the rail that feeds it.",
  MISSING_GROUND: "Every powered part shares a ground return with the controller.",
  MISSING_POWER: "Every part that needs a supply is connected to one.",
  REQUIRED_PIN_UNCONNECTED: "No pin a part needs to work was left floating.",
  OUTPUT_OUTPUT_CONFLICT: "No net outside a shared bus is driven by two outputs at once.",
  I2C_ADDRESS_CONFLICT: "No two devices on the same I²C bus answer to the same address.",
  I2C_PULLUPS_MISSING: "The I²C bus has pull-ups, without which no device can answer.",
  LED_RESISTOR_MISSING: "Every LED has something limiting its current.",
  INDUCTIVE_LOAD_PROTECTION_MISSING:
    "Every motor, relay or solenoid has a flyback path for the spike it makes when it switches off.",
  GPIO_DRIVING_HIGH_CURRENT_LOAD:
    "No load heavier than a pin can drive is wired straight to that pin.",
  DUPLICATE_PIN_ASSIGNMENT: "No controller pin was handed to two different jobs.",
  INVALID_CONTROLLER_PIN: "Every assigned pin actually exists on this board.",
  BOOT_STRAP_PIN_WARNING:
    "Flags pins that work but constrain boot or are shared with the USB console.",
  ELECTRICAL_PLACEHOLDER:
    "No active mechanical or BOM placeholder is mistaken for a real, electrically specified part.",
  MISSING_PRODUCT_REQUIREMENT:
    "A product-level request includes the physical subsystems it needs to perform its stated function.",
  PHYSICAL_DESIGN_INCOMPLETE:
    "A requested physical deliverable passed CAD geometry and product-requirement acceptance before the blueprint is called build-ready.",
  UNSUPPORTED_COMPONENT: "Flags anything outside what this agent is allowed to design.",
  UNKNOWN_ELECTRICAL_VALUE:
    "Reports figures the component library does not document, instead of guessing them.",
  EMPTY_DESIGN: "The request produced an actual circuit rather than a bare board.",
  PREFERRED_COMPONENT_MISSING:
    "Every part the request named as preferred is either in the design or explained here.",
  FORBIDDEN_COMPONENT_PRESENT: "No part the request ruled out ended up in the circuit anyway.",
  FORM_FACTOR_MISMATCH:
    "The board is small enough for the physical form the request described — worn, clipped on, or handheld.",
};

/** One line on what a rule checks; the raw name when the rule is unknown. */
export function describeValidationRule(rule: string): string {
  return RULE_DESCRIPTIONS[rule as ValidationRule] ?? rule;
}

interface RuleContext {
  circuit: CompiledCircuit;
  definitionOf: (instance: ComponentInstance) => ComponentDefinition | null;
  netsByComponent: Map<string, ElectricalNet[]>;
  netById: Map<string, ElectricalNet>;
  /** Instances that are not the controller and not prototyping hardware. */
  parts: ComponentInstance[];
}

function makeContext(circuit: CompiledCircuit): RuleContext {
  const netById = new Map(circuit.nets.map((net) => [net.id, net]));
  const netsByComponent = new Map<string, ElectricalNet[]>();
  for (const net of circuit.nets) {
    for (const connection of net.connections) {
      const list = netsByComponent.get(connection.componentId) ?? [];
      if (!list.includes(net)) list.push(net);
      netsByComponent.set(connection.componentId, list);
    }
  }
  const definitionOf = (instance: ComponentInstance) =>
    componentDefinition(instance.definitionId);
  return {
    circuit,
    definitionOf,
    netsByComponent,
    netById,
    parts: circuit.components.filter(
      (instance) =>
        instance.id !== circuit.controllerInstance.id &&
        componentDefinition(instance.definitionId)?.category !== "prototyping",
    ),
  };
}

let sequence = 0;
function result(
  rule: ValidationRule,
  severity: ValidationResult["severity"],
  title: string,
  message: string,
  componentIds: string[],
  netIds: string[],
  remediation?: string,
): ValidationResult {
  sequence += 1;
  return {
    id: `${rule.toLowerCase()}_${sequence}`,
    rule,
    severity,
    title,
    message,
    componentIds,
    netIds,
    ...(remediation ? { remediation } : {}),
  };
}

/** Reset the id counter so a design's result ids are stable per compilation. */
function resetSequence(): void {
  sequence = 0;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function powerVoltageOutOfRange(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  for (const placement of context.circuit.peripherals) {
    const { definition, instance, supplyVoltage, supplyNetId } = placement;
    if (supplyVoltage === null || supplyNetId === null) continue;
    const minimum = definition.electrical.minimumSupplyVoltage;
    const maximum = definition.electrical.maximumSupplyVoltage;
    if (minimum !== undefined && supplyVoltage < minimum) {
      findings.push(
        result(
          "POWER_VOLTAGE_OUT_OF_RANGE",
          "error",
          `${instance.reference} is under-powered on the ${supplyVoltage} V rail`,
          `${definition.name} needs at least ${minimum} V, but the closest rail this board offers is ${supplyVoltage} V.`,
          [instance.id],
          [supplyNetId],
          `Power ${instance.reference} from a separate ${minimum} V supply and share the ground, or choose a part that runs at ${supplyVoltage} V.`,
        ),
      );
    }
    if (maximum !== undefined && supplyVoltage > maximum) {
      findings.push(
        result(
          "POWER_VOLTAGE_OUT_OF_RANGE",
          "error",
          `${instance.reference} would be over-powered on the ${supplyVoltage} V rail`,
          `${definition.name} is rated to at most ${maximum} V, and the rail it landed on is ${supplyVoltage} V.`,
          [instance.id],
          [supplyNetId],
          `Move ${instance.reference} to the ${maximum} V rail, or use a module variant with an on-board regulator.`,
        ),
      );
    }
  }
  return findings;
}

function logicLevelMismatch(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const controllerLogic = context.circuit.profile.logicVoltage;
  for (const placement of context.circuit.peripherals) {
    const { definition, instance } = placement;

    for (const signal of placement.signalPins) {
      // A signal the compiler routed through a converter has already crossed
      // the domain safely; reporting it again would be wrong.
      if (signal.viaLevelShifter) continue;
      const pin = definition.pins.find((candidate) => candidate.id === signal.peripheralPinId);
      if (!pin) continue;

      const decision = levelShiftDecision({
        devicePinType: pin.electricalType,
        devicePinMaximumVoltage: pin.maximumVoltage,
        deviceLogicVoltage: definition.electrical.logicVoltage,
        deviceSupplyVoltage: placement.supplyVoltage,
        controllerLogicVoltage: controllerLogic,
        controllerPinMaximumVoltage: controllerLogic,
      });
      if (!decision.needed || !decision.reason) continue;

      const analog =
        pin.electricalType === "analog-input" || pin.electricalType === "analog-output";
      findings.push(
        result(
          "LOGIC_LEVEL_MISMATCH",
          decision.reason === "device-input-undervoltage" ? "warning" : "error",
          `${instance.reference} ${pin.label} crosses a voltage domain`,
          `On ${instance.reference} ${pin.label}, ${describeLevelShift(decision.reason)} — ${
            decision.lowVoltage
          } V against ${decision.highVoltage} V at ${signal.assignment.controllerPinLabel}.`,
          [instance.id, context.circuit.controllerInstance.id],
          [signal.assignment.netId],
          analog
            ? `Scale the analog signal with a resistor divider; a logic level converter would destroy the value.`
            : `Put a logic level converter between ${instance.reference} ${pin.label} and ${signal.assignment.controllerPinLabel}, or use a variant of this part that matches the board.`,
        ),
      );
    }
  }
  return findings;
}

function gpioOvercurrent(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const limit = context.circuit.profile.maximumPinCurrentMa;
  const logicVoltage = context.circuit.profile.logicVoltage;

  for (const placement of context.circuit.peripherals) {
    const { definition, instance } = placement;
    if (!placement.signalPins.length) continue;
    // Only parts drawing their working current through the signal pin count —
    // a part on a supply rail is checked by the rail budget rule instead.
    if (placement.supplyNetId !== null) continue;
    // A switch or a jumper carries current, it does not consume it. Its current
    // figures are contact ratings, and reading those as a draw would flag every
    // plain button as overloading the pin it sits on.
    if (isContactOnly(definition)) continue;

    const seriesResistor =
      typeof instance.properties.seriesResistor === "string"
        ? instance.properties.seriesResistor
        : undefined;
    const draw = definition.rules.requiresCurrentLimiting
      ? ledDriveCurrentMa({
          logicVoltage,
          forwardVoltage: definition.electrical.typicalSupplyVoltage,
          seriesResistorValue: seriesResistor,
        }) ?? definition.electrical.maximumCurrentMa
      : definition.electrical.maximumCurrentMa ?? definition.electrical.typicalCurrentMa;

    if (draw === undefined || draw === null || draw <= limit) continue;
    findings.push(
      result(
        "GPIO_OVERCURRENT",
        "error",
        `${instance.reference} draws more than one pin can supply`,
        `${definition.name} pulls about ${draw} mA through ${placement.signalPins[0].assignment.controllerPinLabel}, above the ${limit} mA a single pin on ${context.circuit.controllerDefinition.name} should carry.`,
        [instance.id],
        placement.signalPins.map((signal) => signal.assignment.netId),
        seriesResistor
          ? "Increase the series resistor, or drive the load through a transistor."
          : "Drive the load through a transistor or a driver module and power it from a rail.",
      ),
    );
  }
  return findings;
}

function gpioDrivingHighCurrentLoad(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const limit = context.circuit.profile.maximumPinCurrentMa;
  for (const placement of context.circuit.peripherals) {
    const { definition, instance, supplyNetId } = placement;

    // A load the library says needs a driver must actually have one between it
    // and the controller.
    if (definition.rules.requiresDriver) {
      const nets = context.netsByComponent.get(instance.id) ?? [];
      const driven = nets.some((net) =>
        net.connections.some((connection) => {
          const other = context.circuit.components.find(
            (candidate) => candidate.id === connection.componentId,
          );
          return other?.definitionId === "mosfet-logic-level";
        }),
      );
      if (!driven) {
        findings.push(
          result(
            "GPIO_DRIVING_HIGH_CURRENT_LOAD",
            "error",
            `${instance.reference} has no driver between it and the controller`,
            `${definition.name} draws about ${
              definition.electrical.typicalCurrentMa ?? "more than a pin can supply"
            } mA and switches an inductive load. A controller pin cannot do that directly.`,
            [instance.id, context.circuit.controllerInstance.id],
            nets.map((net) => net.id),
            "Switch it with a logic-level MOSFET on the low side and drive only the gate from the controller.",
          ),
        );
      }
      continue;
    }

    if (!supplyNetId) continue;
    const net = context.netById.get(supplyNetId);
    if (!net || net.role === "power") continue;
    const draw = definition.electrical.typicalCurrentMa ?? 0;
    if (draw > limit) {
      findings.push(
        result(
          "GPIO_DRIVING_HIGH_CURRENT_LOAD",
          "error",
          `${instance.reference} is powered from a signal pin`,
          `${definition.name} draws about ${draw} mA and its supply pin sits on ${net.name}, which is a controller signal rather than a power rail.`,
          [instance.id],
          [supplyNetId],
          "Move the supply pin to a power rail and keep only the control signal on the controller pin.",
        ),
      );
    }
  }
  return findings;
}

function estimatedSupplyOvercurrent(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  for (const rail of context.circuit.profile.rails) {
    const netId = context.circuit.railNetIdByVoltage[String(rail.voltage)];
    if (!netId) continue;
    const load = context.circuit.currentEstimate.perRailTypicalMa[netId] ?? 0;
    if (load <= rail.budgetMa) continue;
    const onRail = context.circuit.peripherals
      .filter((placement) => placement.supplyNetId === netId)
      .map((placement) => placement.instance.id);
    findings.push(
      result(
        "ESTIMATED_SUPPLY_OVERCURRENT",
        "error",
        `The ${rail.voltage} V rail is over budget`,
        `The parts on ${rail.voltage} V draw about ${Math.round(load)} mA together, above the ${rail.budgetMa} mA this board's ${rail.voltage} V output can supply.`,
        onRail,
        [netId],
        "Power the heavy parts from their own supply and connect the grounds together.",
      ),
    );
  }

  // Peak draw matters for motors even when the typical figure fits.
  const peak = context.circuit.currentEstimate.totalMaximumMa;
  const usbBudget = 500;
  if (peak > usbBudget && context.circuit.currentEstimate.totalTypicalMa <= usbBudget) {
    findings.push(
      result(
        "ESTIMATED_SUPPLY_OVERCURRENT",
        "warning",
        "Peak current can exceed a USB port's budget",
        `Typical draw is about ${Math.round(context.circuit.currentEstimate.totalTypicalMa)} mA, but worst case reaches about ${Math.round(peak)} mA — more than the ${usbBudget} mA a USB port supplies.`,
        context.circuit.peripherals
          .filter(
            (placement) =>
              (placement.definition.electrical.maximumCurrentMa ?? 0) >
              (placement.definition.electrical.typicalCurrentMa ?? 0) * 1.5,
          )
          .map((placement) => placement.instance.id),
        [],
        "Use a separate regulated supply for the motors or relays and share the ground with the board.",
      ),
    );
  }
  return findings;
}

function missingGroundAndPower(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const groundNet = context.netById.get(context.circuit.groundNetId);
  for (const instance of context.parts) {
    const definition = context.definitionOf(instance);
    if (!definition) continue;
    const needsGround = definition.pins.some(
      (pin) => pin.electricalType === "ground" && !pin.functions.includes("optional"),
    );
    if (needsGround) {
      const grounded = groundNet?.connections.some(
        (connection) => connection.componentId === instance.id,
      );
      if (!grounded) {
        findings.push(
          result(
            "MISSING_GROUND",
            "error",
            `${instance.reference} has no ground connection`,
            `${definition.name} has a ground pin that is not tied to the project ground net.`,
            [instance.id],
            [context.circuit.groundNetId],
            `Run a wire from ${instance.reference} GND to the ground rail.`,
          ),
        );
      }
    }

    const supplyPin = definition.pins.find((pin) => pin.electricalType === "power-input");
    if (supplyPin) {
      const nets = context.netsByComponent.get(instance.id) ?? [];
      const powered = nets.some(
        (net) =>
          net.role === "power" &&
          net.connections.some(
            (connection) =>
              connection.componentId === instance.id && connection.pinId === supplyPin.id,
          ),
      );
      if (!powered) {
        findings.push(
          result(
            "MISSING_POWER",
            "error",
            `${instance.reference} has no supply connection`,
            `${definition.name} needs power on ${supplyPin.label}, but that pin is not on a power rail.`,
            [instance.id],
            [],
            `Run a wire from ${instance.reference} ${supplyPin.label} to the correct power rail.`,
          ),
        );
      }
    }
  }
  return findings;
}

function requiredPinUnconnected(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  for (const instance of context.parts) {
    const definition = context.definitionOf(instance);
    if (!definition) continue;
    const nets = context.netsByComponent.get(instance.id) ?? [];
    const connectedPins = new Set(
      nets.flatMap((net) =>
        net.connections
          .filter((connection) => connection.componentId === instance.id)
          .map((connection) => connection.pinId),
      ),
    );
    for (const pin of definition.pins) {
      if (pin.functions.includes("optional") || pin.functions.includes("not-connected")) continue;
      if (pin.electricalType === "passive" && definition.category === "passive") continue;
      if (connectedPins.has(pin.id)) continue;
      findings.push(
        result(
          "REQUIRED_PIN_UNCONNECTED",
          "error",
          `${instance.reference} ${pin.label} is not connected`,
          `${definition.name} needs ${pin.label} wired for the part to work, and no net reaches it.`,
          [instance.id],
          [],
          `Connect ${instance.reference} ${pin.label}.`,
        ),
      );
    }
  }
  return findings;
}

function outputOutputConflict(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  for (const net of context.circuit.nets) {
    if (net.role === "power" || net.role === "ground") continue;
    // A shared bus is meant to have several potential drivers: SPI slaves put
    // MISO into high impedance unless selected, and I²C is open-drain.
    if (
      net.role === "spi-data" ||
      net.role === "spi-clock" ||
      net.role === "i2c-sda" ||
      net.role === "i2c-scl"
    ) {
      continue;
    }
    const drivers: Array<{ instance: ComponentInstance; pinLabel: string }> = [];
    for (const connection of net.connections) {
      const instance = context.circuit.components.find(
        (candidate) => candidate.id === connection.componentId,
      );
      if (!instance) continue;
      const definition = context.definitionOf(instance);
      const pin = definition?.pins.find((candidate) => candidate.id === connection.pinId);
      if (!pin) continue;
      if (pin.electricalType === "digital-output" || pin.electricalType === "analog-output") {
        drivers.push({ instance, pinLabel: pin.label });
      }
    }
    if (drivers.length > 1) {
      findings.push(
        result(
          "OUTPUT_OUTPUT_CONFLICT",
          "error",
          `${net.name} is driven by more than one output`,
          `${drivers
            .map((driver) => `${driver.instance.reference} ${driver.pinLabel}`)
            .join(" and ")} both drive ${net.name}. Two outputs fighting over one net can damage both parts.`,
          drivers.map((driver) => driver.instance.id),
          [net.id],
          "Give each output its own net, or use open-drain outputs with a single pull-up.",
        ),
      );
    }
  }
  return findings;
}

function i2cPullupsMissing(context: RuleContext): ValidationResult[] {
  const sda = context.netById.get("net_i2c_sda");
  if (!sda) return [];
  const modulesWithPullups = context.circuit.peripherals.filter(
    (placement) =>
      placement.interfaceKind === "i2c" && placement.definition.rules.requiresPullups === false,
  );
  if (modulesWithPullups.length) return [];
  const hasResistor = sda.connections.some((connection) => {
    const instance = context.circuit.components.find(
      (candidate) => candidate.id === connection.componentId,
    );
    return instance?.definitionId === "resistor";
  });
  if (hasResistor) return [];
  return [
    result(
      "I2C_PULLUPS_MISSING",
      "error",
      "The I²C bus has no pull-up resistors",
      "Nothing on this bus provides pull-ups, so SDA and SCL never return to a high level and no device will answer.",
      context.circuit.peripherals
        .filter((placement) => placement.interfaceKind === "i2c")
        .map((placement) => placement.instance.id),
      [sda.id],
      "Add a 4.7 kΩ resistor from SDA and from SCL to the bus supply rail.",
    ),
  ];
}

function ledResistorMissing(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  for (const instance of context.parts) {
    const definition = context.definitionOf(instance);
    if (!definition?.rules.requiresCurrentLimiting) continue;
    const nets = context.netsByComponent.get(instance.id) ?? [];
    const seriesResistor = nets.some((net) =>
      net.connections.some((connection) => {
        const candidate = context.circuit.components.find(
          (component) => component.id === connection.componentId,
        );
        return candidate?.definitionId === "resistor";
      }),
    );
    if (!seriesResistor) {
      findings.push(
        result(
          "LED_RESISTOR_MISSING",
          "error",
          `${instance.reference} has no series resistor`,
          `${definition.name} has no internal current limiting. Without a series resistor it draws whatever the pin can source and both parts can be damaged.`,
          [instance.id],
          nets.map((net) => net.id),
          "Put a resistor in series with the LED between the controller pin and the anode.",
        ),
      );
    }
  }
  return findings;
}

function inductiveLoadProtectionMissing(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  for (const instance of context.parts) {
    const definition = context.definitionOf(instance);
    if (!definition?.rules.requiresFlybackDiode) continue;
    const nets = context.netsByComponent.get(instance.id) ?? [];
    const protectedByDiode = nets.some((net) =>
      net.connections.some((connection) => {
        const other = context.circuit.components.find(
          (candidate) => candidate.id === connection.componentId,
        );
        return componentDefinition(other?.definitionId ?? "")?.category === "semiconductor" &&
          other?.definitionId.startsWith("diode");
      }),
    );
    if (protectedByDiode) continue;
    findings.push(
      result(
        "INDUCTIVE_LOAD_PROTECTION_MISSING",
        "error",
        `${instance.reference} needs a flyback path`,
        `${definition.name} is an inductive load. Switching it without a flyback diode across the coil sends a high-voltage spike back into the driver.`,
        [instance.id],
        nets.map((net) => net.id),
        "Use a driver module that includes the diode, or fit a 1N4007 across the load, cathode to the positive side.",
      ),
    );
  }
  return findings;
}

function pinAssignmentIntegrity(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  const controllerPins = new Set(
    context.circuit.controllerDefinition.pins.map((pin) => pin.id),
  );
  const byPin = new Map<string, string[]>();

  for (const assignment of context.circuit.assignments) {
    if (!controllerPins.has(assignment.controllerPinId)) {
      findings.push(
        result(
          "INVALID_CONTROLLER_PIN",
          "error",
          `${assignment.controllerPinId} is not a pin on this board`,
          `The compiler recorded an assignment to ${assignment.controllerPinId}, which ${context.circuit.controllerDefinition.name} does not have.`,
          [context.circuit.controllerInstance.id],
          [assignment.netId],
        ),
      );
      continue;
    }
    if (assignment.purpose === "power" || assignment.purpose === "ground") continue;
    const shared =
      assignment.purpose.startsWith("i2c-") || assignment.purpose.startsWith("spi-");
    const key = assignment.controllerPinId;
    const nets = byPin.get(key) ?? [];
    if (!nets.includes(assignment.netId)) nets.push(assignment.netId);
    byPin.set(key, nets);
    if (!shared && nets.length > 1) {
      const pinLabel =
        context.circuit.controllerDefinition.pins.find((pin) => pin.id === key)?.label ?? key;
      findings.push(
        result(
          "DUPLICATE_PIN_ASSIGNMENT",
          "error",
          `${pinLabel} is assigned twice`,
          `Controller pin ${pinLabel} carries ${nets.length} different signals. One pin can only serve one signal.`,
          [context.circuit.controllerInstance.id],
          nets,
          "Move one of the signals to a free pin.",
        ),
      );
    }
  }

  for (const assignment of context.circuit.assignments) {
    const caution = context.circuit.profile.cautionPins[assignment.controllerPinId];
    if (!caution) continue;
    if (assignment.purpose === "power" || assignment.purpose === "ground") continue;
    findings.push(
      result(
        "BOOT_STRAP_PIN_WARNING",
        "warning",
        `${assignment.controllerPinLabel} has a boot or console role`,
        caution,
        [assignment.componentId ?? context.circuit.controllerInstance.id],
        [assignment.netId],
        "Move the signal to a plain GPIO if the board misbehaves at power-up or during upload.",
      ),
    );
  }
  return findings;
}

function unknownElectricalValues(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  for (const instanceId of context.circuit.currentEstimate.unknownComponentIds) {
    const instance = context.circuit.components.find((candidate) => candidate.id === instanceId);
    if (!instance) continue;
    findings.push(
      result(
        "UNKNOWN_ELECTRICAL_VALUE",
        "warning",
        `${instance.reference} has no documented current draw`,
        `The library has no current figure for ${instance.name}, so it is missing from the total. The estimate below is a lower bound.`,
        [instance.id],
        [],
        "Check the part's datasheet and confirm the supply can carry it before powering up.",
      ),
    );
  }
  return findings;
}

/**
 * A board sitting on a breadboard with nothing attached is not a circuit. It is
 * what a product-level brief produces when interpretation named no part at all,
 * and without this rule every other rule finds nothing wrong and the pipeline
 * calls that bare board ready.
 */
function nothingConnected(context: RuleContext): ValidationResult[] {
  if (context.parts.length) return [];
  return [
    result(
      "EMPTY_DESIGN",
      "error",
      "Nothing is connected to the board",
      `This blueprint is a bare ${context.circuit.controllerDefinition.name}: no sensor, display, control or other part was added, so there is no circuit to build.`,
      [context.circuit.controllerInstance.id],
      [],
      "Name the parts the project needs — a display, buttons, a sensor — and compile again. If it really is meant to run on the board alone, blinking the built-in LED for instance, this one can be ignored.",
    ),
  ];
}

/**
 * Some useful catalog entries exist only to reserve physical space while a
 * vendor part is still undecided. Passive optics and mounts are complete in
 * that role; a display, camera, battery or speaker is not, because the circuit
 * cannot be powered or wired until its actual electrical interface is known.
 */
function electricalPlaceholders(context: RuleContext): ValidationResult[] {
  const findings: ValidationResult[] = [];
  for (const instance of context.circuit.components) {
    if (instance.id === context.circuit.controllerInstance.id) continue;
    const definition = context.definitionOf(instance);
    if (!definition?.rules.electricalPlaceholder) continue;
    findings.push(
      result(
        "ELECTRICAL_PLACEHOLDER",
        "error",
        `${instance.reference} is only a mechanical/BOM reference`,
        `${instance.name} reserves physical space, but it does not identify a real electrically specified part or define the supply, pins and interface needed to wire it. This blueprint is not build-ready while that placeholder remains.`,
        [instance.id],
        [],
        "Choose a real manufacturer part or module, add its supply voltage, current draw, pins and interface to the component library, then compile again.",
      ),
    );
  }
  return findings;
}

/**
 * Electrical correctness cannot prove that a product does what its brief says.
 * Keep a small set of high-confidence, product-level completeness checks here
 * so an electrically valid controller plus touch button is never labelled as
 * a complete near-eye display. These checks report missing subsystems; they do
 * not silently invent components or claim an optical prescription is solved.
 */
function missingProductRequirements(
  context: RuleContext,
  request?: HardwareProjectRequest,
  sourceBrief = "",
): ValidationResult[] {
  if (!request) return [];
  const brief = [
    sourceBrief,
    request.title ?? "",
    request.purpose,
    ...request.inputs.map((entry) => entry.type),
    ...request.outputs.map((entry) => entry.type),
  ]
    .join(" ")
    .toLowerCase();
  const isNearEyeDisplay =
    /\b(?:augmented[ -]?reality|near[ -]?eye|head[ -]?up display|hud|smart glasses?|ar glasses?)\b/.test(
      brief,
    );
  if (!isNearEyeDisplay) return [];

  const instancesByDefinition = new Map(
    context.circuit.components.map((instance) => [instance.definitionId, instance]),
  );
  const requirements = [
    {
      label: "near-eye microdisplay",
      accepted: ["micro-oled-display"],
      why: "The image source must be small and optically suitable for a near-eye projection path.",
    },
    {
      label: "focusing or collimating optic",
      accepted: ["ar-focusing-lens"],
      why: "A bare display cannot form a viewable virtual image at the eye.",
    },
    {
      label: "optical combiner",
      accepted: ["optical-combiner-waveguide", "optical-combiner-birdbath"],
      why: "The display image needs a declared optical path into the user's field of view.",
    },
    {
      label: "retained eyeglass interface",
      accepted: ["eyeglass-temple-clip", "eyeglass-bridge-mount"],
      why: "A wearable attachment needs a positive, dimensioned connection to the host frame.",
    },
  ] as const;

  return requirements.flatMap((requirement) => {
    if (requirement.accepted.some((id) => instancesByDefinition.has(id))) return [];
    return [
      result(
        "MISSING_PRODUCT_REQUIREMENT",
        "error",
        `The design is missing its ${requirement.label}`,
        requirement.why,
        [context.circuit.controllerInstance.id],
        [],
        `Choose a measured ${requirement.label} from the component library, include it in the request, and recompile before generating the physical assembly.`,
      ),
    ];
  });
}

function fromCompilerNotes(notes: CompilerNote[]): ValidationResult[] {
  return notes.map((note) =>
    result(
      (VALIDATION_RULES as readonly string[]).includes(note.rule)
        ? (note.rule as ValidationRule)
        : "UNSUPPORTED_COMPONENT",
      note.severity,
      note.title,
      note.message,
      note.componentIds,
      note.netIds,
      note.remediation,
    ),
  );
}

// ---------------------------------------------------------------------------

export function validateCircuit(
  circuit: CompiledCircuit,
  request?: HardwareProjectRequest,
  sourceBrief?: string,
): ValidationResult[] {
  resetSequence();
  const context = makeContext(circuit);
  return [
    ...fromCompilerNotes(circuit.notes),
    ...electricalPlaceholders(context),
    ...missingProductRequirements(context, request, sourceBrief),
    ...nothingConnected(context),
    ...powerVoltageOutOfRange(context),
    ...logicLevelMismatch(context),
    ...gpioOvercurrent(context),
    ...gpioDrivingHighCurrentLoad(context),
    ...estimatedSupplyOvercurrent(context),
    ...missingGroundAndPower(context),
    ...requiredPinUnconnected(context),
    ...outputOutputConflict(context),
    ...i2cPullupsMissing(context),
    ...ledResistorMissing(context),
    ...inductiveLoadProtectionMissing(context),
    ...pinAssignmentIntegrity(context),
    ...unknownElectricalValues(context),
  ].sort(severityOrder);
}

function severityOrder(left: ValidationResult, right: ValidationResult): number {
  const weight = (severity: ValidationResult["severity"]) =>
    severity === "error" ? 0 : severity === "warning" ? 1 : 2;
  return weight(left.severity) - weight(right.severity);
}

export function designStatus(
  results: ValidationResult[],
  options: { conceptOnly?: boolean } = {},
): HardwareProjectStatus {
  if (options.conceptOnly) return "concept-only";
  if (results.some((entry) => entry.severity === "error")) return "needs-changes";
  if (results.some((entry) => entry.severity === "warning")) return "ready-with-warnings";
  return "ready";
}

export function countBySeverity(results: ValidationResult[]): {
  errors: number;
  warnings: number;
  info: number;
} {
  return {
    errors: results.filter((entry) => entry.severity === "error").length,
    warnings: results.filter((entry) => entry.severity === "warning").length,
    info: results.filter((entry) => entry.severity === "info").length,
  };
}
