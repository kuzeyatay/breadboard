// The Career Ops agent's chat identity: the slash command that reaches it, and
// the parsing of a prompt into a run request.
//
// Mirrors the Agent Reach / Deep Research / Hardware Blueprint identity modules
// so every runtime agent is reached the same way — pick it from the Agents tab
// or the slash menu, prompt it in chat, and its own surface appears inline for
// that turn.

export const CAREER_OPS_COMMAND = "/agents:career-ops";
export const CAREER_OPS_AGENT_ID = "career-ops";
export const CAREER_OPS_AGENT_NAME = "Career Ops";

/**
 * The router modes career-ops itself publishes, in the order its discovery menu
 * lists them. Breadboard keeps the list only to offer completions and to tell a
 * mode word apart from a pasted job description — the mode instructions
 * themselves are always read from the clone at run time.
 */
export const CAREER_OPS_MODES = [
  "scan",
  "discover",
  "deep",
  "pdf",
  "latex",
  "latex-tex",
  "cover",
  "email",
  "add",
  "expand",
  "eu-swe",
  "eu-fintech",
  "oferta",
  "ofertas",
  "apply",
  "batch",
  "tracker",
  "agent-inbox",
  "inbox",
  "pipeline",
  "contacto",
  "training",
  "project",
  "interview-prep",
  "interview",
  "interview/plan",
  "interview/practice",
  "interview/debrief",
  "interview-redflag",
  "patterns",
  "offer-prep",
  "titles",
  "upskill",
  "followup",
  "reply-watch",
  "outcome",
  "update",
] as const;

export type CareerOpsMode = (typeof CAREER_OPS_MODES)[number];

export interface CareerOpsRequest {
  /** The whole prompt as career-ops's router should see it. */
  task: string;
  /**
   * The router mode when the prompt opens with a known mode word. Null means
   * the router decides for itself: a pasted JD or URL becomes auto-pipeline,
   * anything else becomes the discovery menu.
   */
  mode: CareerOpsMode | null;
  /** Everything after the mode word. */
  argument: string;
}

/**
 * Extract the task, preserving any other slash tokens the user stacked in front
 * of the command so the capability resolver still sees them.
 */
export function taskFromCareerOpsCommand(value: string): string | null {
  let remaining = value.trim();
  const precedingTokens: string[] = [];
  let selected = false;
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    if (match[1].toLowerCase() === "agents:career-ops") {
      selected = true;
    } else {
      precedingTokens.push(`/${match[1]}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }
  if (!selected) return null;
  return [...precedingTokens, remaining].filter(Boolean).join(" ").trim();
}

export function careerOpsUserMessage(task: string): string {
  const trimmed = task.trim();
  return trimmed ? `${CAREER_OPS_COMMAND} ${trimmed}` : CAREER_OPS_COMMAND;
}

const MODE_SET = new Set<string>(CAREER_OPS_MODES);

/**
 * Split a prompt into the router mode and its argument. A leading `/career-ops`
 * is tolerated because that is how the upstream project documents every example,
 * and users paste those verbatim.
 */
export function parseCareerOpsRequest(task: string): CareerOpsRequest {
  const cleaned = task.replace(/^\/career-ops\b\s*/i, "").trim();
  // Nested modes are two words in the docs (`interview plan`) and one token in
  // the routing table (`interview/plan`); accept both.
  const nested = /^([a-z-]+)[\s/]+([a-z-]+)(?:\s+([\s\S]*))?$/i.exec(cleaned);
  if (nested) {
    const candidate = `${nested[1].toLowerCase()}/${nested[2].toLowerCase()}`;
    if (MODE_SET.has(candidate)) {
      return {
        task: cleaned,
        mode: candidate as CareerOpsMode,
        argument: (nested[3] ?? "").trim(),
      };
    }
  }
  const flat = /^([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i.exec(cleaned);
  if (flat) {
    const candidate = flat[1].toLowerCase();
    if (MODE_SET.has(candidate)) {
      return {
        task: cleaned,
        mode: candidate as CareerOpsMode,
        argument: (flat[2] ?? "").trim(),
      };
    }
  }
  return { task: cleaned, mode: null, argument: cleaned };
}
