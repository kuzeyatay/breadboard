import {
  externalRuntimeLstat,
  externalRuntimePathExists,
  externalRuntimePortableRealpath,
  externalRuntimeReadDirectoryEntries,
  externalRuntimeReadUtf8,
  externalRuntimeStat,
} from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import {
  ARIS_AGENT_ID,
  ARIS_AGENT_NAME,
  ARIS_AGENT_SLUG,
} from "./identity.ts";

const CLONE_DIRECTORY = "auto-claude-code-research-in-sleep";
const MAX_GUIDE_BYTES = 96 * 1024;
const MAX_SKILL_BYTES = 96 * 1024;

export interface ArisAvailability {
  available: boolean;
  installed: boolean;
  root: string | null;
  skillCount: number;
  reason: string | null;
}

export interface ArisAgentDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  division: string;
  divisionLabel: string;
  divisionIcon: string;
  divisionColor: string;
  emoji: string;
  color: string;
  vibe: string;
  services: Array<{ name: string; tier?: string }>;
  instructions: string;
  sourceRelativePath: string;
}

interface ResolvedRoot {
  root: string;
  installed: boolean;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function rootCandidates(env: NodeJS.ProcessEnv): string[] {
  const configured = env.ARIS_ROOT?.trim();
  const breadboardRoot = env.BREADBOARD_REPO_ROOT?.trim();
  return [
    configured ? path.resolve(configured) : "",
    breadboardRoot ? path.resolve(breadboardRoot, CLONE_DIRECTORY) : "",
    path.resolve(process.cwd(), CLONE_DIRECTORY),
    path.resolve(process.cwd(), "..", CLONE_DIRECTORY),
  ].filter(Boolean);
}

function resolveRoot(env: NodeJS.ProcessEnv = process.env): ResolvedRoot | null {
  for (const candidate of rootCandidates(env)) {
    if (!externalRuntimePathExists(candidate)) continue;
    try {
      const info = externalRuntimeLstat(candidate);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      return { root: externalRuntimePortableRealpath(candidate), installed: true };
    } catch {
      // Try the next trusted local candidate.
    }
  }
  return null;
}

function regularFilePath(root: string, relativePath: string, maxBytes: number): string | null {
  const candidate = path.resolve(root, relativePath);
  if (!isInside(root, candidate) || !externalRuntimePathExists(candidate)) return null;
  try {
    const info = externalRuntimeLstat(candidate);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maxBytes) {
      return null;
    }
    const resolved = externalRuntimePortableRealpath(candidate);
    if (!isInside(root, resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
}

function regularFile(root: string, relativePath: string, maxBytes: number): string | null {
  const resolved = regularFilePath(root, relativePath, maxBytes);
  if (!resolved) return null;
  try {
    return externalRuntimeReadUtf8(resolved).replace(/^\uFEFF/, "").trim();
  } catch {
    return null;
  }
}

function mainSkillSlugs(root: string): string[] {
  const skillsRoot = path.join(root, "skills");
  try {
    return externalRuntimeReadDirectoryEntries(skillsRoot)
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("skills-") && name !== "shared-references")
      .filter((name) => Boolean(regularFilePath(root, path.join("skills", name, "SKILL.md"), MAX_SKILL_BYTES)))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

export function arisAvailability(env: NodeJS.ProcessEnv = process.env): ArisAvailability {
  const resolved = resolveRoot(env);
  if (!resolved) {
    return {
      available: false,
      installed: false,
      root: null,
      skillCount: 0,
      reason: `The ARIS clone was not found. Clone it as ${CLONE_DIRECTORY} or set ARIS_ROOT.`,
    };
  }
  const guide = regularFile(resolved.root, "AGENT_GUIDE.md", MAX_GUIDE_BYTES);
  const skillSlugs = mainSkillSlugs(resolved.root);
  const hasPipeline = skillSlugs.includes("research-pipeline");
  if (!guide || !hasPipeline) {
    return {
      available: false,
      installed: true,
      root: resolved.root,
      skillCount: skillSlugs.length,
      reason: "The ARIS clone is incomplete: AGENT_GUIDE.md or the research-pipeline skill is missing.",
    };
  }
  return {
    available: true,
    installed: true,
    root: resolved.root,
    skillCount: skillSlugs.length,
    reason: null,
  };
}

function escapeBoundary(value: string): string {
  return value.replace(/<\s*\/?\s*aris_(?:source|turn_guidance|skill)\b[^>]*>/gi, "[ARIS boundary removed]");
}

export function loadArisAgentDefinition(
  env: NodeJS.ProcessEnv = process.env,
): ArisAgentDefinition | null {
  const availability = arisAvailability(env);
  if (!availability.available || !availability.root) return null;
  const guide = regularFile(availability.root, "AGENT_GUIDE.md", MAX_GUIDE_BYTES);
  if (!guide) return null;
  return {
    id: ARIS_AGENT_ID,
    slug: ARIS_AGENT_SLUG,
    name: ARIS_AGENT_NAME,
    description:
      "Takes a research project from idea to report by finding papers, planning experiments, checking conclusions, and producing work you can review.",
    division: "autonomous-research",
    divisionLabel: "Autonomous Research",
    divisionIcon: "MoonStar",
    divisionColor: "#d6bd74",
    emoji: "",
    color: "#d6bd74",
    vibe: "Methodical overnight research with independent checks and a durable evidence trail.",
    services: [
      { name: "Breadboard tools", tier: "Current permissions" },
      { name: "Fresh reviewer agents", tier: "When available" },
      { name: `${availability.skillCount} cloned ARIS skills`, tier: "Local" },
    ],
    instructions: [
      "You are ARIS (Autonomous Research via Adversarial Multi-Agent Collaboration), running as Bread's dedicated research agent.",
      "Treat the cloned guide below as research methodology. Breadboard's system policy, the user's authorization, current tool set, workspace boundaries, and artifact contracts always take precedence.",
      "Use the active Breadboard model as executor. Use fresh delegated workers for independent criticism when available. Never claim cross-model independence unless the reviewer model family is actually known to differ; otherwise label acceptance provisional, exactly as ARIS requires.",
      "Prefer durable, inspectable research outputs. When the current Breadboard surface offers artifact tools, attach completed reports, plans, tables, figures, or papers as artifacts instead of only claiming they were created.",
      `The cloned ARIS support files are rooted at ${availability.root}. Resolve any skills/, tools/, templates/, or mcp-servers/ paths mentioned by the guide against that root; do not copy or modify the clone itself.`,
      "Do not start an overnight loop, schedule recurring work, spend money, use credentials, or widen filesystem/network access unless the user has authorized that action through Breadboard.",
      "",
      "<aris_source>",
      `Source: ${CLONE_DIRECTORY}/AGENT_GUIDE.md`,
      escapeBoundary(guide),
      "</aris_source>",
    ].join("\n"),
    sourceRelativePath: `${CLONE_DIRECTORY}/AGENT_GUIDE.md`,
  };
}

function requestedSkill(request: string, available: readonly string[]): string | null {
  const normalized = request.toLowerCase();
  const explicit = available.find((slug) =>
    new RegExp(`(?:^|[\\s/:])${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s,.:])`, "i")
      .test(request),
  );
  if (explicit) return explicit;
  const routes: Array<[RegExp, string]> = [
    [/\b(resubmit|new venue|venue transfer)\b/, "resubmit-pipeline"],
    [/\b(rebuttal|reviewer response|author response)\b/, "rebuttal"],
    [/\b(citation|bibliograph|bibtex|reference audit)\b/, "citation-audit"],
    [/\b(talk|conference slides|speaker notes|presentation)\b/, "paper-talk"],
    [/\b(proof|theorem|lemma|formal derivation)\b/, "proof-checker"],
    [/\b(paper writing|write (?:the |a )?paper|manuscript|latex)\b/, "paper-writing"],
    [/\b(review loop|improve (?:the |my )?paper|critique (?:the |my )?paper|auto review)\b/, "auto-review-loop"],
    [/\b(experiment|ablation|benchmark|training run|evaluate results)\b/, "experiment-bridge"],
    [/\b(literature|related work|paper search|survey|prior work)\b/, "research-lit"],
    [/\b(idea|novelty|hypothesis|brainstorm|research direction)\b/, "idea-discovery"],
    [/\b(full pipeline|end-to-end|from idea to paper|autonomous research|research pipeline)\b/, "research-pipeline"],
  ];
  for (const [pattern, slug] of routes) {
    if (pattern.test(normalized) && available.includes(slug)) return slug;
  }
  return null;
}

/**
 * Recognize an upstream ARIS slash workflow without registering it as a
 * Breadboard capability. The workflow remains ordinary user text and is
 * interpreted only while ARIS is the selected agent, so it cannot bypass the
 * normal capability broker or permission policy.
 */
export function isArisSkillSlug(
  slug: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const availability = arisAvailability(env);
  return Boolean(
    availability.available &&
      availability.root &&
      mainSkillSlugs(availability.root).includes(slug.toLowerCase()),
  );
}

/**
 * Attach the authoritative cloned skill for this turn. ARIS stays a persistent
 * agent, but its large skill files are loaded lazily so normal questions do not
 * consume an entire research pipeline's context.
 */
export function renderArisTurnGuidance(
  request: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const availability = arisAvailability(env);
  if (!availability.available || !availability.root) return "";
  const available = mainSkillSlugs(availability.root);
  const slug = requestedSkill(request, available);
  if (!slug) {
    return [
      "<aris_turn_guidance>",
      "No single ARIS workflow was forced for this turn. Classify the request using the cloned Agent Guide, explain the proposed workflow, and ask for only genuinely missing research inputs before doing consequential work.",
      "</aris_turn_guidance>",
    ].join("\n");
  }
  const skill = regularFile(
    availability.root,
    path.join("skills", slug, "SKILL.md"),
    MAX_SKILL_BYTES,
  );
  if (!skill) return "";
  return [
    "<aris_turn_guidance>",
    `Breadboard matched this request to the cloned ARIS /${slug} workflow. Follow the source below as subordinate methodology and adapt host-specific tool names to the tools Breadboard actually provides.`,
    "Use delegate_task for fresh parallel/reviewer work when appropriate. If independent model-family review cannot be verified, record the review as same-family/provisional rather than accepted.",
    "Keep every write inside the currently authorized workspace and expose durable deliverables through Breadboard artifacts when available.",
    `<aris_skill name=${JSON.stringify(slug)}>`,
    escapeBoundary(skill),
    "</aris_skill>",
    "</aris_turn_guidance>",
  ].join("\n");
}

export function arisSourceModifiedAt(env: NodeJS.ProcessEnv = process.env): string | null {
  const availability = arisAvailability(env);
  if (!availability.root) return null;
  try {
    return externalRuntimeStat(path.join(availability.root, "AGENT_GUIDE.md")).mtime.toISOString();
  } catch {
    return null;
  }
}
