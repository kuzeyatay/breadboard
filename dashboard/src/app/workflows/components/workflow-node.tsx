"use client";

// The React Flow `workflowBlock` node type: resolves every prop the vendored
// WorkflowBlockView needs from the local stores, so the pure renderer stays
// store-free. Modeled on sim's editor workflow-block.tsx container, pared
// down to what a single-tenant local canvas actually needs (no diff mode, no
// webhook/schedule/child-workflow badges, no execution highlighting yet).

import { memo, useCallback, useMemo } from "react";
import type { NodeProps } from "reactflow";
import {
  SubBlockRowView,
  WorkflowBlockView,
  WORKFLOW_SOURCE_HANDLE_ID,
} from "@/lib/sim/workflow-renderer";
import {
  resolveBlockConfig,
  resolveOptions,
  showsDefaultHandles,
  isConditionMet,
  type CanvasSubBlockConfig,
} from "../lib/registry";
import { useSubBlockStore } from "../stores/subblock-store";
import { useWorkflowStore, wouldCreateCycle } from "../stores/workflow-store";

export type WorkflowNodeData = {
  type: string;
};

function displayValue(subBlock: CanvasSubBlockConfig, raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (subBlock.type === "switch") return raw ? "On" : "Off";
  if (Array.isArray(raw)) return raw.length ? `${raw.length} items` : undefined;
  if (typeof raw === "object") return "Configured";
  const text = String(raw);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function conditionRowsFor(blockId: string, value: unknown): { id: string; title: string; value: string }[] {
  let parsed: Array<{ id?: string; value?: string }> = [];
  if (Array.isArray(value)) parsed = value as never;
  else if (typeof value === "string") {
    try {
      const candidate = JSON.parse(value);
      if (Array.isArray(candidate)) parsed = candidate;
    } catch {
      // fall through to default rows
    }
  }
  if (parsed.length) {
    return parsed.map((item, index) => ({
      id: item.id ?? `${blockId}-cond-${index}`,
      title: index === 0 ? "if" : index === parsed.length - 1 ? "else" : "else if",
      value: typeof item.value === "string" ? item.value : "",
    }));
  }
  return [
    { id: `${blockId}-if`, title: "if", value: "" },
    { id: `${blockId}-else`, title: "else", value: "" },
  ];
}

export const WorkflowNode = memo(function WorkflowNode({ id, data, selected }: NodeProps<WorkflowNodeData>) {
  const block = useWorkflowStore((state) => state.blocks[id]);
  const edges = useWorkflowStore((state) => state.edges);
  const setSelectedBlock = useWorkflowStore((state) => state.setSelectedBlock);
  const setErrorEnabled = useWorkflowStore((state) => state.setErrorEnabled);
  const values = useSubBlockStore((state) => state.values[id] ?? {});

  const config = useMemo(() => resolveBlockConfig(data.type), [data.type]);
  const wouldCreateConnectionCycle = useCallback(
    (source: string, target: string) => wouldCreateCycle(edges, source, target),
    [edges],
  );

  if (!block || !config) return null;

  const shouldShowDefaultHandles = showsDefaultHandles(config, block.type);
  const visibleSubBlocks = config.subBlocks.filter(
    (sub) => !sub.hidden && sub.context !== "tool-input" && isConditionMet(sub.condition, values),
  );

  const conditionRows = block.type === "condition" ? conditionRowsFor(id, values.conditions) : [];
  const routerRows: { id: string; value: string }[] = [];

  const rows =
    block.type === "condition" || block.type === "router_v2" ? null : (
      <>
        {visibleSubBlocks
          .filter((sub) => sub.id !== "conditions" && sub.id !== "routes")
          .slice(0, 4)
          .map((sub) => (
            <SubBlockRowView key={sub.id} title={sub.title ?? sub.id} displayValue={displayValue(sub, values[sub.id])} />
          ))}
      </>
    );

  const hasContentBelowHeader =
    block.type === "condition" ||
    block.type === "router_v2" ||
    visibleSubBlocks.some((sub) => sub.id !== "conditions" && sub.id !== "routes") ||
    shouldShowDefaultHandles;

  return (
    <WorkflowBlockView
      id={id}
      type={block.type}
      name={block.name}
      isEnabled={block.enabled !== false}
      isLocked={Boolean(block.locked)}
      hasRing={Boolean(selected)}
      ringStyles={selected ? "ring-2 ring-[var(--text-secondary)]" : ""}
      Icon={config.icon}
      iconBgColor={config.bgColor}
      horizontalHandles={block.horizontalHandles !== false}
      shouldShowDefaultHandles={shouldShowDefaultHandles}
      hasContentBelowHeader={hasContentBelowHeader}
      conditionRows={conditionRows}
      routerRows={routerRows}
      wouldCreateConnectionCycle={wouldCreateConnectionCycle}
      onSelect={() => setSelectedBlock(id)}
      rows={rows}
      typeLabel={config.canvasPresentation?.typeLabel}
      hasErrorConnection={edges.some((edge) => edge.source === id && edge.sourceHandle === "error")}
      errorOutputEnabled={Boolean(block.errorEnabled)}
      onToggleErrorOutput={(enabled) => setErrorEnabled(id, enabled)}
    />
  );
});

export const WORKFLOW_NODE_SOURCE_HANDLE = WORKFLOW_SOURCE_HANDLE_ID;
