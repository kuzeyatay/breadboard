// Closed setup catalog for Career Ops. The authenticated Runtime V2 setup job
// owns source staging, dependencies, browser downloads, and scaffolding.

export type SetupAction = "install" | "browsers" | "scaffold";

export const SETUP_ACTIONS: Array<{
  id: SetupAction;
  label: string;
  unlocks: string;
}> = [
  {
    id: "install",
    label: "Install dependencies",
    unlocks: "Everything career-ops does: evaluation, tracker, CVs, cover letters, reports.",
  },
  {
    id: "browsers",
    label: "Install the scanning browser",
    unlocks: "Portal scanning and reading a job description straight from its URL.",
  },
  {
    id: "scaffold",
    label: "Create the candidate files",
    unlocks:
      "config/profile.yml, modes/_profile.md and a starter cv.md, so the agent can judge fit against you rather than against nobody.",
  },
];
