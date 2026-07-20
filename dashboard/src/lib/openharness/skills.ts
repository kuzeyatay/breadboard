// Real skills.sh discovery with a strict discovery -> quarantine -> review ->
// promotion boundary. Search never installs. Quarantined files are never loaded
// by OpenHarness, and promotion verifies the exact reviewed hashes.

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SKILLS_SH_CLI_PACKAGE } from "./skills-sh-client.ts";
import { repositoryRoot } from "../runtime-paths.ts";

const execFileAsync = promisify(execFile);
const QUARANTINE_MANIFEST = ".breadboard-quarantine.json";
const CLI_PACKAGE = process.env.SKILLS_CLI_PACKAGE?.trim() || SKILLS_SH_CLI_PACKAGE;
const MAX_SKILL_FILES = 200;
const MAX_SKILL_FILE_BYTES = 2_000_000;
const MAX_SKILL_TOTAL_BYTES = 10_000_000;
const APPROVABLE_AGENTS = new Set([
  "breadboard-assistant",
  "breadboard-garden",
  "breadboard-quartz",
  "breadboard-document",
]);
const CLASSIFIER_VERSION = "breadboard-skill-policy-v1";

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
  provider?: "api" | "cli" | "cache";
  slashCommand?: string;
  storageKey?: string;
  classification: SkillClassification;
}

