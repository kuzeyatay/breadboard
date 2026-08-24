// Super agent: one turn, the whole inventory.
//
// A normal turn is handed the one capability the user selected — a `/skill`, a
// `/connection`, a persona — and the planner grants what the sentence needs.
// A super-agent turn inverts that: the user is not naming the instrument, so the
// agent is given the catalogue and told to choose, the way the Chief of Staff
// persona is given the specialist roster and told to staff the work itself.
//
// This module owns that catalogue and the directive that comes with it. It is
// descriptive: nothing here grants authority. The capability broker still decides
// what the turn may do, filesystem access still comes only from the user's own
// grants, and every write through a connection still pauses for approval.

import "server-only";

import type { HermesSurface } from "./config.ts";
import { listApprovedSkills } from "./skills.ts";
import { listMcpConnections } from "./mcp-connections.ts";
import {
  CHIEF_OF_STAFF_SLUG,
  loadAgencyAgentsCatalog,
  type AgencyAgentDefinition,
} from "./agency-agents.ts";
import { RUNTIME_AGENT_PROFILES } from "./capability-combinations.ts";
import {
  RUNTIME_AGENT_GROUPS,
  runtimeAgentBrief,
} from "./runtime-agent-briefs.ts";
import {
  INBOX_ZERO_AGENT_ID,
  INBOX_ZERO_COMMAND,
} from "../inbox-zero/identity.ts";
import {
  OPEN_GYM_AGENT_ID,
  OPEN_GYM_COMMAND,
} from "../open-gym/identity.ts";
import {
  GOAL_MODE_CONNECTION,
  GOAL_MODE_SKILL,
} from "../goal-mode.ts";
import { listWorkflows } from "../workflows/store.ts";
import type { LocalWorkflowSummary } from "../workflows/types.ts";
import { researchPipelineRule } from "../research/directive.ts";
import type { ResearchPlan } from "../research/types.ts";

/** Skills listed by name in the prompt. The rest are still openable by slug. */
const MAX_LISTED_SKILLS = 120;
/** Example specialist slugs shown per division. */
const MAX_DIVISION_EXAMPLES = 8;
const MAX_LISTED_WORKFLOWS = 40;

export interface SuperAgentSkillEntry {
  slug: string;
  name: string;
  description: string;
}

export interface SuperAgentDivisionEntry {
  label: string;
  count: number;
  examples: string[];
}

export interface SuperAgentInventory {
  skills: SuperAgentSkillEntry[];
  /** Skills held back from the listing only; every slug stays selectable. */
  unlistedSkillCount: number;
  skillSlugs: string[];
  workflows: LocalWorkflowSummary[];
  /** False when the local automation service could not be reached this turn. */
  workflowsReachable: boolean;
  connections: string[];
  divisions: SuperAgentDivisionEntry[];
  specialistCount: number;
  runtimeAgents: Array<{
    id: string;
    name: string;
    command: string;
    /** False for the form-driven agents, which only the user can start. */
    launchable: boolean;
  }>;
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function skillEntries(
  surface: HermesSurface,
  connectedMcpServers: string[],
): { entries: SuperAgentSkillEntry[]; slugs: string[] } {
  const available = listApprovedSkills(surface, connectedMcpServers).filter(
    (skill) =>
      skill.enabled &&
      skill.healthy &&
      // A coding-conditional skill has to execute through Codex, OpenCode or
      // Ruflo, so offering its guidance here would describe work this turn
      // cannot carry out.
      skill.classification === "eligible_general" &&
      // Goal is a conversation-level commitment, not an ambient capability.
      // It is selected by /goal or explicit persistence wording in
      // goal-intent.ts; listing it in Super Agent's broad inventory lets a
      // model turn an ordinary one-shot request into a goal without consent.
      skill.slug !== GOAL_MODE_SKILL,
  );
  return {
    entries: available.map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      description: truncate(skill.description, 110),
    })),
    slugs: available.map((skill) => skill.slug),
  };
}

function divisionEntries(agents: readonly AgencyAgentDefinition[]): {
  divisions: SuperAgentDivisionEntry[];
  specialistCount: number;
} {
  const byDivision = new Map<string, AgencyAgentDefinition[]>();
  for (const agent of agents) {
    if (agent.slug === CHIEF_OF_STAFF_SLUG) continue;
    const list = byDivision.get(agent.divisionLabel) ?? [];
    list.push(agent);
    byDivision.set(agent.divisionLabel, list);
  }
  const divisions = [...byDivision.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, list]) => ({
      label,
      count: list.length,
      examples: list
        .map((agent) => agent.slug)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, MAX_DIVISION_EXAMPLES),
    }));
  return {
    divisions,
    specialistCount: [...byDivision.values()].reduce(
      (total, list) => total + list.length,
      0,
    ),
  };
}

