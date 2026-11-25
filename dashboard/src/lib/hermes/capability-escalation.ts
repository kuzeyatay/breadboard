// The capability decision layer: what happens when the model calls a tool that
// this turn's up-front decision switched off.
//
// Each turn's tools are chosen before the model reads the request, from keyword
// routers, the Super Agent switch and a few hard-coded cases. When those miss
// ("can you launch a swarm?"), the model used to get "agent_launch is disabled
// for this turn" and could only tell the user so. Now Hermes asks here first
// (agent/tool_access_escalation.py, wired by the Breadboard plugin):
//
//   check  -> "granted"   already allowed by the turn's decision
//             "grantable" the plugin raises Hermes's approval card, which YOLO
//                         (and so Super Agent) answers by itself: no card
//             "denied"    with the reason, shown to the model
//   grant  -> after that approval: the turn's decision is widened, so the
//             tool's own route, which re-reads it, accepts the call.
//
// What it never widens: filesystem roots, command operations and isolation.
// Those stay with the capability broker; only the tool name (and the skill a
// skill-gated route checks) is added.

import type { HermesSurface } from "./config.ts";
import type { CapabilityDecision } from "./capability-policy.ts";
import type { RuntimeRunDispatch } from "./run-store.ts";
import type { StoredCapabilityDecision } from "./runtime-store.ts";
import { AUDIO_ANALYSIS_SKILL } from "./audio-intent.ts";
import { BREADBOARD_USE_SKILL } from "./breadboard-use-intent.ts";
import { COMPUTER_USE_SKILL } from "./computer-use-intent.ts";
import { IMAGE_TO_3D_SKILL } from "./image-3d-intent.ts";
import { MANIM_SKILL } from "../manim/identity.ts";
import { MUSIC_RECOGNITION_SKILL } from "../music-recognition/context.ts";
// SPOTIFY_SKILL_SLUG in spotify/service.ts, which is server-only and cannot be
// imported by this pure policy module.
const SPOTIFY_SKILL_SLUG = "spotify";
import { TO_MARKDOWN_SKILLS } from "../to-markdown.ts";
import { SPOTIFY_TOOLS } from "./tool-scopes.ts";

/** Skill a skill-gated route checks in `selectedConditionalSkills`. */
export const SKILL_FOR_TOOL: Readonly<Record<string, string>> = {
  agent_loop_run: "agent-loop-engineering",
  factcheck_run: "bullshit-detector",
  messaging_send: "send-to-my-phone",
  omh_run: "oh-my-hermes",
  premortem_run: "premortem",
  watch_run: "watch",
  audio_analyze: AUDIO_ANALYSIS_SKILL,
  audio_compare: AUDIO_ANALYSIS_SKILL,
  image_to_3d: IMAGE_TO_3D_SKILL,
  manim_create: MANIM_SKILL,
  music_recognize: MUSIC_RECOGNITION_SKILL,
  ...Object.fromEntries(SPOTIFY_TOOLS.map((tool) => [tool, SPOTIFY_SKILL_SLUG])),
  computer_use: COMPUTER_USE_SKILL,
  breadboard_use: BREADBOARD_USE_SKILL,
  open_app: BREADBOARD_USE_SKILL,
  to_markdown: TO_MARKDOWN_SKILLS[0],
};

/**
 * Tools whose authority is not their name. A terminal command's reach is its
 * operations and roots (the broker's job, and YOLO's whole-machine grant);
 * the browser terminal needs the browser context the turn was opened with.
 */
export function escalationExcluded(tool: string): boolean {
  return tool === "browser_terminal" || tool.startsWith("terminal_") || tool === "recall_control";
}

const LABELS: Readonly<Record<string, string>> = {
  agent_launch: "start a runtime agent",
  workflow_run: "run one of your saved workflows",
  skill_open: "open one of your skills",
  computer_use: "operate a desktop app",
  breadboard_use: "use Breadboard's browser",
  open_app: "open an app on this computer",
  watch_run: "watch a video",
  premortem_run: "run a premortem",
  factcheck_run: "fact-check this",
  messaging_send: "send a message to your phone",
};

