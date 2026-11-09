import { renderSystemPrompt, systemPromptText } from "./service.ts";

/** Keep assignment data outside editable instructions and resolve for its owner. */
export function swarmWorkerPrompt(userId: number, input: { assignment: string; acceptance: string[]; workflowId?: string }): string {
  return `Assignment: ${input.assignment}\n\nCompletion criteria:\n${input.acceptance.map(item => `- ${item}`).join("\n")}\n` +
    (input.workflowId ? renderSystemPrompt("swarm-workflow-instructions", userId, { workflow_id: input.workflowId }) + "\n" : "") +
    systemPromptText("swarm-worker-results", userId);
}

export function swarmCoordinatorPrompt(userId: number, input: { runId: string; objective: string; updates: string }): string {
  return `Team ${input.runId} has an update for: ${input.objective}\n${input.updates}\n\n` +
    renderSystemPrompt("swarm-coordinator-update", userId, { run_id: input.runId });
}

export function swarmToolGuidance(userId: number, phase: "catalog" | "execution"): string {
  return systemPromptText(phase === "catalog" ? "swarm-catalog-guidance" : "swarm-execution-guidance", userId);
}
