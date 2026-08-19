// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/lib/core/async-jobs/types.ts
// (AsyncExecutionCorrelation only); adapted for Breadboard. The Trigger.dev job
// plane around it was not vendored — the executor just carries this through metadata.

export type AsyncExecutionCorrelationSource = string;

export interface AsyncExecutionCorrelation {
  executionId: string;
  requestId: string;
  source: AsyncExecutionCorrelationSource;
  workflowId: string;
  copilotToolCallId?: string;
  triggerType?: string;
  webhookId?: string;
  scheduleId?: string;
  path?: string;
  provider?: string;
  scheduledFor?: string;
  tableId?: string;
  rowId?: string;
  groupId?: string;
  invokerWorkspaceId?: string;
}
