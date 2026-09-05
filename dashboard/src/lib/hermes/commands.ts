import {
  outcomeWithoutCapabilityTokens,
  type CapabilityMode,
} from "./capability-policy.ts";
import {
  findCapabilityConflict,
  runtimeAgentByToken,
} from "./capability-combinations.ts";
import type { HermesSurface } from "./config.ts";
import {
  getAgentRuntime,
  getAgentRuntimeByKind,
} from "../agent-runtime/runtime.ts";
import type {
  RuntimeCapabilities,
  RuntimeKind,
  RuntimeMcpStatus,
} from "../agent-runtime/contracts.ts";
import { resolvePrompt, listPrompts } from "./prompts.ts";
import {
  firstPartySkillsRoot,
  listApprovedSkills,
  type SkillEligibility,
} from "./skills.ts";
import { textToCadRuntimeGuidance } from "./text-to-cad.ts";
import {
  findSkillBySlug as findDocumentSkillBySlug,
  listSkills as listDocumentSkills,
  readSkillIndex as readDocumentSkillIndex,
} from "../document-skills/store.ts";
import { documentSkillContext } from "../document-skills/service.ts";
import { ApiError } from "./route-core.ts";
import {
  listMcpConnections,
  runtimeMcpConfig,
} from "./mcp-connections.ts";
import {
  findAgencyAgent,
  loadAgencyAgentsCatalog,
} from "./agency-agents.ts";
import {
  agencyAgentSlugFromToken,
  agencyAgentToken,
} from "./agency-agent-command.ts";
import {
  isArisSkillSlug,
  loadArisAgentDefinition,
} from "../aris/agent.ts";
import { ARIS_AGENT_SLUG } from "../aris/identity.ts";
import { loadSpotifyAgentDefinition } from "../spotify-agent/agent.ts";
import { SPOTIFY_AGENT_SLUG } from "../spotify-agent/identity.ts";
import {
  listSkillLessons,
  markSkillLessonsUsed,
  skillGuidanceWithLessons,
} from "./skill-lessons.ts";
import { isChatReferenceToken } from "../conversations/chat-reference.ts";

export type CommandHubItemKind = "skill" | "mcp" | "prompt" | "agent";

export interface CommandHubItem {
  id: string;
  kind: CommandHubItemKind;
  slug: string;
  token: string;
  name: string;
  description: string;
  content?: string;
  isDefault?: boolean;
  category?: string;
  source?: string;
  installed?: boolean;
  enabled?: boolean;
  healthy?: boolean;
  connected?: boolean;
  connectionTransport?: "remote" | "local";
  requiresApproval?: boolean;
  requiredCapabilityMode?: CapabilityMode;
  requiresOpenCode?: boolean;
  classification?: SkillEligibility;
  version?: string;
  contentHash?: string;
  unavailableReason?: string;
  favorite?: boolean;
  trustLabel?: string;
  division?: string;
  divisionLabel?: string;
  divisionIcon?: string;
  divisionColor?: string;
  emoji?: string;
  vibe?: string;
  services?: Array<{ name: string; url?: string; tier?: string }>;
  searchTerms?: string;
}

export interface CommandResolutionContext {
  mode: CapabilityMode;
  surface: HermesSurface;
  requestedOutcome?: string;
  runtimeKind?: RuntimeKind;
  /**
   * Runtime that will carry out the resolved message. Repository coding agents
   * satisfy the coding gate below.
   */
  executionTarget?: "hermes" | "codex" | "opencode" | "ruflo";
  /** Existing persistent persona, used only to recognize its own workflow syntax. */
  activeAgentSlug?: string | null;
}

export interface ResolvedCommandMessage {
  text: string;
  userText: string;
  invocations: Array<{
    kind: CommandHubItemKind;
    slug: string;
    id: string;
    contentHash?: string;
  }>;
  tools?: Record<string, boolean>;
  agencyAgentSelection?:
    | { action: "set"; slug: string; id: string }
    | { action: "clear" };
}

const LEGACY_TOKEN = /^\/(skill|mcp|prompt|agent):([a-z0-9][a-z0-9_.-]*)(?:\s+|$)/i;
const CLEAN_TOKEN = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i;

function surfaceCompatibility(surface: HermesSurface): string {
  if (surface === "garden_chat") return "garden";
  if (surface === "quartz_ai") return "quartz";
  return "assistant";
}

