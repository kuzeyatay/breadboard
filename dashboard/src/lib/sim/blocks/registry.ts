// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/blocks/registry.ts (simplified: Breadboard has no per-viewer
// block visibility/preview gating or custom-block overlay, so those layers are dropped); adapted for Breadboard.

import { BLOCK_META_REGISTRY, BLOCK_REGISTRY } from '@/lib/sim/blocks/registry-maps'
import type { BlockCategory, BlockConfig, BlockMeta, BlockTemplate, SuggestedSkill } from '@/lib/sim/blocks/types'

function normalizeType(type: string): string {
  return type.replace(/-/g, '_')
}

export function getBlock(type: string): BlockConfig | undefined {
  return BLOCK_REGISTRY[type] ?? BLOCK_REGISTRY[normalizeType(type)]
}

export function getAllBlocks(): BlockConfig[] {
  return Object.values(BLOCK_REGISTRY)
}

export function getBlockByToolName(toolName: string): BlockConfig | undefined {
  return Object.values(BLOCK_REGISTRY).find((b) => b.tools?.access?.includes(toolName))
}

export function getBlocksByCategory(category: BlockCategory): BlockConfig[] {
  return Object.values(BLOCK_REGISTRY).filter((block) => block.category === category)
}

export function getCanonicalBlocksByCategory(category: BlockCategory): BlockConfig[] {
  return getBlocksByCategory(category)
}

export function getAllBlockTypes(): string[] {
  return Object.keys(BLOCK_REGISTRY)
}

export function isValidBlockType(type: string): type is string {
  return type in BLOCK_REGISTRY || normalizeType(type) in BLOCK_REGISTRY
}

export function getBlockMeta(type: string): BlockMeta | undefined {
  const normalized = normalizeType(type)
  return BLOCK_META_REGISTRY[type] ?? BLOCK_META_REGISTRY[normalized]
}

export function getAllBlockMeta(): Record<string, BlockMeta> {
  return BLOCK_META_REGISTRY
}

export interface ScopedBlockTemplate extends BlockTemplate {
  otherBlockTypes: readonly string[]
  isOwner: boolean
}

export function getTemplatesForBlock(type: string): ScopedBlockTemplate[] {
  const base = normalizeType(type)
  const collected: ScopedBlockTemplate[] = []
  for (const [ownerType, meta] of Object.entries(BLOCK_META_REGISTRY)) {
    if (!meta.templates) continue
    const isOwnerMatch = normalizeType(ownerType) === base
    for (const template of meta.templates) {
      const isAlsoMatch = template.alsoIntegrations?.includes(base) || template.alsoIntegrations?.includes(type)
      if (!isOwnerMatch && !isAlsoMatch) continue
      const others: string[] = []
      if (!isOwnerMatch) others.push(normalizeType(ownerType))
      for (const also of template.alsoIntegrations ?? []) {
        const alsoBase = normalizeType(also)
        if (alsoBase !== base && !others.includes(alsoBase)) others.push(alsoBase)
      }
      collected.push({ ...template, otherBlockTypes: others, isOwner: isOwnerMatch })
    }
  }
  return collected
}

export function getSuggestedSkillsForBlock(type: string): readonly SuggestedSkill[] {
  const direct = getBlockMeta(type)?.skills
  if (direct && direct.length > 0) return direct
  const base = normalizeType(type)
  return BLOCK_META_REGISTRY[base]?.skills ?? []
}

export function getBlockRegistry(): Record<string, BlockConfig> {
  return BLOCK_REGISTRY
}

export type { BlockCategory }
