// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/tools/function/types.ts; adapted for Breadboard.
// `__privateSecretProvenance` is typed loosely here (sim's PrivateSecretProvenanceBundleV1):
// Breadboard's function block never populates it — the vm.createContext sandbox
// (core/execution/vm-sandbox.ts) has no secret-provenance tracking to project.

import type { CodeLanguage } from '@/lib/sim/core/execution/languages'
import type { ToolResponse } from '@/lib/sim/tools/types'

export interface CodeExecutionInput {
  code: Array<{ content: string; id: string }> | string
  sourceCode?: string
  language?: CodeLanguage
  useLocalVM?: boolean
  timeout?: number
  memoryLimit?: number
  title?: string
  outputPath?: string
  outputFormat?: 'json' | 'csv' | 'txt' | 'md' | 'html'
  outputTable?: string
  outputSandboxPath?: string
  outputMimeType?: string
  overwriteFileId?: string
  inputs?: {
    files?: Array<{ path: string; sandboxPath?: string }>
    directories?: Array<{ path: string; sandboxPath?: string }>
    tables?: Array<{ path?: string; tableId?: string; sandboxPath?: string }>
  }
  outputs?: {
    files?: Array<{
      path: string
      mode: 'create' | 'overwrite'
      sandboxPath?: string
      format?: 'json' | 'csv' | 'txt' | 'md' | 'html'
      mimeType?: string
    }>
  }
  sandboxId?: string
  secretScope?: 'all' | 'selected'
  mountedSecrets?: string[]
  envVars?: Record<string, string>
  workflowVariables?: Record<string, unknown>
  blockData?: Record<string, unknown>
  blockNameMapping?: Record<string, string>
  blockOutputSchemas?: Record<string, Record<string, unknown>>
  contextVariables?: Record<string, unknown>
  _context?: {
    workflowId?: string
    executionId?: string
    largeValueExecutionIds?: string[]
    largeValueKeys?: string[]
    fileKeys?: string[]
    allowLargeValueWorkflowScope?: boolean
    userId?: string
    workspaceId?: string
    copilotToolExecution?: boolean
  }
  isCustomTool?: boolean
  _sandboxFiles?: Array<
    | { type?: 'content'; path: string; content: string; encoding?: 'base64' }
    | { type: 'url'; path: string; url: string }
  >
  __privateSecretProvenance?: unknown
}

export interface CodeExecutionOutput extends ToolResponse {
  output: {
    result: any
    stdout: string
  }
}
