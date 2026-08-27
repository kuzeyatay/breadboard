export const SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks:
      "Creates MoneyPrinterTurbo/.venv and installs the video pipeline, its API server and its speech engine.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the pinned dependency set into the existing environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks:
      "Stops the service and deletes MoneyPrinterTurbo/.venv. Videos already made are artifacts and are not touched.",
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
