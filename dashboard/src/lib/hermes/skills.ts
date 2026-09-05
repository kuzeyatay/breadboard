// Real skills.sh discovery with a strict discovery -> quarantine -> review ->
// promotion boundary. Search never installs. Quarantined files are never loaded
// by Hermes, and promotion verifies the exact reviewed hashes.

import crypto from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import type { HermesSurface } from "./config.ts";
import {
  resolveSkillCompatibility,
  type SkillAvailability,
  type SkillCapabilityContract,
  type SkillRequirement,
} from "./skill-compatibility.ts";
import { isReviewedLocalSource } from "./local-skills-sources.ts";
import {
  isTextToCadSkill,
  TEXT_TO_CAD_SKILLS,
  TEXT_TO_CAD_SOURCE,
  TEXT_TO_CAD_VERSION,
} from "./text-to-cad.ts";

const QUARANTINE_MANIFEST = ".breadboard-quarantine.json";
const MAX_SKILL_FILES = 200;
const MAX_SKILL_FILE_BYTES = 2_000_000;
const MAX_SKILL_TOTAL_BYTES = 10_000_000;
const MAX_SKILL_PATH_LENGTH = 240;
const MAX_SKILL_DIRECTORY_DEPTH = 12;
const APPROVABLE_AGENTS = new Set([
  "breadboard-assistant",
  "breadboard-garden",
  "breadboard-quartz",
  "breadboard-document",
]);
const CLASSIFIER_VERSION = "breadboard-skill-policy-v2";
const SCIENTIFIC_SKILLS_REPOSITORY = "k-dense-ai/scientific-agent-skills";
const REVERSE_SKILLS_REPOSITORY = "zhaoxuya520/reverse-skill";
// Checked-in first-party skills are immutable for the lifetime of a server
// process. Some text-to-cad skills include an offline viewer and geometry
// runtime, so re-reading every binary to rediscover the same hash on each
// command would turn intent routing into hundreds of milliseconds of I/O.
// Environment-overridden roots remain uncached for tests and local review.
const FIRST_PARTY_HASH_CACHE = new Map<string, string>();

/**
 * True when a stable upstream id belongs to a reviewed, vendored local clone.
 * Ids are `owner/repo/slug`, so the registry answers for every vendored pack
 * without this file naming them one by one.
 */
function isReviewedLocalUpstreamId(upstreamId: string | undefined): boolean {
  return (
    typeof upstreamId === "string" &&
    isReviewedLocalSource(upstreamId.split("/").slice(0, 2).join("/"))
  );
}
const DEDICATED_RUNTIME_FIRST_PARTY_SKILLS = new Set([
  // earthtojake/text-to-cad is artifact engineering, not repository software
  // engineering. Its manifests necessarily contain Python/XML/CLI examples;
  // classifying those examples as app coding would make the CAD procedures
  // unavailable on the ordinary turns they are vendored to handle.
  ...TEXT_TO_CAD_SKILLS,
  "interactive-visualizer",
  "interactive-visualizer-in-chat",
  "manim",
  "watch",
  "send-to-my-phone",
  "generate-gadget",
  // Office documents are authored through the pinned OfficeCLI binary, not by
  // writing repository code; its guidance is full of command syntax by nature.
  "office",
  // Same shape: the analysis runs inside a pinned Rust binary the product owns.
  // Asking "what key is this in?" is not repository coding, and classifying it
  // as implementation would confine the skill to scoped implementation mode —
  // which is to say, make it unselectable on the turns it exists for.
  "audio-analysis",
  // Like audio analysis, identification is provider-backed knowledge work,
  // not repository implementation, and must remain selectable in normal chat.
  "recognize-music",
  // A diagram is a rendered artifact, not repository code. Its guidance is full
  // of SVG and HTML because that is what a drawing is made of here, and the
  // classifier reads a manifest of markup as implementation work — which would
  // confine "draw me an architecture diagram" to scoped implementation mode.
  "diagram-design",
  // An ASCII diagram is inline knowledge-work output, not repository code.
  // The reviewed pack ships optional Python layout/verifier helpers, and those
  // support scripts must not confine a plain-text drawing request to scoped
  // implementation mode.
  "ascii-art-diagrams",
  // A repository dossier is research, not repository coding. Its guidance is
  // full of api.github.com URL templates because that is where the facts live,
  // and a manifest of API endpoints must not confine "is this repo any good?"
  // to scoped implementation mode.
  "github-explorer",
  // Rewording a paragraph is writing, not repository coding. Its guidance
  // carries `npm run setup:humanizer` because that is what the model has to
  // relay when the local service is not installed, and a manifest of shell
  // commands reads to the classifier as implementation work — which would
  // confine "humanize this" to scoped implementation mode.
  "humanize",
  // A goal is a commitment about when the work may stop, not work of its own.
  // Its guidance is dense with mcp_call syntax because that is how an objective
  // gets recorded, and reading that as implementation would confine "keep going
  // until the tests pass" to scoped implementation mode — leaving the one
  // sentence that most needs a goal unable to start one.
  "goal",
  // Desktop operation runs through Hermes Agent's pinned cua-driver backend;
  // the skill describes how to use that product runtime, not how to write code.
  "computer-use",
]);

export type SkillEligibility =
  | "eligible_general"
  | "eligible_coding_conditional"
  | "blocked_security"
  | "blocked_incompatible"
  | "needs_review"
  | "unknown";

export interface SkillClassification {
  classification: SkillEligibility;
  category: string;
  reasons: string[];
  evidenceFields: string[];
  classifierVersion: string;
  compatibleModes: Array<"knowledge" | "technical_read" | "scoped_implementation">;
  compatibleSurfaces: Array<"assistant" | "garden" | "quartz" | "document">;
  classifiedAt: string;
}

export type SkillPermission =
  | "filesystem-read"
  | "filesystem-write"
  | "garden-read"
  | "garden-propose"
  | "network"
  | "shell"
  | "repository-read"
  | "repository-write"
  | "external-service";

export type CapabilityGap = {
  taskId: string;
  sessionId: string;
  requestedCapability: string;
  reason: string;
  searchQuery: string;
  requiredPermissions: SkillPermission[];
  parentAgent: string;
};

export type SkillAvailableEvent = {
  parentTaskId: string;
  skillId: string;
  capability: string;
  approvedPermissions: SkillPermission[];
};

