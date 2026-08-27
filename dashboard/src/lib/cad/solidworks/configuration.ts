// Process-free SolidWorks installation and bridge probes. This module is safe
// for passive dashboard health/status paths: it never imports child_process,
// touches COM, or starts the Runtime-owned bridge.

import fs from "node:fs";
import path from "node:path";
import { solidworksInstallPath, solidworksPaths, solidworksVersionHint } from "./config.ts";
import type { SolidWorksAvailability } from "./status.ts";

export function solidWorksPythonDependenciesInstalled(python: string): boolean {
  if (process.platform !== "win32") return false;
  const scripts = path.dirname(python);
  const environment = path.dirname(scripts);
  const siteRoot = path.join(environment, "Lib", "site-packages");
  return (
    fs.existsSync(path.join(siteRoot, "fastmcp")) &&
    fs.existsSync(path.join(siteRoot, "win32com"))
  );
}

export function inspectSolidWorksConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): SolidWorksAvailability {
  const base = { clonePath: null, running: null, version: null } as const;
  if (process.platform !== "win32") {
    return {
      ...base,
      available: false,
      code: "unsupported_os",
      message:
        "SolidWorks backend unavailable: SolidWorks runs on Windows only, and this machine is not Windows.",
      running: false,
    };
  }

  const paths = solidworksPaths(env);
  if (!paths.clone) {
    return {
      ...base,
      available: false,
      code: "mcp_not_configured",
      message:
        paths.cloneSource === "env"
          ? "SolidWorks backend unavailable: BREADBOARD_SOLIDWORKS_MCP_PATH does not point at a SolidworksMCP-python checkout."
          : "SolidWorks backend unavailable: configure BREADBOARD_SOLIDWORKS_MCP_PATH with the path to your SolidworksMCP-python checkout.",
    };
  }

  const immutableRuntime = env.BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME?.trim() === "1";
  if (!paths.python && (immutableRuntime || !paths.uv)) {
    return {
      ...base,
      clonePath: paths.clone,
      available: false,
      code: "python_missing",
      message: immutableRuntime
        ? "SolidWorks backend unavailable: its immutable packaged Python runtime is missing."
        : "SolidWorks backend unavailable: the SolidworksMCP-python environment is missing and the sealed uv runtime was not found. Run SolidWorks setup from Breadboard.",
    };
  }

  // A sealed uv runtime can provision or repair the data-root environment on
  // the first Runtime-owned start. Manual/dev configurations have no trusted
  // lifecycle owner for that repair, so they still fail closed here.
  if (
    paths.python &&
    !solidWorksPythonDependenciesInstalled(paths.python) &&
    (immutableRuntime ||
      !(env.BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED?.trim() === "1" && paths.uv))
  ) {
    return {
      ...base,
      clonePath: paths.clone,
      available: false,
      code: "dependencies_missing",
      message: immutableRuntime
        ? "SolidWorks backend unavailable: its immutable packaged Python runtime is incomplete."
        : "SolidWorks backend unavailable: the managed bridge environment is missing fastmcp or pywin32. Run SolidWorks setup from Breadboard.",
    };
  }

  const install = solidworksInstallPath(env);
  if (!install) {
    return {
      ...base,
      clonePath: paths.clone,
      available: false,
      code: "solidworks_not_installed",
      message: "SolidWorks backend unavailable: SolidWorks was not detected on this Windows machine.",
    };
  }

  return {
    available: true,
    code: "available",
    clonePath: paths.clone,
    running: null,
    version: solidworksVersionHint(env),
    message: "SolidWorks is installed. A build starts it when one is needed.",
  };
}
