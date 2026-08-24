// One shared answer to "can these capabilities run in the same message?".
//
// A Breadboard message can carry several kinds of capability at once: a runtime
// agent (`/agents:codex`), a reviewed skill, a connection, a saved prompt, an
// Agency persona, and file attachments. Most of those compose; some cannot.
// Runtime agents in particular take the whole turn away from Hermes and run it
// on their own service, so whether a stacked skill or an attachment survives is
// a property of that agent's run route, not of the chat.
//
// Before this module each surface answered the question for itself, by falling
// through a priority cascade until some runtime matched. That silently picked a
// winner instead of reporting a conflict, so `/my-skill /agents:socials-manager draft a
// post` sent the literal text "/my-skill draft a post" as the brief.
// Everything now routes through `findCapabilityConflict`, which both chat
// surfaces call before dispatch and `resolveCommandMessage` calls again on the
// server, so a bad combination is refused once, in the same words, everywhere.
//
// This module is imported by client components. It must stay free of
// server-only imports (no node: builtins, no database, no config.ts).

import { AGENT_BROWSER_SLASH_COMMAND } from "../agent-browser/identity.ts";
import { agencyAgentSlugFromToken } from "./agency-agent-command.ts";
import { AGENT_REACH_COMMAND } from "../agent-reach/identity.ts";
import { PARAMETRIC_CAD_COMMAND } from "../cad/identity.ts";
import { CAREER_OPS_COMMAND } from "../career-ops/identity.ts";
import { OPEN_GYM_COMMAND } from "../open-gym/identity.ts";
import { TRADINGAGENTS_COMMAND } from "../tradingagents/identity.ts";
import { CODEX_COMMAND } from "../codex/identity.ts";
import { DEEP_RESEARCH_SLASH_COMMAND } from "../deep-research/identity.ts";
import { DEER_FLOW_COMMAND } from "../deer-flow/identity.ts";
import { DEEP_TUTOR_COMMAND } from "../deep-tutor/identity.ts";
import { GET_DOC_COMMAND } from "../get-doc/identity.ts";
import { HARDWARE_BLUEPRINT_COMMAND } from "../hardware/identity.ts";
import { HYPERFRAMES_COMMAND } from "../hyperframes/identity.ts";
import { RESOURCE2SKILL_COMMAND } from "../resource2skill/identity.ts";
import { INBOX_ZERO_COMMAND } from "../inbox-zero/identity.ts";
import { LEGAL_COMMAND } from "../legal/identity.ts";
import { WARDROBE_COMMAND } from "../wardrobe/identity.ts";
import { MATRAIX_COMMAND } from "../matraix/identity.ts";
import { MEETING_NOTES_COMMAND } from "../meeting-notes/identity.ts";
import { MONEY_PRINTER_COMMAND } from "../money-printer/identity.ts";
import { OPENCODE_COMMAND } from "../opencode/identity.ts";
import { OPENMONTAGE_COMMAND } from "../openmontage/identity.ts";
import { OPENPLANTER_COMMAND } from "../openplanter/identity.ts";
import { OPENWORK_COMMAND } from "../openwork/identity.ts";
import { OPENSCIENCE_COMMAND } from "../openscience/identity.ts";
import { MAX_RESEARCH_COMMAND } from "../max-research/identity.ts";
import { SOCIALS_MANAGER_COMMAND } from "../socials-manager/identity.ts";
import { RUFLO_COMMAND } from "../ruflo/identity.ts";
import { SHORTS_COMMAND } from "../shorts/identity.ts";
import { FORMSMITH_COMMAND } from "../shaper/identity.ts";
import { VIDEO_USE_COMMAND } from "../video-use/identity.ts";
import { AGENT_TARS_SLASH_COMMAND } from "../ui-tars/identity.ts";
import { VIBE_TRADING_COMMAND } from "../vibe-trading/identity.ts";
import { STOCK_ANALYST_COMMAND } from "../stock-analyst/identity.ts";
import { VIMAX_COMMAND } from "../vimax/identity.ts";
import { VOX_DIRECTOR_COMMAND } from "../vox-director/identity.ts";
import { BOLT_SLIDES_COMMAND } from "../bolt-slides/identity.ts";

