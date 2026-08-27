// Setup actions execute only in the finite Runtime V2 managed-setup worker.
// This dashboard module intentionally contains metadata and validation only.

export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks: "Installs the framework and its data libraries in a managed environment.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the framework into the existing managed environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks: "Deletes the managed TradingAgents environment.",
  },
] as const;

export type SetupActionId = (typeof SETUP_ACTIONS)[number]["id"];

export function isSetupAction(value: unknown): value is SetupActionId {
  return SETUP_ACTIONS.some((action) => action.id === value);
}

export interface SetupResult {
  ok: boolean;
  message: string;
  detail: string;
}

export class SetupError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SetupError";
  }
}
