// Real skills.sh discovery with a strict discovery -> quarantine -> review ->
// promotion boundary. Search never installs. Quarantined files are never loaded
// by OpenHarness, and promotion verifies the exact reviewed hashes.

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const QUARANTINE_MANIFEST = ".breadboard-quarantine.json";
const CLI_PACKAGE = process.env.SKILLS_CLI_PACKAGE?.trim() || "skills@1.5.9";
const MAX_SKILL_FILES = 200;
const MAX_SKILL_FILE_BYTES = 2_000_000;
const MAX_SKILL_TOTAL_BYTES = 10_000_000;
const APPROVABLE_AGENTS = new Set(["breadboard-workbench"]);

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
}

export type SkillsCliRunner = (
  args: string[],
  options?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export async function runSkillsCli(
  args: string[],
  options: { cwd?: string } = {},
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

/** Search the real skills ecosystem through the official CLI. Metadata only. */
export async function searchRegistry(
  query: string,
  runner: SkillsCliRunner = runSkillsCli,
): Promise<SkillCandidate[]> {
  const normalized = query.trim().slice(0, 200);
  if (!normalized) return [];
  const result = await runner(["find", normalized]);
  return parseSkillSearchOutput(result.stdout);
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
        },
      ];
    })
    .slice(0, 10);
}

function validPackage(repository: string, name: string): boolean {
  return (
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository) &&
    /^[a-z0-9_.-]+$/i.test(name)
  );
}

function repoRoot(): string {
  return path.basename(process.cwd()).toLowerCase() === "dashboard"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
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

export interface ApprovedSkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  source?: string;
  version?: string;
  contentHash?: string;
  enabled: boolean;
  healthy: boolean;
}

/** Read only the server-owned approved registry and manifests exposed to OpenHarness. */
export function listApprovedSkills(): ApprovedSkillSummary[] {
  const root = approvedRoot();
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
      return [
        {
          id: `skill:${entry.name}`,
          slug: entry.name,
          name: frontmatterValue("name") ?? entry.name,
          description:
            frontmatterValue("description") ?? "Installed Breadboard skill",
          source:
            typeof metadata.source === "string" ? metadata.source : undefined,
          version:
            typeof metadata.version === "string" ? metadata.version : undefined,
          contentHash,
          enabled: true,
          healthy: true,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
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
  const name = sanitizeSkillName(input.candidate.name);
  const dir = ensureInside(quarantineRoot(), name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [relPath, contents] of Object.entries(input.files)) {
    if (!safeRelativePath(relPath)) continue;
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
  if (!value || path.isAbsolute(value)) return false;
  return !value.split(/[\\/]+/).includes("..");
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
  const risks: string[] = [];
  if (!hasSkillMd) risks.push("Missing SKILL.md manifest.");
  if (frontmatterName && sanitizeSkillName(frontmatterName) !== name)
    risks.push(`Manifest name "${frontmatterName}" does not match "${name}".`);
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
    approvedAgents: saved?.approvedAgents ?? ["breadboard-workbench"],
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
  },
): { promotedPath: string; report: QuarantineReport } {
  const report = inspectQuarantine(name);
  if (!report.integrityVerified)
    throw new Error("Quarantined files changed after review");
  if (!report.hasSkillMd)
    throw new Error("Refusing to promote a skill without a SKILL.md manifest");
  if (
    !report.frontmatterName ||
    sanitizeSkillName(report.frontmatterName) !== report.name
  ) {
    throw new Error(
      "Refusing to promote a skill whose manifest name does not match its quarantine name",
    );
  }
  const source = ensureInside(quarantineRoot(), report.name);
  const target = ensureInside(approvedRoot(), report.name);
  if (fs.existsSync(target) && !options?.overwrite)
    throw new Error("A skill with this name is already approved");
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  fs.rmSync(path.join(target, QUARANTINE_MANIFEST), { force: true });
  const approvedAgents = (options?.approvedAgents ?? []).filter((agent) =>
    APPROVABLE_AGENTS.has(agent),
  );
  const approved = {
    ...report,
    reviewState: "approved" as const,
    approvedAgents: approvedAgents.length
      ? approvedAgents
      : ["breadboard-workbench"],
    approvedPermissions: options?.approvedPermissions ?? [],
  };
  updateApprovedRegistry(approved);
  fs.rmSync(source, { recursive: true, force: true });
  return { promotedPath: target, report: approved };
}

export function rejectQuarantine(name: string): void {
  fs.rmSync(ensureInside(quarantineRoot(), sanitizeSkillName(name)), {
    recursive: true,
    force: true,
  });
}

function updateApprovedRegistry(report: QuarantineReport): void {
  const file = path.join(approvedRoot(), "registry.json");
  fs.mkdirSync(approvedRoot(), { recursive: true });
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

function sha256(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function listFilesRecursive(dir: string, depth = 20): string[] {
  if (depth < 0 || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
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