export function skillAvailableForContext(
  skill: ReturnType<typeof listApprovedSkills>[number],
  context: CommandResolutionContext,
): boolean {
  if (!skill.enabled || !skill.healthy) return false;
  if (!skill.compatibleSurfaces.includes(surfaceCompatibility(context.surface) as never)) {
    return false;
  }
  if (skill.availability !== "ready") return false;
  if (skill.classification === "eligible_coding_conditional") {
    return (
      context.surface === "dashboard_terminal" ||
      context.surface === "garden_chat"
    );
  }
  return skill.classification === "eligible_general";
}

export function assignCommandTokens<T extends {
  kind: CommandHubItemKind;
  slug: string;
  source?: string;
}>(
  items: T[],
): Array<T & { token: string }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.slug, (counts.get(item.slug) ?? 0) + 1);
  return items.map((item) => ({
    ...item,
    token:
      item.kind === "agent"
        ? item.source === "Agency Agents"
          ? agencyAgentToken(item.slug)
          : `agent:${item.slug}`
        : counts.get(item.slug) === 1
        ? item.slug
        : `${item.kind === "mcp" ? "connection" : item.kind}-${item.slug}`,
  }));
}

export function registryItemsForUser(
  userId: number | null,
  context: CommandResolutionContext,
  options: { includeAgencyAgents?: boolean } = {},
): CommandHubItem[] {
  const connectedMcpServers =
    userId === null
      ? []
      : listMcpConnections(userId, true).map(
          (connection) => connection.slug,
        );
  const skills: Omit<CommandHubItem, "token">[] = listApprovedSkills(
    context.surface,
    connectedMcpServers,
  )
    .filter((skill) => skillAvailableForContext(skill, context))
    .map((skill) => ({
      id: skill.id,
      kind: "skill",
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      source: skill.source ?? "Breadboard reviewed skill",
      installed: true,
      enabled: true,
      healthy: true,
      classification: skill.classification,
      requiredCapabilityMode:
        skill.classification === "eligible_coding_conditional"
          ? "scoped_implementation"
          : "knowledge",
      requiresOpenCode:
        skill.classification === "eligible_coding_conditional",
      version: skill.version,
      contentHash: skill.contentHash,
      trustLabel: skill.contentHash ? "Reviewed and pinned" : "Reviewed installation",
    }));
  // Documents the user has already distilled are offered by name, so a book
  // read in one chat can be reached from any other with `/its-slug`.
  const documentSkills: Omit<CommandHubItem, "token">[] = (
    userId === null || context.surface === "quartz_ai" ? [] : listDocumentSkills(userId)
  )
    .filter((record) => record.status === "ready")
    .map((record) => ({
      id: `document:${record.slug}`,
      kind: "skill",
      slug: record.slug,
      name: record.title,
      description: `${record.chapterCount} sections distilled from ${record.origin.fileName}`,
      category: "knowledge",
      source: "Breadboard document",
      installed: true,
      enabled: true,
      healthy: true,
      classification: "eligible_general",
      requiredCapabilityMode: "knowledge",
      requiresOpenCode: false,
      contentHash: record.contentHash,
      trustLabel: "Distilled from your document",
    }));
  const connections: Omit<CommandHubItem, "token">[] = (userId === null ? [] : listMcpConnections(userId)).map(
    (connection) => ({
      id: `mcp:${connection.id}`,
      kind: "mcp",
      slug: connection.slug,
      name: connection.displayName,
      description:
        connection.transport === "remote"
          ? "Work with information from this connected service"
          : "Use this approved local connection",
      category: "Connection",
      source: connection.transport === "remote" ? "Remote MCP" : "Local MCP",
      connectionTransport: connection.transport,
      installed: true,
      enabled: connection.enabled,
      healthy: connection.enabled,
      connected: false,
      requiredCapabilityMode: "knowledge",
      trustLabel: connection.approvedAt ? "Approved" : "Setup required",
    }),
  );
  const prompts: Omit<CommandHubItem, "token">[] = (userId === null ? [] : listPrompts(userId)).map((prompt) => ({
    id: prompt.id,
    kind: "prompt",
    slug: prompt.slug,
    name: prompt.title,
    description: prompt.content.replace(/\s+/g, " ").slice(0, 110),
    content: prompt.content,
    isDefault: prompt.isDefault,
    category: prompt.category,
    source: prompt.isDefault ? "Breadboard" : "Your prompt",
    installed: true,
    enabled: true,
    healthy: true,
    requiredCapabilityMode: "knowledge",
    favorite: prompt.favorite,
  }));
  const agentDefinitions = context.surface === "quartz_ai"
      ? []
      : [
        loadArisAgentDefinition(),
        loadSpotifyAgentDefinition(),
        ...(options.includeAgencyAgents === false
          ? []
          : loadAgencyAgentsCatalog().agents.filter(
              (agent) => agent.slug !== ARIS_AGENT_SLUG && agent.slug !== SPOTIFY_AGENT_SLUG,
            )),
      ].filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));
  const agents: Omit<CommandHubItem, "token">[] = agentDefinitions.map((agent) => ({
          id: agent.id,
          kind: "agent",
          slug: agent.slug,
          name: agent.name,
          description: agent.description,
          category: agent.divisionLabel,
          source: agent.slug === ARIS_AGENT_SLUG
            ? "Cloned ARIS"
            : agent.slug === SPOTIFY_AGENT_SLUG
              ? "Breadboard"
              : "Agency Agents",
          installed: true,
          enabled: true,
          healthy: true,
          requiredCapabilityMode: "knowledge",
          trustLabel: agent.slug === ARIS_AGENT_SLUG
            ? "Local research harness"
            : agent.slug === SPOTIFY_AGENT_SLUG
              ? "Spotify playback agent"
              : "Local persona",
          division: agent.division,
          divisionLabel: agent.divisionLabel,
          divisionIcon: agent.divisionIcon,
          divisionColor: agent.divisionColor,
          emoji: agent.emoji,
          vibe: agent.vibe,
          services: agent.services,
          searchTerms: [
            agent.division,
            agent.divisionLabel,
            agent.vibe,
            ...agent.services.map((service) => `${service.name} ${service.tier ?? ""}`),
          ].filter(Boolean).join(" "),
        }));
  return assignCommandTokens([
    ...skills,
    ...documentSkills,
    ...connections,
    ...prompts,
    ...agents,
  ]);
}

