// Small electrical helpers shared by the compiler and the validator, kept apart
// from both so neither has to import the other at runtime.

import type { PinElectricalType } from "./types.ts";

/** Volts of slack before a difference counts as an over-voltage. */
const OVERVOLTAGE_MARGIN = 0.1;
/** A CMOS input's high threshold, as a fraction of its own logic supply. */
const INPUT_HIGH_FRACTION = 0.7;

export type LevelShiftReason =
  | "device-input-overvoltage"
  | "controller-input-overvoltage"
  | "device-input-undervoltage";

export interface LevelShiftDecision {
  needed: boolean;
  reason?: LevelShiftReason;
  /** The higher of the two domains, which the shifter's HV side must sit on. */
  highVoltage?: number;
  lowVoltage?: number;
}

function drivesController(type: PinElectricalType): boolean {
  return (
    type === "digital-output" ||
    type === "digital-io" ||
    type === "open-drain"
  );
}

function listensToController(type: PinElectricalType): boolean {
  return type === "digital-input" || type === "digital-io";
}

/**
 * Whether one signal between a controller pin and a peripheral pin crosses a
 * voltage domain, and which way. The comparison is against each pin's own
 * documented maximum rather than a board-level logic level, because that is
 * what actually decides whether a part survives — a 3.3 V-logic display with
 * 5 V-tolerant pins needs no translation on a 5 V board, and a 3.3 V-only
 * sensor does.
 *
 * Analog signals are never shifted: a digital translator would destroy the
 * value, so those are reported instead of silently "fixed".
 */
export function levelShiftDecision(input: {
  devicePinType: PinElectricalType;
  devicePinMaximumVoltage?: number;
  /** Declared logic level, or undefined when the part follows its supply. */
  deviceLogicVoltage?: number;
  deviceSupplyVoltage?: number | null;
  controllerLogicVoltage: number;
  controllerPinMaximumVoltage?: number;
}): LevelShiftDecision {
  if (input.devicePinType === "analog-input" || input.devicePinType === "analog-output") {
    return { needed: false };
  }
  const deviceHigh = input.deviceLogicVoltage ?? input.deviceSupplyVoltage ?? undefined;
  const domains = (high: number, low: number, reason: LevelShiftReason) => ({
    needed: true,
    reason,
    highVoltage: Math.max(high, low),
    lowVoltage: Math.min(high, low),
  });

  if (
    listensToController(input.devicePinType) &&
    input.devicePinMaximumVoltage !== undefined &&
    input.controllerLogicVoltage > input.devicePinMaximumVoltage + OVERVOLTAGE_MARGIN
  ) {
    return domains(
      input.controllerLogicVoltage,
      deviceHigh ?? input.devicePinMaximumVoltage,
      "device-input-overvoltage",
    );
  }

  if (
    drivesController(input.devicePinType) &&
    deviceHigh !== undefined &&
    input.controllerPinMaximumVoltage !== undefined &&
    deviceHigh > input.controllerPinMaximumVoltage + OVERVOLTAGE_MARGIN
  ) {
    return domains(deviceHigh, input.controllerLogicVoltage, "controller-input-overvoltage");
  }

  if (
    listensToController(input.devicePinType) &&
    input.deviceLogicVoltage !== undefined &&
    input.controllerLogicVoltage < INPUT_HIGH_FRACTION * input.deviceLogicVoltage
  ) {
    return domains(
      input.deviceLogicVoltage,
      input.controllerLogicVoltage,
      "device-input-undervoltage",
    );
  }

  return { needed: false };
}

export function describeLevelShift(reason: LevelShiftReason): string {
  if (reason === "device-input-overvoltage") {
    return "the controller drives more voltage than this pin is rated for";
  }
  if (reason === "controller-input-overvoltage") {
    return "this pin drives more voltage than the controller pin is rated for";
  }
  return "a controller high is below this pin's input threshold";
}

/** "4.7 kΩ" → 4700. Understands plain, k and M suffixes. */
export function parseResistance(value: string): number | null {
  const match = /^\s*([\d.]+)\s*([kKmM])?/.exec(value);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  const suffix = match[2]?.toLowerCase();
  return suffix === "k" ? magnitude * 1_000 : suffix === "m" ? magnitude * 1_000_000 : magnitude;
}

/**
 * Current through a series-limited LED: (Vsupply − Vf) / R. Returns null when
 * either figure is missing, which the unknown-value rule reports separately.
 */
export function ledDriveCurrentMa(input: {
  logicVoltage: number;
  forwardVoltage: number | undefined;
  seriesResistorValue: string | undefined;
}): number | null {
  if (input.forwardVoltage === undefined || !input.seriesResistorValue) return null;
  const ohms = parseResistance(input.seriesResistorValue);
  if (ohms === null || ohms <= 0) return null;
  const headroom = input.logicVoltage - input.forwardVoltage;
  if (headroom <= 0) return 0;
  return Math.round(((headroom / ohms) * 1_000 + Number.EPSILON) * 10) / 10;
}

/**
 * A part that only makes and breaks a connection: every pin is a bare contact
 * and nothing is powered. Switches, jumpers and reed contacts are these. Their
 * current figures are contact ratings, never consumption.
 */
export function isContactOnly(definition: {
  pins: ReadonlyArray<{ electricalType: PinElectricalType }>;
  rules: { requiresCurrentLimiting?: boolean };
}): boolean {
  if (definition.rules.requiresCurrentLimiting) return false;
  return definition.pins.every(
    (pin) => pin.electricalType === "passive" || pin.electricalType === "ground",
  );
}
