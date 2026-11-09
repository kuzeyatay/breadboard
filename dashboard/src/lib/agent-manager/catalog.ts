import { RUNTIME_AGENT_PROFILES } from "../hermes/capability-combinations.ts";
import { findConfigurableAgent } from "../agent-settings/catalog.ts";
import { UNIFIED_WORKFLOWS, UNIFIED_AGENT_INPUT_REQUIREMENTS } from "../workflows/unified-catalog.ts";

export interface AgentManagerAction {
  id: string;
  label: string;
  serviceId: string;
  action: string;
  destructive: boolean;
}
export interface AgentManagerEntry {
  id: string;
  name: string;
  command: string;
  workflowId: string;
  description: string;
  healthUrl: string | null;
  distribution: "managed" | "included" | "external";
  hasSettings: boolean;
  requirements: string;
  actions: readonly AgentManagerAction[];
}

const action = (serviceId: string, value: string, label: string): AgentManagerAction => ({
  id: value, serviceId, action: value, label, destructive: value === "remove",
});
const python = (serviceId: string) => [
  action(serviceId, "install", "Install required tools"),
  action(serviceId, "reinstall", "Reinstall tools"),
  action(serviceId, "remove", "Remove installed tools"),
];

// Only fixed recipes owned by the native managed-setup worker appear here.
// Do not turn an arbitrary endpoint, command, directory or package into an action.
const ACTIONS: Readonly<Record<string, readonly AgentManagerAction[]>> = {
  "deep-tutor": python("deep-tutor"),
  "deer-flow": python("deer-flow"),
  "legal": python("legal"),
  "money-printer": python("money-printer"),
  "openexecutive": python("openexecutive"),
  "shorts": python("shorts"),
  "stock-analyst": python("stock-analyst"),
  "trading-agent": python("tradingagents"),
  "vibe-trading": python("vibe-trading"),
  "bolt-slides": [action("bolt-slides", "install-dependencies", "Install or repair tools")],
  "career-ops": [action("career-ops", "install", "Install or repair tools"), action("career-ops", "browsers", "Download browser")],
  "hyperframes": [action("hyperframes", "install-cli", "Install / repair rendering tools")],
  "matraix": [action("matraix", "install-runtime", "Install or repair tools")],
  "music-producer": [action("acestep", "install", "Download and prepare music models")],
  "openmontage": [action("openmontage", "install-dependencies", "Install or repair tools"), action("openmontage", "install-remotion", "Install animation tools")],
  "openscience": [action("openscience", "install", "Install or repair tools")],
  "openwork": [action("openwork", "prepare-server", "Set up or repair")],
  "resource2skill": [action("resource2skill", "install-runtime", "Install or repair tools"), action("resource2skill", "install-web", "Download web tools"), action("resource2skill", "install-blender", "Install Blender support")],
  "wardrobe": [action("wardrobe", "install", "Install or repair tools")],
};