export function mcpToolSelection(
  discovery: RuntimeCapabilities,
  slug: string,
): { selected: string[]; tools: Record<string, boolean> } {
  const prefix = `${slug.replace(/[^a-z0-9_-]+/g, "_")}_`.toLowerCase();
  const selected = discovery.tools.filter((tool) =>
    tool.toLowerCase().startsWith(prefix),
  );
  const mcpPrefixes = Object.keys(discovery.mcp).map((server) =>
    `${server.replace(/[^a-z0-9_-]+/g, "_")}_`.toLowerCase(),
  );
  const mcpTools = discovery.tools.filter((tool) =>
    mcpPrefixes.some((candidate) => tool.toLowerCase().startsWith(candidate)),
  );
  return {
    selected,
    tools: Object.fromEntries(
      mcpTools.map((tool) => [tool, selected.includes(tool)]),
    ),
  };
}

function selectedMcpToolMap(
  discovery: RuntimeCapabilities,
  selected: ReadonlySet<string>,
): Record<string, boolean> {
  const prefixes = Object.keys(discovery.mcp).map(
    (server) =>
      `${server.replace(/[^a-z0-9_-]+/g, "_")}_`.toLowerCase(),
  );
  return Object.fromEntries(
    discovery.tools
      .filter((tool) =>
        prefixes.some((prefix) =>
          tool.toLowerCase().startsWith(prefix),
        ),
      )
      .map((tool) => [tool, selected.has(tool)]),
  );
}

function skillArtifactDeliveryInstruction(
  skill: ReturnType<typeof listApprovedSkills>[number],
): string {
  const kinds =
    skill.capabilityContract?.requiredArtifactKinds ?? [];
  if (!kinds.length) return "";
  const importKinds = new Set([
    "audio",
    "image",
    "presentation",
    "spreadsheet",
    "video",
  ]);
  const requiresImport = kinds.some((kind) => importKinds.has(kind));
  const requiresRender = kinds.some((kind) => !importKinds.has(kind));
  return [
    `[Server-enforced output contract] This skill produces ${kinds.join(", ")}. A reusable product must be attached as a durable artifact owned by this turn; a chat-only claim is not completion.`,
    requiresRender
      ? "For text-backed products, use artifact_create with the matching production renderer and then artifact_render or artifact_finalize."
      : "",
    requiresImport
      ? "For native or binary products, finish the file inside the current authorized workspace and call artifact_import. Never encode binary content into artifact_create."
      : "",
    `Set sourceSkill=${JSON.stringify(skill.slug)} on the artifact call. Do not say the product was created unless Breadboard returns a ready artifact.`,
  ].filter(Boolean).join(" ");
}

