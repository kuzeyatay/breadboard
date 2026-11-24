// The assistant in the workflow editor holds chats keyed `workflow:<id>`. When a
// turn comes from one of those chats, Bread is told which workflow is on screen
// and what it currently contains, so "add a step that…" needs no lookup and no
// guessing which workflow "this" is.

import db from "../db.ts";
import { workflowStateToDefinition } from "./authoring.ts";
import { getWorkflow } from "./store.ts";

const MAX_DEFINITION_CHARS = 12_000;

/** The workflow a chat session belongs to, when it was opened from the workflow editor. */
export function openWorkflowIdForChat(chatSessionId: number): string | null {
  const row = db.prepare("SELECT page_key FROM chat_sessions WHERE id = ?").get(chatSessionId) as
    | { page_key?: string | null }
    | undefined;
  const match = /^workflow:([0-9a-f-]{36})$/i.exec(row?.page_key ?? "");
  return match ? match[1]! : null;
}

export function openWorkflowContext(chatSessionId: number, userId: number): string {
  const workflowId = openWorkflowIdForChat(chatSessionId);
  if (!workflowId) return "";
  const workflow = getWorkflow(userId, workflowId);
  if (!workflow) return "";
  if (workflow.source === "demonstration") {
    return [
      "# open_workflow",
      `The user has the workflow "${workflow.name}" (id ${workflow.id}) open. It was taught by demonstration, so it has recorded steps rather than blocks and cannot be edited with workflow_update; to change it the user re-teaches it.`,
    ].join("\n");
  }
  const definition = workflowStateToDefinition(workflow.state);
  let rendered = JSON.stringify({ name: workflow.name, description: workflow.description, steps: definition.steps, edges: definition.edges });
  if (rendered.length > MAX_DEFINITION_CHARS) {
    rendered = `${rendered.slice(0, MAX_DEFINITION_CHARS)}… (truncated; call workflow_update with action "get" for the full definition)`;
  }
  return [
    "# open_workflow",
    `The user is in the workflow editor with "${workflow.name}" (workflowId ${workflow.id}) open. "This workflow" means this one.`,
    "To change it, call workflow_update with this workflowId and the complete new definition (every step and edge you keep, plus your changes). The editor on screen reloads with your version.",
    "Current definition (a Start block carrying <start.input> is added automatically and is not listed):",
    rendered,
    definition.unsupported.length
      ? `Blocks that cannot be edited this way, and would be dropped by an update: ${definition.unsupported.join(", ")}. Tell the user before changing this workflow.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
