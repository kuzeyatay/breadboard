// Breadboard stand-in for sim's lib/execution/payloads/store.ts (simstudioai/sim,
// Apache-2.0). Sim's version durably persists oversized execution values to blob
// storage plus a Postgres ownership row, for values too big to keep in the
// process cache. Breadboard has neither, so `storeLargeValue` never durably
// offloads — it registers the value in the same in-process cache
// (core/execution/payloads/cache.ts) the executor already reads through
// `materializeLargeValueRefSync`, and lets the caller's existing
// keep-inline-on-failure fallback (executor/variables/resolver.ts) take over
// once the process-local cache also can't hold it.

import { generateId } from '@/lib/sim/core/utils/id'
import { cacheLargeValue, materializeLargeValueRefSync } from '@/lib/sim/core/execution/payloads/cache'
import { LARGE_VALUE_REF_VERSION, type LargeValueKind, type LargeValueRef } from '@/lib/sim/core/execution/payloads/large-value-ref'

export interface LargeValueStoreContext {
  workspaceId?: string
  workflowId?: string
  executionId?: string
  /** Executions whose stored values this caller may read. Sim enforces it against the
   * durable ownership row; with only the process-local cache there is nothing to scope,
   * but callers still pass it and the field must survive them. */
  largeValueExecutionIds?: string[]
  largeValueKeys?: string[]
  fileKeys?: string[]
  allowLargeValueWorkflowScope?: boolean
  userId?: string
  requireDurable?: boolean
  maxBytes?: number
  /** When false, materialization does not register a log reference for the key. */
  trackReference?: boolean
}

function getKind(value: unknown): LargeValueKind {
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return 'string'
  return 'object'
}

function getPreview(value: unknown): string {
  const json = typeof value === 'string' ? value : JSON.stringify(value)
  return (json ?? '').slice(0, 200)
}

export async function storeLargeValue(
  value: unknown,
  json: string,
  size: number,
  context: LargeValueStoreContext
): Promise<LargeValueRef> {
  const id = `lv_${generateId()}`
  const cached = cacheLargeValue(id, value, size, context, { recoverable: false })
  if (!cached) {
    throw new Error('Cannot retain large execution value without durable storage')
  }
  return {
    __simLargeValueRef: true,
    version: LARGE_VALUE_REF_VERSION,
    id,
    kind: getKind(value),
    size,
    key: undefined,
    executionId: context.executionId,
    preview: getPreview(value),
  }
}

export async function materializeLargeValueRef(
  ref: LargeValueRef,
  context?: LargeValueStoreContext
): Promise<unknown> {
  return materializeLargeValueRefSync(ref, context)
}
