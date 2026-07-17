// Skill discovery, quarantine, inspection, and promotion.
//
// Dynamic skill discovery/installation is available ONLY to the dashboard
// terminal and capability scout (never garden/quartz). A downloaded skill is
// NEVER auto-executed and NEVER auto-installed. The lifecycle is:
//
//   search → (user asks) → quarantine download → inspect files/manifest/risks →
//   (user approves) → promote into the approved skills dir → agents updated.
//
// Every decision is recorded in an auditable store. All filesystem writes are
// confined to the quarantine/approved roots with canonicalized, sanitized paths.

import fs from "node:fs";
import path from "node:path";

export interface SkillCandidate {
  name: string;
  description: string;
  source: string;
  version?: string;
  requestedCommands: string[];
  requestedDependencies: string[];
  requestedNetwork: boolean;
  requestedFilesystem: boolean;
}

// A small curated registry. In production this can be augmented with an external
// registry URL (SKILL_REGISTRY_URL); the curated set is the trusted default.
const CURATED_REGISTRY: SkillCandidate[] = [
  {
    name: "pdf-extract",
    description: "Extract text and tables from PDF files for analysis.",
    source: "https://skills.example.com/pdf-extract",
    version: "1.0.0",
    requestedCommands: ["pdftotext"],
    requestedDependencies: ["pdf-parse"],
    requestedNetwork: false,
    requestedFilesystem: true,
  },
  {
    name: "sql-explain",
    description: "Explain and analyze SQL query plans.",
    source: "https://skills.example.com/sql-explain",
    version: "0.3.1",
    requestedCommands: [],
    requestedDependencies: [],
    requestedNetwork: false,
    requestedFilesystem: false,
  },
];

export function searchRegistry(query: string): SkillCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return CURATED_REGISTRY.slice(0, 10);
  return CURATED_REGISTRY.filter(
    (candidate) =>
      candidate.name.toLowerCase().includes(q) || candidate.description.toLowerCase().includes(q),
  ).slice(0, 10);
}

// --- Roots ----------------------------------------------------------------

function repoRoot(): string {
  // dashboard runs from the dashboard package dir; skills live at the repo root.
  return path.resolve(process.cwd(), "..");
}
export function quarantineRoot(): string {
  return process.env.OPENHARNESS_SKILLS_QUARANTINE ?? path.join(repoRoot(), "openharness-skills", "quarantine");
}
export function approvedRoot(): string {
  return process.env.OPENHARNESS_SKILLS_APPROVED ?? path.join(repoRoot(), ".agents", "skills");
}

export function sanitizeSkillName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!cleaned) throw new Error("Invalid skill name");
  return cleaned;
}

function ensureInside(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, target);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the skills root");
  }
  return resolved;
}

// --- Quarantine -----------------------------------------------------------

export interface QuarantineReport {
  name: string;
  files: string[];
  hasSkillMd: boolean;
  frontmatterName?: string;
  requestedCommands: string[];
  requestedDependencies: string[];
  requestedNetwork: boolean;
  requestedFilesystem: boolean;
  nameCollision: boolean;
  risks: string[];
}

/**
 * Write a candidate's files into quarantine (no execution) and produce an
 * inspection report. `files` is a map of relative path → contents; the download
 * itself (fetching from a registry URL) is done by the route and passed here so
 * this stays testable and side-effect-bounded.
 */
export function quarantineSkill(input: {
  candidate: SkillCandidate;
  files: Record<string, string>;
}): QuarantineReport {
  const name = sanitizeSkillName(input.candidate.name);
  const dir = ensureInside(quarantineRoot(), name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const written: string[] = [];
  for (const [relPath, contents] of Object.entries(input.files)) {
    // Reject absolute paths / traversal in provided file names.
    if (relPath.includes("..") || path.isAbsolute(relPath)) continue;
    const target = ensureInside(dir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, "utf8");
    written.push(relPath);
  }

  return inspectQuarantine(name, input.candidate);
}

export function inspectQuarantine(name: string, candidate?: SkillCandidate): QuarantineReport {
  const safeName = sanitizeSkillName(name);
  const dir = ensureInside(quarantineRoot(), safeName);
  if (!fs.existsSync(dir)) throw new Error("Skill is not in quarantine");

  const files = listFilesRecursive(dir).map((file) => path.relative(dir, file));
  const skillMdPath = path.join(dir, "SKILL.md");
  const hasSkillMd = fs.existsSync(skillMdPath);
  const frontmatterName = hasSkillMd ? parseSkillName(fs.readFileSync(skillMdPath, "utf8")) : undefined;

  const risks: string[] = [];
  if (!hasSkillMd) risks.push("Missing SKILL.md manifest.");
  if (frontmatterName && frontmatterName !== safeName) {
    risks.push(`Manifest name "${frontmatterName}" does not match "${safeName}".`);
  }
  // Scan files for suspicious content.
  for (const rel of files) {
    if (/\.(sh|bash|ps1|bat|cmd)$/i.test(rel)) risks.push(`Contains a script file: ${rel}`);
    const full = path.join(dir, rel);
    try {
      const contents = fs.readFileSync(full, "utf8");
      if (/curl\s|wget\s|rm\s+-rf|child_process|eval\(/i.test(contents)) {
        risks.push(`Suspicious command pattern in ${rel}`);
      }
    } catch {
      // Binary or unreadable file — flag it.
      risks.push(`Unreadable/binary file: ${rel}`);
    }
  }

  const nameCollision = fs.existsSync(ensureInside(approvedRoot(), safeName));
  if (nameCollision) risks.push("A skill with this name is already approved (name collision).");

  return {
    name: safeName,
    files,
    hasSkillMd,
    frontmatterName,
    requestedCommands: candidate?.requestedCommands ?? [],
    requestedDependencies: candidate?.requestedDependencies ?? [],
    requestedNetwork: candidate?.requestedNetwork ?? false,
    requestedFilesystem: candidate?.requestedFilesystem ?? false,
    nameCollision,
    risks,
  };
}

/**
 * Promote a quarantined skill into the approved skills dir. Requires that the
 * skill passed inspection (has a valid SKILL.md and no name collision unless
 * `overwrite`). Never executes anything.
 */
export function promoteSkill(name: string, options?: { overwrite?: boolean }): { promotedPath: string } {
  const safeName = sanitizeSkillName(name);
  const source = ensureInside(quarantineRoot(), safeName);
  if (!fs.existsSync(source)) throw new Error("Skill is not in quarantine");
  if (!fs.existsSync(path.join(source, "SKILL.md"))) {
    throw new Error("Refusing to promote a skill without a SKILL.md manifest");
  }
  const target = ensureInside(approvedRoot(), safeName);
  if (fs.existsSync(target) && !options?.overwrite) {
    throw new Error("A skill with this name is already approved");
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  // Clear quarantine after promotion.
  fs.rmSync(source, { recursive: true, force: true });
  return { promotedPath: target };
}

export function rejectQuarantine(name: string): void {
  const safeName = sanitizeSkillName(name);
  const dir = ensureInside(quarantineRoot(), safeName);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- helpers --------------------------------------------------------------

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function parseSkillName(markdown: string): string | undefined {
  const match = markdown.match(/^---\s*[\r\n]([\s\S]*?)[\r\n]---/);
  if (!match) return undefined;
  const nameLine = match[1].split(/\r?\n/).find((line) => line.trim().startsWith("name:"));
  return nameLine ? nameLine.split(":")[1]?.trim() : undefined;
}
