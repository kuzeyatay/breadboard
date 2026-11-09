import { TASK_RECOVERY_INSTRUCTIONS } from "../hermes/task-recovery-policy.ts";
import type { SystemPromptDefinition } from "./types.ts";

export const COORDINATION_SYSTEM_PROMPTS: SystemPromptDefinition[] = [
  { id: "swarm-worker-results", title: "Team worker results", group: "Coordination", source: "dashboard/src/lib/swarm/worker-adapter.ts",
    description: "How a team worker reports its assignment. Runtime permissions and task criteria stay enforced separately.",
    defaultContent: "Return observed results, sources, artifact links, failed checks and remaining uncertainty. Do not launch another team or save findings as personal memory." },
  { id: "swarm-workflow-instructions", title: "Team workflow assignment", group: "Coordination", source: "dashboard/src/lib/swarm/worker-adapter.ts",
    description: "Instructions for a saved-workflow worker. Runtime variable: {{workflow_id}}.",
    defaultContent: "Run only saved workflow {{workflow_id}}. Report its execution receipt." },
  { id: "swarm-coordinator-update", title: "Team result review", group: "Coordination", source: "dashboard/src/lib/swarm/pump.ts",
    description: "Instructions when completed or blocked team work wakes the parent chat. Runtime variable: {{run_id}}.",
    defaultContent: "Use agent_launch with team_action=status and team_id={{run_id}} to inspect evidence. Verify every original acceptance criterion before accepting a result. Retry only a confirmed failure with a concrete correction. Awaiting approval is a user decision; do not approve it yourself. Stop when no independent work is ready. Use the existing results when synthesizing the answer." },
  { id: "swarm-catalog-guidance", title: "Team capability selection", group: "Coordination", source: "dashboard/src/lib/swarm/service.ts",
    description: "Guidance accompanying the team capability catalog.",
    defaultContent: "Use personas from the current Agency roster, saved workflow IDs from your inventory, and chat_send_message/chat_wait for peer chats. Interactive specialists retain their normal launch flow." },
  { id: "swarm-execution-guidance", title: "Team execution updates", group: "Coordination", source: "dashboard/src/lib/swarm/service.ts",
    description: "Guidance returned after a team action or status request.",
    defaultContent: "The server owns execution. End this turn while workers run. Results wake this conversation. Verify each original criterion against saved evidence; a completed worker alone is not proof of success." },
  { id: "task-recovery-instructions", title: "Unfinished task recovery", group: "Coordination", source: "dashboard/src/lib/hermes/task-recovery.ts",
    description: "Instructions for a scheduled recovery turn. Original requests, checkpoints, Stop and permission rules remain separate.",
    defaultContent: TASK_RECOVERY_INSTRUCTIONS },
];
