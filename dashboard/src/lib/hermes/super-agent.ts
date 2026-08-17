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
  INBOX_ZERO_AGENT_ID,
  INBOX_ZERO_COMMAND,
} from "../inbox-zero/identity.ts";
import { ensureN8nSession, n8nJson } from "../workflows/n8n.ts";
import { summarizeLocalWorkflow } from "../workflows/execution.ts";
import type { LocalWorkflowSummary } from "../workflows/types.ts";

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
      skill.classification === "eligible_general",
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

async function localWorkflows(): Promise<{
  workflows: LocalWorkflowSummary[];
  reachable: boolean;
}> {
  try {
    const session = await ensureN8nSession();
    const listed = await n8nJson("/rest/workflows?limit=100", {
      method: "GET",
      session,
    });
    const rows = Array.isArray(listed)
      ? listed
      : Array.isArray((listed as { data?: unknown })?.data)
        ? ((listed as { data: unknown[] }).data)
        : [];
    return {
      workflows: rows
        .map((row) => summarizeLocalWorkflow(row))
        .filter((row): row is LocalWorkflowSummary => Boolean(row))
        .slice(0, MAX_LISTED_WORKFLOWS),
      reachable: true,
    };
  } catch {
    // The automation service is optional and started on demand. A super-agent
    // turn must not fail because it is not running.
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
  const connections = listMcpConnections(input.userId, true).map(
    (connection) => connection.slug,
  );
  const skills = skillEntries(input.surface, connections);
  const catalog = loadAgencyAgentsCatalog();
  const roster =
    catalog.status === "ready"
      ? divisionEntries(catalog.agents)
      : { divisions: [], specialistCount: 0 };
  const workflows = await localWorkflows();
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
  if (available.has("agent-browser")) {
    instruments.push(
      "- `agent-browser` — a real browser. The only instrument for pages that need clicking, scrolling, or JavaScript to show their content, which is what `web_extract` reporting an empty page usually means.",
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
    "",
    "And say what actually happened. A tool that returned an error did no work: name the failure and what you did instead. Never present a figure taken from a search snippet as something you read on the page, and never fill a gap from memory — an unverified list of names is the one answer this turn must not produce.",
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
        "These are the user's own local n8n automations. Call `workflow_run` with the workflow id and the input text when one of them is what the request is asking for.",
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
        "The local automation service is not running this turn, so `workflow_run` has nothing to run. If the request needs one, say it needs the Workflows page opened first.",
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
    const launchable = inventory.runtimeAgents.filter((agent) => agent.launchable);
    const userOnly = inventory.runtimeAgents.filter((agent) => !agent.launchable);
    sections.push(
      [
        "## Runtime agents — start one with `agent_launch`",
        "Each of these is a private worker you can call with `agent_launch`. Give it a complete brief when the request is plainly its work rather than something you can finish yourself. Three things follow from how delegation works, and all matter:",
        "- It has not run when the tool returns. It starts after your turn ends. Never write as though you have already seen its output, and never invent a result, file, artifact, or link.",
        "- The agent cannot see this conversation. The brief is everything it gets: subject, constraints, and what the finished thing should be, written for a stranger.",
        "- Its card is hidden. Its outcome always returns to you as an internal turn. Summarize the useful result in your own voice; if it produced an artifact or file, present that exact artifact or link to the user. Do not merely report that the worker finished.",
        ...launchable.map(
          (agent) => `- ${agent.id} — ${agent.name} (${agent.command})`,
        ),
        userOnly.length
          ? `\nStarted from their own form, so only the user can run them — name the command instead of calling the tool: ${userOnly
              .map((agent) => `${agent.command} (${agent.name})`)
              .join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

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

  return sections.join("\n\n");
}