export type SkillsCliRunner = (
  args: string[],
  options?: { cwd?: string; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string }>;

export async function runSkillsCli(
  args: string[],
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<{ stdout: string; stderr: string }> {
  const windowsNpx = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  const command =
    process.platform === "win32" && fs.existsSync(windowsNpx)
      ? process.execPath
      : "npx";
  const commandArgs =
    command === process.execPath
      ? [windowsNpx, "--yes", CLI_PACKAGE, ...args]
      : ["--yes", CLI_PACKAGE, ...args];
  try {
    const result = await execFileAsync(command, commandArgs, {
      cwd: options.cwd,
      timeout: 60_000,
      maxBuffer: 2_000_000,
      env: { ...process.env, DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" },
      signal: options.signal,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as Error & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const stdout = failed.stdout?.toString() ?? "";
    const stderr = failed.stderr?.toString() ?? "";
    // Node 24 on Windows can hit a libuv shutdown assertion after the official
    // CLI has already printed a complete `find` response. Discovery is
    // read-only, so accept only output that independently parses into real
    // skills.sh package records. Mutating `add` failures are always fatal.
    if (args[0] === "find" && parseSkillSearchOutput(stdout).length > 0) {
      return { stdout, stderr };
    }
    throw error;
  }
}

export async function listInstalledSkillsWithCli(
  runner: SkillsCliRunner = runSkillsCli,
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<unknown> {
  const result = await runner(["list", "--json"], options);
  try {
    return JSON.parse(stripAnsi(result.stdout));
  } catch {
    throw new Error("The Skills CLI returned malformed list output");
  }
}

export async function updateInstalledSkillsWithCli(
  names: string[],
  runner: SkillsCliRunner = runSkillsCli,
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const safeNames = names.map(validCliSkillName);
  if (!safeNames.length) throw new Error("At least one installed skill is required");
  await runner(["update", ...safeNames, "--project", "--yes"], options);
}

export async function removeInstalledSkillsWithCli(
  names: string[],
  runner: SkillsCliRunner = runSkillsCli,
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const safeNames = names.map(validCliSkillName);
  if (!safeNames.length) throw new Error("At least one installed skill is required");
  await runner(["remove", ...safeNames, "--yes"], options);
}

function validCliSkillName(value: string): string {
  const name = value.trim();
  if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(name)) throw new Error(`Invalid Skills CLI skill name: ${value}`);
  return name;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

/** Search the real skills ecosystem through the official CLI. Metadata only. */
export async function searchRegistry(
  query: string,
  runner: SkillsCliRunner = runSkillsCli,
): Promise<SkillCandidate[]> {
  const normalized = query.trim().slice(0, 200);
  if (!normalized) return [];
  const result = await runner(["find", normalized]);
  return parseSkillSearchOutput(result.stdout).map((candidate) => ({
    ...candidate,
    provider: "cli" as const,
  }));
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
  const evidenceFields = [
    "name",
    ...(input.description ? ["description"] : []),
    ...(input.repository ? ["repository"] : []),
    ...(input.manifest ? ["SKILL.md"] : []),
    ...(input.requestedPermissions?.length ? ["requested_permissions"] : []),
  ];
  const security =
    /\b(credential theft|exfiltrat|malware|ransomware|privilege escalation|persistence|evade authorization|steal (?:password|token|secret)|exploit development|reverse shell|botnet)\b/i;
  const incompatible =
    /\b(force[- ]push automation|production deploy(?:ment)? automation|global package installer|kernel module|firmware flasher)\b/i;
  const coding =
    /\b(api development|backend|build config|code review|code generation|coding|database migration|debug(?:ger|ging)?|devops|frontend|full[- ]stack|mobile development|package integration|programming|react|refactor|repository|software architecture|software test|typescript|web development)\b/i;
  const general =
    /\b(analysis|brainstorm|business|communication|decision|document|editing|education|explain|image|knowledge|literature|marketing|meeting|pdf|planning|presentation|productivity|quiz|research|spreadsheet|study|summari[sz]|teaching|translation|travel|visual design|writing)\b/i;
  const now = new Date().toISOString();
  if (security.test(text)) {
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
  if (incompatible.test(text)) {
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
  if (coding.test(text)) {
    return {
      classification: "eligible_coding_conditional",
      category: "Implementation",
      reasons: ["The primary purpose is software implementation or repository engineering."],
      evidenceFields,
      classifierVersion: CLASSIFIER_VERSION,
      compatibleModes: ["scoped_implementation"],
      compatibleSurfaces: ["assistant"],
      classifiedAt: now,
    };
  }
  if (general.test(text)) {
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
          installCommand: `npx skills add ${packageId}`,
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
    process.env.OPENHARNESS_SKILLS_QUARANTINE ??
    path.join(repoRoot(), "openharness-skills", "quarantine")
  );
}

export function approvedRoot(): string {
  return (
    process.env.OPENHARNESS_SKILLS_APPROVED ??
    path.join(repoRoot(), ".agents", "skills")
  );
}

/** Coding-oriented skills are reviewed and retained outside the general store. */
export function conditionalRoot(): string {
  return (
    process.env.OPENHARNESS_SKILLS_CONDITIONAL ??
    path.join(repoRoot(), "openharness-skills", "conditional")
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
  instructions: string;
}

function listApprovedSkillsAtRoot(root: string): ApprovedSkillSummary[] {
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
          const directory = path.join(root, entry.name);
          const currentHashes = Object.fromEntries(
            listFilesRecursive(directory).map((file) => [
              path.relative(directory, file),
              crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
            ]),
          );
          integrityVerified = sameHashes(
            Object.fromEntries(pinnedHashes),
            currentHashes,
          );
        } catch {
          integrityVerified = false;
        }
      }
      const classified =
        metadata.classification && typeof metadata.classification === "object"
          ? (metadata.classification as SkillClassification)
          : classifySkill({
              name: frontmatterValue("name") ?? entry.name,
              description: frontmatterValue("description"),
              manifest: markdown,
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
          instructions: markdown,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Read the general and conditional registries. Returning conditional entries
 * here does not activate them: command resolution and every surface filter the
 * classification against the current server-owned capability mode.
 */
export function listApprovedSkills(): ApprovedSkillSummary[] {
  const bySlug = new Map<string, ApprovedSkillSummary>();
  for (const skill of [
    ...listApprovedSkillsAtRoot(approvedRoot()),
    ...listApprovedSkillsAtRoot(conditionalRoot()),
  ]) {
    bySlug.set(skill.slug, skill);
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
  exactVersion?: string;
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

/**
 * Run the official CLI in an isolated temporary project, then copy only the
 * selected skill into Breadboard quarantine. The temporary CLI install is not
 * an active OpenHarness skill registry.
 */
export async function downloadSkillToQuarantine(
  candidate: SkillCandidate,
  runner: SkillsCliRunner = runSkillsCli,
): Promise<QuarantineReport> {
  if (
    !validPackage(candidate.repository, candidate.name) ||
    candidate.package !== `${candidate.repository}@${candidate.name}`
  ) {
    throw new Error("Invalid skill package identifier");
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-skill-"));
  try {
    await runner(
      [
        "add",
        candidate.repository,
        "--skill",
        candidate.name,
        "--agent",
        "universal",
        "--copy",
        "--yes",
      ],
      { cwd: staging },
    );
    const skillDirectory = findInstalledSkill(staging, candidate.name);
    if (!skillDirectory)
      throw new Error("The Skills CLI did not produce the selected skill");
    const files = readBoundedSkillFiles(skillDirectory);
    const lock = readSkillLock(staging, candidate.name);
    return quarantineSkill({
      candidate: {
        ...candidate,
        source:
          typeof lock?.sourceUrl === "string"
            ? lock.sourceUrl
            : candidate.source,
        version:
          typeof lock?.skillFolderHash === "string"
            ? lock.skillFolderHash
            : candidate.version,
      },
      files,
    });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function findInstalledSkill(root: string, name: string): string | null {
  const direct = [
    path.join(root, ".agents", "skills", name),
    path.join(root, ".universal", "skills", name),
    path.join(root, "skills", name),
  ].find((candidate) => fs.existsSync(path.join(candidate, "SKILL.md")));
  if (direct) return direct;
  return (
    listFilesRecursive(root, 6)
      .find(
        (file) =>
          path.basename(file).toLowerCase() === "skill.md" &&
          path.basename(path.dirname(file)) === name,
      )
      ?.replace(/[\\/]SKILL\.md$/i, "") ?? null
  );
}

function readSkillLock(
  root: string,
  name: string,
): Record<string, unknown> | null {
  const lockFile = [
    path.join(root, "skills-lock.json"),
    path.join(root, ".agents", ".skill-lock.json"),
  ].find((candidate) => fs.existsSync(candidate));
  if (!lockFile) return null;
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8")) as {
      skills?: Record<string, Record<string, unknown>>;
    };
    return lock.skills?.[name] ?? null;
  } catch {
    return null;
  }
}

function readBoundedSkillFiles(root: string): Record<string, Buffer> {
  const paths = listFilesRecursive(root);
  if (paths.length > MAX_SKILL_FILES)
    throw new Error(
      `Skill exceeds the ${MAX_SKILL_FILES}-file quarantine limit`,
    );
  let total = 0;
  return Object.fromEntries(
    paths.map((file) => {
      const size = fs.statSync(file).size;
      if (size > MAX_SKILL_FILE_BYTES)
        throw new Error(
          "Skill contains a file larger than the quarantine limit",
        );
      total += size;
      if (total > MAX_SKILL_TOTAL_BYTES)
        throw new Error("Skill exceeds the total quarantine size limit");
      return [path.relative(root, file), fs.readFileSync(file)];
    }),
  );
}

export function quarantineSkill(input: {
  candidate: SkillCandidate;
  files: Record<string, string | Buffer>;
}): QuarantineReport {
  const name = sanitizeSkillName(input.candidate.storageKey ?? input.candidate.name);
  if (input.candidate.classification?.classification === "blocked_security") {
    throw new Error("Breadboard policy blocks this skill from quarantine.");
  }
  const dir = ensureInside(quarantineRoot(), name);
  const fileEntries = Object.entries(input.files);
  if (fileEntries.length > MAX_SKILL_FILES) {
    throw new Error(`Skill exceeds the ${MAX_SKILL_FILES}-file quarantine limit`);
  }
  let totalBytes = 0;
  const normalizedPaths = new Set<string>();
  for (const [relPath, contents] of fileEntries) {
    if (!safeRelativePath(relPath)) {
      throw new Error(`Unsafe skill file path: ${relPath}`);
    }
    const normalized = relPath.replace(/\\/g, "/");
    if (normalizedPaths.has(normalized.toLowerCase())) {
      throw new Error(`Duplicate skill file path: ${relPath}`);
    }
    normalizedPaths.add(normalized.toLowerCase());
    const bytes = Buffer.isBuffer(contents) ? contents.byteLength : Buffer.byteLength(contents);
    if (bytes > MAX_SKILL_FILE_BYTES) {
      throw new Error("Skill contains a file larger than the quarantine limit");
    }
    totalBytes += bytes;
    if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
      throw new Error("Skill exceeds the total quarantine size limit");
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [relPath, contents] of fileEntries) {
    const target = ensureInside(dir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  const report = inspectFiles(name, dir, input.candidate);
  fs.writeFileSync(
    path.join(dir, QUARANTINE_MANIFEST),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  return report;
}

function safeRelativePath(value: string): boolean {
  if (!value || value.includes("\0") || path.isAbsolute(value) || /^[a-z]:/i.test(value)) return false;
  const parts = value.split(/[\\/]+/);
  return !parts.includes("..") && !parts.includes("") && !parts.includes(".");
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
    .map((file) => path.relative(dir, file))
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
  const classification = classifySkill({
    name: frontmatterName ?? name,
    description: candidate?.description,
    repository: candidate?.repository,
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
    exactVersion: candidate?.version ?? saved?.exactVersion,
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
  const effectiveClassification =
    options?.classificationOverride ?? report.classification.classification;
  if (
    effectiveClassification !== "eligible_general" &&
    effectiveClassification !== "eligible_coding_conditional"
  ) {
    throw new Error(
      "Refusing to promote a skill until Breadboard classifies it as eligible.",
    );
  }
  const source = ensureInside(quarantineRoot(), report.name);
  const destinationRoot =
    effectiveClassification === "eligible_coding_conditional"
      ? conditionalRoot()
      : approvedRoot();
  const target = ensureInside(destinationRoot, report.name);
  const otherTarget = ensureInside(
    effectiveClassification === "eligible_coding_conditional"
      ? approvedRoot()
      : conditionalRoot(),
    report.name,
  );
  if ((fs.existsSync(target) || fs.existsSync(otherTarget)) && !options?.overwrite)
    throw new Error("A skill with this name is already approved");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const operationId = crypto.randomUUID();
  const stagedTarget = ensureInside(destinationRoot, `${report.name}.promoting-${operationId}`);
  const targetBackup = ensureInside(destinationRoot, `${report.name}.backup-${operationId}`);
  const otherRoot = effectiveClassification === "eligible_coding_conditional"
    ? approvedRoot()
    : conditionalRoot();
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
      compatibleModes:
        effectiveClassification === "eligible_coding_conditional"
          ? ["scoped_implementation" as const]
          : [
              "knowledge" as const,
              "technical_read" as const,
              "scoped_implementation" as const,
            ],
      compatibleSurfaces:
        effectiveClassification === "eligible_coding_conditional"
          ? ["assistant" as const]
          : [
              "assistant" as const,
              "garden" as const,
              "quartz" as const,
              "document" as const,
            ],
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
