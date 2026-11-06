// Workflow entry points group the existing specialists. They do not create new
// runtimes, replace run kinds, or hide the individual /agents:* commands.
import {
  runtimeAgentById,
  type CapabilitySurface,
  type RuntimeAgentProfile,
} from "../hermes/capability-combinations.ts";

export const UNIFIED_WORKFLOW_IDS = [
  "code", "research", "browse", "work", "markets", "learn", "create", "design",
] as const;
export type UnifiedWorkflowId = (typeof UNIFIED_WORKFLOW_IDS)[number];

export interface UnifiedWorkflowMode {
  id: string;
  name: string;
  description: string;
  agentIds: readonly string[];
}

export interface UnifiedWorkflow {
  id: UnifiedWorkflowId;
  name: string;
  command: string;
  description: string;
  modes: readonly UnifiedWorkflowMode[];
  agentIds: readonly string[];
}

function mode(id: string, name: string, description: string, agentIds: string[]): UnifiedWorkflowMode {
  return { id, name, description, agentIds };
}

function workflow(
  id: UnifiedWorkflowId,
  name: string,
  description: string,
  modes: UnifiedWorkflowMode[],
): UnifiedWorkflow {
  return { id, name, command: `/workflows:${id}`, description, modes,
    agentIds: [...new Set(modes.flatMap((item) => item.agentIds))] };
}

export const UNIFIED_WORKFLOWS: readonly UnifiedWorkflow[] = [
  workflow("code", "Code", "Build, fix and test software in a connected repository.", [
    mode("build", "Build and fix", "Build or fix something in your connected project.", ["codex", "opencode"]),
    mode("team", "Coordinated coding", "Use a team of coding agents for larger changes.", ["ruflo"]),
    mode("skills", "Create a skill", "Turn source resources into a reusable skill.", ["resource2skill"]),
  ]),
  workflow("research", "Research", "Find evidence, investigate a question or run a scientific project.", [
    mode("web", "Web research", "Gather and compare public sources for a cited answer.", ["deep-research", "agent-reach"]),
    mode("papers", "Find papers", "Find academic papers and available full texts.", ["get-doc"]),
    mode("investigate", "Investigate", "Investigate public records and map relationships with sources.", ["openplanter"]),
    mode("science", "Scientific project", "Work across literature, code, experiments and writing.", ["openscience"]),
    mode("project", "Prepared research project", "Run a research project you have already set up.", ["praxist"]),
    mode("thorough", "Thorough research", "Coordinate several research specialists when the question needs broad coverage.", ["max-research"]),
    mode("audience", "Simulated audience", "Compare simulated opinions. Results are not responses from real people.", ["matraix"]),
    mode("map", "Map and world activity", "Open the globe and inspect a place or available live feeds.", ["gods-eye"]),
  ]),
  workflow("browse", "Browse", "Work with browser pages or visual interfaces.", [
    mode("browser", "Browser task", "Visit websites, fill forms, and gather information.", ["agent-browser"]),
    mode("visual", "Visual interaction", "Work with apps and websites by reading the screen and clicking.", ["agent-tars"]),
  ]),
  workflow("work", "Work", "Complete workspace tasks, documents, meetings and connected-account work.", [
    mode("workspace", "Workspace task", "Complete tasks using your workspace’s files, skills, and connected apps.", ["openwork", "deer-flow"]),
    mode("advisory", "Business advisory", "Get advice on business decisions, with optional review by other specialists.", ["openexecutive"]),
    mode("career", "Career", "Score roles, tailor applications and track a job search.", ["career-ops"]),
    mode("meeting", "Meeting notes", "Transcribe a recording and summarize decisions and actions.", ["meeting-notes"]),
    mode("mail", "Mail", "Read, organize or draft in the authorized connected mailbox.", ["inbox-zero"]),
    mode("publish", "Social publishing", "Draft or publish social content within the requested account permissions.", ["socials-manager"]),
    mode("legal", "Document review", "Review or draft against supplied legal documents.", ["legal"]),
  ]),
  workflow("markets", "Markets", "Research investments, stocks, and market trends.", [
    mode("instrument", "Instrument review", "Compare investment arguments and risks for a symbol and date.", ["trading-agent"]),
    mode("equities", "Stock analysis", "Analyze stocks using prices, charts, and news.", ["stock-analyst"]),
    mode("strategy", "Markets and strategies", "Research markets and test strategies on historical data. Does not place trades.", ["vibe-trading"]),
  ]),
  workflow("learn", "Learn", "Understand your material, practice and build interactive lessons.", [
    mode("tutor", "Ask and practice", "Get explanations, solve problems, or practice with quizzes.", ["deep-tutor"]),
    mode("classroom", "Interactive classroom", "Teach through lessons, slides, quizzes and simulations.", ["classroom"]),
  ]),
  workflow("create", "Create", "Make videos, music, presentations and images, or edit existing media.", [
    mode("video", "Produce a video", "Create a film from your brief.", ["openmontage", "vimax"]),
    mode("motion", "Motion graphics", "Create motion graphics and animated scenes.", ["hyperframes"]),
    mode("collage", "Paper-collage explainer", "Render a narrated paper-collage explainer.", ["vox-director"]),
    mode("stock-video", "Stock-footage video", "Combine script, stock footage, narration and subtitles.", ["money-printer"]),
    mode("edit", "Edit a video", "Edit the supplied video's cuts, framing, pacing and captions.", ["video-use"]),
    mode("highlights", "Make shorts", "Choose a video and extract vertical highlights.", ["shorts"]),
    mode("music", "Music", "Generate a musical draft or revise a track into playable versions.", ["music-producer"]),
    mode("slides", "Slides", "Build an interactive presentation with slide and presenter controls.", ["bolt-slides"]),
    mode("wardrobe", "Wardrobe", "Organize your clothes and create images of you wearing them.", ["wardrobe"]),
  ]),
  workflow("design", "Design", "Design circuits, dimensioned parts, or 3D models from images.", [
    mode("electronics", "Electronics", "Produce a checked circuit, component list and wiring blueprint.", ["hardware-blueprint"]),
    mode("cad", "Parametric CAD", "Design dimensioned 3D parts you can revise and download.", ["parametric-cad"]),
    mode("image-to-3d", "Image to 3D", "Turn an image into a 3D model.", ["formsmith"]),
  ]),
];

