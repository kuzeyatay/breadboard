import { externalRuntimePath as path } from "./external-runtime-path.ts";
import { configuredManagedPayloadRoot, managedPayloadRoot, managedVenvRoot, runtimeBulkDataRoot } from "../../scripts/runtime-v2-bulk-paths.mjs";
import { runtimeProcessPath } from "../../scripts/runtime-v2-paths.mjs";

// Single authority for the dashboard's mutable-data and repo-root locations.
//
// A dashboard started directly keeps the historical layout (db/ under the
// dashboard package, repo root one level up). The desktop shell overrides both
// in development and packaged modes so they share durable data in the OS
// user-data directory while program assets still come from the selected build:
//   BREADBOARD_DATA_DIR  — base directory containing db/ (brain.db etc.)
//   BREADBOARD_REPO_ROOT — directory that mirrors the repo layout for
//                          read-only assets (hermes-config/, gbrain/, …)

export function dashboardDataDir(): string {
  const configured = process.env.BREADBOARD_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  const developmentDashboard = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR?.trim();
  if (developmentDashboard) return path.resolve(developmentDashboard);
  return path.basename(process.cwd()).toLowerCase() === "dashboard"
    ? path.resolve(process.cwd())
    : path.join(process.cwd(), "dashboard");
}

export function databaseDir(): string {
  const dataDir = dashboardDataDir();
  // Desktop layout stores databases under <data>/database; a directly launched
  // dashboard without BREADBOARD_DATA_DIR retains <dashboard>/db.
  return process.env.BREADBOARD_DATA_DIR?.trim()
    ? path.join(dataDir, "database")
    : path.join(dataDir, "db");
}

export function repositoryRoot(): string {
  const configured = process.env.BREADBOARD_REPO_ROOT?.trim();
  if (configured) return path.resolve(configured);
  return path.basename(process.cwd()).toLowerCase() === "dashboard"
    ? path.resolve(process.cwd(), "..")
    : path.resolve(process.cwd());
}

/**
 * Mutable state owned by one supervised Runtime V2 service. Installed
 * application sources are read-only, so provisioned environments must never
 * live beside a clone under repositoryRoot().
 */
export function runtimeV2ServiceRoot(serviceId: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(serviceId)) {
    throw new Error("Invalid Runtime V2 service identifier.");
  }
  return path.join(dashboardDataDir(), "runtime-v2", "services", serviceId);
}

export function dashboardBulkDataDir(): string {
  return runtimeBulkDataRoot(dashboardDataDir());
}

export function runtimeV2BulkRoot(): string {
  return path.join(dashboardBulkDataDir(), "runtime-v2");
}

export function runtimeV2PayloadRoot(relative: string, env: NodeJS.ProcessEnv = process.env): string {
  return managedPayloadRoot(dashboardDataDir(), relative, env);
}

export function runtimeV2ConfiguredPayloadRoot(relative: string, configured: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return configuredManagedPayloadRoot(dashboardDataDir(), relative, configured, env);
}

export function runtimeV2ToolchainRoot(toolchainId: string, env: NodeJS.ProcessEnv = process.env): string {
  return runtimeV2PayloadRoot(`runtime-v2/toolchains/${toolchainId}`, env);
}

export function runtimeV2ServiceVenv(serviceId: string): string {
  return runtimeProcessPath(managedVenvRoot(dashboardDataDir(), serviceId));
}
