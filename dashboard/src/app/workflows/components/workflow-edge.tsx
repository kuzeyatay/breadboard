"use client";

// The React Flow `workflowEdge` edge type: wraps the vendored WorkflowEdgeView
// with the run/diff state the pure renderer expects. Diff mode does not exist
// in this local editor, so diffStatus is always null; runStatus/isWorkflowRunning
// come from the run-drawer's last result while a run is in flight.

import { memo } from "react";
import type { EdgeProps } from "reactflow";
import { WorkflowEdgeView } from "@/lib/sim/workflow-renderer";
import { useRunStore } from "../stores/run-store";
import { useWorkflowStore } from "../stores/workflow-store";

export const WorkflowEdge = memo(function WorkflowEdge(props: EdgeProps) {
  const selectedEdgeId = useWorkflowStore((state) => state.selectedEdgeId);
  const removeEdge = useWorkflowStore((state) => state.removeEdge);
  const isRunning = useRunStore((state) => state.status === "running");
  const blockStatus = useRunStore((state) => state.blockStatus);

  const targetStatus = blockStatus[props.target];
  const sourceStatus = blockStatus[props.source];
  const runStatus = sourceStatus === "error" ? "error" : sourceStatus === "success" ? "success" : undefined;

  return (
    <WorkflowEdgeView
      {...props}
      data={{ ...(props.data ?? {}), isSelected: props.id === selectedEdgeId, onDelete: removeEdge }}
      diffStatus={null}
      runStatus={runStatus}
      isPreviewRun={false}
      isWorkflowRunning={isRunning}
      isTargetActive={targetStatus === "running" || targetStatus === "success" || targetStatus === "error"}
      isConnectedToSelection={false}
    />
  );
});
