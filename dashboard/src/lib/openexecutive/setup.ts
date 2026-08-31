export const OPENEXECUTIVE_SETUP_ACTIONS = [
  {
    id: "install",
    label: "Build environment",
    unlocks: "Installs OpenExecutive and its Python dependencies into managed Runtime data.",
  },
  {
    id: "reinstall",
    label: "Repair",
    unlocks: "Reinstalls the managed Open Executive environment.",
  },
  {
    id: "remove",
    label: "Remove environment",
    unlocks: "Removes the managed environment without touching the cloned source.",
  },
] as const;
