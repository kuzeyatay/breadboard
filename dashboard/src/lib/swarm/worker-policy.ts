import type { CapabilityDecision } from "../hermes/capability-policy.ts";
import type { SwarmAuthority, SwarmExecutor } from "./types.ts";

export interface SwarmWorkerScope { runId: string; taskKey: string; attemptId: string; authority: SwarmAuthority; executor: SwarmExecutor }
const ORCHESTRATION = new Set(["agent_launch", "delegate_task", "chat_send", "chat_send_message", "chat_wait", "messaging_send", "save_memory"]);

export function workerToolAllowed(scope: SwarmWorkerScope, tool: string): boolean {
  if (ORCHESTRATION.has(tool) || !scope.authority.allowedTools.includes(tool)) return false;
  if (scope.executor.kind === "native") return [scope.executor.id, "skill_open", "read", "glob", "grep"].includes(tool);
  if (scope.executor.kind === "workflow") return ["workflow_run", "read", "glob", "grep"].includes(tool);
  return true;
}

export function restrictSwarmWorkerDecision(decision: CapabilityDecision, scope: SwarmWorkerScope): void {
  const parent = scope.authority.capability;
  if (!parent) throw new Error("The assignment has no sealed capability ceiling.");
  decision.allowedTools = decision.allowedTools.filter(tool => workerToolAllowed(scope, tool));
  decision.allowedOperations = decision.allowedOperations.filter(operation => parent.allowedOperations.includes(operation));
  decision.selectedConnections = decision.selectedConnections.filter(connection => parent.selectedConnections.includes(connection));
  decision.selectedConditionalSkills = decision.selectedConditionalSkills.filter(skill => parent.selectedConditionalSkills.includes(skill));
  // Keep exact parent grants; a worker's own planner can narrow them but never
  // manufacture a new root, wildcard, delete target or command allowance.
  decision.authorizedRoots = decision.authorizedRoots.filter(root => parent.authorizedRoots.includes(root));
  decision.authorizedPathPatterns = decision.authorizedPathPatterns.filter(pattern => parent.authorizedPathPatterns.includes(pattern));
  decision.authorizedDeleteTargets = (decision.authorizedDeleteTargets ?? []).filter(target => (parent.authorizedDeleteTargets ?? []).includes(target));
  decision.allowedCommandPatterns = decision.allowedCommandPatterns.filter(pattern => parent.allowedCommandPatterns.includes(pattern));
}
