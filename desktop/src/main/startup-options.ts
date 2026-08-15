import * as path from "node:path";

const USER_DATA_PREFIX = "--breadboard-user-data-dir=";
const QA_ARGUMENT = "--breadboard-qa";

export type QaServiceProfile = "critical";

export interface StartupOptions {
  forceDev: boolean;
  userDataDir: string | null;
  /** QA-only Chromium download target derived beside the isolated userData. */
  qaDownloadsDir: string | null;
  /**
   * Explicitly gated development-only QA mode. It keeps application code in
   * the checkout while routing every mutable path through userData.
   */
  qaMode: boolean;
  qaServiceProfile: QaServiceProfile;
}

export function parseStartupOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): StartupOptions {
  const userDataArgs = argv.filter((value) => value.startsWith(USER_DATA_PREFIX));
  if (userDataArgs.length > 1) {
    throw new Error("Only one --breadboard-user-data-dir argument is allowed");
  }

  let userDataDir: string | null = null;
  const argument = userDataArgs[0];
  if (argument) {
    const raw = argument.slice(USER_DATA_PREFIX.length).trim();
    if (!raw || !path.isAbsolute(raw)) {
      throw new Error("--breadboard-user-data-dir must be an absolute path");
    }
    const resolved = path.resolve(raw);
    if (resolved === path.parse(resolved).root) {
      throw new Error("--breadboard-user-data-dir cannot be a filesystem root");
    }
    userDataDir = resolved;
  }

  const forceDev = argv.includes("--breadboard-dev");
  const qaArgument = argv.includes(QA_ARGUMENT);
  const qaEnvironment = env["BREADBOARD_QA_MODE"] === "1";
  if (qaArgument !== qaEnvironment) {
    throw new Error(
      "QA mode requires both --breadboard-qa and BREADBOARD_QA_MODE=1",
    );
  }
  if (qaArgument && !forceDev) {
    throw new Error("QA mode requires --breadboard-dev");
  }
  if (qaArgument && !userDataDir) {
    throw new Error("QA mode requires --breadboard-user-data-dir=<absolute-path>");
  }

  const requestedProfile = env["BREADBOARD_QA_SERVICE_PROFILE"]?.trim().toLowerCase();
  if (qaArgument && requestedProfile && requestedProfile !== "critical") {
    throw new Error(
      'BREADBOARD_QA_SERVICE_PROFILE must be "critical"; broader profiles are blocked until every optional runtime has an isolated mutable-data contract',
    );
  }

  return {
    forceDev,
    userDataDir,
    qaDownloadsDir: qaArgument
      ? path.join(path.dirname(userDataDir!), "downloads")
      : null,
    qaMode: qaArgument,
    qaServiceProfile: "critical",
  };
}