async function localWorkflows(userId: number): Promise<{
  workflows: LocalWorkflowSummary[];
  reachable: boolean;
}> {
  try {
    return {
      workflows: listWorkflows(userId).slice(0, MAX_LISTED_WORKFLOWS),
      reachable: true,
    };
  } catch {
    // Workflows now live in Breadboard's own database rather than a service that
    // has to be running, but a read failure still must not fail the turn.
    return { workflows: [], reachable: false };
  }
}

/**
 * Everything a super-agent turn is allowed to reach for, read from the same
 * stores the Skills, Connections, Agents and Workflows surfaces read.
 */
export async function loadSuperAgentInventory(input: {
  userId: number;
  surface: HermesSurface;
}): Promise<SuperAgentInventory> {
  const connectedMcpServers = listMcpConnections(input.userId, true).map(
    (connection) => connection.slug,
  );
  const connections = connectedMcpServers.filter(
    (slug) => slug !== GOAL_MODE_CONNECTION,
  );
  const skills = skillEntries(input.surface, connectedMcpServers);
  const catalog = loadAgencyAgentsCatalog();
  const roster =
    catalog.status === "ready"
      ? divisionEntries(catalog.agents)
      : { divisions: [], specialistCount: 0 };
  const workflows = await localWorkflows(input.userId);
  return {
    skills: skills.entries.slice(0, MAX_LISTED_SKILLS),
    unlistedSkillCount: Math.max(0, skills.entries.length - MAX_LISTED_SKILLS),
    skillSlugs: skills.slugs,
    workflows: workflows.workflows,
    workflowsReachable: workflows.reachable,
    connections,
    divisions: roster.divisions,
    specialistCount: roster.specialistCount,
    runtimeAgents: RUNTIME_AGENT_PROFILES.filter((agent) =>
      agent.surfaces.includes(input.surface),
    ).map((agent) => ({
      id: agent.id,
      name: agent.name,
      command: agent.command,
      launchable: agent.launchableByModel,
    })),
  };
}

/**
 * Email is not a judgement call.
 *
 * Every other choice in this prompt is left to the model, because picking the
 * right instrument is the thing it is good at. Email is the exception, and for
 * a mechanical reason rather than a stylistic one: the assistant has no mailbox.
 * Asked about email without this rule it answers from the conversation, from a
 * web search, or from nothing — a fluent, confident answer about an inbox it has
 * never seen, which is worse than saying it cannot help. Inbox Zero is the only
 * thing here connected to the user's actual mail, so anything about mail goes
 * there, and the one case that must not be delegated is spelled out too:
 * writing prose that happens to be destined for an email is still writing.
 */
function emailRoutingRule(): string {
  return [
    "## Email goes to Inbox Zero — always",
    `You have no mailbox of your own. ${INBOX_ZERO_COMMAND} is connected to the user's real email, and it is the only thing here that is. So when the request touches their mail in any way, hand it to \`agent_launch\` with agent id \`${INBOX_ZERO_AGENT_ID}\` rather than answering from what you can infer.`,
    "",
    "That covers all of it: reading, searching, and summarizing mail; who wrote and what they said; unread, backlog, and inbox counts; replying, drafting a reply, forwarding, and sending; archiving, deleting, labelling, marking read, and snoozing; unsubscribing and cleaning up newsletters; follow-ups waiting on a response; and setting up rules that sort mail automatically.",
    "",
    "Two boundaries, because a standing rule is only safe with them:",
    "- Writing a message body the user asked *you* for — a draft they will paste somewhere themselves, wording to look over — is writing, not email. Do that yourself. Delegate the moment it has to reach, read, or leave the mailbox.",
    "- The brief is everything the agent gets. It cannot see this conversation, so name the person, the thread, the time range, and what a finished result looks like. Never state that mail was read, sent, archived, or changed until its result comes back saying so.",
  ].join("\n");
}

/**
 * A registered movement demonstration is a presentation capability, not merely
 * fitness knowledge. Without a hard routing rule the general "answer it when
 * you can" instruction wins and produces plausible prose while silently
 * dropping the animation the user actually asked the product to provide.
 */