export interface SkillCandidate {
  id: string;
  upstreamId?: string;
  name: string;
  package: string;
  publisher: string;
  repository: string;
  source: string;
  detailsUrl: string;
  installs?: string;
  description: string;
  version?: string;
  installCommand: string;
  requestedPermissions: SkillPermission[];
  provider?: "api" | "cache" | "local-git";
  slashCommand?: string;
  storageKey?: string;
  classification: SkillClassification;
}

export function classifySkill(input: {
  name: string;
  description?: string;
  repository?: string;
  manifest?: string;
  requestedPermissions?: SkillPermission[];
}): SkillClassification {
  const fields = [
    input.name,
    input.description ?? "",
    input.repository ?? "",
    input.manifest ?? "",
  ];
  const text = fields.join("\n").toLowerCase();
  const primaryText = [input.name, input.description ?? ""].join("\n").toLowerCase();
  const evidenceFields = [
    "name",
    ...(input.description ? ["description"] : []),
    ...(input.repository ? ["repository"] : []),
    ...(input.manifest ? ["SKILL.md"] : []),
    ...(input.requestedPermissions?.length ? ["requested_permissions"] : []),
  ];
  const security =
    /\b(credential theft|exfiltrat|malware|ransomware|privilege escalation|(?:unauthorized|stealth|malicious) persistence|evade authorization|steal (?:password|token|secret)|exploit development|reverse shell|botnet)\b/i;
  const incompatible =
    /\b(force[- ]push automation|production deploy(?:ment)? automation|global package installer|kernel module|firmware flasher)\b/i;
  const coding =
    /\b(android|angular|ansible|api development|astro|backend|bash script(?:ing)?|build config|ci\/cd|code review|code generation|codebase|coding|compiler|containeri[sz]ation|continuous (?:integration|delivery)|database migration|debug(?:ger|ging)?|devops|docker(?:file)?|electron|flutter|frontend|full[- ]stack|git workflow|golang|graphql|ios|java|javascript|kotlin|kubernetes|mobile development|next\.?js|node\.?js|npm|package integration|package manager|php|programming|python|react|refactor|repository|ruby|rust|sdk(?: development)?|shell script(?:ing)?|software architecture|software development|software engineering|software implementation|software maintenance|software test|source code|sql|svelte|swift|terraform|typescript|vue|web development)\b/i;
  const general =
    /\b(analysis|brainstorm|business|communication|decision|document|editing|education|explain|image|knowledge|literature|marketing|meeting|pdf|planning|presentation|productivity|quiz|research|spreadsheet|study|summari[sz]|teaching|translation|travel|visual design|writing)\b/i;
  const now = new Date().toISOString();
  const primaryGeneral = general.test(primaryText);
  const primaryCoding = coding.test(primaryText);
  const manifestLines = (input.manifest ?? "").split(/\r?\n/);
  const unmitigatedSecurityIntent = manifestLines.some((line, index) => {
    if (!security.test(line)) return false;
    const context = manifestLines.slice(Math.max(0, index - 2), index + 1).join(" ");
    return !/\b(do not|don'?t|never|must not|avoid|prevent|prohibit|forbid|refuse|protect|safety|not allowed)\b/i.test(context);
  });
  if (security.test(primaryText) || unmitigatedSecurityIntent) {
    return {
      classification: "blocked_security",
      category: "Prohibited",
      reasons: ["The primary capability matches Breadboard's prohibited security automation policy."],
      evidenceFields,
      classifierVersion: CLASSIFIER_VERSION,
      compatibleModes: [],
      compatibleSurfaces: [],
      classifiedAt: now,
    };
  }
  if (incompatible.test(primaryText)) {
    return {
      classification: "blocked_incompatible",
      category: "Incompatible",
      reasons: ["The primary workflow requires operations Breadboard does not safely support."],
      evidenceFields,
      classifierVersion: CLASSIFIER_VERSION,
      compatibleModes: [],
      compatibleSurfaces: [],
      classifiedAt: now,
    };
  }
  // Classify the advertised primary purpose before scanning incidental words
  // in a long manifest. Scientific writing skills commonly discuss code/data
  // availability or repository constraints without being coding skills.
  if (primaryGeneral && !primaryCoding) {
    return {
      classification: "eligible_general",
      category: "Knowledge work",
      reasons: ["The primary purpose is compatible with research, learning, writing, analysis, or productivity."],
      evidenceFields,
      classifierVersion: CLASSIFIER_VERSION,
      compatibleModes: ["knowledge", "technical_read", "scoped_implementation"],
      compatibleSurfaces: ["assistant", "garden", "quartz", "document"],
      classifiedAt: now,
    };
  }
  if (primaryCoding || coding.test(text)) {
    return {
      classification: "eligible_coding_conditional",
      category: "Implementation",
      reasons: ["The primary purpose is software implementation or repository engineering and must run through OpenCode."],
      evidenceFields,
      classifierVersion: CLASSIFIER_VERSION,
      compatibleModes: ["scoped_implementation"],
      compatibleSurfaces: ["assistant", "garden"],
      classifiedAt: now,
    };
  }
  if (primaryGeneral || general.test(text)) {
    return {
      classification: "eligible_general",
      category: "Knowledge work",
      reasons: ["The primary purpose is compatible with research, learning, writing, analysis, or productivity."],
      evidenceFields,
      classifierVersion: CLASSIFIER_VERSION,
      compatibleModes: ["knowledge", "technical_read", "scoped_implementation"],
      compatibleSurfaces: ["assistant", "garden", "quartz", "document"],
      classifiedAt: now,
    };
  }
  return {
    classification: input.manifest ? "needs_review" : "unknown",
    category: "Unclassified",
    reasons: [
      input.manifest
        ? "The available metadata is mixed or ambiguous and requires human review."
        : "The provider did not supply enough evidence for a safe eligibility decision.",
    ],
    evidenceFields,
    classifierVersion: CLASSIFIER_VERSION,
    compatibleModes: [],
    compatibleSurfaces: [],
    classifiedAt: now,
  };
}

/**
 * Catalog discovery is allowed to show skills that still need classification.
 * They remain non-installable until detail loading, quarantine, and review have
 * produced an eligible classification and compatible execution contract.
 */
export function isCatalogSkillInspectable(classification: SkillEligibility): boolean {
  return classification === "eligible_general" ||
    classification === "eligible_coding_conditional" ||
    classification === "needs_review" ||
    classification === "unknown";
}

export function parseSkillSearchOutput(output: string): SkillCandidate[] {
  const lines = output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  return lines
    .flatMap((line, index) => {
      const match = line.match(
        /^([^\s]+\/[^\s]+@[^\s]+)\s+([\d.]+[KMB]?)\s+installs$/i,
      );
      if (!match) return [];
      const packageId = match[1];
      const at = packageId.lastIndexOf("@");
      const repository = packageId.slice(0, at);
      const name = packageId.slice(at + 1);
      if (!validPackage(repository, name)) return [];
      const publisher = repository.split("/")[0];
      const detailsUrl =
        lines
          .slice(index + 1, index + 3)
          .map((next) => next.replace(/^└\s*/, ""))
          .find((next) => /^https:\/\/skills\.sh\//i.test(next)) ??
        `https://skills.sh/${repository}/${name}`;
      return [
        {
          id: packageId,
          name,
          package: packageId,
          publisher,
          repository,
          source: `https://github.com/${repository}`,
          detailsUrl,
          installs: match[2],
          description: "",
          installCommand: "Catalog snapshot via Breadboard proxy",
          // Search output does not declare permissions. They are derived from the
          // downloaded manifest/files in quarantine, never guessed as approved.
          requestedPermissions: [],
          classification: classifySkill({
            name,
            repository,
          }),
        },
      ];
    })
    .slice(0, 100);
}

function validPackage(repository: string, name: string): boolean {
  return (
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository) &&
    /^[a-z0-9_.-]+$/i.test(name)
  );
}

function repoRoot(): string {
  return repositoryRoot();
}

export function quarantineRoot(): string {
  return (
    process.env.HERMES_SKILLS_QUARANTINE ??
    path.join(repoRoot(), "hermes-skills", "quarantine")
  );
}

export function approvedRoot(): string {
  return (
    process.env.HERMES_SKILLS_APPROVED ??
    path.join(repoRoot(), ".agents", "skills")
  );
}

/** Coding-oriented skills are reviewed and retained outside the general store. */
export function conditionalRoot(): string {
  return (
    process.env.HERMES_SKILLS_CONDITIONAL ??
    path.join(repoRoot(), "hermes-skills", "conditional")
  );
}

export function firstPartySkillsRoot(): string {
  return (
    process.env.HERMES_FIRST_PARTY_SKILLS_ROOT ??
    path.join(repoRoot(), "hermes-skills", "prebuilt")
  );
}

export interface ApprovedSkillSummary {
  id: string;
  slug: string;
  upstreamSlug: string;
  storageKey: string;
  name: string;
  description: string;
  source?: string;
  version?: string;
  contentHash?: string;
  enabled: boolean;
  healthy: boolean;
  classification: SkillEligibility;
  category: string;
  compatibleModes: SkillClassification["compatibleModes"];
  compatibleSurfaces: SkillClassification["compatibleSurfaces"];
  availability: SkillAvailability;
  unavailableReasons: string[];
  capabilityContract: SkillCapabilityContract | null;
  compatibilityRequirements: SkillRequirement[];
  instructions: string;
}

function listApprovedSkillsAtRoot(
  root: string,
  surface: HermesSurface,
  connectedMcpServers: Iterable<string>,
): ApprovedSkillSummary[] {
  if (!fs.existsSync(root)) return [];
  let registry: { skills?: Record<string, Record<string, unknown>> } = {};
  try {
    registry = JSON.parse(
      fs.readFileSync(path.join(root, "registry.json"), "utf8"),
    ) as typeof registry;
  } catch {
    registry = {};
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      if (!entry.isDirectory() || !/^[a-z0-9_.-]+$/i.test(entry.name))
        return [];
      const manifestPath = path.join(root, entry.name, "SKILL.md");
      if (!fs.existsSync(manifestPath)) return [];
      let markdown = "";
      try {
        markdown = fs.readFileSync(manifestPath, "utf8");
      } catch {
        return [];
      }
      const metadata = registry.skills?.[entry.name] ?? {};
      // Only entries that passed Breadboard review are public commands. The
      // repository's private agent workflows intentionally have no registry
      // record and therefore never masquerade as skills.sh installations.
      if (!registry.skills?.[entry.name]) return [];
      const frontmatter =
        markdown.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/)?.[1] ?? "";
      const frontmatterValue = (key: string) =>
        frontmatter
          .match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "mi"))?.[1]
          ?.trim();
      const registryHashes = metadata.fileHashes ?? metadata.hashes;
      const hashes =
        registryHashes && typeof registryHashes === "object"
          ? (registryHashes as Record<string, unknown>)
          : {};
      const pinnedHashes = Object.entries(hashes)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        )
        .sort(([left], [right]) => left.localeCompare(right));
      const contentHash = pinnedHashes.length
        ? crypto
            .createHash("sha256")
            .update(JSON.stringify(pinnedHashes))
            .digest("hex")
        : undefined;
      let integrityVerified = pinnedHashes.length === 0;
      if (pinnedHashes.length) {
        try {
          integrityVerified = reviewedTreeMatchesPins(
            path.join(root, entry.name),
            Object.fromEntries(pinnedHashes),
          );
        } catch {
          integrityVerified = false;
        }
      }
      const storedClassification =
        metadata.classification && typeof metadata.classification === "object"
          ? (metadata.classification as SkillClassification)
          : null;
      const classified =
        storedClassification?.classifierVersion === CLASSIFIER_VERSION
          ? storedClassification
          : classifySkill({
              name: frontmatterValue("name") ?? entry.name,
              description: frontmatterValue("description"),
              manifest: markdown,
            });
      const compatibility = resolveSkillCompatibility({
        classification: classified.classification,
        manifest: markdown,
        name: frontmatterValue("name") ?? entry.name,
        description: frontmatterValue("description"),
        surface,
        connectedMcpServers,
        reviewedScientificSource:
          typeof metadata.upstreamId === "string" &&
          metadata.upstreamId.startsWith(`${SCIENTIFIC_SKILLS_REPOSITORY}/`),
        reviewedReverseSource:
          typeof metadata.upstreamId === "string" &&
          metadata.upstreamId.startsWith(`${REVERSE_SKILLS_REPOSITORY}/`),
        reviewedLocalSource: isReviewedLocalUpstreamId(
          typeof metadata.upstreamId === "string" ? metadata.upstreamId : undefined,
        ),
      });
      return [
        {
          id:
            typeof metadata.upstreamId === "string"
              ? metadata.upstreamId
              : `skill:${entry.name}`,
          slug:
            typeof metadata.slashCommand === "string"
              ? metadata.slashCommand
              : entry.name,
          upstreamSlug:
            typeof metadata.slug === "string"
              ? metadata.slug
              : frontmatterValue("name") ?? entry.name,
          storageKey: entry.name,
          name: frontmatterValue("name") ?? entry.name,
          description:
            frontmatterValue("description") ?? "Installed Breadboard skill",
          source:
            typeof metadata.source === "string" ? metadata.source : undefined,
          version:
            typeof metadata.version === "string" ? metadata.version : undefined,
          contentHash,
          enabled: integrityVerified,
          healthy: integrityVerified,
          classification: classified.classification,
          category: classified.category,
          compatibleModes: classified.compatibleModes,
          compatibleSurfaces: classified.compatibleSurfaces,
          availability: compatibility.availability,
          unavailableReasons: compatibility.reasons,
          capabilityContract: compatibility.contract,
          compatibilityRequirements: compatibility.requirements,
          instructions: markdown,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function frontmatterValue(markdown: string, key: string): string | undefined {
  const frontmatter =
    markdown.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/)?.[1] ?? "";
  return frontmatter
    .match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "mi"))?.[1]
    ?.trim();
}

