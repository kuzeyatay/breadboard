import type { AgentPreferenceTask } from "./preferences.ts";

// Job-shaped sections from Breadboard's runtime briefs. Candidate IDs document
// coverage; shipped selections are empty so enabling does not opt into a bias.
const presets: [string, string, string, string[]][] = [
  ["video", "Producing video", "Create a video from a brief, including a directed production, cinematic story, narrated explainer, stock-footage video, or motion graphics. Choose an agent that fits the requested format.", ["openmontage", "vimax", "vox-director", "money-printer", "hyperframes"]],
  ["motion", "Animation and motion graphics", "Create precise animated charts, diagrams, text, or code-authored motion graphics.", ["hyperframes"]],
  ["video-editing", "Editing video and making shorts", "Edit an existing video or cut a long recording into vertical clips. Use the required video picker or attachment.", ["video-use", "shorts"]],
  ["music", "Creating music", "Generate playable music, an instrumental, or a vocal song, or revise a track into new versions.", ["music-producer"]],
  ["music-playback", "Finding and playing music", "Find music and control playback in the connected Spotify account.", ["/agent:agent-spotify"]],
  ["coding", "Building and fixing software", "Implement, debug, refactor, or test code in a connected repository. Use a swarm only when the scope benefits from coordinated work.", ["codex", "opencode", "ruflo"]],
  ["research", "Web research and reports", "Investigate a question across sources and return a cited answer or report. Reserve exhaustive research for requests that need it.", ["deep-research", "deer-flow", "max-research"]],
  ["retrieval", "Reading websites and listings", "Retrieve structured information from specific public websites, directories, or listings whose location is already known.", ["agent-reach"]],
  ["papers", "Finding papers and publications", "Find scholarly papers or reports and retrieve available full-text PDFs.", ["get-doc"]],
  ["science", "Scientific research and experiments", "Conduct a literature-grounded scientific study or research workflow. Praxist requires an existing configured task project; ARIS is for its research harness workflows.", ["openscience", "/agent:aris", "praxist"]],
  ["learning", "Learning and interactive lessons", "Teach or quiz me on workspace material, or build a full interactive lesson with slides, checks, and simulations.", ["deep-tutor", "classroom"]],
  ["stocks", "Analyzing stocks", "Analyze named tickers or sectors with current equity data. Use Trading Agent when a full bull/bear and risk debate is requested. Research only; no trade execution.", ["stock-analyst", "trading-agent"]],
  ["markets", "Market conditions and strategies", "Analyze broader market conditions, market reasoning, or strategy questions without placing trades.", ["vibe-trading"]],
  ["files", "Documents, spreadsheets, and creative files", "Produce editable deliverables such as a PowerPoint, spreadsheet, web page, Blender scene, or REAPER audio project.", ["resource2skill", "openwork"]],
  ["slides", "Interactive presentations", "Build a slide deck to present or share as an interactive web link, with presenter tools.", ["bolt-slides"]],
  ["work", "Multi-step knowledge work", "Carry out a deliverable-oriented task that needs its own workspace, files, and several steps.", ["openwork"]],
  ["careers", "Job searches and applications", "Find roles, tailor an application to a real posting, or track a job search across runs.", ["career-ops"]],
  ["business", "Company decisions and operations", "Work through a consequential company decision spanning strategy, finance, people, product, or operations.", ["openexecutive"]],
  ["meetings", "Meeting notes", "Turn an attached or existing meeting recording into a summary, decisions, and action items.", ["meeting-notes"]],
  ["legal", "Legal document work", "Review, compare, or draft against legal documents supplied through the agent's attachment flow.", ["legal"]],
  ["mail", "Managing email", "Read, search, organize, or draft messages in my connected mailbox, within the request's authorization.", ["inbox-zero"]],
  ["social", "Social posts and scheduling", "Compose, schedule, or publish posts through connected social accounts, within the request's authorization.", ["socials-manager"]],
  ["investigations", "Public records and relationships", "Investigate ownership or relationships across corporate registries, public filings, contracts, or sanctions records.", ["openplanter"]],
  ["cad", "CAD and printable parts", "Design manufacturable physical parts and return real CAD geometry that fits the requested process or printer.", ["parametric-cad"]],
  ["electronics", "Electronics and circuit wiring", "Build a validated wiring blueprint with components, pins, and nets.", ["hardware-blueprint"]],
  ["image-to-3d", "3D models from photographs", "Turn a photograph into a 3D mesh using the agent's image picker.", ["formsmith"]],
  ["outfits", "Outfit visualization", "Generate outfit images from photographs of real clothes and my provided identity photo.", ["wardrobe"]],
  ["audiences", "Simulating audience opinions", "Simulate how a specified population might answer a questionnaire, with segment breakdowns. This is simulated opinion, not measured survey evidence.", ["matraix"]],
  ["world", "Live globe and world activity", "Show a place or live aircraft, ships, satellites, and other activity on a globe.", ["gods-eye"]],
  ["computer", "Browser and desktop tasks", "Interact with a browser or desktop when the task needs actual interface actions. Prefer ordinary retrieval for information that can be read directly.", ["agent-browser", "agent-tars"]],
];

export function agentPreferenceTaskPresets(): AgentPreferenceTask[] {
  return presets.map(([id, name, when]) => ({
    id, name, when, agents: [],
  }));
}

export function taskPresetCandidates(id: string): string[] {
  return (presets.find((preset) => preset[0] === id)?.[3] ?? [])
    .map((agent) => agent.startsWith("/") ? agent : `/agents:${agent}`);
}