export function unifiedWorkflowById(id: string): UnifiedWorkflow | null {
  return UNIFIED_WORKFLOWS.find((item) => item.id === id.toLowerCase()) ?? null;
}

export function unifiedWorkflowForAgent(agentId: string): UnifiedWorkflow | null {
  return UNIFIED_WORKFLOWS.find((item) => item.agentIds.includes(agentId)) ?? null;
}

export function unifiedWorkflowAgents(
  workflowId: string,
  options: { modeId?: string | null; surface?: CapabilitySurface; modelLaunchableOnly?: boolean } = {},
): RuntimeAgentProfile[] {
  const item = unifiedWorkflowById(workflowId);
  if (!item) return [];
  const ids = options.modeId
    ? item.modes.find((entry) => entry.id === options.modeId)?.agentIds ?? []
    : item.agentIds;
  return ids.flatMap((id) => {
    const agent = runtimeAgentById(id);
    return agent && (!options.surface || agent.surfaces.includes(options.surface)) &&
      (!options.modelLaunchableOnly || agent.launchableByModel) ? [agent] : [];
  });
}

/** Requirements are separate from ordinary chat attachments. A workflow must
 * never describe a populated composer tray as a populated native file picker. */
export const UNIFIED_AGENT_INPUT_REQUIREMENTS: Readonly<Record<string, string>> = {
  codex: "A repository connected to this Garden.",
  opencode: "A repository connected to this Garden.",
  ruflo: "A connected repository and the configured coding executor.",
  praxist: "An existing configured task-project directory, supplied as the task path.",
  "trading-agent": "Choose a symbol and optional date in the form.",
  "meeting-notes": "An attached recording or the newest recording already on this conversation.",
  shorts: "Choose a video in the Shorts picker. Chat attachments are not used.",
  formsmith: "Choose an image in the Formsmith picker. Chat attachments are not used.",
  "video-use": "Attach a video or open one in the video editor. Available in the Terminal.",
  legal: "The documents attached to this request.",
  wardrobe: "Clothing photos attached to this request and a configured identity photo.",
  "inbox-zero": "A configured mailbox connection; permission for each requested account action.",
  "socials-manager": "Configured social accounts; permission for each requested publishing action.",
};
