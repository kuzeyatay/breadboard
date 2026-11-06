import type { CommandHubItem } from "./commands.ts";
import type { CapabilityUse } from "./capability-usage.ts";

/** Only leading selectors are commands; slash-like text in prose is untouched. */
export function selectedSkillsInDraft(value: string, skills: readonly Pick<CommandHubItem, "id" | "token" | "name" | "slug">[]) {
  const byToken = new Map(skills.flatMap(skill => [
    [skill.token.toLowerCase(), skill] as const,
    [`skill:${skill.slug}`.toLowerCase(), skill] as const,
  ]));
  const selected = [];
  const seen = new Set<string>();
  let offset = value.length - value.trimStart().length;
  while (offset < value.length) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(value.slice(offset));
    if (!match) break;
    const skill = byToken.get(match[1].toLowerCase());
    if (skill && !seen.has(skill.id)) {
      selected.push({ ...skill, command: `/${match[1]}` });
      seen.add(skill.id);
    }
    offset += match[0].length;
  }
  return selected;
}

export function removeSkillFromDraft(value: string, skill: Pick<CommandHubItem, "token" | "slug">): string {
  const tokens = new Set([skill.token.toLowerCase(), `skill:${skill.slug}`.toLowerCase()]);
  let offset = value.length - value.trimStart().length;
  let result = value.slice(0, offset);
  while (offset < value.length) {
    const match = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i.exec(value.slice(offset));
    if (!match) break;
    if (!tokens.has(match[1].toLowerCase())) result += match[0];
    offset += match[0].length;
  }
  return result + value.slice(offset);
}

export function skillUseState(use: CapabilityUse): "used" | "loaded" | "failed" | "selected" {
  if (use.calls > 0) return use.failures >= use.calls ? "failed" : "used";
  return use.guidanceLoaded ? "loaded" : "selected";
}

const PERMISSION_LABELS: Record<string, string> = {
  "filesystem-read": "Read files in the allowed workspace",
  "filesystem-write": "Create or change files in the allowed workspace",
  "garden-read": "Read Garden content",
  "garden-propose": "Propose changes to your Garden",
  network: "Access the network",
  shell: "Run commands in the allowed workspace",
  "repository-read": "Read the connected repository",
  "repository-write": "Change files in the connected repository",
  "external-service": "Use an external service",
};

export function skillPermissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? permission;
}
