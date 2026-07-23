import type { OpenHarnessSurface } from "./config.ts";
import { availableArtifactRenderers } from "./artifact-renderers.ts";
import { allowedToolsForSurface } from "./tool-scopes.ts";
import type { SkillEligibility } from "./skills.ts";

export type SkillAvailability =
  | "ready"
  | "unavailable"
  | "incompatible"
  | "needs_review";

export interface SkillCapabilityContract {
  category?: string;
  surfaces: OpenHarnessSurface[];
  requiredTools: string[];
  requiredArtifactKinds: string[];
  requiredRuntimes: string[];
  requiredMcpServers: string[];
  optionalMcpServers: string[];
}

export interface SkillCompatibility {
  availability: SkillAvailability;
  reasons: string[];
  contract: SkillCapabilityContract | null;
}

const SURFACE_ALIASES: Record<string, OpenHarnessSurface> = {
  assistant: "dashboard_terminal",
  dashboard_terminal: "dashboard_terminal",
  interactive_terminal: "dashboard_terminal",
  terminal: "dashboard_terminal",
  garden: "garden_chat",
  garden_chat: "garden_chat",
  quartz: "quartz_ai",
  quartz_ai: "quartz_ai",
};

const RUNTIME_ALIASES: Record<string, string> = {
  "text-renderer": "text",
  "markdown-renderer": "markdown",
  "docx-renderer": "docx",
  "pdf-renderer": "pdf",
  "html-renderer": "html",
};

function normalizeList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const source = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  return source
    .split(",")
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

/**
 * Read the deliberately small, data-only `breadboard:` capability contract.
 * This is not a general YAML parser: executable YAML tags and aliases are
 * intentionally unsupported, while both inline and indented string arrays are.
 */
export function parseSkillCapabilityContract(markdown: string): SkillCapabilityContract | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*breadboard\s*:\s*$/i.test(line));
  if (start < 0) return null;
  const baseIndent = lines[start].match(/^\s*/)?.[0].length ?? 0;
  const values = new Map<string, string[]>();
  let activeKey: string | null = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= baseIndent) break;
    const keyValue = raw.trim().match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/);
    if (keyValue) {
      activeKey = keyValue[1].toLowerCase();
      values.set(activeKey, normalizeList(keyValue[2]));
      continue;
    }
    const item = raw.trim().match(/^[-*]\s+(.+)$/)?.[1];
    if (item && activeKey) {
      values.set(activeKey, [
        ...(values.get(activeKey) ?? []),
        item.trim().replace(/^['"]|['"]$/g, ""),
      ]);
    }
  }
  const surfaces = (values.get("surfaces") ?? [])
    .map((surface) => SURFACE_ALIASES[surface.toLowerCase()])
    .filter((surface): surface is OpenHarnessSurface => Boolean(surface));
  return {
    category: values.get("category")?.[0],
    surfaces,
    requiredTools: values.get("requiredtools") ?? [],
    requiredArtifactKinds: values.get("requiredartifactkinds") ?? [],
    requiredRuntimes: values.get("requiredruntimes") ?? [],
    requiredMcpServers: values.get("requiredmcpservers") ?? [],
    optionalMcpServers: values.get("optionalmcpservers") ?? [],
  };
}