/**
 * Checked-in Breadboard capabilities are first-party product code, not
 * mutable skills.sh installations. Their exact repository contents are hashed
 * at load time and still pass the same surface/tool/runtime compatibility gate.
 */
export function listFirstPartySkills(
  surface: HermesSurface = "dashboard_terminal",
  connectedMcpServers: Iterable<string> = [],
): ApprovedSkillSummary[] {
  const root = firstPartySkillsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || !/^[a-z0-9_.-]+$/i.test(entry.name)) return [];
    const directory = path.join(root, entry.name);
    const manifestPath = path.join(directory, "SKILL.md");
    if (!fs.existsSync(manifestPath)) return [];
    let markdown = "";
    let contentHash = "";
    try {
      markdown = fs.readFileSync(manifestPath, "utf8");
      if (process.env.HERMES_FIRST_PARTY_SKILLS_ROOT) {
        contentHash = hashSkillDirectory(directory);
      } else {
        contentHash = FIRST_PARTY_HASH_CACHE.get(directory) ?? "";
        if (!contentHash) {
          contentHash = hashSkillDirectory(directory);
          FIRST_PARTY_HASH_CACHE.set(directory, contentHash);
        }
      }
    } catch {
      return [];
    }
    const name = frontmatterValue(markdown, "name") ?? entry.name;
    const description =
      frontmatterValue(markdown, "description") ?? "Breadboard first-party skill";
    const inferred = classifySkill({ name, description, manifest: markdown });
    // These first-party capabilities produce artifacts through a constrained,
    // product-owned runtime. Incidental implementation language in their
    // guidance does not turn the user's task into repository coding.
    const requiresOpenCode =
      inferred.classification === "eligible_coding_conditional" &&
      !DEDICATED_RUNTIME_FIRST_PARTY_SKILLS.has(entry.name);
    const classification: SkillClassification = {
      ...inferred,
      classification: requiresOpenCode
        ? "eligible_coding_conditional"
        : "eligible_general",
      category: requiresOpenCode ? "Implementation" : "Featured",
      reasons: [
        requiresOpenCode
          ? "This first-party software capability is reviewed and must execute through OpenCode."
          : "This capability is reviewed and shipped as first-party Breadboard product code.",
      ],
      compatibleModes: requiresOpenCode
        ? ["scoped_implementation"]
        : ["knowledge", "technical_read", "scoped_implementation"],
      compatibleSurfaces: requiresOpenCode
        ? ["assistant", "garden"]
        : ["assistant", "garden"],
    };
    const compatibility = resolveSkillCompatibility({
      classification: classification.classification,
      manifest: markdown,
      name,
      description,
      surface,
      connectedMcpServers,
    });
    const textToCad = isTextToCadSkill(entry.name);
    const summary: ApprovedSkillSummary = {
      id: textToCad
        ? `${TEXT_TO_CAD_SOURCE}/${entry.name}`
        : `breadboard:first-party/${entry.name}`,
      slug: entry.name,
      upstreamSlug: entry.name,
      storageKey: entry.name,
      name,
      description,
      source: textToCad ? TEXT_TO_CAD_SOURCE : "Breadboard",
      version: textToCad ? TEXT_TO_CAD_VERSION : "1.0.0",
      contentHash,
      enabled: true,
      healthy: true,
      classification: classification.classification,
      category: classification.category,
      compatibleModes: classification.compatibleModes,
      compatibleSurfaces: classification.compatibleSurfaces,
      availability: compatibility.availability,
      unavailableReasons: compatibility.reasons,
      capabilityContract: compatibility.contract,
      compatibilityRequirements: compatibility.requirements,
      instructions: markdown,
    };
    return [summary];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Reviewed skills installed into this Breadboard, read straight from the
 * approved store rather than the skills.sh catalog database.
 *
 * A catalog installation has both a store directory and a database row, so it
 * shows up either way. A first-party capability that was moved into the store —
 * Premortem — has only the directory, and would otherwise be invisible to the
 * Skills panel even though it is installed and usable.
 */
