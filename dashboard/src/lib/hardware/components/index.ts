// The component library: the single place a definition or controller profile is
// looked up from. Nothing outside this module may invent a part.

import type { ComponentDefinition, ControllerProfile } from "../types.ts";
import { ACTUATOR_DEFINITIONS } from "./actuators.ts";
import { BASIC_DEFINITIONS } from "./basics.ts";
import { COMMS_DEFINITIONS } from "./comms.ts";
import { CONTROL_DEFINITIONS } from "./controls.ts";
import { CONTROLLER_DEFINITIONS, CONTROLLER_PROFILES } from "./controllers.ts";
import {
  AVR_CONTROLLER_DEFINITIONS,
  AVR_CONTROLLER_PROFILES,
} from "./controllers-avr.ts";
import { DISPLAY_DEFINITIONS } from "./displays.ts";
import { MODULE_DEFINITIONS } from "./modules.ts";
import { POWER_DEFINITIONS } from "./power.ts";
import { SENSOR_DEFINITIONS } from "./sensors.ts";
import { EXPANDED_COMPONENT_DEFINITIONS } from "./expanded-catalog.ts";

export const COMPONENT_DEFINITIONS: readonly ComponentDefinition[] = Object.freeze([
  ...CONTROLLER_DEFINITIONS,
  ...AVR_CONTROLLER_DEFINITIONS,
  ...MODULE_DEFINITIONS,
  ...SENSOR_DEFINITIONS,
  ...DISPLAY_DEFINITIONS,
  ...CONTROL_DEFINITIONS,
  ...COMMS_DEFINITIONS,
  ...ACTUATOR_DEFINITIONS,
  ...POWER_DEFINITIONS,
  ...BASIC_DEFINITIONS,
  ...EXPANDED_COMPONENT_DEFINITIONS,
]);

const byId = new Map(COMPONENT_DEFINITIONS.map((definition) => [definition.id, definition]));
const allProfiles = [...CONTROLLER_PROFILES, ...AVR_CONTROLLER_PROFILES];
const profilesById = new Map(allProfiles.map((profile) => [profile.definitionId, profile]));

export function componentDefinition(id: string): ComponentDefinition | null {
  return byId.get(id) ?? null;
}

export function controllerProfile(definitionId: string): ControllerProfile | null {
  return profilesById.get(definitionId) ?? null;
}

export function isController(definitionId: string): boolean {
  return profilesById.has(definitionId);
}

export function controllerDefinitions(): ComponentDefinition[] {
  return [...CONTROLLER_DEFINITIONS, ...AVR_CONTROLLER_DEFINITIONS];
}

/** Parts that feed the project rather than being fed by it. */
export function isPowerSource(definitionId: string): boolean {
  return byId.get(definitionId)?.category === "power-source";
}

export { allProfiles as CONTROLLER_PROFILES };
export * from "./actuators.ts";
export * from "./basics.ts";
export * from "./comms.ts";
export * from "./controls.ts";
export * from "./controllers.ts";
export * from "./controllers-avr.ts";
export * from "./displays.ts";
export * from "./modules.ts";
export * from "./power.ts";
export * from "./sensors.ts";