/** Structurally identical to `HermesSurface`, redeclared to keep this module
 * out of the server-only config module's import graph. */
export type CapabilitySurface =
  | "dashboard_terminal"
  | "garden_chat"
  | "quartz_ai";

export interface RuntimeAgentProfile {
  /** Stable id, matching the agent's own `*_AGENT_ID` where it has one. */
  id: string;
  /** The slash command a user types, e.g. `/agents:codex`. */
  command: string;
  /** The command without its leading slash, e.g. `agents:codex`. */
  token: string;
  name: string;
  /** Surfaces with a chat runner for this agent. */
  surfaces: readonly CapabilitySurface[];
  /**
   * True when the agent's run route resolves stacked `/skill`, `/prompt`, and
   * `/connection` tokens through `resolveCommandMessage`. False means the rest
   * of the message is handed to the agent verbatim, so a stacked token would
   * arrive as literal prose rather than as a capability.
   */
  stacksCapabilities: boolean;
  /** True when the agent's run route accepts chat file attachments. */
  acceptsAttachments: boolean;
  /**
   * True when a super-agent turn may launch this agent itself, through
   * `agent_launch`. It means one specific thing: sending `<command> <brief>`
   * through the surface's own submit path starts a run. Agents whose command
   * only *seeds a form* — Trading Agent's request, Shorts' video — are false,
   * because a model launch there would open a dialog nobody is looking at and
   * report a run that never started.
   */
  launchableByModel: boolean;
  /**
   * True when a model-selected launch still needs a person to confirm it.
   * Read-only specialists can start as part of the assistant's turn; agents
   * that write, publish, browse, or render keep the explicit launch gate.
   */
  requiresLaunchApproval: boolean;
}

