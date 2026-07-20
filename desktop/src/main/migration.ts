import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./runtime-config";

/**
 * Migration from a development checkout into the desktop data layout.
 *
 * Principles:
 *  - copy, never delete;
 *  - back up any destination that would be overwritten;
 *  - idempotent: a recorded migration version + marker prevents re-copying;
 *  - a written report documents exactly what happened.
 */
export interface MigrationItem {
  label: string;
  source: string;
  destination: string;
  kind: "file" | "directory";
  exists: boolean;
  alreadyMigrated: boolean;
}

export interface MigrationPlan {
  sourceRoot: string;
  items: MigrationItem[];
}

export interface MigrationResult {
  performed: MigrationItem[];
  skipped: MigrationItem[];
  backups: string[];
  reportPath: string;
}

export const MIGRATION_VERSION = 1;

export interface MigrationTargets {
  databaseDir: string;
  quartzContent: string;
  backupsDir: string;
  configDir: string;
}

/** Detect whether `candidate` looks like a Breadboard dev checkout with data. */
export function detectDevInstallation(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "dashboard", "db", "brain.db")) ||
    fs.existsSync(path.join(candidate, "quartz", "content"))
  );
}

export function planMigration(sourceRoot: string, targets: MigrationTargets): MigrationPlan {
  const items: MigrationItem[] = [
    {
      label: "Main database (brain.db)",
      source: path.join(sourceRoot, "dashboard", "db", "brain.db"),
      destination: path.join(targets.databaseDir, "brain.db"),
      kind: "file",
      exists: false,
      alreadyMigrated: false,
    },
    {
      label: "Skills catalog database",
      source: path.join(sourceRoot, "dashboard", "db", "skills-catalog.db"),
      destination: path.join(targets.databaseDir, "skills-catalog.db"),
      kind: "file",
      exists: false,
      alreadyMigrated: false,
    },
    {
      label: "Garden content (Quartz content tree)",
      source: path.join(sourceRoot, "quartz", "content"),
      destination: targets.quartzContent,
      kind: "directory",
      exists: false,
      alreadyMigrated: false,
    },
  ];
  for (const item of items) {
    item.exists = fs.existsSync(item.source);
    item.alreadyMigrated = fs.existsSync(item.destination) && !isEffectivelyEmpty(item.destination);
  }
  return { sourceRoot, items };
}

function isEffectivelyEmpty(target: string): boolean {
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return stat.size === 0;
    return fs.readdirSync(target).length === 0;
  } catch {
    return true;
  }
}

export function executeMigration(plan: MigrationPlan, targets: MigrationTargets): MigrationResult {
  const performed: MigrationItem[] = [];
  const skipped: MigrationItem[] = [];
  const backups: string[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (const item of plan.items) {
    if (!item.exists || item.alreadyMigrated) {
      skipped.push(item);
      continue;
    }
    // Back up a non-empty destination before overwriting (defensive; the
    // alreadyMigrated check normally prevents this branch from overwriting).
    if (fs.existsSync(item.destination) && !isEffectivelyEmpty(item.destination)) {
      const backupPath = path.join(
        targets.backupsDir,
        `${stamp}-${path.basename(item.destination)}`,
      );
      fs.cpSync(item.destination, backupPath, { recursive: true });
      backups.push(backupPath);
    }
    fs.mkdirSync(path.dirname(item.destination), { recursive: true });
    fs.cpSync(item.source, item.destination, { recursive: true, force: true });
    performed.push(item);
  }

  const reportPath = path.join(targets.configDir, "migration-report.json");
  atomicWriteFile(
    reportPath,
    JSON.stringify(
      {
        migrationVersion: MIGRATION_VERSION,
        at: new Date().toISOString(),
        sourceRoot: plan.sourceRoot,
        performed: performed.map(({ label, source, destination }) => ({ label, source, destination })),
        skipped: skipped.map(({ label, source, exists, alreadyMigrated }) => ({
          label,
          source,
          reason: !exists ? "source missing" : alreadyMigrated ? "destination already populated" : "unknown",
        })),
        backups,
      },
      null,
      2,
    ),
  );
  return { performed, skipped, backups, reportPath };
}

/** Validate that a migrated SQLite file at least carries the SQLite header. */
export function looksLikeSqliteDatabase(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    return header.toString("utf8", 0, 15) === "SQLite format 3";
  } catch {
    return false;
  }
}
