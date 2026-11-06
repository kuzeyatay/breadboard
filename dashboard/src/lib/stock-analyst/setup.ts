// Runtime V2's finite setup worker owns all executable and destructive setup
// actions. This dashboard module contains only the closed UI/action contract.

export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Set up Stock Analyst",
    unlocks:
      "Installs Stock Analyst and its market-data tools.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the required tools.",
  },
  {
    id: "remove",
    label: "Remove installed tools",
    unlocks:
      "Stops Stock Analyst and removes its installed tools. Your other files are kept.",
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
