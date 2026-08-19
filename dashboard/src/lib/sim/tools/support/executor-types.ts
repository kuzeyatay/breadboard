// Vendored from simstudioai/sim (Apache-2.0), apps/sim/executor/types.ts —
// adapted for Breadboard: only the two types the tools tree imports. The full
// executor context lives in sim's engine and is not needed to run a tool.

export interface UserFile {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
  key: string;
  context?: string;
  base64?: string;
  /** Provider Files API handle (OpenAI/Anthropic `file_...` id) set when a large file is uploaded instead of inlined as base64. */
  providerFileId?: string;
  /** Provider File API uri (Gemini `fileUri`) set when a large file is uploaded instead of inlined as base64. */
  providerFileUri?: string;
  /** Short-lived signed HTTPS URL passed to providers that fetch attachments by remote URL instead of inlining base64. */
  remoteUrl?: string;
}

/** Minimal stand-in for sim's ExecutionContext; tools only read identifiers. */
export interface ExecutionContext {
  workflowId?: string;
  workspaceId?: string;
  executionId?: string;
  userId?: string;
  [key: string]: unknown;
}