export function normalizeSkillCapabilityContract(input: {
  name?: string;
  description?: string;
  manifest: string;
}): SkillCapabilityContract | null {
  const declared = parseSkillCapabilityContract(input.manifest);
  if (declared) return declared;
  const text = [input.name, input.description, input.manifest].filter(Boolean).join("\n").toLowerCase();
  const artifactTools = ["artifact_create", "artifact_read", "artifact_update", "artifact_render"];
  const surfaces: OpenHarnessSurface[] = ["garden_chat", "dashboard_terminal"];
  if (/\b(video|audio|presentation|slides?|spreadsheet|xlsx|image generation|diagram)\b/.test(text)) {
    const kind = /\bvideo\b/.test(text) ? "video"
      : /\baudio\b/.test(text) ? "audio"
      : /\b(presentation|slides?)\b/.test(text) ? "presentation"
      : /\b(spreadsheet|xlsx)\b/.test(text) ? "spreadsheet"
      : /\bdiagram\b/.test(text) ? "diagram"
      : "image";
    return { surfaces, requiredTools: artifactTools, requiredArtifactKinds: [kind], requiredRuntimes: [`${kind}-renderer`], requiredMcpServers: [], optionalMcpServers: [] };
  }
  if (/\b(html|web prototype|interactive prototype)\b/.test(text)) {
    return { surfaces, requiredTools: artifactTools, requiredArtifactKinds: ["html"], requiredRuntimes: ["html-renderer"], requiredMcpServers: [], optionalMcpServers: [] };
  }
  if (/\b(pdf)\b/.test(text)) {
    return { surfaces, requiredTools: artifactTools, requiredArtifactKinds: ["pdf"], requiredRuntimes: ["pdf-renderer"], requiredMcpServers: [], optionalMcpServers: [] };
  }
  if (/\b(docx|word document|document artifact)\b/.test(text)) {
    return { surfaces, requiredTools: artifactTools, requiredArtifactKinds: ["document"], requiredRuntimes: ["docx-renderer"], requiredMcpServers: [], optionalMcpServers: [] };
  }
  if (/\b(report|essay|structured plan|reusable written|writing|markdown|summari[sz]|translation|flashcards?|quiz|study guide)\b/.test(text)) {
    return { surfaces, requiredTools: artifactTools, requiredArtifactKinds: ["markdown"], requiredRuntimes: ["markdown-renderer"], requiredMcpServers: [], optionalMcpServers: [] };
  }
  return null;
}

export function resolveSkillCompatibility(input: {
  classification: SkillEligibility;
  manifest: string;
  name?: string;
  description?: string;
  surface: OpenHarnessSurface;
  connectedMcpServers?: Iterable<string>;
}): SkillCompatibility {
  if (input.classification === "eligible_coding_conditional") {
    return {
      availability: "incompatible",
      reasons: ["Coding and repository-engineering skills are not part of Breadboard's user-facing skills product."],
      contract: normalizeSkillCapabilityContract(input),
    };
  }
  if (input.classification !== "eligible_general") {
    return {
      availability: input.classification.startsWith("blocked_") ? "incompatible" : "needs_review",
      reasons: ["The skill has not passed Breadboard's non-coding eligibility review."],
      contract: normalizeSkillCapabilityContract(input),
    };
  }
  const contract = normalizeSkillCapabilityContract(input);
  if (!contract) {
    return {
      availability: "needs_review",
      reasons: ["No Breadboard capability contract declares an executable tool or renderer path."],
      contract: null,
    };
  }
  const reasons: string[] = [];
  if (!contract.surfaces.length) reasons.push("The contract declares no recognized Breadboard surface.");
  else if (!contract.surfaces.includes(input.surface)) reasons.push(`The skill is not permitted on ${input.surface}.`);

  const surfaceTools = new Set(allowedToolsForSurface(input.surface));
  for (const tool of contract.requiredTools) {
    if (!surfaceTools.has(tool)) reasons.push(`Required tool ${tool} is unavailable on ${input.surface}.`);
  }

  const renderers = availableArtifactRenderers();
  const rendererIds = new Set(renderers.map((renderer) => renderer.id));
  const rendererKinds = new Set(renderers.map((renderer) => renderer.kind));
  for (const kind of contract.requiredArtifactKinds) {
    if (!rendererKinds.has(kind as never)) reasons.push(`Artifact kind ${kind} has no production renderer.`);
  }
  for (const runtime of contract.requiredRuntimes) {
    const renderer = RUNTIME_ALIASES[runtime.toLowerCase()];
    if (!renderer || !rendererIds.has(renderer as never)) reasons.push(`Required runtime ${runtime} is unavailable.`);
  }

  const connected = new Set(
    [...(input.connectedMcpServers ?? [])].map((server) => server.toLowerCase()),
  );
  for (const server of contract.requiredMcpServers) {
    if (!connected.has(server.toLowerCase())) reasons.push(`Required MCP server ${server} is not connected and authorized.`);
  }

  const hasExecutionPath =
    contract.requiredTools.length > 0 ||
    contract.requiredRuntimes.length > 0 ||
    contract.requiredMcpServers.length > 0;
  if (!hasExecutionPath) reasons.push("The capability contract does not declare an executable path.");
  if (contract.requiredArtifactKinds.length > 0) {
    for (const tool of ["artifact_create", "artifact_render"]) {
      if (!contract.requiredTools.includes(tool)) reasons.push(`Artifact-producing skills must require ${tool}.`);
    }
  }
  return {
    availability: reasons.length ? "unavailable" : "ready",
    reasons,
    contract,
  };
}