function openGymRoutingRule(): string {
  return [
    "## Exercise demonstrations and workout programs go to openGym",
    `openGym (\`${OPEN_GYM_COMMAND}\`) is the only instrument here that can match the cloned exercise catalogue, show its registered animated demonstrations, and remember a training plan after this turn. Those are concrete capabilities you do not have in your own prose response.`,
    "",
    `Whenever the user asks how to do, perform, execute, or demonstrate a named exercise—or asks about its form or animation—call \`agent_launch\` with agent id \`${OPEN_GYM_AGENT_ID}\`. Do not answer with instructions instead: the openGym card and its animation are the requested result. It completes the user-facing turn itself, so do not expect or create a second synthesis turn after it.`,
    "",
    `Also launch \`${OPEN_GYM_AGENT_ID}\` to build or revise a complete workout program, or to continue the user's saved plan, because that work needs its persistent training state. General fitness facts can stay with you. Pain, injury, rehabilitation, diagnosis, and nutrition are outside openGym's role; do not send those there.`,
  ].join("\n");
}

/** Runtime agents that can reach the open web, in the order they are offered. */
const RESEARCH_AGENT_IDS = [
  "deep-research",
  "agent-reach",
  "agent-browser",
  "get-doc",
] as const;

/**
 * Web research is a staffing decision, not a single tool call.
 *
 * Two failures made this section necessary, and both looked like an answer.
 * The first is scope collapse: `web_search` is the instrument the model can run
 * inside its own turn, so a request to survey a whole field became one batch of
 * searches, and the answer was assembled from result snippets — no page was
 * ever opened. The second is silent degradation: when a research worker returns
 * nothing, or a tool errors, the turn continues and quietly falls back to what
 * it already had, presenting snippet-derived numbers as if they had been read.
 *
 * So the rule names the instruments that exist, says a broad request earns more
 * than one of them, and makes reading the authoritative page a step rather than
 * an option. It also states the sequencing plainly: launches are queued one at
 * a time and each returns to this agent as an internal turn, so briefs must not
 * depend on each other's output — coordination happens here, on the way back.
 *
 * `agent-browser` is the one exception to "staff more than one". Listing it
 * beside the others got it launched on any request that sounded broad, which
 * spends a real browser session — the slowest and most fragile thing here — on
 * pages plain extraction would have read. It therefore sits outside the list,
 * behind a cheaper attempt that actually came back short.
 */
function researchRoutingRule(inventory: SuperAgentInventory): string {
  const available = new Set(
    inventory.runtimeAgents
      .filter((agent) => agent.launchable)
      .map((agent) => agent.id),
  );
  const instruments: string[] = [];
  if (available.has("deep-research")) {
    instruments.push(
      "- `deep-research` — the multi-round worker. Give it breadth: the parts of the question that need many sources compared against each other. Questions about whether a method works, its benefits or harms, and whether learning is retained are its work too, even when the user wants a normal conversational answer. Begin the brief with `--answer` when they want a sourced answer rather than a report; use its report form only when they asked for a report, review, survey, or write-up.",
    );
  }
  if (available.has("agent-reach")) {
    instruments.push(
      "- `agent-reach` — retrieval from named sources. Give it depth: specific sites, directories, or listings to open and pull structured detail out of, when you know where the answer lives and the work is reading it.",
    );
  }
  if (available.has("get-doc")) {
    instruments.push(
      "- `get-doc` — papers and reports. Use it when the evidence is a publication rather than a web page.",
    );
  }

  return [
    "## Web research: read pages, and use more than one instrument",
    "`web_search` and `web_extract` are yours to run in this turn. Search finds candidates; extract opens them. A narrow lookup — one fact, one page — is finished here, and needs nobody else.",
    ...(available.has("deep-research")
      ? [
          "When the user explicitly says to do, conduct, run, perform, or use deep research, that is an instruction to launch `deep-research` with `agent_launch`, not permission to substitute your own `web_search`. Use `--answer` unless they explicitly requested a report, review, survey, or write-up. The worker stays private; wait for its result and synthesize that result in your own response.",
        ]
      : []),
    ...(available.has("max-research")
      ? [
          // The same rule, and it had to be written down for the same reason.
          // Without it a request that said "do max research" in as many words
          // drew five `web_search` calls and an answer written here — the exact
          // substitution the sentence above exists to prevent, one agent over.
          "The same is true of max research, which is a different agent: when the user says to do, run, or use max research, launch `max-research` with `agent_launch`. It commissions every research agent at once and reconciles them, so it is not interchangeable with `deep-research` and never with your own `web_search`. It runs for tens of minutes; that is expected, and it is what the user asked for. Wait for its result and synthesize that result.",
        ]
      : []),
    "",
    "Anything wider is not. A request to survey, enumerate, or investigate a topic — every X, which are active, how many members, what changed over time — is answered by reading the authoritative pages, never by quoting search-result snippets. Open the official page with `web_extract` first: it is the spine every other finding hangs on.",
    ...(instruments.length
      ? [
          "",
          "Then staff the rest. A broad request earns more than one worker, each with the part it is actually good at:",
          ...instruments,
          "",
          "Three things about how launches work here, all of which change how you write a brief:",
          "- They run one at a time, in order, and each returns to you as an internal turn. So write each brief to stand alone — a brief that assumes another worker's findings will arrive first is a brief that fails.",
          "- Each worker is blind to this conversation. Name the subject, the sources you already trust, the shape of the result you need, and what it should do when a source is missing.",
          "- You are the one who reconciles. When their results come back, merge them, resolve the disagreements, and say plainly which parts are complete and which are partial. A published total that does not match what you counted is a gap to report, not a number to smooth over.",
        ]
      : []),
    ...(available.has("agent-browser")
      ? [
          "",
          "`agent-browser` is not on that list, and is never part of an opening plan. It drives a real browser one page at a time: it is the slowest instrument here, the most likely to fail on its own before it reaches the site, and it costs the user far more than reading a page does. Treat it as the last resort it is.",
          "Launch it only when something you already tried came back short and a browser is the specific thing that would fix it — `web_extract` returned an empty or JavaScript-only page, the content sits behind a button, a scroll, or a login, or another worker reported exactly that. Wanting more coverage is not a reason. A request merely sounding broad is not a reason. If the answer is incomplete and nothing needs clicking, say what is missing instead.",
        ]
      : []),
    "",
    "And say what actually happened. A tool that returned an error did no work: name the failure and what you did instead. Never present a figure taken from a search snippet as something you read on the page, and never fill a gap from memory — an unverified list of names is the one answer this turn must not produce.",
  ].join("\n");
}

