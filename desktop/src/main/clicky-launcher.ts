import * as fs from "node:fs";
import * as path from "node:path";

import type {
  ClickyLaunchResult,
  ClickyLauncherState,
} from "../shared/ipc-contract";

const CLICKY_BUNDLE_NAME = "Clicky.app";
const CLICKY_PROJECT_RELATIVE_PATH = path.join(
  "clicky",
  "leanring-buddy.xcodeproj",
);

export interface ClickyLauncherOptions {
  platform: NodeJS.Platform;
  appRoot: string;
  resourcesRoot: string;
  homeDirectory: string;
  configuredApplicationPath?: string;
  openPath: (applicationPath: string) => Promise<string>;
  launchWindowsCompanion?: () => Promise<void>;
}

export interface ClickyLauncher {
  state(): ClickyLauncherState;
  launch(): Promise<ClickyLaunchResult>;
  openProject(): Promise<ClickyLaunchResult>;
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isClickyApplicationBundle(candidate: string): boolean {
  return (
    path.basename(candidate).toLocaleLowerCase() ===
      CLICKY_BUNDLE_NAME.toLocaleLowerCase() &&
    isDirectory(candidate) &&
    isDirectory(path.join(candidate, "Contents")) &&
    fs.existsSync(path.join(candidate, "Contents", "MacOS", "Clicky"))
  );
}

/**
 * Xcode's default output lives outside the checkout under DerivedData. Inspect
 * only the project-level directories and the two ordinary product folders;
 * finding a local development build must not become a recursive home scan.
 */
function derivedDataCandidates(homeDirectory: string): string[] {
  const derivedDataRoot = path.join(
    homeDirectory,
    "Library",
    "Developer",
    "Xcode",
    "DerivedData",
  );
  let projectDirectories: fs.Dirent[];
  try {
    projectDirectories = fs.readdirSync(derivedDataRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return projectDirectories.flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const name = entry.name.toLocaleLowerCase();
    if (!name.startsWith("leanring-buddy-") && !name.startsWith("clicky-")) {
      return [];
    }
    const products = path.join(derivedDataRoot, entry.name, "Build", "Products");
    return [
      path.join(products, "Debug", CLICKY_BUNDLE_NAME),
      path.join(products, "Release", CLICKY_BUNDLE_NAME),
    ];
  });
}

function uniqueResolvedPaths(candidates: readonly string[]): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    const absolute = path.resolve(candidate);
    const key = process.platform === "win32" ? absolute.toLocaleLowerCase() : absolute;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(absolute);
  }
  return resolved;
}

function applicationCandidates(options: ClickyLauncherOptions): string[] {
  return uniqueResolvedPaths([
    options.configuredApplicationPath ?? "",
    path.join(options.resourcesRoot, "clicky", CLICKY_BUNDLE_NAME),
    path.join(options.resourcesRoot, "app-services", "clicky", CLICKY_BUNDLE_NAME),
    path.join(options.appRoot, "clicky", CLICKY_BUNDLE_NAME),
    path.join(options.appRoot, "clicky", "build", "Debug", CLICKY_BUNDLE_NAME),
    path.join(options.appRoot, "clicky", "build", "Release", CLICKY_BUNDLE_NAME),
    ...derivedDataCandidates(options.homeDirectory),
    path.join(options.homeDirectory, "Applications", CLICKY_BUNDLE_NAME),
    path.join(path.parse(options.homeDirectory).root, "Applications", CLICKY_BUNDLE_NAME),
  ]);
}

function projectCandidates(options: ClickyLauncherOptions): string[] {
  return uniqueResolvedPaths([
    path.join(options.appRoot, CLICKY_PROJECT_RELATIVE_PATH),
    path.join(options.resourcesRoot, CLICKY_PROJECT_RELATIVE_PATH),
    path.join(
      options.resourcesRoot,
      "app-services",
      CLICKY_PROJECT_RELATIVE_PATH,
    ),
  ]);
}

