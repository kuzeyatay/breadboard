import type { SuperAgentInventory } from '../hermes/super-agent.ts';
import { runtimeAgentBrief } from '../hermes/runtime-agent-briefs.ts';

/** A stable discovery index, not a reduced tool grant. Spoken turns retain the
 * same tools, skills, workers and approval checks as the full Breadboard chat. */
export function voiceCapabilitiesContext(inventory: SuperAgentInventory): string {
  const skills = [...inventory.skillSlugs].sort();
  const workers = [...inventory.runtimeAgents].sort((a, b) => a.id.localeCompare(b.id));
  const workflows = [...inventory.workflows].sort((a, b) => a.id.localeCompare(b.id));
  return [
    '# full_breadboard_capabilities',
    'Understand the requested subject before choosing a tool. Resolve references from this conversation; if a necessary person, place, object or prior answer is still unidentified, ask one brief clarifying question before any lookup. Do not search private history or the web to guess the missing subject. Answer directly from reliable supplied information and reasoning. Use the full Breadboard tool loop for current facts, genuinely missing evidence, private context the user requests, or actions. A short spoken reply does not mean reduced capabilities.',
    'Use an available tool directly. When a deferred tool is already named in these instructions, call tool_describe with that exact name if its parameters are unknown, then tool_call; do not search for a tool you already know. Use tool_search only to discover an unknown capability, then describe and call the match. Do not repeat a search once you have the needed name. Read the relevant procedure with skill_open before using a skill.',
    'Skills, direct tools, and workers are distinct capabilities. A skill being unselected, or a direct tool search returning no match, does not mean Breadboard lacks the capability. Check the worker descriptions below before declaring a task unavailable. When a worker supplies the missing capability, use agent_launch with its exact worker id; do not try to open that id as a skill. Include the complete request, relevant conversation evidence, project references, constraints, and required deliverables in its brief. Do not silently narrow the task to a spoken explanation.',
    'Choose a worker only for a capability you lack. agent_launch queues work; it is not a completed result. Honor the native confirmation and permission controls, keep the user informed briefly, and report completion only from the returned result. Form-only workers can be started only by the user through their command.',
    'For signed-in website actions, open breadboard-use and use breadboard_use with the existing browser session. Direct APIs and tools come first; computer use is a fallback only when permitted and necessary. For mailbox work use Inbox Zero; do not substitute unrelated website navigation. Never send, publish, purchase or modify data without the authorization required by the tools.',
    'Use agent_search to discover specialist personas. Use workflow_run for an existing saved workflow, workflow_create only when asked to create one, and workflow_propose for an unsolicited suggestion. Do not invent workflow IDs or unavailable connections.',
    skills.length ? `Installed skills (open by slug): ${skills.join(', ')}.` : '',
    inventory.connections.length ? `Connections: ${[...inventory.connections].sort().join(', ')}. Discover exact tool schemas on demand; a connection being installed is not evidence that it is online.` : '',
    'Workers:',
    ...workers.map(worker => {
      const brief = runtimeAgentBrief(worker.id);
      const label = worker.launchable
        ? `- ${worker.id}: ${worker.name}`
        : `- ${worker.command}: ${worker.name} (user form only)`;
      return [label, brief?.does, worker.launchable ? brief?.choose : undefined].filter(Boolean).join(' ');
    }),
    inventory.workflowsReachable
      ? ['Saved workflows:', ...workflows.map(workflow => `- ${workflow.id}: ${workflow.name}${workflow.active ? '' : ' (inactive)'}`)].join('\n')
      : 'The workflow catalog could not be read. Do not invent a saved workflow.',
  ].filter(Boolean).join('\n');
}
