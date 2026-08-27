// Runtime V2's finite setup worker owns all executable and destructive setup
// actions. This dashboard module contains only the closed UI/action contract.

export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks:
      "Creates a managed environment and installs the agent, its data libraries and its API server.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the project into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks: "Stops the service and deletes its managed environment. Nothing in the clone is touched.",
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
