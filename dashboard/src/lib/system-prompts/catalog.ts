import { BREAD_ASSISTANT_IDENTITY } from "../assistant-identity.ts";
import { MAINTENANCE_PROMPT_FILES, MAINTENANCE_REPAIR_PROMPT } from "./maintenance-defaults.ts";
import { loadAgencyAgentsCatalog } from "../hermes/agency-agents.ts";
import { loadArisAgentDefinition } from "../aris/agent.ts";
import { loadSpotifyAgentDefinition } from "../spotify-agent/agent.ts";
import { FEATURE_SYSTEM_PROMPTS } from "./feature-defaults.ts";
import { COORDINATION_SYSTEM_PROMPTS } from "./coordination-defaults.ts";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";
import { CONVERSATION_REFERENCE_POLICY } from "../conversations/message-context.ts";
import { directModeSection } from "../hermes/direct-mode.ts";
import { voiceToolContract, VOICE_CONVERSATION_PROMPT, VOICE_ARTIFACT_PROMPT } from "../speech/voice-prompt.ts";
import { RUNTIME_SYSTEM_PROMPT, DIRECT_PROVIDER_PROMPT } from "./defaults.ts";
import { GOAL_CONTINUATION_PROMPT, GOAL_BUDGET_PROMPT } from "../goal-prompts.ts";
import type { SystemPromptDefinition } from "./types.ts";

// Every stable section used by the interactive prompt composer is registered
// here. Runtime facts (grants, model identity, page context) stay separate.
const files: Array<[string, string, string, string]> = [
  ["chat-core", "Main assistant", "Chat", "The shared instructions for every chat, including writing style and how Bread handles requests."],
  ["response-style", "Response style", "Chat", "Writing instructions for legacy assistant routes."],
  ["artifact-delivery", "Files and artifacts", "Chat", "When to create files and how to deliver or revise them."],
  ["scoped-implementation", "Implementation", "Chat", "Instructions used when a turn has permission to edit files."],
  ["web-grounding", "Web research", "Tools", "How to ground answers when web evidence is required."],
  ["garden-page-history", "Garden page history", "Tools", "Reading a page’s origin and edit history."],
  ["garden-sources", "Garden sources", "Tools", "Discovering and importing sources into Gardens."],
  ["geographic-grounding", "Maps and places", "Tools", "Finding places and grounding geographic answers."],
  ["image-results", "Image search", "Tools", "Selecting and displaying image search results."],
  ["garden-image-replies", "Garden images", "Tools", "Using figures and images from Garden sources."],
  ["weather-results", "Weather", "Tools", "Retrieving and displaying weather forecasts."],
  ["product-search", "Product search", "Tools", "Finding and comparing products."],
  ["chat-search", "Chat search", "Tools", "Finding and reading previous conversations."],
  ["chat-coordination", "Chat coordination", "Tools", "Working with other chats and their ongoing tasks."],
  ["notifications", "Notifications", "Tools", "Reading and summarizing notifications."],
  ["process-status", "Task status", "Tools", "Checking and reporting progress on running work."],
  ["usage-status", "Codex usage", "Tools", "Reading the connected ChatGPT/Codex usage meter."],
];

let cached: { root: string; definitions: SystemPromptDefinition[] } | undefined;