/**
 * Choosing a runtime agent is a decision, so the prompt has to contain one.
 *
 * The catalogue used to be a list of names: `- vimax — ViMax (/agents:vimax)`.
 * Nothing in it said what an agent does, which left the model two ways to pick
 * and both were wrong. Agents with self-describing names were launched on topic
 * match — a passing mention of markets was enough to staff a trading agent —
 * and agents whose names describe nothing were never launched at all. Neither is
 * a judgement; both are what you get when the only signal is a slug.
 *
 * `runtime-agent-briefs.ts` supplies the missing half: what each agent reaches
 * and when it is the right choice. This function frames it, and the framing is
 * the part that keeps a wide catalogue from becoming a reason to delegate. Three
 * rules, in the order a decision actually happens:
 *
 * *Whether* comes first, and its default is no. The failure being prevented is
 * not misrouting, it is delegating at all when the turn could have answered:
 * every launch spends a confirmation and a wait, and hands back less than the
 * answer already in hand. So the rule demands a named capability the turn does
 * not have — the mailbox, the repository, a browser, a workspace outliving the
 * turn, a file kind this turn cannot write — and says outright that topic match
 * is not one.
 *
 * *How many* comes second, because "more agents" reads as thoroughness and is
 * usually duplication. One at a time, reconsidering when the outcome returns as
 * an internal turn, which is also what the serial launch queue really does.
 * A second agent has to be doing a different job, not the same job again.
 *
 * *What it costs the user* comes last: most of these read and report, a few send
 * mail, publish posts, or keep trading after the turn ends.
 *
 * Grouping by domain is not cosmetic. The hard calls here are all within a
 * domain — ViMax invents footage where MoneyPrinter cuts existing footage, Stock
 * Analyst takes tickers where Vibe Trading takes conditions — and those read as
 * distinctions only when they sit next to each other.
 */
