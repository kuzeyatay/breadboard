export const RESOURCE2SKILL_COMMAND = "/agents:resource2skill";
export const RESOURCE2SKILL_AGENT_ID = "resource2skill";
export const RESOURCE2SKILL_AGENT_NAME = "Resource2Skill";

export const RESOURCE2SKILL_DOMAINS = ["web", "ppt", "excel", "blender", "reaper"] as const;
export type Resource2SkillDomain = (typeof RESOURCE2SKILL_DOMAINS)[number];

export interface Resource2SkillRequest {
  domain: Resource2SkillDomain;
  task: string;
}

export function briefFromResource2SkillCommand(value: string): string | null {
  const match = /^\/agents:resource2skill(?:\s+([\s\S]*))?$/i.exec(value.trim());
  return match ? (match[1] ?? "").trim() : null;
}

export function parseResource2SkillBrief(brief: string): Resource2SkillRequest {
  const trimmed = brief.trim();
  const flag = /(?:^|\s)--domain(?:=|\s+)(web|ppt|excel|blender|reaper)(?=\s|$)/i.exec(trimmed);
  const task = flag ? `${trimmed.slice(0, flag.index)} ${trimmed.slice(flag.index + flag[0].length)}`.trim() : trimmed;
  if (flag) return { domain: flag[1].toLowerCase() as Resource2SkillDomain, task };
  if (/\b(deck|slides?|presentation|powerpoint|pptx?)\b/i.test(task)) return { domain: "ppt", task };
  if (/\b(workbook|spreadsheet|excel|xlsx|financial model|dashboard sheet)\b/i.test(task)) {
    return { domain: "excel", task };
  }
  if (/\b(blender|3d scene|\.blend|rendered scene|product scene)\b/i.test(task)) {
    return { domain: "blender", task };
  }
  if (/\b(song|music|audio track|soundtrack|reaper|wav|midi|bpm)\b/i.test(task)) {
    return { domain: "reaper", task };
  }
  return { domain: "web", task };
}

export function resource2SkillUserMessage(brief: string): string {
  return brief.trim() ? `${RESOURCE2SKILL_COMMAND} ${brief.trim()}` : RESOURCE2SKILL_COMMAND;
}
