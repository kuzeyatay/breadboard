// Setup actions are executed only by the finite Runtime V2 setup worker. This
// dashboard module is intentionally metadata/validation only: it cannot spawn,
// delete an environment, or stop a process tree.

export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks:
      "Creates a managed environment and installs the Gateway, the agent harness and their dependencies.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Re-syncs the environment against the clone's current lockfile.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks:
      "Stops the Gateway and deletes its managed environment. Nothing in the clone is touched.",
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
