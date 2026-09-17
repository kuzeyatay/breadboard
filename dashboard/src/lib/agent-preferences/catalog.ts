import { RUNTIME_AGENT_PROFILES } from "../hermes/capability-combinations.ts";
import { loadAgencyAgentsCatalog } from "../hermes/agency-agents.ts";
import { agencyAgentToken } from "../hermes/agency-agent-command.ts";
import { runtimeAgentBrief } from "../hermes/runtime-agent-briefs.ts";
import type { AgentPreferenceOption } from "./preferences.ts";
import { loadArisAgentDefinition } from "../aris/agent.ts";
import { loadSpotifyAgentDefinition } from "../spotify-agent/agent.ts";
import { ARIS_AGENT_SLUG, ARIS_AGENT_COMMAND } from "../aris/identity.ts";
import { SPOTIFY_AGENT_SLUG, SPOTIFY_AGENT_COMMAND } from "../spotify-agent/identity.ts";

export function agentPreferenceCatalog(): { agents: AgentPreferenceOption[]; notice: string | null } {
  const agency = loadAgencyAgentsCatalog();
  const builtins = [
    { agent: loadArisAgentDefinition(), command: ARIS_AGENT_COMMAND },
    { agent: loadSpotifyAgentDefinition(), command: SPOTIFY_AGENT_COMMAND },
  ];
  const agents: AgentPreferenceOption[] = [
    ...RUNTIME_AGENT_PROFILES.map((agent) => ({
      command: agent.command, name: agent.name,
      description: runtimeAgentBrief(agent.id)?.does ?? "",
      group: "Runtime agents", manualOnly: !agent.launchableByModel,
    })),
    ...builtins.flatMap(({ agent, command }) => agent ? [{
      command, name: agent.name, description: agent.description,
      group: "Built-in agents", manualOnly: true,
    }] : []),
    ...agency.agents.filter((agent) => agent.slug !== ARIS_AGENT_SLUG && agent.slug !== SPOTIFY_AGENT_SLUG).map((agent) => ({
      command: `/${agencyAgentToken(agent.slug)}`, name: agent.name,
      description: agent.description, group: `Agency · ${agent.divisionLabel}`, manualOnly: true,
    })),
  ];
  return { agents: agents.sort((a, b) => a.name.localeCompare(b.name)), notice: agency.message };
}
