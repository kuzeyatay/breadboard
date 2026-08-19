// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/executor/handlers/function/function-handler.ts; adapted for Breadboard.
import { normalizeSecretMountPolicy } from '@/lib/sim/core/copilot/secret-mount-policy'
import { getRemainingExecutionMs } from '@/lib/sim/core/core/execution-limits'
import {
  normalizeRecord,
  normalizeStringRecord,
  normalizeWorkflowVariables,
} from '@/lib/sim/core/core/utils/records'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/sim/core/execution/constants'
import { DEFAULT_CODE_LANGUAGE } from '@/lib/sim/core/execution/languages'
import { mergeFileKeys, mergeLargeValueKeys } from '@/lib/sim/core/execution/payloads/access-keys'
import { BlockType } from '@/lib/sim/executor/constants'
import type { BlockHandler, ExecutionContext } from '@/lib/sim/executor/types'
import { collectBlockData } from '@/lib/sim/executor/utils/block-data'
import {
  FUNCTION_BLOCK_CONTEXT_VARS_KEY,
  FUNCTION_BLOCK_DISPLAY_CODE_KEY,
} from '@/lib/sim/executor/variables/resolver'
import type { SerializedBlock } from '@/lib/sim/serializer/types'
import { executeTool } from '@/lib/sim/tools/engine-bridge'

function readCodeContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        entry && typeof entry === 'object' && typeof entry.content === 'string' ? entry.content : ''
      )
      .join('\n')
  }

  return undefined
}

/**
 * Handler for Function blocks that execute custom code.
 */
export class FunctionBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.FUNCTION
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<any> {
    const codeContent = readCodeContent(inputs.code) ?? inputs.code
    const sourceCode =
      readCodeContent(inputs[FUNCTION_BLOCK_DISPLAY_CODE_KEY]) ??
      readCodeContent((block.config?.params as Record<string, unknown> | undefined)?.code)

    const { blockNameMapping, blockOutputSchemas } = collectBlockData(ctx)

    const contextVariables = normalizeRecord(inputs[FUNCTION_BLOCK_CONTEXT_VARS_KEY])
    const requestedTimeout =
      typeof inputs.timeout === 'number' && Number.isFinite(inputs.timeout) && inputs.timeout > 0
        ? inputs.timeout
        : undefined
    const remainingExecutionMs = getRemainingExecutionMs(ctx.abortSignal)
    const timeout =
      remainingExecutionMs === undefined
        ? (requestedTimeout ?? DEFAULT_EXECUTION_TIMEOUT_MS)
        : Math.max(
            1,
            requestedTimeout === undefined
              ? remainingExecutionMs
              : Math.min(requestedTimeout, remainingExecutionMs)
          )
    const secretMountPolicy =
      inputs.secretScope === undefined
        ? undefined
        : normalizeSecretMountPolicy({
            secretScope: inputs.secretScope,
            mountedSecrets: inputs.mountedSecrets,
          })

    const toolParams = {
      code: codeContent,
      ...(sourceCode ? { sourceCode } : {}),
      language: inputs.language || DEFAULT_CODE_LANGUAGE,
      timeout,
      ...(inputs.sandboxId ? { sandboxId: inputs.sandboxId } : {}),
      ...(secretMountPolicy ?? {}),
      envVars: normalizeStringRecord(ctx.environmentVariables),
      workflowVariables: normalizeWorkflowVariables(ctx.workflowVariables),
      blockData: {},
      blockNameMapping,
      blockOutputSchemas,
      contextVariables,
      _context: {
        workflowId: ctx.workflowId,
        workspaceId: ctx.workspaceId,
        executionId: ctx.executionId,
        largeValueExecutionIds: ctx.largeValueExecutionIds,
        largeValueKeys: ctx.largeValueKeys,
        fileKeys: ctx.fileKeys,
        allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
        userId: ctx.userId,
        isDeployedContext: ctx.isDeployedContext,
        enforceCredentialAccess: ctx.enforceCredentialAccess,
      },
    }

    const result = await executeTool('function_execute', toolParams, { executionContext: ctx })

    if (!result.success) {
      throw new Error(result.error || 'Function execution failed')
    }

    mergeLargeValueKeys(ctx, result.largeValueKeys ?? [])
    mergeFileKeys(ctx, result.fileKeys ?? [])

    return result.output
  }
}
