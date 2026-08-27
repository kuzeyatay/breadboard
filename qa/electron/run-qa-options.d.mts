export const PACKAGED_PARITY_PROJECT: "packaged-parity";
export const PACKAGED_PARITY_ENVIRONMENT: Readonly<{
  executablePath: "BREADBOARD_QA_PACKAGED_EXE";
  packageReceiptPath: "BREADBOARD_QA_PARITY_PACKAGE_RECEIPT_PATH";
  runId: "BREADBOARD_QA_PARITY_RUN_ID";
}>;

export interface QaRunnerOptions {
  readonly forwarded: readonly string[];
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly skipDesktopBuild: boolean;
  readonly dashboardMode: "hot" | "standalone";
  readonly packagedParity: boolean;
}

export interface PackagedParityHandoff {
  readonly executablePath: string;
  readonly packageReceiptPath: string;
  readonly runId: string;
}

export function parseQaRunnerOptions(options: {
  argv: readonly string[];
  baseEnv?: NodeJS.ProcessEnv;
  repoRoot: string;
}): QaRunnerOptions;

export function readPackagedParityHandoff(options: {
  env?: NodeJS.ProcessEnv;
  repoRoot: string;
}): PackagedParityHandoff;