function resolvedClicky(options: ClickyLauncherOptions): {
  applicationPath: string | null;
  projectPath: string | null;
} {
  return {
    applicationPath:
      applicationCandidates(options).find(isClickyApplicationBundle) ?? null,
    projectPath: projectCandidates(options).find(isDirectory) ?? null,
  };
}

function launcherState(options: ClickyLauncherOptions): ClickyLauncherState {
  if (options.platform === "win32") {
    const available = typeof options.launchWindowsCompanion === "function";
    return {
      supported: true,
      available,
      projectAvailable: false,
      status: available ? "ready" : "not_found",
      message: available
        ? "Clicky is ready to open as a floating Windows companion."
        : "Restart Breadboard with the updated desktop shell to use Clicky on Windows.",
    };
  }
  if (options.platform !== "darwin") {
    return {
      supported: false,
      available: false,
      projectAvailable: false,
      status: "unsupported",
      message: "Clicky is available on Windows and macOS.",
    };
  }

  const resolved = resolvedClicky(options);
  if (resolved.applicationPath) {
    return {
      supported: true,
      available: true,
      projectAvailable: resolved.projectPath !== null,
      status: "ready",
      message: "Clicky is ready to launch into the macOS menu bar.",
    };
  }
  if (resolved.projectPath) {
    return {
      supported: true,
      available: false,
      projectAvailable: true,
      status: "not_built",
      message: "Build Clicky once in Xcode, then Breadboard can launch it.",
    };
  }
  return {
    supported: true,
    available: false,
    projectAvailable: false,
    status: "not_found",
    message: "Breadboard could not find the Clicky app or its Xcode project.",
  };
}

function result(
  ok: boolean,
  code: ClickyLaunchResult["code"],
  message: string,
  state: ClickyLauncherState,
): ClickyLaunchResult {
  return { ok, code, message, state };
}

export function createClickyLauncher(
  options: ClickyLauncherOptions,
): ClickyLauncher {
  return {
    state: () => launcherState(options),
    async launch() {
      const state = launcherState(options);
      if (!state.supported) {
        return result(false, "unsupported", state.message, state);
      }
      if (options.platform === "win32") {
        if (!options.launchWindowsCompanion) {
          return result(false, "not_found", state.message, state);
        }
        try {
          await options.launchWindowsCompanion();
          return result(true, "launched", "Clicky opened. Use its microphone or type a question.", state);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return result(false, "launch_failed", `Clicky could not launch: ${reason}`, state);
        }
      }
      const applicationPath = resolvedClicky(options).applicationPath;
      if (!applicationPath) {
        return result(
          false,
          state.status === "not_built" ? "not_built" : "not_found",
          state.message,
          state,
        );
      }
      try {
        const errorMessage = await options.openPath(applicationPath);
        if (errorMessage) {
          return result(
            false,
            "launch_failed",
            `Clicky could not launch: ${errorMessage}`,
            state,
          );
        }
        return result(
          true,
          "launched",
          "Clicky launched. Look for it in the macOS menu bar.",
          state,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return result(
          false,
          "launch_failed",
          `Clicky could not launch: ${reason}`,
          state,
        );
      }
    },
    async openProject() {
      const state = launcherState(options);
      if (options.platform === "win32") {
        return result(false, "not_found", "Clicky is built into Breadboard on Windows. Use Launch Clicky.", state);
      }
      if (!state.supported) {
        return result(false, "unsupported", state.message, state);
      }
      const projectPath = resolvedClicky(options).projectPath;
      if (!projectPath) {
        return result(false, "not_found", state.message, state);
      }
      try {
        const errorMessage = await options.openPath(projectPath);
        if (errorMessage) {
          return result(
            false,
            "project_open_failed",
            `The Clicky project could not open: ${errorMessage}`,
            state,
          );
        }
        return result(
          true,
          "project_opened",
          "The Clicky project opened in Xcode. Build and run it once to finish setup.",
          state,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return result(
          false,
          "project_open_failed",
          `The Clicky project could not open: ${reason}`,
          state,
        );
      }
    },
  };
}
