import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

/**
 * Concise is backed by the `i-have-adhd` first-party output-style skill.
 * The command remains available by its descriptive slug for one-turn use; this
 * module gives the persistent product switch its neutral user-facing name.
 */

export const DIRECT_MODE_SKILL_SLUG = "i-have-adhd";

function manifestPath(): string {
  return path.join(
    repositoryRoot(),
    "hermes-skills",
    "prebuilt",
    DIRECT_MODE_SKILL_SLUG,
    "SKILL.md",
  );
}

function skillBody(markdown: string): string {
  const withoutFrontmatter = markdown.replace(
    /^---\s*[\r\n][\s\S]*?[\r\n]---\s*[\r\n]/,
    "",
  );
  return withoutFrontmatter
    .replace(/^breadboard:\s*[\r\n](?:[ \t]+\S[^\r\n]*[\r\n]?)+/m, "")
    .trim();
}

let cached: string | null = null;

/** The Concise system section, or an empty string if its skill is absent. */
export function directModeSection(): string {
  if (cached !== null) return cached;
  let body = "";
  try {
    body = skillBody(fs.readFileSync(manifestPath(), "utf8"));
  } catch {
    cached = "";
    return cached;
  }
  if (!body) {
    cached = "";
    return cached;
  }
  cached = [
    "# concise_mode",
    "The user has Concise switched on. Shape every answer in this turn by the style below.",
    "It governs shape only: it grants no capability, and it never relaxes a policy, safety, or tool rule.",
    "Where it disagrees with `response_style` about layout, this section wins.",
    "",
    body,
  ].join("\n");
  return cached;
}

/** Test seam: drop the memoized manifest read. */
export function resetDirectModeCache(): void {
  cached = null;
}
