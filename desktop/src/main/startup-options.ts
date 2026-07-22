import * as path from "node:path";

const USER_DATA_PREFIX = "--breadboard-user-data-dir=";

export interface StartupOptions {
  forceDev: boolean;
  userDataDir: string | null;
}

export function parseStartupOptions(argv: string[]): StartupOptions {
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

  return {
    forceDev: argv.includes("--breadboard-dev"),
    userDataDir,
  };
}