/** What the approval card says Bread wants to do. */
export function escalationLabel(tool: string, args: Record<string, unknown>): string {
  const named = (key: string) => typeof args[key] === "string" ? String(args[key]).trim().slice(0, 80) : "";
  if (tool === "agent_launch" && named("agent")) return `start the ${named("agent")} agent`;
  if (tool === "agent_launch" && args.team_action !== undefined) return "launch a team of agents";
  if (tool === "skill_open" && named("slug")) return `open the ${named("slug")} skill`;
  if (tool === "workflow_run" && (named("workflow") || named("id"))) return `run the workflow ${named("workflow") || named("id")}`;
  return LABELS[tool] ?? `use ${tool.replace(/_/g, " ")}`;
}

export type EscalationVerdict =
  | { status: "granted" }
  | { status: "grantable"; label: string; prompt: string }
  | { status: "denied"; message: string };

/** Pure policy: may this call be switched on, and is it already? */
export function decideEscalation(input: {
  surface: HermesSurface;
  tool: string;
  args: Record<string, unknown>;
  /** Tools this surface can ever have (the signed capability token). */
  surfaceTools: readonly string[];
  dispatch: RuntimeRunDispatch;
  decision: Pick<StoredCapabilityDecision, "allowedTools" | "selectedConditionalSkills"> | null;
  /** Skills this user has that `skill_open` may serve. */
  openableSkillSlugs: readonly string[];
  /** The chat can carry an approval notification (not temporary, voice or Buzz). */
  notifiable?: boolean;
}): EscalationVerdict {
  const { tool, args, dispatch } = input;
  if (input.surface === "quartz_ai") {
    return { status: "denied", message: `${tool} is not available in a public Quartz chat.` };
  }
  if (dispatch.swarmWorker) {
    return { status: "denied", message: `${tool} is outside this team assignment. Report what you need to the coordinator instead.` };
  }
  if (!input.surfaceTools.includes(tool) || escalationExcluded(tool)) {
    return { status: "denied", message: `${tool} is disabled for this turn.` };
  }
  const skill = escalationSkill(tool, args, input.openableSkillSlugs);
  if (skill === null) {
    return { status: "denied", message: `That skill is not installed or not available here. Open one of the skills you can see instead.` };
  }
  const decision = input.decision;
  if (decision && decision.allowedTools.includes(tool) && (!skill || decision.selectedConditionalSkills.includes(skill))) {
    return { status: "granted" };
  }
  // A turn nobody is watching gets its card as a notification the user can
  // answer in place (chat-notifications/approvals.ts). Only a chat that cannot
  // notify (temporary, voice, Buzz) is refused: a card nobody can ever see
  // would just stall it. YOLO answers its own cards.
  if (dispatch.interactive === false && dispatch.teamApproval !== true && input.notifiable === false) {
    return { status: "denied", message: `${tool} needs the user's approval, and no one can answer it on this turn. Do the work with the tools you have and say what ${tool} would have added.` };
  }
  const label = escalationLabel(tool, args);
  return { status: "grantable", label, prompt: `Bread wants to ${label}. Allow it for this turn?` };
}

/** "" when the tool needs no skill, null when the skill it needs is not available. */
function escalationSkill(tool: string, args: Record<string, unknown>, openable: readonly string[]): string | null {
  if (tool === "skill_open") {
    const slug = typeof args.slug === "string" ? args.slug.trim().replace(/^\//, "") : "";
    return slug && openable.includes(slug) ? slug : null;
  }
  return SKILL_FOR_TOOL[tool] ?? "";
}

/** The turn's decision, widened by one tool (and the skill its route checks). */
export function widenedDecision(
  stored: StoredCapabilityDecision,
  tool: string,
  skill: string,
  now = new Date(),
): CapabilityDecision {
  const { id: _id, runtimeSessionId: _session, ...rest } = stored;
  return {
    ...rest,
    allowedTools: [...new Set([...stored.allowedTools, tool])],
    selectedConditionalSkills: skill
      ? [...new Set([...stored.selectedConditionalSkills, skill])]
      : stored.selectedConditionalSkills,
    decisionReason: `${stored.decisionReason}; escalated ${tool} on request`.slice(0, 2_000),
    createdAt: now.toISOString(),
    revokedAt: null,
  } as CapabilityDecision;
}

export function escalationSkillFor(tool: string, args: Record<string, unknown>, openable: readonly string[]): string {
  return escalationSkill(tool, args, openable) ?? "";
}
