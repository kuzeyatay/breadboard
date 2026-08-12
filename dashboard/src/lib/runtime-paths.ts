import path from "path";

// Single authority for the dashboard's mutable-data and repo-root locations.
//
// Development keeps the historical layout (db/ under the dashboard package,
// repo root one level up). The desktop shell overrides both through
// environment variables so packaged installs keep user data in the OS
// user-data directory and read-only assets under the install resources:
//   BREADBOARD_DATA_DIR  — base directory containing db/ (brain.db etc.)
//   BREADBOARD_REPO_ROOT — directory that mirrors the repo layout for
//                          read-only assets (hermes-config/, gbrain/, …)

export function dashboardDataDir(): string {
  const configured = process.env.BREADBOARD_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  const developmentDashboard = process.env.BREADBOARD_DEVELOPMENT_DASHBOARD_DIR?.trim();
  if (developmentDashboard) return path.resolve(developmentDashboard);
  return path.basename(process.cwd()).toLowerCase() === "dashboard"
    ? process.cwd()
    : path.join(process.cwd(), "dashboard");
}

export function databaseDir(): string {
  const dataDir = dashboardDataDir();
  // Desktop layout stores databases under <data>/database; the historical dev
  // layout uses <dashboard>/db. BREADBOARD_DATA_DIR opts into the former.
  return process.env.BREADBOARD_DATA_DIR?.trim()
    ? path.join(dataDir, "database")
    : path.join(dataDir, "db");
}

export function repositoryRoot(): string {
  const configured = process.env.BREADBOARD_REPO_ROOT?.trim();
  if (configured) return path.resolve(configured);
  return path.basename(process.cwd()).toLowerCase() === "dashboard"
    ? path.resolve(process.cwd(), "..")
    : process.cwd();
}