function runtimeAgentCatalogue(inventory: SuperAgentInventory): string {
  const launchable = inventory.runtimeAgents.filter(
    (agent) => agent.launchable,
  );
  const userOnly = inventory.runtimeAgents.filter((agent) => !agent.launchable);
  const describe = (
    agent: (typeof inventory.runtimeAgents)[number],
  ): string => {
    const brief = runtimeAgentBrief(agent.id);
    const head = `- ${agent.id} — ${agent.name} (\`${agent.command}\`).`;
    if (!brief) return head.replace(/\.$/, "");
    return [head, brief.does, brief.choose].filter(Boolean).join(" ");
  };
  // The form-driven agents are listed by command and never by id. The id is the
  // argument `agent_launch` takes, so printing one next to an agent the tool
  // cannot start is an invitation to call it and be refused; the command is the
  // only thing that is any use here, because naming it is the whole action.
  const describeUserOnly = (
    agent: (typeof inventory.runtimeAgents)[number],
  ): string => {
    const brief = runtimeAgentBrief(agent.id);
    return [`- \`${agent.command}\` — ${agent.name}.`, brief?.does]
      .filter(Boolean)
      .join(" ");
  };
  // A newly added agent with no brief still has to appear, or the model cannot
  // reach something the user installed. It goes last, undescribed, rather than
  // being silently dropped into a domain it may not belong to.
  const grouped = RUNTIME_AGENT_GROUPS.flatMap((group) => {
    const members = launchable.filter(
      (agent) => runtimeAgentBrief(agent.id)?.group === group.key,
    );
    return members.length
      ? [`\n### ${group.label}`, ...members.map(describe)]
      : [];
  });
  const ungrouped = launchable.filter((agent) => !runtimeAgentBrief(agent.id));

  return [
    "## Runtime agents — start one with `agent_launch`",
    "Each of these is a private worker you can hand a job to with `agent_launch`. Three things follow from how delegation works, and all matter:",
    "- It has not run when the tool returns. It starts after your turn ends. Never write as though you have already seen its output, and never invent a result, file, artifact, or link.",
    "- The agent cannot see this conversation. The brief is everything it gets: subject, constraints, and what the finished thing should be, written for a stranger.",
    "- Its card is normally hidden. openGym is the presentation-bearing exception: its exercise animation card remains visible and completes the user-facing turn itself. Its outcome always returns to you as an internal turn except for that openGym presentation. Summarize other useful results in your own voice; if one produced an artifact or file, present that exact artifact or link to the user.",
    "",
    "Choosing well starts with choosing whether, and the honest default is none of them. You have your own tools, and a request you can finish in this turn should be finished in this turn — a delegation the user did not need costs them a confirmation and a wait, and hands back less than the answer you already had.",
    "",
    "So name the reason before you launch anything: what does this agent reach that I cannot? The answers that count are concrete — it holds the user's real mailbox, the connected repository, a real browser, a workspace that outlives this turn, or it writes a kind of file this turn cannot produce. That the request is *about* an agent's topic is not one of them. If everything it would add is more words on a subject you already understand, launch nothing and answer.",
    "",
    "Then decide how many. Prefer one: launch the agent that unblocks the most, and when its outcome comes back as an internal turn, decide again knowing what it found. Reach for a second only when the request splits into parts needing genuinely different reach — a repository change and a market read are two jobs, while two market agents on one question is one job done twice. Where several agents share a domain below, what separates them is the shape of the input they take and what they hand back, so read those entries against each other rather than stopping at the first that sounds close.",
    "",
    "And weigh what starting one commits the user to. Most of these read something and report back. A few act outwardly — mail leaves, posts publish, a desk keeps trading after the turn is over — and those deserve a higher bar and a plain sentence about what you are setting in motion.",
    ...grouped,
    ...(ungrouped.length
      ? [
          "\n### Also installed",
          ...ungrouped.map(
            (agent) => `- ${agent.id} — ${agent.name} (\`${agent.command}\`)`,
          ),
        ]
      : []),
    ...(userOnly.length
      ? [
          "\nStarted from their own form, so only the user can run them, and `agent_launch` will refuse. When one is what the request needs, say what it does and name its command so they can start it themselves:",
          ...userOnly.map(describeUserOnly),
        ]
      : []),
  ].join("\n");
}

/**
 * The directive and the inventory, as one system-prompt section.
 *
 * Two things are stated as fact rather than left to inference. First, the agent
 * owns the whole request: it picks its instruments and returns one answer in its
 * own voice. Second, the boundaries are real — a folder still needs the user's
 * grant, and a runtime agent it launches has not run yet when the tool returns —
 * because an inventory this wide otherwise invites claims about work nothing
 * performed.
 */
