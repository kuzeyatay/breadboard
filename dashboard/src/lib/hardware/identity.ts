// The Hardware Blueprint agent's chat identity: the slash command that reaches
// it, and the parsing of a prompt into a run request.
//
// Mirrors the Socials Manager / Deep Research identity modules so every runtime agent is
// reached the same way — pick it from the Agents tab, prompt it in chat, and its
// own surface appears inline for that turn.

import { isCadBackendPreference, type CadBackendPreference } from "../cad/engines.ts";

export const HARDWARE_BLUEPRINT_COMMAND = "/agents:hardware-blueprint";
export const HARDWARE_BLUEPRINT_AGENT_ID = "hardware-blueprint";
export const HARDWARE_BLUEPRINT_AGENT_NAME = "Hardware Blueprint";

export interface HardwareBlueprintRequest {
  /** What to build, with the flags stripped out. */
  brief: string;
  /** Board named with `--board`, kept verbatim for the compiler to resolve. */
  board: string | null;
  prototypeType: "breadboard" | "perfboard" | "pcb" | null;
  firmwarePlatform: "arduino" | "platformio" | null;
  /**
   * Whether the run should also design a printable enclosure through the
   * Parametric CAD agent. Null means the brief's own wording decides.
   */
  enclosure: boolean | null;
  /**
   * The CAD backend this one message asks for. Null means the saved preference
   * decides. Separate from `enclosure`, which decides *whether* there is any
   * mechanical CAD at all — this only decides which engine builds it.
   */
  cadBackend: CadBackendPreference | null;
}

/**
 * Extract the brief, preserving any other slash tokens the user stacked in
 * front of the command so the capability resolver still sees them.
 */
export function taskFromHardwareBlueprintCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:hardware-blueprint") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function hardwareBlueprintUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${HARDWARE_BLUEPRINT_COMMAND} ${trimmed}` : HARDWARE_BLUEPRINT_COMMAND;
}

/**
 * Split a prompt into the brief and its run shape. Options stay inline flags so
 * chat remains the only surface:
 *   `--board esp32`                choose the controller
 *   `--breadboard|--perfboard|--pcb`  choose the build style
 *   `--arduino`                    generate an Arduino IDE sketch instead of PlatformIO
 *   `--enclosure|--no-enclosure`   design a printable case for it, or do not
 *   `--cad solidworks`             which CAD backend builds the mechanical part
 * Anything unrecognized stays part of the brief.
 */
export function parseHardwareBlueprintRequest(task: string): HardwareBlueprintRequest {
  let board: string | null = null;
  let prototypeType: HardwareBlueprintRequest["prototypeType"] = null;
  let firmwarePlatform: HardwareBlueprintRequest["firmwarePlatform"] = null;
  let enclosure: HardwareBlueprintRequest["enclosure"] = null;
  let cadBackend: HardwareBlueprintRequest["cadBackend"] = null;

  const brief = task
    // Before `--no-enclosure`, because a backend name is a value rather than a
    // switch and must not be left behind in the brief when it is unrecognised.
    .replace(/(?:^|\s)--cad[= ]("[^"]+"|[^\s]+)/gi, (match, value: string) => {
      const requested = value.replace(/^"|"$/g, "").trim().toLowerCase();
      if (!isCadBackendPreference(requested)) return match;
      cadBackend = requested;
      return " ";
    })
    .replace(/(?:^|\s)--no-enclosure\b/gi, () => {
      enclosure = false;
      return " ";
    })
    .replace(/(?:^|\s)--enclosure\b/gi, () => {
      enclosure = true;
      return " ";
    })
    .replace(/(?:^|\s)--(breadboard|perfboard|pcb)\b/gi, (_match, value: string) => {
      prototypeType = value.toLowerCase() as HardwareBlueprintRequest["prototypeType"];
      return " ";
    })
    .replace(/(?:^|\s)--(arduino|platformio)\b/gi, (_match, value: string) => {
      firmwarePlatform = value.toLowerCase() as HardwareBlueprintRequest["firmwarePlatform"];
      return " ";
    })
    .replace(/(?:^|\s)(?:--board|-b)[= ]("[^"]+"|[^\s]+)/gi, (_match, value: string) => {
      board = value.replace(/^"|"$/g, "").trim() || null;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  return { brief, board, prototypeType, firmwarePlatform, enclosure, cadBackend };
}