function commandToken(command: string): string {
  return command.replace(/^\//, "").toLowerCase();
}

const TERMINAL_AND_GARDEN: readonly CapabilitySurface[] = [
  "dashboard_terminal",
  "garden_chat",
];

function profile(
  id: string,
  command: string,
  name: string,
  options: {
    surfaces?: readonly CapabilitySurface[];
    stacksCapabilities?: boolean;
    acceptsAttachments?: boolean;
    launchableByModel?: boolean;
    requiresLaunchApproval?: boolean;
  } = {},
): RuntimeAgentProfile {
  return {
    id,
    command,
    token: commandToken(command),
    name,
    surfaces: options.surfaces ?? TERMINAL_AND_GARDEN,
    stacksCapabilities: options.stacksCapabilities ?? false,
    acceptsAttachments: options.acceptsAttachments ?? false,
    launchableByModel: options.launchableByModel ?? true,
    requiresLaunchApproval: options.requiresLaunchApproval ?? true,
  };
}

/**
 * Every runtime agent that can own a turn, and what it can carry with it.
 *
 * `stacksCapabilities` is a statement about the run route, not an aspiration:
 * only the three repository coding agents call `resolveCommandMessage`, so only
 * they can be handed a skill, prompt, or connection in the same message.
 * `acceptsAttachments` likewise tracks the routes that actually forward files.
 */
export const RUNTIME_AGENT_PROFILES: readonly RuntimeAgentProfile[] = [
  profile("codex", CODEX_COMMAND, "Codex", {
    stacksCapabilities: true,
    acceptsAttachments: true,
  }),
  profile("opencode", OPENCODE_COMMAND, "OpenCode", {
    stacksCapabilities: true,
    acceptsAttachments: true,
  }),
  profile("ruflo", RUFLO_COMMAND, "Ruflo", {
    stacksCapabilities: true,
    acceptsAttachments: true,
  }),
  profile("deep-research", DEEP_RESEARCH_SLASH_COMMAND, "Deep Research", {
    // Research reads sources and writes only its answer into this chat. It is
    // safe to treat it as an internal delegation rather than a user-approved
    // external action.
    requiresLaunchApproval: false,
  }),
  profile("agent-browser", AGENT_BROWSER_SLASH_COMMAND, "Agent Browser"),
  profile("agent-reach", AGENT_REACH_COMMAND, "Agent Reach", {
    // Retrieval runs read public sources and keep transient output in their own
    // sandbox; setup/credential writes remain separate user-owned actions.
    requiresLaunchApproval: false,
  }),
  profile("get-doc", GET_DOC_COMMAND, "Get Doc", {
    requiresLaunchApproval: false,
  }),
  // Deep Tutor reads the material of the surface it was called on, so it runs
  // on both — and means something different on each.
  profile("deep-tutor", DEEP_TUTOR_COMMAND, "Deep Tutor", {
    requiresLaunchApproval: false,
  }),
  profile("career-ops", CAREER_OPS_COMMAND, "Career Ops"),
  profile("open-gym", OPEN_GYM_COMMAND, "openGym", {
    // It reads the local catalogue and writes only the user's private training
    // state plus an artifact in the launching conversation.
    requiresLaunchApproval: false,
  }),
  // Meeting Notes takes a recording, so attachments are the point rather than an
  // extra. It is the one attachment-shaped agent a model may still launch, and
  // the reason is a real difference rather than an exception: where Video Use
  // and the Legal Agent can only work on a file the composer hands them, this
  // one falls back to the newest recording already on the conversation, so a
  // delegated brief with no file finds the meeting the person is asking about
  // instead of failing. It reads that recording and writes notes into this same
  // chat, which is internal delegation rather than an outward action.
  profile("meeting-notes", MEETING_NOTES_COMMAND, "Meeting Notes", {
    acceptsAttachments: true,
    requiresLaunchApproval: false,
  }),
  // Trading Agent takes a typed request rather than a message, so a skill or
  // an attachment stacked onto it has nowhere to go — the defaults are right.
  // Its command only seeds the form, so a model cannot launch it either.
  profile("trading-agent", TRADINGAGENTS_COMMAND, "Trading Agent", {
    launchableByModel: false,
  }),
  // Vibe Trading is the conversational half of the same domain: the prompt is
  // forwarded verbatim to the cloned service's own agent loop, which is why it
  // takes a sentence where Trading Agent takes a form.
  profile("vibe-trading", VIBE_TRADING_COMMAND, "Vibe Trading", {
    // Conversational market analysis only; the agent has no trade execution.
    requiresLaunchApproval: false,
  }),
  // The third agent in the domain, and the one that answers about named stocks:
  // the cloned daily-analysis backend's own equity agent, with live quotes,
  // K-lines, chip distribution, sector rankings and fifteen strategy skills
  // across six markets. Like Vibe Trading it reads and reports and cannot place
  // an order, so a delegation to it needs no separate approval.
  profile("stock-analyst", STOCK_ANALYST_COMMAND, "Stock Analyst", {
    requiresLaunchApproval: false,
  }),
  // DeerFlow hands the message to the cloned harness's own lead agent, which
  // owns its skills and its workspace, so a stacked Breadboard skill would
  // arrive as prose rather than as a capability.
  profile("deer-flow", DEER_FLOW_COMMAND, "DeerFlow"),
  profile("openplanter", OPENPLANTER_COMMAND, "OpenPlanter"),
  // OpenWork runs the task inside its own workspace rather than a repository,
  // so a stacked skill has nowhere to land: the workspace's skills are what the
  // agent already has, and the message is the brief.
  profile("openwork", OPENWORK_COMMAND, "OpenWork"),
  // OpenScience runs the research loop inside its own workspace with its own
  // ~290 skills and scientific-database tools, so a stacked Breadboard skill
  // has nowhere to land — the message is the goal.
  profile("openscience", OPENSCIENCE_COMMAND, "OpenScience"),
  // Max Research is the five research agents run against one question and
  // reconciled into one answer, so it stacks nothing: a Breadboard skill has
  // nowhere to land on a run whose whole body of work happens inside the
  // agents it commissions. It stays launchable by the model — it is the right
  // instrument for a question that genuinely needs the whole record — but it
  // asks first, because it is the most expensive thing here and it runs for
  // tens of minutes once started.
  profile("max-research", MAX_RESEARCH_COMMAND, "Max Research"),
  profile("socials-manager", SOCIALS_MANAGER_COMMAND, "Socials Manager"),
  // Inbox Zero hands the instruction to the mail app's own assistant, which
  // owns the mailbox tools, so a stacked Breadboard skill has nowhere to land.
  // It keeps the launch gate for the plainest possible reason: it can send and
  // archive real mail, and an unattended delegation must not be the first time
  // the person hears about that. Inbox Zero asks again before it sends, but a
  // second boundary here costs one click and buys back every case where the
  // model misread which mailbox the request was about.
  profile("inbox-zero", INBOX_ZERO_COMMAND, "Inbox Zero"),
  profile("hardware-blueprint", HARDWARE_BLUEPRINT_COMMAND, "Hardware Blueprint"),
  profile("parametric-cad", PARAMETRIC_CAD_COMMAND, "Parametric CAD"),
  profile("hyperframes", HYPERFRAMES_COMMAND, "HyperFrames"),
  profile("resource2skill", RESOURCE2SKILL_COMMAND, "Resource2Skill"),
  // OpenMontage runs its whole production inside its own workspace from one
  // brief, so — like OpenWork — a stacked skill has nowhere to land: the
  // pipeline's own director skills are what the agent already reads.
  profile("openmontage", OPENMONTAGE_COMMAND, "OpenMontage"),
  profile("vimax", VIMAX_COMMAND, "ViMax"),
  // Vox Director carries its whole topic in the command and renders locally.
  // Like ViMax it takes no attachment and stacks nothing: the collage method it
  // works from is the clone's own skill, which the run already reads.
  profile("vox-director", VOX_DIRECTOR_COMMAND, "Vox Director"),
  // Shorts takes a video and a typed request rather than a message, so a skill
  // or an attachment stacked onto it has nowhere to go — the defaults are right.
  // The video is chosen in the form, so only the user can start one.
  profile("shorts", SHORTS_COMMAND, "Shorts", { launchableByModel: false }),
  // Formsmith takes exactly one picture through its dedicated picker. A model
  // cannot populate that picker, and generic chat attachments are not forwarded.
  profile("formsmith", FORMSMITH_COMMAND, "Formsmith", { launchableByModel: false }),
  // Video Use edits a video that already exists — one attached to the message,
  // or an artifact opened in the studio. The video is the attachment, which is
  // why this is one of the few profiles that really accepts one, and a stacked
  // skill has nowhere to land because the instruction is the whole request.
  // A model cannot launch it for the same reason Shorts cannot be launched:
  // there is no way for one to attach a video, so a delegated launch could only
  // ever fail.
  profile("video-use", VIDEO_USE_COMMAND, "Video Use", {
    acceptsAttachments: true,
    launchableByModel: false,
    requiresLaunchApproval: false,
  }),
  // MoneyPrinter is the other end of the same job from ViMax: ViMax draws a film
  // that does not exist, this one cuts stock footage to a script. The message is
  // the subject of the video, so nothing stacked onto it would survive.
  profile("money-printer", MONEY_PRINTER_COMMAND, "MoneyPrinter"),
  // The Legal Agent works on documents, so attachments are the point rather
  // than an extra: the run route writes each one into the workspace the harness
  // reads from. The assignment itself reaches the harness verbatim, so nothing
  // else stacked onto the message would survive it.
  // Not model-launchable, for the same reason as Formsmith and Video Use: the
  // input is the attachment tray, and a delegated launch carries only a
  // sentence. Handing this agent an assignment with no documents attached
  // produces a confident answer about nothing, so the person picks it
  // themselves, with the files in hand.
  profile("legal", LEGAL_COMMAND, "Legal Agent", {
    acceptsAttachments: true,
    launchableByModel: false,
  }),
  // Wardrobe is the seventh attachment-shaped agent, and the plainest of them:
  // the photographs of the clothes are the entire request, and the message is
  // only direction for the generator, so nothing stacked onto it would survive.
  // Not model-launchable, for the same reason as Formsmith, Video Use and the
  // Legal Agent — a delegated launch carries a sentence and no photos, which
  // could only ever fail.
  profile("wardrobe", WARDROBE_COMMAND, "Wardrobe", {
    acceptsAttachments: true,
    launchableByModel: false,
  }),
  // MatrAIx answers by simulating a population rather than by reasoning about
  // one, so the message is the whole brief: the questionnaire and the cohort
  // are derived from it, and a stacked skill would only arrive as prose inside
  // the subject being surveyed. A delegated launch is safe — it spends model
  // calls and writes files under its own run, and touches nothing else — so it
  // asks for approval like every other agent that produces a deliverable.
  profile("matraix", MATRAIX_COMMAND, "MatrAIx"),
  // Bolt Slides writes a deck from the message and builds it into a running web
  // app. The brief is the whole request, so nothing stacked onto it survives,
  // and it takes no attachments: the run has no image step, and a file handed to
  // it would have nowhere to go. A delegated launch is safe — it spends model
  // calls, writes into its own workspace, and files one artifact on this chat.
  profile("bolt-slides", BOLT_SLIDES_COMMAND, "Bolt Slides"),
  // Agent TARS drives a real browser or desktop from the Terminal only; Garden
  // Chat offers the same palette entry as a setup dialog, with no chat runner.
  profile("agent-tars", AGENT_TARS_SLASH_COMMAND, "Agent TARS", {
    surfaces: ["dashboard_terminal"],
  }),
];

const BY_TOKEN = new Map(
  RUNTIME_AGENT_PROFILES.map((agent) => [agent.token, agent]),
);
const BY_ID = new Map(RUNTIME_AGENT_PROFILES.map((agent) => [agent.id, agent]));

export function runtimeAgentByToken(token: string): RuntimeAgentProfile | null {
  return BY_TOKEN.get(token.replace(/^\//, "").toLowerCase()) ?? null;
}

export function runtimeAgentById(id: string): RuntimeAgentProfile | null {
  return BY_ID.get(id) ?? null;
}

/** Runtime agents that can carry a stacked skill, prompt, or connection. */
export function stackingRuntimeAgents(): readonly RuntimeAgentProfile[] {
  return RUNTIME_AGENT_PROFILES.filter((agent) => agent.stacksCapabilities);
}

/** Runtime agents that can carry chat file attachments. */
export function attachmentRuntimeAgents(): readonly RuntimeAgentProfile[] {
  return RUNTIME_AGENT_PROFILES.filter((agent) => agent.acceptsAttachments);
}

/** Runtime agents a super-agent turn may start itself, on this surface. */
export function modelLaunchableRuntimeAgents(
  surface: CapabilitySurface,
): readonly RuntimeAgentProfile[] {
  return RUNTIME_AGENT_PROFILES.filter(
    (agent) => agent.launchableByModel && agent.surfaces.includes(surface),
  );
}

export function surfaceLabel(surface: CapabilitySurface): string {
  if (surface === "garden_chat") return "Garden Chat";
  if (surface === "quartz_ai") return "Quartz";
  return "the Terminal";
}

export type CapabilityTokenKind =
  | "runtime_agent"
  | "unknown_runtime_agent"
  | "persona"
  | "capability";

export interface CapabilityToken {
  /** The token without its leading slash, lowercased. */
  token: string;
  /** As the user typed it, including the leading slash. */
  raw: string;
  kind: CapabilityTokenKind;
  /** Present only for `runtime_agent`. */
  agent?: RuntimeAgentProfile;
}

/**
 * The same leading-slash grammar `resolveCommandMessage` uses, so the client
 * and the server agree on where the capability tokens end and the request
 * begins. Prose and fenced code never start with a bare token, so they are
 * left alone exactly as before.
 */
export function leadingCapabilityTokens(text: string): {
  tokens: CapabilityToken[];
  rest: string;
} {
  let remaining = text.trimStart();
  const tokens: CapabilityToken[] = [];
  while (remaining.startsWith("/")) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(remaining);
    if (!match) break;
    const token = match[1].toLowerCase();
    const agent = BY_TOKEN.get(token);
    tokens.push({
      token,
      raw: `/${match[1]}`,
      kind: agent
        ? "runtime_agent"
        : agencyAgentSlugFromToken(token)
          ? "persona"
        : token.startsWith("agents:")
          ? "unknown_runtime_agent"
          : token.startsWith("agent:")
            ? "persona"
            : "capability",
      ...(agent ? { agent } : {}),
    });
    remaining = remaining.slice(match[0].length).trimStart();
  }
  return { tokens, rest: remaining.trim() };
}

export interface CapabilityConflict {
  /** Stable machine code, reused as the `ApiError` code on the server. */
  code: string;
  /** User-facing sentence. Written to be shown verbatim in the composer. */
  message: string;
}

function list(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export interface CapabilityCombinationInput {
  /** The composer text, exactly as it will be submitted. */
  text: string;
  surface: CapabilitySurface;
  /** How many files are attached to this turn. */
  attachmentCount?: number;
  /**
   * The runtime agent already selected in the palette, if any. A turn with no
   * runtime-agent token still runs on this agent, so it is held to the same
   * stacking and attachment rules.
   */
  activeRuntimeAgentId?: string | null;
}

/**
 * Report the first reason this combination cannot be sent, or null when it can.
 *
 * Rules are ordered most-specific first so the message names the actual
 * problem: two runtime agents beats "the Socials Manager cannot take a skill",
 * which beats "the Socials Manager cannot take attachments".
 */
export function findCapabilityConflict(
  input: CapabilityCombinationInput,
): CapabilityConflict | null {
  const { tokens } = leadingCapabilityTokens(input.text);
  const attachmentCount = input.attachmentCount ?? 0;

  const unknown = tokens.find((item) => item.kind === "unknown_runtime_agent");
  if (unknown) {
    return {
      code: "unknown_runtime_agent",
      message: `There is no runtime agent called ${unknown.raw}. Open the capability palette to see the agents available in ${surfaceLabel(input.surface)}.`,
    };
  }

  const requested = tokens.flatMap((item) => (item.agent ? [item.agent] : []));
  const distinct = [...new Map(requested.map((agent) => [agent.id, agent])).values()];
  if (distinct.length > 1) {
    return {
      code: "conflicting_runtime_agents",
      message: `${list(distinct.map((agent) => agent.name))} cannot run the same message — each one takes the whole turn. Keep one of ${list(distinct.map((agent) => agent.command))} and send the rest separately.`,
    };
  }

  const agent = distinct[0] ?? runtimeAgentById(input.activeRuntimeAgentId ?? "");
  if (!agent) return null;
  const selected = distinct.length === 0;

  if (!agent.surfaces.includes(input.surface)) {
    const where = agent.surfaces.length
      ? list(agent.surfaces.map((item) => surfaceLabel(item)))
      : "another surface";
    return {
      code: "runtime_agent_surface_unavailable",
      message: `${agent.name} runs in ${where}, not ${surfaceLabel(input.surface)}.`,
    };
  }

  const personas = tokens.filter((item) => item.kind === "persona");
  if (personas.length) {
    return {
      code: "runtime_agent_persona_conflict",
      message: `${personas[0].raw} is an Agency persona, and personas shape Hermes turns only. ${agent.name} runs on its own service, so it cannot take one${selected ? `. Clear ${agent.name} first` : ` — drop ${personas[0].raw} or ${agent.command}`}.`,
    };
  }

  const stacked = tokens.filter((item) => item.kind === "capability");
  if (stacked.length && !agent.stacksCapabilities) {
    const carriers = list(stackingRuntimeAgents().map((item) => item.name));
    return {
      code: "runtime_agent_capability_conflict",
      message: `${agent.name} runs the whole message itself, so ${list(stacked.map((item) => item.raw))} would reach it as plain text rather than as ${plural(stacked.length, "a capability", "capabilities")}. ${carriers} are the runtime agents that can carry a skill, prompt, or connection${selected ? `; otherwise clear ${agent.name} first` : ""}.`,
    };
  }

  if (attachmentCount > 0 && !agent.acceptsAttachments) {
    const carriers = list(attachmentRuntimeAgents().map((item) => item.name));
    return {
      code: "runtime_agent_attachment_conflict",
      message: `${agent.name} cannot take file attachments. Remove the ${attachmentCount} attached ${plural(attachmentCount, "file", "files")}, or send ${plural(attachmentCount, "it", "them")} to ${carriers} instead.`,
    };
  }

  return null;
}
