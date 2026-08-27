// Compatibility-only type surface. Git execution moved to the sealed
// Runtime V2 worker in `scripts/runtime-v2-agent-edits-executor.mjs`.
// Product routes import `runtime-client.ts`; this module cannot start Git.

export {
  isSnapshotId,
  type AgentEditFile,
  type AgentEditStatus,
  type AgentEditsRef,
  type AgentEditsSummary,
  type AgentEditsUndoResult,
} from "./runtime-client.ts";
