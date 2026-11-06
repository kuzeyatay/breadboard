// Setup actions are executed only by the finite Runtime V2 setup worker. This
// dashboard module is intentionally metadata/validation only: it cannot spawn,
// delete an environment, or stop a process tree.

export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Set up DeerFlow",
    unlocks:
      "Installs the tools DeerFlow needs.",
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
      "Stops DeerFlow and removes its installed tools. Your other files are kept.",
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
