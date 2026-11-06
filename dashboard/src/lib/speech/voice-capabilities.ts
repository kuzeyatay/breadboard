import type { SuperAgentInventory } from '../hermes/super-agent.ts';

/** A stable discovery index, not a reduced tool grant. Spoken turns retain the
 * same tools, skills, workers and approval checks as the full Breadboard chat. */
export function voiceCapabilitiesContext(inventory: SuperAgentInventory): string {
  const skills = [...inventory.skillSlugs].sort();
  const workers = [...inventory.runtimeAgents].sort((a, b) => a.id.localeCompare(b.id));
  const workflows = [...inventory.workflows].sort((a, b) => a.id.localeCompare(b.id));
  return [
    '# full_breadboard_capabilities',
    'Use the full Breadboard tool loop when this conversation needs information, a calculation, private context or an action. Answer directly when the conversation already supplies what you need. A short spoken reply does not mean reduced capabilities.',
    'Use an available tool directly. If the needed tool is deferred, use tool_search, then tool_describe for its exact arguments and tool_call to run it. Search for the capability the request needs, not the wording of a previous example. Read the relevant procedure with skill_open before using a skill.',
    'Choose a worker only for a capability you lack. agent_launch queues work; it is not a completed result. Honor the native confirmation and permission controls, keep the user informed briefly, and report completion only from the returned result. Form-only workers can be started only by the user through their command.',
    'For signed-in website actions, open breadboard-use and use breadboard_use with the existing browser session. Direct APIs and tools come first; computer use is a fallback only when permitted and necessary. For mailbox work use Inbox Zero; do not substitute unrelated website navigation. Never send, publish, purchase or modify data without the authorization required by the tools.',
    'Use agent_search to discover specialist personas. Use workflow_run for an existing saved workflow, workflow_create only when asked to create one, and workflow_propose for an unsolicited suggestion. Do not invent workflow IDs or unavailable connections.',
    skills.length ? `Installed skills (open by slug): ${skills.join(', ')}.` : '',
    inventory.connections.length ? `Connections: ${[...inventory.connections].sort().join(', ')}. Discover exact tool schemas on demand; a connection being installed is not evidence that it is online.` : '',
    'Workers:',
    ...workers.map(worker => worker.launchable
      ? `- ${worker.id}: ${worker.name}`
      : `- ${worker.command}: ${worker.name} (user form only)`),
    inventory.workflowsReachable
      ? ['Saved workflows:', ...workflows.map(workflow => `- ${workflow.id}: ${workflow.name}${workflow.active ? '' : ' (inactive)'}`)].join('\n')
      : 'The workflow catalog could not be read. Do not invent a saved workflow.',
  ].filter(Boolean).join('\n');
}
