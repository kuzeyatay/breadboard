// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/execution/payloads/access-keys.ts; adapted for Breadboard.
import { collectUserFileKeys } from '@/lib/sim/core/core/utils/user-file'
import { collectLargeValueKeys } from '@/lib/sim/core/execution/payloads/large-execution-value'

export interface ExactAccessKeyContext {
  largeValueKeys?: string[]
  fileKeys?: string[]
}

export function mergeUniqueKeys(target: string[], source: readonly string[]): void {
  if (source.length === 0) {
    return
  }
  const existingKeys = new Set(target)
  for (const key of source) {
    if (!existingKeys.has(key)) {
      existingKeys.add(key)
      target.push(key)
    }
  }
}

export function mergeLargeValueKeys(context: ExactAccessKeyContext, keys: readonly string[]): void {
  if (keys.length === 0) {
    return
  }
  context.largeValueKeys ??= []
  mergeUniqueKeys(context.largeValueKeys, keys)
}

export function mergeFileKeys(context: ExactAccessKeyContext, keys: readonly string[]): void {
  if (keys.length === 0) {
    return
  }
  context.fileKeys ??= []
  mergeUniqueKeys(context.fileKeys, keys)
}

export function recordMaterializedAccessKeys(context: ExactAccessKeyContext, value: unknown): void {
  mergeLargeValueKeys(context, collectLargeValueKeys(value))
  mergeFileKeys(context, collectUserFileKeys(value))
}
