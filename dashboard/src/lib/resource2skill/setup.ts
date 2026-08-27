import path from "node:path";
import {
  externalRuntimePathExists,
  externalRuntimeReadDirectoryEntries,
  externalRuntimeStatIfPresent,
} from "../external-runtime-filesystem.ts";
import {
  resource2SkillAvailability,
  resource2SkillBrowserRoot,
  resource2SkillVenv,
} from "./runtime.ts";

export interface Resource2SkillSetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  runtime: { found: boolean; python: string; version: string };
  domains: { web: boolean; ppt: boolean; excel: boolean; blender: boolean; reaper: boolean };
}

function commandExists(command: string, env: NodeJS.ProcessEnv): boolean {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const extensions = process.platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  return (env[pathKey] ?? "").split(path.delimiter).filter(Boolean).some((directory) =>
    extensions.some((extension) =>
      externalRuntimeStatIfPresent(
        path.join(directory, `${command}${extension}`),
      )?.isFile(),
    ),
  );
}

function directoryHasPrefix(directory: string, prefix: string): boolean {
  try {
    return externalRuntimeReadDirectoryEntries(directory)
      .some((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix));
  } catch {
    return false;
  }
}

export function setupStatus(env: NodeJS.ProcessEnv = process.env): Resource2SkillSetupStatus {
  const availability = resource2SkillAvailability(env);
  const soundfont = env.VWS_REAPER_SOUNDFONT?.trim();
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: availability.cloned, path: availability.root ?? "" },
    runtime: { found: Boolean(availability.python), python: availability.python ?? "", version: availability.pythonVersion },
    domains: {
      web: availability.available && directoryHasPrefix(resource2SkillBrowserRoot(), "chromium"),
      ppt: availability.available && commandExists("soffice", env),
      excel: availability.available,
      blender: availability.available && externalRuntimePathExists(
        path.join(resource2SkillVenv(env), "breadboard-blender.json"),
      ),
      reaper: availability.available && commandExists("fluidsynth", env) &&
        Boolean(soundfont && externalRuntimePathExists(path.resolve(soundfont))),
    },
  };
}
