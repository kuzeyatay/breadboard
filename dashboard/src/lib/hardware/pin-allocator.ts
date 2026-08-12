// The single source of truth for controller pin assignments.
//
// Every consumer — wiring diagram, schematic, assembly steps and firmware —
// reads the assignments recorded here. Nothing else is allowed to choose a pin,
// which is what keeps the four views from drifting apart.

import type { ComponentDefinition, ComponentPin, ControllerProfile } from "./types.ts";

export type PinPurpose =
  | "i2c-sda"
  | "i2c-scl"
  | "spi-sck"
  | "spi-mosi"
  | "spi-miso"
  | "spi-cs"
  | "uart-tx"
  | "uart-rx"
  | "digital"
  | "pwm"
  | "analog"
  | "power"
  | "ground";

export interface PinAssignment {
  controllerPinId: string;
  controllerPinLabel: string;
  purpose: PinPurpose;
  /** Instance the pin serves, or null for shared bus and supply pins. */
  componentId: string | null;
  /** The peripheral pin this controller pin faces, when there is one. */
  peripheralPinId?: string;
  netId: string;
  /** Firmware constant name, e.g. `PIN_BME280_SDA`. Absent for supply pins. */
  constantName?: string;
}

export type AllocationResult =
  | { ok: true; pin: ComponentPin }
  | { ok: false; reason: string };

export class PinAllocator {
  private readonly profile: ControllerProfile;
  private readonly pinsById: Map<string, ComponentPin>;
  private readonly taken = new Map<string, PinAssignment>();
  private readonly assignments: PinAssignment[] = [];

  constructor(controller: ComponentDefinition, profile: ControllerProfile) {
    this.profile = profile;
    this.pinsById = new Map(controller.pins.map((pin) => [pin.id, pin]));
  }

  pin(pinId: string): ComponentPin | null {
    return this.pinsById.get(pinId) ?? null;
  }

  isTaken(pinId: string): boolean {
    return this.taken.has(pinId);
  }

  assignmentFor(pinId: string): PinAssignment | null {
    return this.taken.get(pinId) ?? null;
  }

  list(): PinAssignment[] {
    return [...this.assignments];
  }

  /** Reserve a named pin. Supply and ground pins may be shared; signals may not. */
  reserve(input: Omit<PinAssignment, "controllerPinLabel">): AllocationResult {
    const pin = this.pinsById.get(input.controllerPinId);
    if (!pin) {
      return { ok: false, reason: `${input.controllerPinId} is not a pin on this board.` };
    }
    const shareable =
      input.purpose === "power" ||
      input.purpose === "ground" ||
      input.purpose === "i2c-sda" ||
      input.purpose === "i2c-scl" ||
      input.purpose === "spi-sck" ||
      input.purpose === "spi-mosi" ||
      input.purpose === "spi-miso";
    const existing = this.taken.get(pin.id);
    if (existing && !shareable) {
      return {
        ok: false,
        reason: `${pin.label} is already used for ${existing.purpose}.`,
      };
    }
    if (existing && shareable && existing.purpose !== input.purpose) {
      return {
        ok: false,
        reason: `${pin.label} is already used for ${existing.purpose}.`,
      };
    }
    const assignment: PinAssignment = { ...input, controllerPinLabel: pin.label };
    this.assignments.push(assignment);
    if (!existing) this.taken.set(pin.id, assignment);
    return { ok: true, pin };
  }

  /** Take the next free pin from an ordered preference list. */
  allocate(
    kind: "digital" | "pwm" | "analog",
    input: Omit<PinAssignment, "controllerPinId" | "controllerPinLabel">,
  ): AllocationResult {
    const order =
      kind === "pwm"
        ? [...this.profile.pwmPinOrder, ...this.profile.digitalPinOrder]
        : kind === "analog"
          ? this.profile.analogPinOrder
          : this.profile.digitalPinOrder;
    for (const candidate of order) {
      if (this.taken.has(candidate)) continue;
      const pin = this.pinsById.get(candidate);
      if (!pin) continue;
      if (kind !== "analog" && pin.functions.includes("input-only")) continue;
      return this.reserve({ ...input, controllerPinId: candidate });
    }
    return {
      ok: false,
      reason:
        kind === "analog"
          ? "The board has no free analog input left."
          : `The board has no free ${kind === "pwm" ? "PWM-capable " : ""}digital pin left.`,
    };
  }

  /** Pins that carry a signal, in assignment order. Supply pins are excluded. */
  signalAssignments(): PinAssignment[] {
    return this.assignments.filter(
      (assignment) => assignment.purpose !== "power" && assignment.purpose !== "ground",
    );
  }
}

/** Firmware-safe constant name, e.g. `PIN_BME280_SDA`. */
export function pinConstantName(reference: string, suffix: string): string {
  const clean = (value: string) =>
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  return `PIN_${clean(reference)}_${clean(suffix)}`;
}
