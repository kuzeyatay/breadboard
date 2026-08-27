export interface OnboardingState {
  /** True until the user layer (cv.md, profile.yml, _profile.md) exists. */
  onboardingNeeded: boolean;
  /** Which user-layer files are still missing, as career-ops names them. */
  missing: string[];
  /** Non-blocking notes doctor wants surfaced (MCP config, CLI detection). */
  warnings: string[];
  /** Mode templates doctor copied into place during the probe. */
  autoCopied: string[];
}

export interface CareerOpsHealth {
  available: boolean;
  /** The clone exists, even when its dependencies are not installed. */
  cloned: boolean;
  root: string | null;
  /** node_modules is present, so the scripts can actually run. */
  dependenciesInstalled: boolean;
  /** Playwright's chromium download is present — only portal scanning needs it. */
  browsersInstalled: boolean;
  onboarding: OnboardingState | null;
  /** How many router modes the clone publishes. */
  modeCount: number;
  /** Applications currently in data/applications.md, or null when there is none. */
  trackedApplications: number | null;
  reason: string | null;
}