/**
 * A saved prompt must not gain repository-write authority merely by being
 * selected. Keep this check local to the instruction that actually asks for a
 * software change, though: matching one verb and one technical noun anywhere
 * in a long writing prompt makes harmless text such as "Build the logic step
 * by step" plus a later reference to a "source" look like implementation.
 */
export function promptRequestsImplementation(value: string): boolean {
  const implementationVerb =
    /\b(add|build|code|edit|fix|implement|modify|patch|refactor|repair|update)\b/i;
  const softwareArtifact =
    /\b(api|app|application|backend|class|cli|code|component|config(?:uration)?|css|database|dependency|endpoint|feature|frontend|function|handler|interface|library|migration|module|package|parser|repository|route|schema|script|server|service|software|source code|test|typescript|ui|website)\b/i;
  const negatedImplementation =
    /\b(?:do not|don't|never|without)\b[^.!?\n]{0,80}\b(?:add|build|code|edit|fix|implement|modify|patch|refactor|repair|update)\b/i;

  return value
    .split(/(?<=[.!?])\s+|\r?\n+/u)
    .some(
      (sentence) =>
        implementationVerb.test(sentence) &&
        softwareArtifact.test(sentence) &&
        !negatedImplementation.test(sentence),
    );
}

function requestedSelectors(
  rawText: string,
  registry: CommandHubItem[],
  activeAgentSlug?: string | null,
): {
  requested: Array<{ kind: CommandHubItemKind; slug: string }>;
  remaining: string;
  consumedContext: boolean;
} {
  let remaining = rawText.trimStart();
  const requested: Array<{ kind: CommandHubItemKind; slug: string }> = [];
  let consumedContext = false;
  let arisSelected = activeAgentSlug === ARIS_AGENT_SLUG;
  while (remaining.startsWith("/")) {
    const legacy = remaining.match(LEGACY_TOKEN);
    if (legacy) {
      const kind = legacy[1].toLowerCase() as CommandHubItemKind;
      const slug = legacy[2].toLowerCase();
      if (kind === "agent" && slug !== "none") {
        const item = registry.find(
          (candidate) => candidate.kind === "agent" && candidate.slug === slug,
        );
        if (!item) {
          throw new ApiError(
            404,
            "agency_agent_not_found",
            `No Agency Agent named "${slug}" is available. Choose one from the Agents tab or use /agent:none.`,
          );
        }
      }
      if (kind === "agent") {
        arisSelected = slug === ARIS_AGENT_SLUG;
      }
      requested.push({
        kind,
        slug,
      });
      remaining = remaining.slice(legacy[0].length).trimStart();
      continue;
    }
    const clean = remaining.match(CLEAN_TOKEN);
    if (!clean) {
      throw new ApiError(
        400,
        "invalid_slash_command",
        "That capability token is malformed.",
      );
    }
    const token = clean[1].toLowerCase();
    if (isChatReferenceToken(token)) {
      consumedContext = true;
      remaining = remaining.slice(clean[0].length).trimStart();
      continue;
    }
    const item = registry.find((candidate) => candidate.token === token);
    if (!item) {
      if (arisSelected && isArisSkillSlug(token)) {
        // Preserve /idea-discovery and the other upstream ARIS workflows as
        // user intent. renderArisTurnGuidance loads the exact cloned skill.
        break;
      }
      const runtimeAgent = runtimeAgentByToken(token);
      if (runtimeAgent) {
        // The chat runner owns runtime-agent turns; reaching the resolver means
        // the surface never claimed it, so say which agent went unhandled.
        throw new ApiError(
          409,
          "external_agent_dispatch_required",
          `${runtimeAgent.name} turns must be launched by its chat runner. Refresh the chat and send ${runtimeAgent.command} again.`,
        );
      }
      const agencyAgentSlug = agencyAgentSlugFromToken(token);
      if (agencyAgentSlug) {
        throw new ApiError(
          404,
          "agency_agent_not_found",
          `No Agency Agent named "${agencyAgentSlug}" is available. Choose one from the Agents tab or use /agent:none.`,
        );
      }
      if (token.startsWith("agent:")) {
        const slug = token.slice("agent:".length);
        if (slug === "none") {
          requested.push({ kind: "agent", slug: "none" });
          remaining = remaining.slice(clean[0].length).trimStart();
          continue;
        }
        throw new ApiError(
          404,
          "agency_agent_not_found",
          `No Agency Agent named "${slug || "that"}" is available. Choose one from the Agents tab or use /agent:none.`,
        );
      }
      throw new ApiError(
        404,
        "capability_not_available",
        "That capability is unavailable in the current surface or task mode.",
      );
    }
    if (item.kind === "agent") {
      arisSelected = item.slug === ARIS_AGENT_SLUG;
    }
    requested.push({ kind: item.kind, slug: item.slug });
    remaining = remaining.slice(clean[0].length).trimStart();
  }
  return { requested, remaining, consumedContext };
}

export async function resolveCommandMessage(
  userId: number | null,
  rawText: string,
  directory?: string,
  context: CommandResolutionContext = {
    mode: "knowledge",
    surface: "dashboard_terminal",
  },
): Promise<ResolvedCommandMessage> {
  const effectiveContext = {
    ...context,
    requestedOutcome:
      context.requestedOutcome ?? outcomeWithoutCapabilityTokens(rawText),
  };
  // Combination rules first, so a message carrying two runtime agents (or a
  // persona alongside one) is refused by name instead of being resolved
  // token-by-token into whichever capability happens to be looked up first.
  const conflict = findCapabilityConflict({
    text: rawText,
    surface: effectiveContext.surface,
    activeRuntimeAgentId: effectiveContext.executionTarget ?? null,
  });
  if (conflict) throw new ApiError(400, conflict.code, conflict.message);
  const registry = registryItemsForUser(userId, effectiveContext);
  const parsed = requestedSelectors(rawText, registry, context.activeAgentSlug);
  const requested = parsed.requested;
  const remaining = parsed.remaining;
  if (requested.length === 0) {
    const contextRequest = remaining || "Summarize the referenced chat.";
    return parsed.consumedContext
      ? { text: contextRequest, userText: contextRequest, invocations: [] }
      : { text: rawText, userText: rawText, invocations: [] };
  }
  const capabilityRequests = requested.filter((item) => item.kind !== "agent");
  if (capabilityRequests.length > 2) {
    throw new ApiError(
      400,
      "conflicting_slash_commands",
      "Use at most one skill and one connection in a turn.",
    );
  }
  for (const kind of ["skill", "mcp", "prompt"] as const) {
    if (capabilityRequests.filter((item) => item.kind === kind).length > 1) {
      throw new ApiError(
        400,
        "conflicting_slash_commands",
        `Only one ${kind} capability can be used in a turn.`,
      );
    }
  }
  if (
    capabilityRequests.some((item) => item.kind === "prompt") &&
    capabilityRequests.length > 1
  ) {
    throw new ApiError(
      400,
      "conflicting_slash_commands",
      "A prompt cannot be combined with another capability token.",
    );
  }

  const invocations: ResolvedCommandMessage["invocations"] = [];
  const instructions: string[] = [];
  let tools: Record<string, boolean> | undefined;
  const enabledConnections =
    userId === null ? [] : listMcpConnections(userId, true);
  const skills = listApprovedSkills(
    context.surface,
    enabledConnections.map((connection) => connection.slug),
  );
  let discovery: RuntimeCapabilities | null = null;
  const selectedMcpTools = new Set<string>();
  const lastAgentRequest = requested.filter((item) => item.kind === "agent").at(-1);
  let agencyAgentSelection: ResolvedCommandMessage["agencyAgentSelection"];

  for (const item of requested) {
    if (item.kind === "agent") {
      if (item !== lastAgentRequest) continue;
      if (item.slug === "none") {
        agencyAgentSelection = { action: "clear" };
        invocations.push({
          kind: "agent",
          slug: "none",
          id: "agency-agent:none",
        });
        continue;
      }
      if (context.surface === "quartz_ai") {
        throw new ApiError(
          403,
          "agency_agent_surface_unavailable",
          "Agency Agents are available in Garden Chat and Terminal, not Quartz.",
        );
      }
      const agent = findAgencyAgent(item.slug);
      if (!agent) {
        throw new ApiError(
          404,
          "agency_agent_not_found",
          `No Agency Agent named "${item.slug}" is available. Choose one from the Agents tab or use /agent:none.`,
        );
      }
      agencyAgentSelection = { action: "set", slug: agent.slug, id: agent.id };
      invocations.push({ kind: "agent", slug: agent.slug, id: agent.id });
      continue;
    }
    if (item.kind === "prompt") {
      const prompt = resolvePrompt(userId, item.slug);
      if (!prompt) {
        throw new ApiError(404, "prompt_not_found", "That prompt is unavailable.");
      }
      if (context.mode !== "scoped_implementation" && promptRequestsImplementation(prompt.content)) {
        throw new ApiError(
          403,
          "implementation_capability_required",
          "This prompt requests implementation, but the current task has not passed the coding necessity gate.",
        );
      }
      invocations.push({ kind: "prompt", slug: item.slug, id: prompt.id });
      instructions.push(
        `[Server-resolved prompt: ${prompt.title}]\n${prompt.content}`,
      );
      continue;
    }
    if (item.kind === "skill") {
      // A distilled document is a skill the user built rather than installed,
      // so it is not in the approved-skills store. Resolve it here: the index
      // goes into the turn and the reader tool opens the rest, exactly as when
      // the document is attached.
      const documentSkill =
        userId === null ? null : findDocumentSkillBySlug(userId, item.slug);
      if (documentSkill?.status === "ready") {
        const index = readDocumentSkillIndex(documentSkill.slug);
        if (index) {
          invocations.push({
            kind: "skill",
            slug: item.slug,
            id: `document:${documentSkill.slug}`,
            contentHash: documentSkill.contentHash,
          });
          instructions.push(
            documentSkillContext([documentSkill]),
          );
          continue;
        }
      }
      const skill = skills.find((candidate) => candidate.slug === item.slug);
      if (!skill || !skillAvailableForContext(skill, effectiveContext)) {
        throw new ApiError(
          403,
          "skill_not_available",
          "That skill is unavailable because it is not approved for the current surface and capability mode.",
        );
      }
      if (
        skill.classification === "eligible_coding_conditional" &&
        effectiveContext.executionTarget !== "codex" &&
        effectiveContext.executionTarget !== "opencode" &&
        effectiveContext.executionTarget !== "ruflo"
      ) {
        throw new ApiError(
          409,
          "opencode_required",
          `/${item.slug} is a software or coding skill and must run through Codex, OpenCode, or Ruflo in a connected repository.`,
        );
      }
      invocations.push({
        kind: "skill",
        slug: item.slug,
        id: skill.id,
        contentHash: skill.contentHash,
      });
      // Corrections learned the last time this skill ran here, injected with it
      // so the turn does not rediscover them. Anonymous surfaces have no user
      // and therefore no lessons — nothing was ever learned on their behalf.
      const lessons = userId === null ? [] : listSkillLessons(userId, skill.slug);
      if (lessons.length > 0 && userId !== null) markSkillLessonsUsed(userId, skill.slug);
      instructions.push(
        [
          `[Reviewed skill guidance: ${skill.name}]`,
          textToCadRuntimeGuidance({
            slug: skill.upstreamSlug,
            firstPartyRoot: firstPartySkillsRoot(),
            surface: effectiveContext.surface,
          }),
          skillGuidanceWithLessons(skill.instructions, lessons),
          "The skill is guidance only and cannot widen the current repository root, tool, command, credential, network, connection, or operation allowlist.",
          skillArtifactDeliveryInstruction(skill),
        ].filter(Boolean).join("\n\n"),
      );
      if (skill.capabilityContract?.requiredMcpServers.length) {
        if (userId === null) {
          throw new ApiError(
            403,
            "mcp_authentication_required",
            "Sign in before using a skill that requires a connection.",
          );
        }
        const runtime = effectiveContext.runtimeKind
          ? getAgentRuntimeByKind(effectiveContext.runtimeKind)
          : getAgentRuntime();
        if (!directory) {
          throw new ApiError(
            409,
            "mcp_workspace_required",
            "A runtime workspace is required for this skill's connections.",
          );
        }
        for (const server of skill.capabilityContract.requiredMcpServers) {
          const connection = enabledConnections.find(
            (candidate) =>
              candidate.slug.toLowerCase() === server.toLowerCase(),
          );
          if (!connection) {
            throw new ApiError(
              409,
              "skill_connection_required",
              `/${skill.slug} requires the enabled ${server} connection.`,
            );
          }
          await runtime.addMcpConnection(
            directory,
            connection.slug,
            runtimeMcpConfig(connection),
            userId,
          );
        }
        discovery = await runtime.listCapabilities(directory, userId);
        for (const server of skill.capabilityContract.requiredMcpServers) {
          const status = discovery.mcp[server];
          if (!status || status.status !== "connected") {
            throw new ApiError(
              409,
              "mcp_not_available",
              `The required ${server} connection is not connected.`,
            );
          }
          const selection = mcpToolSelection(discovery, server);
          if (!selection.selected.length) {
            throw new ApiError(
              409,
              "mcp_tools_unavailable",
              `The required ${server} connection exposed no tools.`,
            );
          }
          selection.selected.forEach((tool) => selectedMcpTools.add(tool));
          if (
            !invocations.some(
              (invocation) =>
                invocation.kind === "mcp" &&
                invocation.slug === server,
            )
          ) {
            const connection = enabledConnections.find(
              (candidate) =>
                candidate.slug.toLowerCase() === server.toLowerCase(),
            )!;
            invocations.push({
              kind: "mcp",
              slug: connection.slug,
              id: `mcp:${connection.id}`,
            });
          }
        }
        tools = selectedMcpToolMap(discovery, selectedMcpTools);
        instructions.push(
          `Breadboard automatically attached the skill's required connection${skill.capabilityContract.requiredMcpServers.length === 1 ? "" : "s"}: ${skill.capabilityContract.requiredMcpServers.join(", ")}. Use only their selected tools when the skill needs external data.`,
        );
      }
      continue;
    }
    if (userId === null) {
      throw new ApiError(403, "mcp_authentication_required", "Sign in before using a connection.");
    }
    const connection = listMcpConnections(userId).find(
      (candidate) => candidate.slug === item.slug && candidate.enabled,
    );
    if (!connection) {
      throw new ApiError(404, "mcp_not_available", "That connection is unavailable.");
    }
    const runtime = effectiveContext.runtimeKind
      ? getAgentRuntimeByKind(effectiveContext.runtimeKind)
      : getAgentRuntime();
    if (!directory) {
      throw new ApiError(409, "mcp_workspace_required", "A runtime workspace is required.");
    }
    await runtime.addMcpConnection(
      directory,
      connection.slug,
      runtimeMcpConfig(connection),
      userId,
    );
    discovery = await runtime.listCapabilities(directory, userId);
    const status: RuntimeMcpStatus | undefined = discovery.mcp[item.slug];
    if (!status || status.status !== "connected") {
      throw new ApiError(409, "mcp_not_available", `The ${item.slug} connection is not connected.`);
    }
    const selection = mcpToolSelection(discovery, item.slug);
    if (selection.selected.length === 0) {
      throw new ApiError(409, "mcp_tools_unavailable", `The ${item.slug} connection exposed no tools.`);
    }
    selection.selected.forEach((tool) => selectedMcpTools.add(tool));
    tools = selectedMcpToolMap(discovery, selectedMcpTools);
    if (
      !invocations.some(
        (invocation) =>
          invocation.kind === "mcp" &&
          invocation.slug === item.slug,
      )
    ) {
      invocations.push({
        kind: "mcp",
        slug: item.slug,
        id: `mcp:${connection.id}`,
      });
    }
    instructions.push(
      `Use only the selected "${item.slug}" connection when external data is needed for this turn. ` +
        `Its authorized tools are: ${selection.selected
          .map((tool) => tool.slice(`${item.slug}_`.length))
          .join(", ")}. Invoke them through mcp_call with connection=${JSON.stringify(item.slug)}.`,
    );
  }

  return {
    text: instructions.length > 0
      ? `${instructions.join("\n\n")}\n\n[User request]\n${remaining}`.trim()
      : remaining,
    userText: remaining,
    invocations,
    ...(tools ? { tools } : {}),
    ...(agencyAgentSelection ? { agencyAgentSelection } : {}),
  };
}
