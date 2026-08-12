import "server-only";

import { parse as parseFlatted } from "flatted";
import { RouteError } from "@/lib/server-auth";
import type { N8nSession } from "@/lib/workflows/n8n";
import { n8nJson } from "@/lib/workflows/n8n";
import type { LocalWorkflowSummary, WorkflowRunResponse } from "@/lib/workflows/types";

const MAX_CHAT_INPUT = 20_000;
const MAX_RESULT_CHARACTERS = 16_000;
const EXECUTION_TIMEOUT_MS = 90_000;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function workflowNodes(value: unknown): UnknownRecord[] {
  const workflow = record(value);
  return Array.isArray(workflow?.nodes)
    ? workflow.nodes.map(record).filter((node): node is UnknownRecord => Boolean(node))
    : [];
}

export function summarizeLocalWorkflow(value: unknown): LocalWorkflowSummary | null {
  const workflow = record(value);
  const id = stringValue(workflow?.id);
  const name = stringValue(workflow?.name);
  if (!workflow || !id || !name) return null;
  return {
    id,
    name,
    active: workflow.active === true,
    updatedAt: stringValue(workflow.updatedAt),
    nodeCount: workflowNodes(workflow).length,
  };
}

function enabledNodes(workflow: UnknownRecord): UnknownRecord[] {
  return workflowNodes(workflow).filter((node) => node.disabled !== true && stringValue(node.name));
}

function nodeName(node: UnknownRecord): string {
  return stringValue(node.name) ?? "";
}

function nodeType(node: UnknownRecord): string {
  return stringValue(node.type)?.toLowerCase() ?? "";
}

function connectedNodeNames(workflow: UnknownRecord, sourceName: string): string[] {
  const connections = record(workflow.connections);
  const source = record(connections?.[sourceName]);
  if (!source) return [];
  return Object.values(source).flatMap((outputs) =>
    Array.isArray(outputs)
      ? outputs.flatMap((branch) =>
          Array.isArray(branch)
            ? branch.map((edge) => stringValue(record(edge)?.node)).filter((name): name is string => Boolean(name))
            : [],
        )
      : [],
  );
}

function triggerPriority(node: UnknownRecord): number {
  const type = nodeType(node);
  if (type.includes("manualtrigger")) return 100;
  if (type.includes("chattrigger")) return 90;
  if (type.includes("webhook")) return 80;
  if (type.includes("formtrigger")) return 70;
  if (type.includes("scheduletrigger")) return 60;
  if (type.includes("trigger")) return 50;
  return 0;
}

