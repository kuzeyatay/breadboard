// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/handlers/agent/skills-resolver.ts; adapted for Breadboard.
// Sim resolves workspace skills from Postgres; Breadboard keeps only the builtin
// catalog, so DB-backed skills resolve to nothing and builtins still work.

import { getBuiltinSkillById, getBuiltinSkillByName } from '@/lib/sim/core/workflows/skills/builtin-skills'

interface SkillInput {
  skillId: string
}

export interface SkillMetadata {
  name: string
  description: string
}

export async function resolveSkillMetadata(
  skillInputs: SkillInput[],
  workspaceId: string
): Promise<SkillMetadata[]> {
  if (!skillInputs.length || !workspaceId) return []
  const metadata: SkillMetadata[] = []
  for (const input of skillInputs) {
    const builtin = getBuiltinSkillById(input.skillId)
    if (builtin) metadata.push({ name: builtin.name, description: builtin.description })
  }
  return metadata
}

export async function resolveSkillContent(
  skillName: string,
  workspaceId: string
): Promise<{ name: string; content: string } | null> {
  if (!skillName || !workspaceId) return null
  const builtin = getBuiltinSkillByName(skillName)
  return builtin ? { name: builtin.name, content: builtin.content } : null
}

export async function resolveSkillContentById(
  skillId: string,
  workspaceId: string
): Promise<{ name: string; content: string } | null> {
  if (!skillId || !workspaceId) return null
  const builtin = getBuiltinSkillById(skillId)
  return builtin ? { name: builtin.name, content: builtin.content } : null
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Build the system prompt section that lists available skills.
 */
export function buildSkillsSystemPromptSection(skills: SkillMetadata[]): string {
  if (!skills.length) return ''

  const skillEntries = skills
    .map(
      (s) =>
        `  <skill name="${escapeXml(s.name)}">\n    <description>${escapeXml(s.description)}</description>\n  </skill>`
    )
    .join('\n')

  return [
    '',
    'You have access to the following skills. Use the load_skill tool to activate a skill when relevant.',
    '',
    '<available_skills>',
    skillEntries,
    '</available_skills>',
  ].join('\n')
}

/**
 * Build the load_skill tool definition for injection into the tools array.
 */
export function buildLoadSkillTool(skillNames: string[]) {
  return {
    id: 'load_skill',
    name: 'load_skill',
    description: `Load a skill to get specialized instructions. Available skills: ${skillNames.join(', ')}`,
    params: {},
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'Name of the skill to load',
          enum: skillNames,
        },
      },
      required: ['skill_name'],
    },
  }
}
