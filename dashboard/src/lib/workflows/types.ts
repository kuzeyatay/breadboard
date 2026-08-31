export type LocalWorkflowSummary = {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string | null;
  nodeCount: number;
  source?: "canvas" | "demonstration";
  stepCount?: number;
  inputs?: Array<{
    name: string;
    label: string;
    type: "string" | "number" | "date" | "file" | "folder";
    required: boolean;
  }>;
};

export type WorkflowRunResponse = {
  workflow: LocalWorkflowSummary;
  executionId: string | null;
  status: "success" | "error" | "waiting" | "timeout";
  assistantContent: string;
};
