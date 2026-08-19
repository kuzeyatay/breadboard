// Breadboard stand-in for sim's stores/providers/store.ts (simstudioai/sim, Apache-2.0).
// Sim's real store tracks per-provider connection state (API keys, discovered
// Ollama models) for the canvas UI. Only referenced from `blocks/utils.ts`
// subblock-condition helpers, which run in the browser canvas — never from the
// server executor — so a static empty snapshot is enough to keep it type-safe
// headlessly. Breadboard has exactly one provider ("breadboard"/ChatMock), so
// there is nothing meaningful to track here.

interface ProviderState {
  models: string[]
  hasApiKey?: boolean
}

interface ProvidersState {
  providers: Record<string, ProviderState> & { ollama: ProviderState }
}

const EMPTY_STATE: ProvidersState = {
  providers: new Proxy(
    { ollama: { models: [] } },
    { get: (target, key) => (target as Record<string, ProviderState>)[key as string] ?? { models: [] } }
  ) as ProvidersState['providers'],
}

export const useProvidersStore = {
  getState(): ProvidersState {
    return EMPTY_STATE
  },
}