export function listInstalledLocalSkills(
  surface: HermesSurface = "dashboard_terminal",
  connectedMcpServers: Iterable<string> = [],
): ApprovedSkillSummary[] {
  const bySlug = new Map<string, ApprovedSkillSummary>();
  for (const root of [approvedRoot(), conditionalRoot()]) {
    for (const skill of listApprovedSkillsAtRoot(root, surface, connectedMcpServers)) {
      bySlug.set(skill.slug, skill);
    }
  }
  return [...bySlug.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

/**
 * Return reviewed, integrity-pinned skills with a compatible execution path on
 * the requested surface. Coding skills remain isolated in the conditional
 * registry and are exposed only where the OpenCode runner is available.
 */
export function listApprovedSkills(
  surface: HermesSurface = "dashboard_terminal",
  connectedMcpServers: Iterable<string> = [],
): ApprovedSkillSummary[] {
  const bySlug = new Map<string, ApprovedSkillSummary>();
  for (const skill of listFirstPartySkills(surface, connectedMcpServers)) {
    if (
      ["eligible_general", "eligible_coding_conditional"].includes(
        skill.classification,
      ) &&
      skill.availability === "ready"
    ) {
      bySlug.set(skill.slug, skill);
    }
  }
  const roots = surface === "dashboard_terminal" || surface === "garden_chat"
    ? [approvedRoot(), conditionalRoot()]
    : [approvedRoot()];
  for (const root of roots) {
    for (const skill of listApprovedSkillsAtRoot(root, surface, connectedMcpServers)) {
      if (
        !["eligible_general", "eligible_coding_conditional"].includes(skill.classification) ||
        skill.availability !== "ready"
      ) continue;
      bySlug.set(skill.slug, skill);
    }
  }
  return [...bySlug.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function sanitizeSkillName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!cleaned) throw new Error("Invalid skill name");
  return cleaned;
}

export function skillStorageKey(upstreamId: string, slug: string): string {
  const suffix = crypto.createHash("sha256").update(upstreamId).digest("hex").slice(0, 10);
  return sanitizeSkillName(`${slug}-${suffix}`);
}

function ensureInside(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, target);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Path escapes the skills root");
  return resolved;
}

export interface QuarantineReport {
  name: string;
  slug?: string;
  upstreamId?: string;
  slashCommand?: string;
  package: string;
  source: string;
  description?: string;
  repository?: string;
  exactVersion?: string;
  catalogRevision?: string;
  localHash: string;
  files: string[];
  fileHashes: Record<string, string>;
  hasSkillMd: boolean;
  frontmatterName?: string;
  requestedPermissions: SkillPermission[];
  discoveredScripts: string[];
  externalNetworkRequirements: string[];
  installedAt: string;
  nameCollision: boolean;
  integrityVerified: boolean;
  risks: string[];
  riskSummary: string;
  reviewState: "quarantined" | "approved";
  approvedAgents: string[];
  approvedPermissions?: SkillPermission[];
  classification: SkillClassification;
  reviewOverride?: SkillEligibility;
  reviewer?: number;
  reviewedAt?: string;
}

export const SKILL_SNAPSHOT_LIMITS = Object.freeze({
  maxFiles: MAX_SKILL_FILES,
  maxFileBytes: MAX_SKILL_FILE_BYTES,
  maxTotalBytes: MAX_SKILL_TOTAL_BYTES,
  maxPathLength: MAX_SKILL_PATH_LENGTH,
  maxDirectoryDepth: MAX_SKILL_DIRECTORY_DEPTH,
});

export function quarantineCatalogSkillSnapshot(input: {
  candidate: SkillCandidate;
  files: Array<{ path: string; contents: string }> | null;
  catalogRevision: string;
}): QuarantineReport {
  if (!input.files?.length) throw new Error("Skill snapshot unavailable");
  return quarantineEntries({
    candidate: input.candidate,
    entries: input.files.map((file) => [file.path, file.contents]),
    catalogRevision: input.catalogRevision,
  });
}

export function quarantineSkill(input: {
  candidate: SkillCandidate;
  files: Record<string, string | Buffer>;
}): QuarantineReport {
  return quarantineEntries({ candidate: input.candidate, entries: Object.entries(input.files) });
}

function quarantineEntries(input: {
  candidate: SkillCandidate;
  entries: Array<[string, string | Buffer]>;
  catalogRevision?: string;
}): QuarantineReport {
  const name = sanitizeSkillName(input.candidate.storageKey ?? input.candidate.name);
  // The keyword classifier flags legitimate reverse-engineering and security
  // guidance as blocked_security. Operator-vendored reviewed local clones are
  // exempt from that heuristic block; explicit human approval at promotion and
  // the runtime permission policy remain the real controls.
  if (
    input.candidate.classification?.classification === "blocked_security" &&
    !isReviewedLocalSource(input.candidate.repository)
  ) {
    throw new Error("Breadboard policy blocks this incompatible skill from quarantine.");
  }
  const entries = validateSkillSnapshotEntries(input.entries);
  const root = quarantineRoot();
  fs.mkdirSync(root, { recursive: true });
  const destination = ensureInside(root, name);
  const staging = fs.mkdtempSync(path.join(root, ".staging-"));
  try {
    for (const [relativePath, contents] of entries) {
      const target = ensureInside(staging, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents, Buffer.isBuffer(contents)
        ? { flag: "wx" }
        : { encoding: "utf8", flag: "wx" });
    }
    const inspected = inspectFiles(name, staging, input.candidate);
    const report: QuarantineReport = {
      ...inspected,
      catalogRevision: input.catalogRevision ?? input.candidate.version,
      localHash: deterministicSkillContentHash(entries),
    };
    fs.writeFileSync(
      path.join(staging, QUARANTINE_MANIFEST),
      JSON.stringify(report, null, 2),
      { encoding: "utf8", flag: "wx" },
    );
    replaceDirectoryAtomically(staging, destination);
    return report;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function validateSkillSnapshotEntries(
  entries: Array<[string, string | Buffer]>,
): Array<[string, string | Buffer]> {
  if (!entries.length) throw new Error("Skill snapshot unavailable");
  if (entries.length > MAX_SKILL_FILES) throw new Error(`Skill exceeds the ${MAX_SKILL_FILES}-file quarantine limit`);
  const normalizedPaths = new Set<string>();
  const normalized: Array<[string, string | Buffer]> = [];
  let totalBytes = 0;
  for (const [relativePath, contents] of entries) {
    validateSkillSnapshotPath(relativePath);
    const caseInsensitive = relativePath.toLowerCase();
    if (normalizedPaths.has(caseInsensitive)) throw new Error(`Duplicate skill file path: ${relativePath}`);
    normalizedPaths.add(caseInsensitive);
    const bytes = Buffer.isBuffer(contents) ? contents.byteLength : Buffer.byteLength(contents, "utf8");
    if (bytes > MAX_SKILL_FILE_BYTES) throw new Error("Skill contains a file larger than the quarantine limit");
    totalBytes += bytes;
    if (totalBytes > MAX_SKILL_TOTAL_BYTES) throw new Error("Skill exceeds the total quarantine size limit");
    normalized.push([relativePath, contents]);
  }
  const manifests = normalized.filter(([relativePath]) => path.posix.basename(relativePath).toLowerCase() === "skill.md");
  if (manifests.length !== 1 || manifests[0][0] !== "SKILL.md") {
    throw new Error("Skill snapshot must contain exactly one root SKILL.md");
  }
  return normalized.sort(([left], [right]) => left.localeCompare(right));
}

function validateSkillSnapshotPath(relativePath: string): void {
  if (
    !relativePath ||
    relativePath.length > MAX_SKILL_PATH_LENGTH ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("//") ||
    /^[A-Za-z]:/.test(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath
  ) {
    throw new Error(`Unsafe skill file path: ${relativePath}`);
  }
  const parts = relativePath.split("/");
  if (parts.length - 1 > MAX_SKILL_DIRECTORY_DEPTH || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe skill file path: ${relativePath}`);
  }
  for (const part of parts) {
    if (/^[\s.]|[\s.]$/.test(part) || /[<>:"|?*\u0000-\u001f]/.test(part)) {
      throw new Error(`Unsafe skill file path: ${relativePath}`);
    }
    const base = part.split(".")[0].toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) {
      throw new Error(`Reserved Windows skill file path: ${relativePath}`);
    }
  }
}

function replaceDirectoryAtomically(staging: string, destination: string): void {
  const root = path.dirname(destination);
  const backup = ensureInside(root, `.previous-${path.basename(destination)}-${crypto.randomUUID()}`);
  let backedUp = false;
  try {
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backup);
      backedUp = true;
    }
    fs.renameSync(staging, destination);
    if (backedUp) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    if (backedUp && fs.existsSync(backup)) fs.renameSync(backup, destination);
    throw error;
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (fs.existsSync(backup) && fs.existsSync(destination)) fs.rmSync(backup, { recursive: true, force: true });
  }
}

export function inspectQuarantine(
  name: string,
  candidate?: SkillCandidate,
): QuarantineReport {
  const safeName = sanitizeSkillName(name);
  const dir = ensureInside(quarantineRoot(), safeName);
  if (!fs.existsSync(dir)) throw new Error("Skill is not in quarantine");
  const saved = readQuarantineManifest(dir);
  const report = inspectFiles(safeName, dir, candidate, saved ?? undefined);
  return {
    ...report,
    integrityVerified: saved
      ? sameHashes(saved.fileHashes, report.fileHashes)
      : report.integrityVerified,
  };
}

function inspectFiles(
  name: string,
  dir: string,
  candidate?: SkillCandidate,
  saved?: QuarantineReport,
): QuarantineReport {
  const files = listFilesRecursive(dir)
    // Registry pins are portable metadata. Always store POSIX separators so a
    // skill reviewed on Windows verifies identically when it is loaded later.
    .map((file) => path.relative(dir, file).replace(/\\/g, "/"))
    .filter((file) => file !== QUARANTINE_MANIFEST);
  const fileHashes = Object.fromEntries(
    files.map((file) => [file, sha256(fs.readFileSync(path.join(dir, file)))]),
  );
  const skillMdPath = path.join(dir, "SKILL.md");
  const hasSkillMd = fs.existsSync(skillMdPath);
  const skillMarkdown = hasSkillMd ? fs.readFileSync(skillMdPath, "utf8") : "";
  const frontmatterName = hasSkillMd
    ? parseSkillName(skillMarkdown)
    : undefined;
  const discoveredScripts = files.filter((file) =>
    /\.(sh|bash|ps1|bat|cmd|js|mjs|cjs|py|rb)$/i.test(file),
  );
  const externalNetworkRequirements = [
    ...new Set(
      files.flatMap((file) => {
        try {
          return (
            fs
              .readFileSync(path.join(dir, file), "utf8")
              .match(/https?:\/\/[^\s)\]"']+/g) ?? []
          );
        } catch {
          return [];
        }
      }),
    ),
  ].slice(0, 20);
  const requestedPermissions = derivePermissions(
    skillMarkdown,
    discoveredScripts,
    externalNetworkRequirements,
    candidate?.requestedPermissions ?? saved?.requestedPermissions ?? [],
  );
  const description = candidate?.description ?? saved?.description;
  const repository = candidate?.repository ?? saved?.repository;
  const classification = classifySkill({
    name: frontmatterName ?? name,
    description,
    repository,
    manifest: skillMarkdown,
    requestedPermissions,
  });
  const risks: string[] = [];
  if (!hasSkillMd) risks.push("Missing SKILL.md manifest.");
  const expectedManifestName = candidate?.name ?? saved?.slug ?? name;
  if (frontmatterName && sanitizeSkillName(frontmatterName) !== sanitizeSkillName(expectedManifestName))
    risks.push(`Manifest name "${frontmatterName}" does not match "${expectedManifestName}".`);
  if (discoveredScripts.length)
    risks.push(`Contains script files: ${discoveredScripts.join(", ")}`);
  if (externalNetworkRequirements.length)
    risks.push("References external network locations.");
  for (const file of files) {
    try {
      const contents = fs.readFileSync(path.join(dir, file), "utf8");
      if (/curl\s|wget\s|rm\s+-rf|child_process|eval\(/i.test(contents))
        risks.push(`Suspicious command pattern in ${file}`);
    } catch {
      risks.push(`Unreadable/binary file: ${file}`);
    }
  }
  const nameCollision = fs.existsSync(ensureInside(approvedRoot(), name));
  if (nameCollision)
    risks.push("A skill with this name is already approved (name collision).");
  return {
    name,
    slug: candidate?.name ?? saved?.slug ?? name,
    upstreamId: candidate?.upstreamId ?? candidate?.id ?? saved?.upstreamId,
    slashCommand: candidate?.slashCommand ?? saved?.slashCommand ?? candidate?.name ?? saved?.slug ?? name,
    package: candidate?.package ?? saved?.package ?? name,
    source: candidate?.source ?? saved?.source ?? "unknown",
    description,
    repository,
    exactVersion: candidate?.version ?? saved?.exactVersion,
    catalogRevision: saved?.catalogRevision ?? candidate?.version,
    localHash: hashSkillDirectory(dir),
    files,
    fileHashes,
    hasSkillMd,
    frontmatterName,
    requestedPermissions,
    discoveredScripts,
    externalNetworkRequirements,
    installedAt: saved?.installedAt ?? new Date().toISOString(),
    nameCollision,
    integrityVerified: true,
    risks: [...new Set(risks)],
    riskSummary: risks.length
      ? `${risks.length} risk signal(s) require review.`
      : "No static risk signals detected; human review is still required.",
    reviewState: "quarantined",
    approvedAgents: saved?.approvedAgents ?? ["breadboard-assistant"],
    classification: saved?.reviewOverride
      ? {
          ...classification,
          classification: saved.reviewOverride,
          reasons: [
            ...classification.reasons,
            "An authenticated reviewer supplied an explicit eligibility override.",
          ],
        }
      : classification,
    reviewOverride: saved?.reviewOverride,
    reviewer: saved?.reviewer,
    reviewedAt: saved?.reviewedAt,
  };
}

function derivePermissions(
  markdown: string,
  scripts: string[],
  urls: string[],
  declared: SkillPermission[],
): SkillPermission[] {
  const permissions = new Set<SkillPermission>(declared);
  if (scripts.length || /allowed-tools:[\s\S]*(bash|shell)/i.test(markdown))
    permissions.add("shell");
  if (urls.length || /\b(fetch|http|api|network)\b/i.test(markdown))
    permissions.add("network");
  if (/\b(read|inspect|open)\b[^\n]*(file|document|repository)/i.test(markdown))
    permissions.add("filesystem-read");
  if (
    /\b(write|edit|modify|create|delete)\b[^\n]*(file|document|repository)/i.test(
      markdown,
    )
  )
    permissions.add("filesystem-write");
  return [...permissions];
}

export function promoteSkill(
  name: string,
  options?: {
    overwrite?: boolean;
    approvedAgents?: string[];
    approvedPermissions?: SkillPermission[];
    classificationOverride?: "eligible_general" | "eligible_coding_conditional";
    allowConditional?: boolean;
    reviewer?: number;
  },
): { promotedPath: string; report: QuarantineReport } {
  const report = inspectQuarantine(name);
  if (!report.integrityVerified)
    throw new Error("Quarantined files changed after review");
  if (!report.hasSkillMd)
    throw new Error("Refusing to promote a skill without a SKILL.md manifest");
  if (
    !report.frontmatterName ||
    (
      sanitizeSkillName(report.frontmatterName) !== sanitizeSkillName(report.slug ?? report.name) &&
      !report.upstreamId
    )
  ) {
    throw new Error(
      "Refusing to promote a skill whose manifest name does not match its quarantine name",
    );
  }
  let effectiveClassification =
    options?.classificationOverride ?? report.classification.classification;
  // A reviewed, operator-vendored local clone is trusted like a first-party
  // skill: promotion is the explicit human approval the eligibility gate asks
  // for, so the keyword classifier's blocked/needs-review verdict does not
  // stop it. Coding-conditional stays conditional (OpenCode); everything else
  // is stored as reviewed general guidance so the runtime will offer it.
  if (
    isReviewedLocalUpstreamId(report.upstreamId) &&
    effectiveClassification !== "eligible_general" &&
    effectiveClassification !== "eligible_coding_conditional"
  ) {
    effectiveClassification = "eligible_general";
  }
  if (
    report.classification.classification ===
      "eligible_coding_conditional" &&
    effectiveClassification !== "eligible_coding_conditional"
  ) {
    throw new Error(
      "A coding or repository-engineering skill must remain OpenCode-conditional.",
    );
  }
  if (
    report.classification.classification !==
      "eligible_coding_conditional" &&
    effectiveClassification === "eligible_coding_conditional"
  ) {
    throw new Error(
      "A non-coding skill cannot be promoted as an OpenCode-conditional skill.",
    );
  }
  if (
    report.classification.classification === "eligible_coding_conditional" &&
    !options?.allowConditional
  ) {
    throw new Error("Refusing to promote a coding or repository-engineering skill.");
  }
  if (
    effectiveClassification !== "eligible_general" &&
    effectiveClassification !== "eligible_coding_conditional"
  ) {
    throw new Error(
      "Refusing to promote a skill until Breadboard classifies it as eligible.",
    );
  }
  const source = ensureInside(quarantineRoot(), report.name);
  const conditional = effectiveClassification === "eligible_coding_conditional";
  const destinationRoot = conditional ? conditionalRoot() : approvedRoot();
  const target = ensureInside(destinationRoot, report.name);
  const otherRoot = conditional ? approvedRoot() : conditionalRoot();
  const otherTarget = ensureInside(otherRoot, report.name);
  if ((fs.existsSync(target) || fs.existsSync(otherTarget)) && !options?.overwrite)
    throw new Error("A skill with this name is already approved");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const operationId = crypto.randomUUID();
  const stagedTarget = ensureInside(destinationRoot, `${report.name}.promoting-${operationId}`);
  const targetBackup = ensureInside(destinationRoot, `${report.name}.backup-${operationId}`);
  const otherBackup = ensureInside(otherRoot, `${report.name}.backup-${operationId}`);
  fs.cpSync(source, stagedTarget, { recursive: true });
  fs.rmSync(path.join(stagedTarget, QUARANTINE_MANIFEST), { force: true });
  const approvedAgents = (options?.approvedAgents ?? []).filter((agent) =>
    APPROVABLE_AGENTS.has(agent),
  );
  const approved = {
    ...report,
    reviewState: "approved" as const,
    approvedAgents: approvedAgents.length
      ? approvedAgents
      : ["breadboard-assistant"],
    approvedPermissions: options?.approvedPermissions ?? [],
    classification: {
      ...report.classification,
      classification: effectiveClassification,
      compatibleModes: conditional
        ? ["scoped_implementation" as const]
        : ["knowledge" as const, "technical_read" as const, "scoped_implementation" as const],
      compatibleSurfaces: conditional
        ? ["assistant" as const, "garden" as const]
        : ["assistant" as const, "garden" as const, "quartz" as const, "document" as const],
    },
    reviewOverride: options?.classificationOverride,
    reviewer: options?.reviewer,
    reviewedAt: new Date().toISOString(),
  };
  if (fs.existsSync(target)) fs.renameSync(target, targetBackup);
  if (options?.overwrite && fs.existsSync(otherTarget)) fs.renameSync(otherTarget, otherBackup);
  try {
    fs.renameSync(stagedTarget, target);
    updateApprovedRegistry(approved, destinationRoot);
    if (fs.existsSync(otherBackup)) removeRegistryEntry(report.name, otherRoot);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (fs.existsSync(targetBackup)) fs.renameSync(targetBackup, target);
    if (fs.existsSync(otherBackup)) fs.renameSync(otherBackup, otherTarget);
    fs.rmSync(stagedTarget, { recursive: true, force: true });
    throw error;
  }
  fs.rmSync(targetBackup, { recursive: true, force: true });
  fs.rmSync(otherBackup, { recursive: true, force: true });
  fs.rmSync(source, { recursive: true, force: true });
  return { promotedPath: target, report: approved };
}

export function rejectQuarantine(name: string): void {
  fs.rmSync(ensureInside(quarantineRoot(), sanitizeSkillName(name)), {
    recursive: true,
    force: true,
  });
}

export function removeApprovedSkill(storageKey: string): void {
  const name = sanitizeSkillName(storageKey);
  let removed = false;
  for (const root of [approvedRoot(), conditionalRoot()]) {
    const target = ensureInside(root, name);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removeRegistryEntry(name, root);
    removed = true;
  }
  if (!removed) throw new Error("Approved skill content was not found");
}

function removeRegistryEntry(name: string, root: string): void {
  const registryFile = path.join(root, "registry.json");
  try {
    const registry = JSON.parse(fs.readFileSync(registryFile, "utf8")) as {
      skills?: Record<string, unknown>;
    };
    if (registry.skills) delete registry.skills[name];
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2), "utf8");
  } catch {
    // A missing registry cannot make removed content executable.
  }
}

function updateApprovedRegistry(report: QuarantineReport, root: string): void {
  const file = path.join(root, "registry.json");
  fs.mkdirSync(root, { recursive: true });
  let registry: { skills: Record<string, unknown> } = { skills: {} };
  try {
    registry = JSON.parse(fs.readFileSync(file, "utf8")) as {
      skills: Record<string, unknown>;
    };
  } catch {
    registry = { skills: {} };
  }
  registry.skills[report.name] = {
    ...report,
    approvedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(registry, null, 2), "utf8");
}

function readQuarantineManifest(dir: string): QuarantineReport | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(dir, QUARANTINE_MANIFEST), "utf8"),
    ) as QuarantineReport;
  } catch {
    return null;
  }
}

function sameHashes(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rightEntries = Object.entries(right).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

export function canonicalSkillHash(fileHashes: Record<string, string>): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(Object.entries(fileHashes).sort(([left], [right]) => left.localeCompare(right))))
    .digest("hex");
}

export function deterministicSkillContentHash(
  entries: Array<[string, string | Buffer]>,
): string {
  const hash = crypto.createHash("sha256");
  for (const [relativePath, value] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const contents = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    hash.update(`${Buffer.byteLength(normalizedPath, "utf8")}:`);
    hash.update(normalizedPath, "utf8");
    hash.update(`${contents.byteLength}:`);
    hash.update(contents);
  }
  return hash.digest("hex");
}

export function hashSkillDirectory(root: string): string {
  const entries = listFilesRecursive(root)
    .filter((file) => path.basename(file) !== QUARANTINE_MANIFEST)
    .map((file) => [
      path.relative(root, file).replace(/\\/g, "/"),
      fs.readFileSync(file),
    ] as [string, Buffer]);
  return deterministicSkillContentHash(entries);
}

/**
 * Reviewed text artifacts are authenticated by their reviewed CONTENT, not by
 * the byte form a checkout happened to write.
 *
 * The reviewed root is a committed directory, so git rewrites its line endings
 * on checkout under core.autocrlf. Hashing raw bytes therefore made a pin mean
 * "these bytes were written on that machine" rather than "this text was
 * reviewed", and the three shipped pins ended up in three different byte forms
 * with no checkout satisfying all of them (W23E-001).
 *
 * The canonicalisation is deliberately the smallest rule that covers every
 * conversion git can perform, and nothing else. Whitespace, indentation, a
 * trailing newline, a BOM, Unicode normalisation, frontmatter, punctuation and
 * casing all remain identity-bearing, because a checkout never changes them and
 * a reviewer can see every one of them.
 */
const REVIEWED_TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml"]);

/** Pins carry their scheme so future code can tell which contract they assert. */
const TEXT_PIN_PREFIX = "text-v1:";

function isReviewedTextPath(relativePath: string): boolean {
  return REVIEWED_TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

/**
 * Strict UTF-8 decode, then CRLF and lone CR folded to LF. Returns null when the
 * bytes are not valid UTF-8: a lossy decode would turn an invalid sequence into
 * U+FFFD and could then verify, so this fails closed instead.
 */
export function canonicalizeReviewedText(bytes: Buffer): Buffer | null {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return null;
  return Buffer.from(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
}

/** The canonical identity of a reviewed text artifact, in its pinned form. */
export function reviewedTextPin(bytes: Buffer): string | null {
  const canonical = canonicalizeReviewedText(bytes);
  return canonical === null ? null : `${TEXT_PIN_PREFIX}${sha256(canonical)}`;
}

/**
 * Verify one reviewed file against its pin, in whichever scheme the pin declares.
 * A bare hex pin keeps its original raw-byte meaning exactly, so no historical
 * pin is silently reinterpreted.
 */
function reviewedFileMatchesPin(
  absolutePath: string,
  relativePath: string,
  pin: string,
): boolean {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(absolutePath);
  } catch {
    return false;
  }
  if (pin.startsWith(TEXT_PIN_PREFIX)) {
    // A text pin may only ever authenticate a declared text artifact.
    if (!isReviewedTextPath(relativePath)) return false;
    return reviewedTextPin(bytes) === pin;
  }
  return sha256(bytes) === pin;
}

/**
 * The reviewed tree matches its pins when the pinned file set is exactly the set
 * on disk and every file matches under its own scheme. An added or removed file
 * is a mismatch, as it always was.
 */
function reviewedTreeMatchesPins(
  directory: string,
  pinned: Record<string, string>,
): boolean {
  const present = listFilesRecursive(directory)
    .map((file) => path.relative(directory, file).replace(/\\/g, "/"))
    .sort();
  const expected = Object.keys(pinned).sort();
  if (present.length !== expected.length) return false;
  if (present.some((name, index) => name !== expected[index])) return false;
  return present.every((name) =>
    reviewedFileMatchesPin(path.join(directory, name), name, pinned[name]),
  );
}

function sha256(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function listFilesRecursive(dir: string, depth = 20): string[] {
  if (depth < 0 || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Skill content contains a symbolic link: ${entry.name}`);
    }
    return entry.isDirectory() ? listFilesRecursive(full, depth - 1) : [full];
  });
}

function parseSkillName(markdown: string): string | undefined {
  const match = markdown.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/);
  if (!match) return undefined;
  const line = match[1]
    .split(/\r?\n/)
    .find((value) => value.trim().startsWith("name:"));
  return line?.slice(line.indexOf(":") + 1).trim();
}