const HEALTH_ALIASES: Readonly<Record<string, string | null>> = {
  "trading-agent": "tradingagents", "parametric-cad": "cad", "formsmith": "shaper", "agent-tars": "ui-tars",
  "hardware-blueprint": null, "max-research": null, "socials-manager": null, "vimax": null,
};
const INCLUDED = new Set(["hardware-blueprint", "max-research", "deep-research", "meeting-notes", "parametric-cad", "get-doc"]);
// These IDs have dedicated dialogs in CommandHub.openAgentSettings; the rest
// must actually exist in the shared configurable-agent catalog.
export const AGENT_MANAGER_CUSTOM_SETTINGS = ["agent-tars", "agent-reach", "socials-manager", "hyperframes", "resource2skill", "matraix", "bolt-slides", "classroom", "gods-eye", "openmontage", "openscience", "openwork", "wardrobe", "inbox-zero"] as const;
const REQUIREMENTS: Readonly<Record<string, string>> = {
  codex: "Requires Codex, a signed-in account, and a connected project. Shares the account used by your coding provider.",
  opencode: "Requires OpenCode, a model connection, and a connected project.",
  ruflo: "Requires a configured coding agent and a connected project.",
  "agent-browser": "Uses your selected browser profile and its signed-in accounts.",
  "agent-tars": "Requires a visual model and permission to use the browser or desktop.",
  "agent-reach": "Add channel tools, browser extensions, and account connections in agent settings.",
  "deep-research": "Requires a model connection and access to your sources.",
  "get-doc": "Full-text access depends on the publisher and your library subscriptions.",
  "meeting-notes": "Text notes work without setup. For recordings, configure Scriberr or Voicebox transcription.",
  "hardware-blueprint": "Included. Requires a model connection.",
  "parametric-cad": "Included. Requires the local CAD tools listed in its status check.",
  "max-research": "Uses the specialists in the Research Master Agent. No separate download is needed.",
  openplanter: "Included with the desktop app. Uses your model connection.",
  praxist: "Requires a prepared project, acceptance of Praxist’s terms, and Docker with its Linux image. Check status for missing requirements.",
  "socials-manager": "Connect social accounts and manage publishing permissions in agent settings.",
  "inbox-zero": "Set up the local mail service and connect your mailbox in agent settings.",
  classroom: "Set up Classroom in agent settings.",
  "gods-eye": "Set up the globe in agent settings. Some map layers need a Google Maps key.",
  "music-producer": "Requires large model downloads and compatible hardware, or an external ACE-Step provider.",
  "vox-director": "Requires narration, FFmpeg, and image generation. Shares downloaded models and voices with other media tools.",
  vimax: "Configure video and image providers and media tools in agent settings.",
  formsmith: "Requires separately installed 3D tools, downloaded models, and compatible hardware. Check status for missing requirements.",
  "video-use": "Configure video tools and transcription in agent settings.",
  wardrobe: "Requires a reference photo, an image provider, and the tools listed below.",
  "money-printer": "Requires Python tools, FFmpeg, narration, and access to a footage provider.",
};

export const AGENT_MANAGER_CATALOG: readonly AgentManagerEntry[] = RUNTIME_AGENT_PROFILES.map((profile) => {
  const workflow = UNIFIED_WORKFLOWS.find((item) => item.agentIds.includes(profile.id));
  const mode = workflow?.modes.find((item) => item.agentIds.includes(profile.id));
  const healthId = profile.id in HEALTH_ALIASES ? HEALTH_ALIASES[profile.id] : profile.id;
  const managedActions = ACTIONS[profile.id] ?? [];
  const actions = managedActions.length && !managedActions.some(item => item.id === "remove")
    ? [...managedActions, action(managedActions[0].serviceId, "remove", profile.id === "music-producer" ? "Remove music models and tools" : "Remove installed tools")]
    : managedActions;
  return {
    id: profile.id, name: profile.name, command: profile.command,
    workflowId: workflow?.id ?? "", description: mode?.description ?? "",
    healthUrl: healthId ? `/api/${healthId}/health` : null,
    distribution: ACTIONS[profile.id] ? "managed" : INCLUDED.has(profile.id) ? "included" : "external",
    hasSettings: Boolean(findConfigurableAgent(profile.id)) || AGENT_MANAGER_CUSTOM_SETTINGS.some((id) => id === profile.id),
    requirements: REQUIREMENTS[profile.id] ?? UNIFIED_AGENT_INPUT_REQUIREMENTS[profile.id] ??
      "Install the required tools here, then connect models or accounts in agent settings.",
    actions,
  };
});

export function agentManagerEntry(id: string): AgentManagerEntry | null {
  return AGENT_MANAGER_CATALOG.find((entry) => entry.id === id) ?? null;
}

export function agentManagerAction(agentId: string, actionId: string): AgentManagerAction | null {
  return agentManagerEntry(agentId)?.actions.find((entry) => entry.id === actionId) ?? null;
}

export const AGENT_MANAGER_WORKFLOWS = UNIFIED_WORKFLOWS.map(({ id, name, agentIds }) => ({ id, name, agentIds }));
