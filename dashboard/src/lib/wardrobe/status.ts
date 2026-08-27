import {
  installedDependencies,
  runtimeAvailability,
} from "./runtime.ts";

export interface SetupStatus {
  ready: boolean;
  reason: string;
  clone: { found: boolean; path: string };
  dependencies: { installed: boolean; vite: boolean; sharp: boolean };
  identity: { found: boolean; path: string };
  dataDir: string;
}

export interface SetupResult {
  ok: boolean;
  message: string;
  status: SetupStatus;
}

export function setupStatus(env: NodeJS.ProcessEnv = process.env): SetupStatus {
  const availability = runtimeAvailability(env);
  const dependencies = installedDependencies(env);
  return {
    ready: availability.available,
    reason: availability.reason ?? "",
    clone: { found: availability.cloned, path: availability.root ?? "" },
    dependencies: { installed: availability.installed, ...dependencies },
    identity: {
      found: availability.hasModelReference,
      path: availability.modelReference ?? "",
    },
    dataDir: availability.dataDir ?? "",
  };
}
