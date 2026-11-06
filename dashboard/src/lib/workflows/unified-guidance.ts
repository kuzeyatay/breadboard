import { type CapabilitySurface } from "../hermes/capability-combinations.ts";
import { runtimeAgentBrief } from "../hermes/runtime-agent-briefs.ts";
import {
  UNIFIED_AGENT_INPUT_REQUIREMENTS,
  unifiedWorkflowAgents,
  unifiedWorkflowById,
} from "./unified-catalog.ts";
import type { UnifiedWorkflowSelection } from "./unified-command.ts";

export function renderUnifiedWorkflowGuidance(
  selection: UnifiedWorkflowSelection,
  surface: CapabilitySurface,
): string {
  const workflow = unifiedWorkflowById(selection.workflowId);
  if (!workflow) return "";
  const mode = selection.modeId ? workflow.modes.find((item) => item.id === selection.modeId) : null;
  if (selection.modeId && !mode) return "";
  const agents = unifiedWorkflowAgents(workflow.id, { modeId: selection.modeId, surface });
  const lines = agents.map((agent) => {
    const brief = runtimeAgentBrief(agent.id);
    const input = UNIFIED_AGENT_INPUT_REQUIREMENTS[agent.id];
    const launch = agent.launchableByModel
      ? `Existing agent_launch is supported${agent.requiresLaunchApproval ? " with its normal launch approval" : ""}.`
      : "Manual specialist selection is required; do not invoke agent_launch for this agent.";
    return `- ${agent.name} (${agent.command}): ${brief ? `${brief.does}${brief.choose ? ` Choose it when: ${brief.choose}` : ""} ` : ""}${launch}${input ? ` Required input: ${input}` : ""}`;
  });
  return [
    `[Breadboard workflow: ${workflow.name}${mode ? ` / ${mode.name}` : ""}]`,
    mode?.description ?? workflow.description,
    "This selects a workflow over existing specialist agents, not a new runtime. Complete the user's task using the smallest suitable capability set. A simple answer need not launch an agent.",
    "When delegation is necessary, choose from the specialists below and carry the complete task and relevant conversation context. Respect the existing launch, attachment, surface, account and tool permission checks. Selection of this workflow does not authorize publishing, sending mail, trading, installations or new account access.",
    "Check actual readiness before claiming an agent can run. Report the concrete setup blocker; do not claim a result from a health response, empty retrieval or incomplete artifact. Do not silently change engines after a failed run or start duplicate work.",
    "Keep supplied attachments and selected skills/connections intact. When a specialist cannot receive them through agent_launch, keep them with the current turn and guide the user to its existing input form or direct command; never forward only the prose and discard the files. Existing native pickers remain required even when the chat has attachments.",
    "The user can select every specialist by name on the Agents page. An explicitly selected specialist takes precedence over a general workflow. Keep that specialist's run identity, status, artifacts and cancellation behavior.",
    ...(workflow.id === "research" ? ["Use Thorough research only when requested or needed for conflicting evidence; do not run every research participant for a simple lookup. Treat simulated-audience results as simulations, separate from retrieved evidence."] : []),
    ...(workflow.id === "markets" ? ["These specialists perform analysis, not trade execution. Preserve the distinction between instrument review, equity data and strategy/backtesting."] : []),
    ...(workflow.id === "design" ? ["Preserve the distinction between validated electronics, exact parametric geometry and reconstructed meshes. Use the matching output validation and export formats."] : []),
    lines.length ? "Specialists available on this surface:\n" + lines.join("\n")
      : "This mode has no specialist runner on the current surface. Explain where to open its existing workflow; do not fabricate a launch.",
  ].join("\n\n");
}
