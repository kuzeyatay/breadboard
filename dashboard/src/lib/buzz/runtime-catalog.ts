// The agents whose existing run routes accept a text brief. File/form agents
// keep their own input flow; this list never pretends a persona is a runtime.
import { RUNTIME_AGENT_PROFILES, runtimeAgentById } from "../hermes/capability-combinations.ts";
export const ROOM_RUNTIME_IDS = ["agent-reach", "bolt-slides", "parametric-cad", "career-ops", "classroom", "codex", "deep-research", "deep-tutor", "deer-flow", "get-doc", "gods-eye", "hardware-blueprint", "hyperframes", "inbox-zero", "matraix", "max-research", "money-printer", "music-producer", "opencode", "openexecutive", "openmontage", "openplanter", "openscience", "openwork", "praxist", "resource2skill", "ruflo", "socials-manager", "stock-analyst", "vibe-trading", "vimax", "vox-director"] as const;
export const ROOM_RUNTIME_AGENTS = RUNTIME_AGENT_PROFILES.filter(agent => (ROOM_RUNTIME_IDS as readonly string[]).includes(agent.id));
export const runtimeSlug = (id: string) => `runtime:${id}`;
export function roomRuntime(slug: string | null) {
  if (!slug?.startsWith("runtime:")) return null;
  const id = slug.slice(8);
  return (ROOM_RUNTIME_IDS as readonly string[]).includes(id) ? runtimeAgentById(id) : null;
}
