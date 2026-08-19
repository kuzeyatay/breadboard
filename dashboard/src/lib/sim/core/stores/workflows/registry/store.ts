// Breadboard stand-in for sim's stores/workflows/registry/store.ts (simstudioai/sim,
// Apache-2.0). Only reached from `blocks/blocks/agent.ts` subblock-condition
// helpers, which run in the browser canvas, never the server executor.

interface WorkflowRegistryState {
  activeWorkflowId: string | null
}

export const useWorkflowRegistry = {
  getState(): WorkflowRegistryState {
    return { activeWorkflowId: null }
  },
}
