// The Legal Agent's chat identity: the slash command that activates it, and the
// parsing of a message into a legal assignment.
//
// The runtime underneath is Harvey LAB's execution harness (`harvey-labs/`),
// but the agent is named for the work rather than the stack — the same reason
// the Postiz agent is the Socials Manager. Nobody asks for "a LAB harness run";
// they ask for a contract to be reviewed.
//
// Imported by client components and by API routes, so it stays free of
// server-only imports.

export const LEGAL_COMMAND = "/agents:legal";
export const LEGAL_AGENT_ID = "legal";
export const LEGAL_AGENT_NAME = "Legal Agent";

/** The document skills the harness can load. Each is a manual plus scripts. */
export const LEGAL_SKILL_IDS = ["docx", "xlsx", "pptx"] as const;
export type LegalSkillId = (typeof LEGAL_SKILL_IDS)[number];

export const DEFAULT_MAX_TURNS = 60;
export const MIN_MAX_TURNS = 5;
export const MAX_MAX_TURNS = 200;

/** Reasoning efforts the harness passes through to the model. */
export const LEGAL_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type LegalEffort = (typeof LEGAL_EFFORTS)[number];

export interface LegalRequest {
  /** The assignment, in the user's own words, minus every flag. */
  task: string;
  /** How many model turns the run may take before it is stopped. */
  maxTurns: number;
  /** Which document skills are loaded into the system prompt. */
  skills: LegalSkillId[];
  /** Reasoning effort, or null to follow the chat's own setting. */
  effort: LegalEffort | null;
  /**
   * Whether the agent may run shell commands. Off means the `bash` tool is not
   * offered at all — the harness's own sandbox is a container Breadboard does
   * not have, so this switch is the boundary that replaces it.
   */
  allowShell: boolean;
}

export function legalUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${LEGAL_COMMAND} ${trimmed}` : LEGAL_COMMAND;
}

/**
 * The assignment with the token removed. Any other slash token stacked in front
 * is preserved, so the capability resolver still sees what the person asked
 * for rather than a message this agent has quietly eaten.
 */
export function taskFromLegalCommand(value: string): string | null {
  const match = value.trimStart().match(/^\/agents:legal(?:\s+|$)/i);
  if (!match) return null;
  return value.trimStart().slice(match[0].length).trim();
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function parseSkillList(value: string): LegalSkillId[] | null {
  const requested = value
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is LegalSkillId =>
      (LEGAL_SKILL_IDS as readonly string[]).includes(entry),
    );
  return requested.length ? [...new Set(requested)] : null;
}

/**
 * Split a message into the assignment and the shape of the run. Every option is
 * an inline flag so chat stays the only surface a person needs:
 * `--turns 40` / `-t 40`, `--effort high`, `--skills docx,xlsx`, `--no-skills`,
 * `--shell` / `--no-shell`. Anything unrecognized stays part of the assignment,
 * because a legal instruction is prose and prose contains dashes.
 *
 * `defaults` is where the request starts before any flag is read — the user's
 * saved settings, when the caller has them. A flag in the message still wins,
 * which is the whole precedence rule.
 */
export function parseLegalRequest(
  task: string,
  defaults?: Partial<Omit<LegalRequest, "task">>,
): LegalRequest {
  let maxTurns = clamp(defaults?.maxTurns ?? DEFAULT_MAX_TURNS, MIN_MAX_TURNS, MAX_MAX_TURNS);
  let skills = defaults?.skills ?? [...LEGAL_SKILL_IDS];
  let effort = defaults?.effort ?? null;
  let allowShell = defaults?.allowShell ?? true;

  const cleaned = task
    .replace(/(?:^|\s)--no-skills\b/gi, () => {
      skills = [];
      return " ";
    })
    .replace(/(?:^|\s)--skills[= ]([a-z,\s]+?)(?=\s--|\s*$)/gi, (_match, value: string) => {
      skills = parseSkillList(value) ?? skills;
      return " ";
    })
    .replace(/(?:^|\s)(?:--turns|-t)[= ](\d{1,3})\b/gi, (_match, value: string) => {
      maxTurns = clamp(Number(value), MIN_MAX_TURNS, MAX_MAX_TURNS);
      return " ";
    })
    .replace(/(?:^|\s)--effort[= ]([a-z]+)\b/gi, (_match, value: string) => {
      const requested = value.toLowerCase();
      // "max" is what a person types; the harness speaks the provider's word.
      const normalized = requested === "max" ? "xhigh" : requested;
      if ((LEGAL_EFFORTS as readonly string[]).includes(normalized)) {
        effort = normalized as LegalEffort;
      }
      return " ";
    })
    .replace(/(?:^|\s)--no-shell\b/gi, () => {
      allowShell = false;
      return " ";
    })
    .replace(/(?:^|\s)--shell\b/gi, () => {
      allowShell = true;
      return " ";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

  return { task: cleaned, maxTurns, skills, effort, allowShell };
}

/** The one-line label a run card and a saved turn are addressed by. */
export function legalRunLabel(request: { task: string }): string {
  const first = request.task.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return first.length > 120 ? `${first.slice(0, 117)}…` : first || "Legal assignment";
}
