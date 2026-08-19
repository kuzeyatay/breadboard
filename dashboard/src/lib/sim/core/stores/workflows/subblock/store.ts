// Breadboard stand-in for sim's stores/workflows/subblock/store.ts (simstudioai/sim,
// Apache-2.0). A Zustand store holding per-block subblock values on the editor canvas.
// Only reached from `blocks/blocks/agent.ts` option-condition helpers, which run in the
// browser, never the server executor — headless, it reports no stored values.

interface SubBlockState {
  workflowValues: Record<string, Record<string, Record<string, unknown>>>;
  getValue(blockId: string, subBlockId: string): unknown;
}

export const useSubBlockStore = {
  getState(): SubBlockState {
    return {
      workflowValues: {},
      getValue: () => null,
    };
  },
};