export function renderSuperAgentDirective(
  inventory: SuperAgentInventory,
  /**
   * This turn's research reading, when the deterministic classifier decided the
   * request is exhaustive enough to earn the pipeline. Omitted — the common
   * case — the directive is exactly what it was before.
   */
  researchPlan?: ResearchPlan | null,
): string {
  const sections: string[] = [
    [
      "# super_agent_mode",
      "The user switched Super agent on for this message. You are not waiting to be handed a capability: the inventory below is yours to draw on, and choosing well from it is your job.",
      "",
      "Operating loop for this turn:",
      "1. Decide what the request actually is. Conversational or trivial → answer it directly in a line or two and use nothing.",
      "2. Real work → pick the instruments from the inventory before improvising. A reviewed skill beats your own guess at a procedure; a connected service beats asking the user for data they already connected; an automation beats rebuilding what it does.",
      "3. Carry the work out with the tools, then verify what you actually got back. A tool that failed did not do the work.",
      "4. Answer once, in your own voice, as the person who owns the result. Do not narrate the inventory, list what you considered, or report tool mechanics.",
      "",
      "Boundaries that still hold, because a wide inventory is not wider authority:",
      "- Files and folders on the user's computer need their standing grant. If a turn needs one, the app asks for it — never claim you read or changed a path you were not granted.",
      "- Every write or destructive action through a connected service pauses for the user's approval before Breadboard forwards it.",
      "- A runtime agent you launch starts after this turn ends, with the user's confirmation. Handing work to one is not the same as the work being done.",
      "- Only claim something happened when a tool returned a result saying so.",
    ].join("\n"),
  ];

  if (inventory.skills.length) {
    sections.push(
      [
        "## Reviewed skills — open one with `skill_open`",
        "Call `skill_open` with a slug to read that skill's full guidance, then follow it. Open one whenever it covers the task better than improvising; open more than one when the work spans them.",
        ...inventory.skills.map(
          (skill) => `- ${skill.slug} — ${skill.name}: ${skill.description}`,
        ),
        inventory.unlistedSkillCount > 0
          ? `- …and ${inventory.unlistedSkillCount} more installed skills, openable by slug.`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (inventory.workflows.length) {
    sections.push(
      [
        "## Automations — run one with `workflow_run`",
        "These are the user's own saved automations. Call `workflow_run` with the workflow id and the input text when one of them is what the request is asking for.",
        ...inventory.workflows.map(
          (workflow) =>
            `- ${workflow.id} — ${workflow.name}${workflow.active ? "" : " (inactive)"}`,
        ),
      ].join("\n"),
    );
  } else if (!inventory.workflowsReachable) {
    sections.push(
      [
        "## Automations",
        "The saved automations could not be read this turn, so `workflow_run` has nothing to run. If the request needs one, say so rather than guessing an id.",
      ].join("\n"),
    );
  }

  if (inventory.connections.length) {
    sections.push(
      [
        "## Connected services",
        `Connected and usable through \`mcp_call\`: ${inventory.connections.join(", ")}.`,
        "Their exact tool names are listed in the registry section of this prompt. Use one when the request is about data or an action that lives in that service.",
      ].join("\n"),
    );
  }

  if (inventory.divisions.length) {
    sections.push(
      [
        "## Specialists",
        `The company roster holds ${inventory.specialistCount} specialist personas across these divisions. Bring one in by reasoning explicitly as that specialist for the part of the work it owns, and say whose expertise you are applying:`,
        ...inventory.divisions.map(
          (division) =>
            `- ${division.label} (${division.count}): ${division.examples.join(", ")}${division.count > division.examples.length ? ", …" : ""}`,
        ),
        "A persona can also be pinned to the whole conversation from the Agents tab, or with `/agents:agency-agents:<slug>` in a message — that is the user's choice to make, not yours to announce every turn.",
      ].join("\n"),
    );
  }

  if (inventory.runtimeAgents.length) {
    sections.push(runtimeAgentCatalogue(inventory));

    if (
      inventory.runtimeAgents.some((agent) => agent.id === OPEN_GYM_AGENT_ID)
    ) {
      sections.push(openGymRoutingRule());
    }

    if (
      inventory.runtimeAgents.some((agent) => agent.id === INBOX_ZERO_AGENT_ID)
    ) {
      sections.push(emailRoutingRule());
    }
  }

  // Unconditional, unlike the routing rules above it: most of this section is
  // about the tools this turn runs itself, and a surface with no research
  // worker still has `web_search` and `web_extract` to misuse.
  sections.push(researchRoutingRule(inventory));
  // The tracked pipeline sits after the staffing rule and only for a request
  // that earned it. A trivial super-agent turn never sees this section, which
  // is what keeps ordinary questions as fast as they were.
  if (researchPlan) sections.push(researchPipelineRule(researchPlan));

  return sections.join("\n\n");
}