function executionPath(workflow: UnknownRecord): { trigger: UnknownRecord; destination: UnknownRecord } {
  const nodes = enabledNodes(workflow);
  if (!nodes.length) throw new RouteError(409, "This automation has no enabled nodes to run.");
  const names = new Set(nodes.map(nodeName));
  const incoming = new Map(nodes.map((node) => [nodeName(node), 0]));
  for (const node of nodes) {
    for (const target of connectedNodeNames(workflow, nodeName(node))) {
      if (names.has(target)) incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }
  const trigger = [...nodes].sort((left, right) => {
    const priority = triggerPriority(right) - triggerPriority(left);
    if (priority) return priority;
    return (incoming.get(nodeName(left)) ?? 0) - (incoming.get(nodeName(right)) ?? 0);
  })[0];

  const byName = new Map(nodes.map((node) => [nodeName(node), node]));
  const depth = new Map<string, number>([[nodeName(trigger), 0]]);
  const queue = [nodeName(trigger)];
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    const sourceDepth = depth.get(source) ?? 0;
    for (const target of connectedNodeNames(workflow, source)) {
      if (!byName.has(target) || depth.has(target)) continue;
      const nextDepth = sourceDepth + 1;
      depth.set(target, nextDepth);
      queue.push(target);
    }
  }
  const destinationName = [...depth.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? nodeName(trigger);
  return { trigger, destination: byName.get(destinationName) ?? trigger };
}

function inputTaskData(input: string) {
  const normalized = input.trim().slice(0, MAX_CHAT_INPUT);
  return {
    source: [],
    data: {
      main: [[{
        json: {
          source: "breadboard-chat",
          chatInput: normalized,
          text: normalized,
          query: normalized,
        },
        pairedItem: { item: 0 },
      }]],
    },
    executionTime: 0,
    executionStatus: "success",
    executionIndex: 0,
    startTime: Date.now(),
  };
}

function executionData(execution: UnknownRecord): UnknownRecord | null {
  if (typeof execution.data === "string") {
    try {
      return record(parseFlatted(execution.data));
    } catch {
      return null;
    }
  }
  return record(execution.data);
}

function executionError(execution: UnknownRecord): string {
  const data = executionData(execution);
  const error = record(record(data?.resultData)?.error);
  return stringValue(error?.message)
    ?? stringValue(error?.description)
    ?? "The automation stopped before it produced a result.";
}

function outputItems(execution: UnknownRecord): unknown[] {
  const data = executionData(execution);
  const resultData = record(data?.resultData);
  const runData = record(resultData?.runData);
  if (!runData) return [];
  const preferred = stringValue(resultData?.lastNodeExecuted);
  const names = preferred && preferred in runData
    ? [preferred]
    : Object.keys(runData).reverse();
  for (const name of names) {
    const runs = Array.isArray(runData[name]) ? runData[name] as unknown[] : [];
    const last = record(runs.at(-1));
    const dataByType = record(last?.data);
    if (!dataByType) continue;
    const items = Object.values(dataByType).flatMap((outputs) =>
      Array.isArray(outputs)
        ? outputs.flatMap((branch) => Array.isArray(branch) ? branch : [])
        : [],
    );
    const json = items
      .map((item) => record(item)?.json)
      .filter((item) => item !== undefined);
    if (json.length) return json.slice(0, 20);
  }
  return [];
}

function markdownResult(workflowName: string, items: unknown[]): string {
  if (!items.length) return `**${workflowName}** finished successfully. It did not return any chat-visible data.`;
  const only = items.length === 1 ? items[0] : items;
  if (typeof only === "string") return `**${workflowName}** finished.\n\n${only.slice(0, MAX_RESULT_CHARACTERS)}`;
  const value = JSON.stringify(only, null, 2) ?? String(only);
  const clipped = value.length > MAX_RESULT_CHARACTERS
    ? `${value.slice(0, MAX_RESULT_CHARACTERS)}\n… output shortened by Breadboard`
    : value;
  return `**${workflowName}** finished.\n\n\`\`\`json\n${clipped.replaceAll("```", "` ` `")}\n\`\`\``;
}

function terminalStatus(execution: UnknownRecord): "success" | "error" | null {
  const status = stringValue(execution.status)?.toLowerCase();
  if (["error", "crashed", "canceled"].includes(status ?? "")) return "error";
  if (status === "success" || execution.finished === true) return "success";
  return null;
}

async function waitForExecution(executionId: string, session: N8nSession): Promise<UnknownRecord | null> {
  const deadline = Date.now() + EXECUTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const execution = record(await n8nJson(`/rest/executions/${encodeURIComponent(executionId)}`, {
      method: "GET",
      session,
    }));
    if (execution && terminalStatus(execution)) return execution;
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  return null;
}

export async function runLocalWorkflow(
  workflowValue: unknown,
  input: string,
  session: N8nSession,
): Promise<WorkflowRunResponse> {
  const workflow = record(workflowValue);
  const summary = summarizeLocalWorkflow(workflow);
  if (!workflow || !summary) throw new RouteError(404, "This automation no longer exists.");
  const { trigger, destination } = executionPath(workflow);
  const taskData = inputTaskData(input);
  const triggerName = nodeName(trigger);
  const destinationName = nodeName(destination);
  const payload = destinationName === triggerName
    ? { triggerToStartFrom: { name: triggerName, data: taskData } }
    : {
        runData: { [triggerName]: [taskData] },
        destinationNode: { nodeName: destinationName, mode: "inclusive" },
      };
  const started = record(await n8nJson(`/rest/workflows/${encodeURIComponent(summary.id)}/run`, {
    method: "POST",
    session,
    body: JSON.stringify(payload),
  }));
  if (started?.waitingForWebhook === true) {
    return {
      workflow: summary,
      executionId: null,
      status: "waiting",
      assistantContent: `**${summary.name}** is waiting for its webhook or form input. Open its settings to finish that trigger.`,
    };
  }
  const executionId = stringValue(started?.executionId);
  if (!executionId) throw new RouteError(502, "n8n did not return an execution for this automation.");
  const execution = await waitForExecution(executionId, session);
  if (!execution) {
    return {
      workflow: summary,
      executionId,
      status: "timeout",
      assistantContent: `**${summary.name}** is still running in n8n. Open its settings to inspect execution ${executionId}.`,
    };
  }
  if (terminalStatus(execution) === "error") {
    return {
      workflow: summary,
      executionId,
      status: "error",
      assistantContent: `**${summary.name}** could not finish.\n\n${executionError(execution)}`,
    };
  }
  return {
    workflow: summary,
    executionId,
    status: "success",
    assistantContent: markdownResult(summary.name, outputItems(execution)),
  };
}
