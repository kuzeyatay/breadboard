// The Parametric CAD agent's chat identity: the slash command that reaches it,
// and the parsing of a prompt into a run request.
//
// Mirrors the Hardware Blueprint / Socials Manager identity modules so every runtime
// agent is reached the same way — pick it from the Agents tab, prompt it in
// chat, and its own surface appears inline for that turn.
//
// This module is imported by client components. It must stay free of
// server-only imports.

export const PARAMETRIC_CAD_COMMAND = "/agents:parametric-cad";
export const PARAMETRIC_CAD_AGENT_ID = "parametric-cad";
export const PARAMETRIC_CAD_AGENT_NAME = "Parametric CAD";

export interface ParametricCadRequest {
  /** What to design, with the flags stripped out. */
  brief: string;
  /** Manufacturing process named with `--fdm|--sla|--sls`. */
  process: "fdm" | "sla" | "sls" | null;
  /** Printer bed named with `--bed 250x250x300`, in millimetres. */
  printerBed: { x: number; y: number; z: number } | null;
  /** Units named with `--inch`. Geometry stays millimetre-native either way. */
  units: "mm" | "inch" | null;
  /** `--fresh` starts a new project instead of revising the one in this chat. */
  fresh: boolean;
}

/**
 * Extract the brief, preserving any other slash tokens the user stacked in
 * front of the command so the capability resolver still sees them.
 */
export function taskFromParametricCadCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:parametric-cad") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function parametricCadUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${PARAMETRIC_CAD_COMMAND} ${trimmed}` : PARAMETRIC_CAD_COMMAND;
}

const BED = /(?:^|\s)--bed[= ](\d{1,4})\s*[x×]\s*(\d{1,4})\s*[x×]\s*(\d{1,4})\b/i;

/**
 * Split a prompt into the brief and its run shape. Options stay inline flags so
 * chat remains the only surface:
 *   `--fdm|--sla|--sls`      the manufacturing process the defaults come from
 *   `--bed 220x220x250`      the printer volume the part must fit
 *   `--inch`                 the design specification is written in inches
 *   `--fresh`                start a new project rather than revise this chat's
 * Anything unrecognized stays part of the brief.
 *
 * `defaults` is the user's saved settings, used only for what the brief leaves
 * unsaid: a flag in the message overwrites it, and `--fresh` is never a
 * preference because it describes this message, not a habit.
 */
export function parseParametricCadRequest(
  task: string,
  defaults?: Partial<Pick<ParametricCadRequest, "process" | "printerBed" | "units">>,
): ParametricCadRequest {
  let process: ParametricCadRequest["process"] = defaults?.process ?? null;
  let printerBed: ParametricCadRequest["printerBed"] = defaults?.printerBed ?? null;
  let units: ParametricCadRequest["units"] = defaults?.units ?? null;
  let fresh = false;

  const bed = BED.exec(task);
  if (bed) {
    printerBed = { x: Number(bed[1]), y: Number(bed[2]), z: Number(bed[3]) };
  }

  const brief = task
    .replace(BED, " ")
    .replace(/(?:^|\s)--(fdm|sla|sls)\b/gi, (_match, value: string) => {
      process = value.toLowerCase() as ParametricCadRequest["process"];
      return " ";
    })
    .replace(/(?:^|\s)--(inch|mm)\b/gi, (_match, value: string) => {
      units = value.toLowerCase() === "inch" ? "inch" : "mm";
      return " ";
    })
    .replace(/(?:^|\s)--fresh\b/gi, () => {
      fresh = true;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  return { brief, process, printerBed, units, fresh };
}
