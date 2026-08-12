export type LocalWorkflowSummary = {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string | null;
  nodeCount: number;
};

export type WorkflowRunResponse = {
  workflow: LocalWorkflowSummary;
  executionId: string | null;
  status: "success" | "error" | "waiting" | "timeout";
  assistantContent: string;
};
