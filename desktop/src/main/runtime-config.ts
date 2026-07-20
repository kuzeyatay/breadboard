import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Typed desktop runtime configuration.
 *
 * Persisted per-install secrets live in `<configDir>/desktop-config.json`
 * (created on first launch, atomic writes, never logged). Per-launch values
 * (ports) are resolved at startup and are not persisted.
 */
export interface PersistentDesktopConfig {
  /** Schema version for the config file + data layout. */
  version: 1;
  /** NextAuth JWT/session secret (per-install random). */
  nextAuthSecret: string;
  /** OpenHarness Basic-auth password (per-install random). */
  openharnessPassword: string;
  openharnessUsername: string;
  /** Shared secret between dashboard server and OpenHarness plugin process. */
  openharnessToolSecret: string;
  /** Secret for signing short-lived capability tokens. */
  openharnessCapabilitySecret: string;
  /** OpenHarness routing mode; preserved Breadboard contract. */
  openharnessMode: "required" | "preferred" | "legacy";
  /**
   * Seed invite code for the invite-only registration flow (the dashboard
   * consumes it via SECOND_BRAIN_INITIAL_INVITE_CODE). Shown to the user from
   * the Help menu so the first local account can be created.
   */
  initialInviteCode: string;
  /** Optional capabilities. */
  scriberrEnabled: boolean;
  scriberrBaseUrl: string | null;
  /** Recorded migration source, if a dev checkout was imported. */
  migratedFrom: string | null;
  migrationVersion: number;
}

export interface LaunchPorts {
  dashboard: number;
  chatmock: number;
  openharness: number;
  quartz: number;
  /** Quartz's hot-reload websocket listener (`build --serve --wsPort`). It is
   * opened unconditionally by the Quartz CLI, so it must be allocated too or
   * startup fails with EADDRINUSE when anything else holds the default 3001. */
  quartzWs: number;
}

export interface DesktopRuntimeConfig {
  persistent: PersistentDesktopConfig;
  ports: LaunchPorts;
}

const CONFIG_FILE = "desktop-config.json";

function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function defaultPersistentConfig(): PersistentDesktopConfig {
  return {
    version: 1,
    nextAuthSecret: randomSecret(),
    openharnessPassword: randomSecret(24),
    openharnessUsername: "breadboard",
    openharnessToolSecret: randomSecret(),
    openharnessCapabilitySecret: randomSecret(),
    openharnessMode: "required",
    initialInviteCode: `BREAD${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
    scriberrEnabled: false,
    scriberrBaseUrl: null,
    migratedFrom: null,
    migrationVersion: 0,
  };
}

export function validatePersistentConfig(value: unknown): PersistentDesktopConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("desktop-config.json is not an object");
  }
  const record = value as Record<string, unknown>;
  const requireString = (key: string): string => {
    const raw = record[key];
    if (typeof raw !== "string" || raw.length === 0) {
      throw new Error(`desktop-config.json: missing or empty "${key}"`);
    }
    return raw;
  };
  const mode = record["openharnessMode"];
  if (mode !== "required" && mode !== "preferred" && mode !== "legacy") {
    throw new Error(`desktop-config.json: invalid openharnessMode ${String(mode)}`);
  }
  if (record["version"] !== 1) {
    throw new Error(`desktop-config.json: unsupported version ${String(record["version"])}`);
  }
  return {
    version: 1,
    nextAuthSecret: requireString("nextAuthSecret"),
    openharnessPassword: requireString("openharnessPassword"),
    openharnessUsername: requireString("openharnessUsername"),
    openharnessToolSecret: requireString("openharnessToolSecret"),
    openharnessCapabilitySecret: requireString("openharnessCapabilitySecret"),
    openharnessMode: mode,
    // Backfilled for configs written before the field existed.
    initialInviteCode:
      typeof record["initialInviteCode"] === "string" && record["initialInviteCode"].length > 0
        ? (record["initialInviteCode"] as string)
        : `BREAD${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
    scriberrEnabled: record["scriberrEnabled"] === true,
    scriberrBaseUrl:
      typeof record["scriberrBaseUrl"] === "string" && record["scriberrBaseUrl"].length > 0
        ? (record["scriberrBaseUrl"] as string)
        : null,
    migratedFrom:
      typeof record["migratedFrom"] === "string" && record["migratedFrom"].length > 0
        ? (record["migratedFrom"] as string)
        : null,
    migrationVersion:
      typeof record["migrationVersion"] === "number" ? (record["migrationVersion"] as number) : 0,
  };
}

/** Atomic write: temp file in the same directory, then rename. */
export function atomicWriteFile(filePath: string, contents: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, contents, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function loadOrCreatePersistentConfig(configDir: string): PersistentDesktopConfig {
  const file = path.join(configDir, CONFIG_FILE);
  if (fs.existsSync(file)) {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return validatePersistentConfig(parsed);
  }
  const created = defaultPersistentConfig();
  atomicWriteFile(file, JSON.stringify(created, null, 2));
  return created;
}

export function savePersistentConfig(configDir: string, config: PersistentDesktopConfig): void {
  atomicWriteFile(path.join(configDir, CONFIG_FILE), JSON.stringify(config, null, 2));
}

/** Values safe to include in logs/diagnostics — no secrets. */
export function redactedConfigSummary(config: DesktopRuntimeConfig): Record<string, unknown> {
  return {
    version: config.persistent.version,
    openharnessMode: config.persistent.openharnessMode,
    openharnessUsername: config.persistent.openharnessUsername,
    scriberrEnabled: config.persistent.scriberrEnabled,
    migratedFrom: config.persistent.migratedFrom,
    migrationVersion: config.persistent.migrationVersion,
    ports: config.ports,
  };
}

/** Redact any known secret values from a log line. */
export function redactSecrets(line: string, config: PersistentDesktopConfig): string {
  let out = line;
  for (const secret of [
    config.nextAuthSecret,
    config.openharnessPassword,
    config.openharnessToolSecret,
    config.openharnessCapabilitySecret,
  ]) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out;
}