export function systemPromptDefinitions(): SystemPromptDefinition[] {
  const root = repositoryRoot();
  if (cached?.root === root) return cached.definitions;
  const definitions: SystemPromptDefinition[] = files.map(([id, title, group, description]) => ({
    id, title, group, description, source: `hermes-config/system/${id}.md`,
    defaultContent: fs.readFileSync(path.join(root, "hermes-config", "system", `${id}.md`), "utf8").trim(),
  }));
  const add = (id: string, title: string, group: string, description: string, source: string, defaultContent: string) =>
    definitions.push({ id, title, group, description, source, defaultContent });
  add("runtime-base", "Agent runtime", "Chat", "The base instructions sent to the agent on every turn.", "dashboard/src/lib/system-prompts/defaults.ts", RUNTIME_SYSTEM_PROMPT);
  add("direct-provider", "Agent mode off", "Chat", "Instructions for messages sent directly to a model with Agent mode switched off.", "dashboard/src/lib/system-prompts/defaults.ts", DIRECT_PROVIDER_PROMPT);
  add("conversation-references", "Conversation references", "Chat", "How to resolve references to earlier messages and selected answers.", "dashboard/src/lib/conversations/message-context.ts", CONVERSATION_REFERENCE_POLICY);
  add("concise-mode", "Concise mode", "Chat", "The style instructions applied while Concise is switched on.", "hermes-skills/prebuilt/i-have-adhd/SKILL.md", directModeSection());
  add("chat-surface", "Chat context", "Chat", "Instructions for signed-in Terminal and Garden chats.", "dashboard/src/lib/system-prompts/catalog.ts",
    "You are in the user's signed-in Breadboard chat. Garden readers, source tools and authorized host actions are available through the supplied tools. Use them to finish requested work; let the native tool controls handle permissions.");
  add("quartz-surface", "Garden reader", "Chat", "Instructions for the assistant beside a Garden page.", "dashboard/src/lib/system-prompts/catalog.ts",
    "You are answering on a Garden reader surface. Use its current page and highlighted passage as context. Private tools and host commands require explicit server authorization.");
  add("voice-conversation", "Spoken conversation", "Voice", "The conversational style used during voice chats.", "dashboard/src/lib/speech/voice-prompt.ts", VOICE_CONVERSATION_PROMPT);
  add("voice-artifacts", "Spoken file delivery", "Voice", "How voice chats create, revise and describe files.", "dashboard/src/lib/speech/voice-prompt.ts", VOICE_ARTIFACT_PROMPT);
  add("goal-continuation", "Goal continuation", "Goals", "Instructions for continuing an active goal. Placeholders such as {{ objective }} and {{ tokens_used }} are filled in each turn.", "dashboard/src/lib/goal-prompts.ts", GOAL_CONTINUATION_PROMPT);
  add("goal-budget", "Goal budget reached", "Goals", "Instructions when a goal reaches its budget. Keep the {{ objective }} placeholder to include the goal’s text.", "dashboard/src/lib/goal-prompts.ts", GOAL_BUDGET_PROMPT);
  for (const [id, title] of files) {
    const text = voiceToolContract(id);
    if (text !== undefined) add(`voice-${id}`, `${title} in voice`, "Voice", "The shorter tool instructions used during spoken conversations.", "dashboard/src/lib/speech/voice-prompt.ts", text);
  }
  add("council-identity", "Shared Council identity", "Chat", "The shared identity added to Council-routed chat, document and learning requests. An empty value removes this prefix. Other prompts may contain their own identity instructions.", "dashboard/src/lib/assistant-identity.ts", BREAD_ASSISTANT_IDENTITY);
  definitions.push(...FEATURE_SYSTEM_PROMPTS, ...COORDINATION_SYSTEM_PROMPTS);
  for (const [id, title, file] of MAINTENANCE_PROMPT_FILES) {
    definitions.push({ id, title, group: "Maintenance", scope: "installation",
      description: "Installation-wide baseline instructions for the background maintenance evaluator. Changes apply on its next run.",
      source: `hermes-config/system/${file}`,
      defaultContent: fs.readFileSync(path.join(root, "hermes-config", "system", file), "utf8").trim() });
  }
  definitions.push({ id: "maintenance-repair", title: "Maintenance repair", group: "Maintenance", scope: "installation",
    description: "Installation-wide instructions for proposing behavioral corrections. Proposals remain subject to the evaluator’s existing checks.",
    source: "dashboard/src/lib/ifixai-maintenance/repair.ts", defaultContent: MAINTENANCE_REPAIR_PROMPT });
  const agents = [...loadAgencyAgentsCatalog().agents, loadArisAgentDefinition(), loadSpotifyAgentDefinition()];
  const seen = new Set<string>();
  for (const agent of agents) {
    if (!agent || seen.has(agent.slug)) continue;
    seen.add(agent.slug);
    add("agency-" + agent.slug, agent.name, "Agents", agent.description,
      agent.sourceRelativePath, agent.instructions);
  }
  cached = { root, definitions };
  return definitions;
}
