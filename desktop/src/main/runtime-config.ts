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
  version: 2;
  /** NextAuth JWT/session secret (per-install random). */
  nextAuthSecret: string;
  /** Loopback Hermes dashboard/WebSocket credential (per-install random). */
  hermesSessionToken: string;
  /** Shared secret between Hermes's Breadboard plugin and the dashboard. */
  hermesToolSecret: string;
  /** Secret for signing short-lived Hermes capability tokens. */
  hermesCapabilitySecret: string;
  /**
   * Seed invite code for the invite-only registration flow (the dashboard
   * consumes it via SECOND_BRAIN_INITIAL_INVITE_CODE). Shown to the user from
   * the Help menu so the first local account can be created.
   */
  initialInviteCode: string;
  /** GBrain garden-knowledge retrieval mode. Additive; default preferred. */
  gbrainMode: "disabled" | "preferred" | "required";
  /** Per-install secret for the loopback GBrain adapter (never logged). */
  gbrainAdapterSecret: string;
  /** UI-TARS browser-operator runtime mode. Additive; default optional. */
  uiTarsMode: "disabled" | "optional" | "required";
  /** Per-install secret for the loopback UI-TARS adapter (never logged). */
  uiTarsAdapterSecret: string;
  /** Parametric CAD service mode. Additive; default optional. */
  cadMode: "disabled" | "optional";
  /** Per-install secret for the loopback CAD service (never logged). */
  cadServiceSecret: string;
  /**
   * ColPali page-retrieval service mode. Additive; default optional.
   *
   * `optional` still does nothing on a machine that never ran
   * `npm run setup:colpali` — there is no interpreter to launch, and document
   * attachments keep being inlined whole.
   */
  colpaliMode: "disabled" | "optional";
  /** Per-install secret for the loopback ColPali service (never logged). */
  colpaliServiceSecret: string;
  /**
   * Local text-humanization service mode. Additive; default local.
   *
   * `local` still does nothing on a machine that never ran
   * `npm run setup:humanizer` — there is no interpreter to launch, and no
   * checkpoint to load even if there were. There is deliberately no remote
   * value: the feature is local rewriting or it is unavailable.
   */
  humanizerMode: "disabled" | "local";
  /** Which device the humanizer asks for. `cuda` fails loudly when absent. */
  humanizerDevice: "auto" | "cuda" | "cpu";
  /** Per-install secret for the loopback humanizer service (never logged). */
  humanizerServiceSecret: string;
  /**
   * Subscription-OAuth proxy (CLIProxyAPI) mode. Additive; default optional.
   *
   * No secret fields here on purpose: the proxy's loopback bearer and
   * management key are file-backed under its home directory, because ChatMock
   * persists the bearer in `providers.json` when a catalog is synced and a
   * freshly minted one would invalidate that stored copy. See
   * `desktop/src/main/cliproxy.ts`.
   */
  cliproxyMode: "disabled" | "optional" | "required";
  /** Optional capabilities. */
  scriberrEnabled: boolean;
  scriberrBaseUrl: string | null;
  /** Private credentials for Breadboard's local Scriberr service. */
  scriberrUsername: string;
  scriberrPassword: string;
  /** Recorded migration source, if a dev checkout was imported. */
  migratedFrom: string | null;
  migrationVersion: number;
}

export interface LaunchPorts {
  dashboard: number;
  chatmock: number;
  /** Internal Hermes loopback port. Never published to the renderer. */
  hermes: number;
  /** Host port where the optional Postiz web/API container is published. */
  postiz: number;
  /** Private readiness endpoint owned by the Postiz supervisor process. */
  postizSupervisor: number;
  quartz: number;
  /** Quartz's hot-reload websocket listener (`build --serve --wsPort`). It is
   * opened unconditionally by the Quartz CLI, so it must be allocated too or
   * startup fails with EADDRINUSE when anything else holds the default 3001. */
  quartzWs: number;
  /** GBrain adapter loopback port. Optional: only allocated when GBrain is enabled. */
  gbrain?: number;
  /** UI-TARS adapter loopback port. Optional: only allocated when UI-TARS is enabled. */
  uiTars?: number;
  /** CAD service loopback port. Only allocated when the CAD service is enabled. */
  cad?: number;
  colpali?: number;
  /** Humanizer service loopback port. Only allocated when it is enabled. */
  humanizer?: number;
  /** Subscription proxy loopback port. Only allocated when it is enabled. */
  cliproxy?: number;
  /** Voicebox local speech service. Optional so older test/runtime configs remain valid. */
  voicebox?: number;
  /**
   * Loopback port of the Recall capture engine. Not allocated dynamically: the
   * engine is started by the dashboard rather than the supervisor, and 3030 is
   * the port its own tooling (CLI, MCP server) defaults to, so overriding it
   * would silently break those.
   */
  recall?: number;
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
    version: 2,
    nextAuthSecret: randomSecret(),
    hermesSessionToken: randomSecret(),
    hermesToolSecret: randomSecret(),
    hermesCapabilitySecret: randomSecret(),
    gbrainMode: "preferred",
    gbrainAdapterSecret: randomSecret(24),
    uiTarsMode: "optional",
    uiTarsAdapterSecret: randomSecret(24),
    cadMode: "optional",
    cadServiceSecret: randomSecret(24),
    colpaliMode: "optional",
    colpaliServiceSecret: randomSecret(24),
    humanizerMode: "local",
    humanizerDevice: "auto",
    humanizerServiceSecret: randomSecret(24),
    cliproxyMode: "optional",
    initialInviteCode: `BREAD${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
    scriberrEnabled: true,
    scriberrBaseUrl: null,
    scriberrUsername: "breadboard",
    scriberrPassword: randomSecret(24),
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
  if (record["version"] !== 1 && record["version"] !== 2) {
    throw new Error(`desktop-config.json: unsupported version ${String(record["version"])}`);
  }
  const legacyPrefix = ["open", "harness"].join("");
  const legacyToolSecret = record[`${legacyPrefix}ToolSecret`];
  const legacyCapabilitySecret = record[`${legacyPrefix}CapabilitySecret`];
  return {
    version: 2,
    nextAuthSecret: requireString("nextAuthSecret"),
    // Backfill high-entropy secrets for installations created before Hermes
    // became a managed runtime. loadOrCreatePersistentConfig persists the
    // normalized object below.
    hermesSessionToken:
      typeof record["hermesSessionToken"] === "string" &&
      record["hermesSessionToken"].length >= 32
        ? (record["hermesSessionToken"] as string)
        : randomSecret(),
    hermesToolSecret:
      typeof record["hermesToolSecret"] === "string" &&
      record["hermesToolSecret"].length >= 32
        ? (record["hermesToolSecret"] as string)
        : typeof legacyToolSecret === "string" && legacyToolSecret.length >= 32
          ? legacyToolSecret
        : randomSecret(),
    hermesCapabilitySecret:
      typeof record["hermesCapabilitySecret"] === "string" &&
      record["hermesCapabilitySecret"].length >= 32
        ? (record["hermesCapabilitySecret"] as string)
        : typeof legacyCapabilitySecret === "string" && legacyCapabilitySecret.length >= 32
          ? legacyCapabilitySecret
          : randomSecret(),
    // GBrain fields backfilled for configs written before they existed. An
    // install that explicitly turned GBrain off keeps it off; anything else
    // (missing, or written before the field existed) adopts the new default.
    gbrainMode:
      record["gbrainMode"] === "disabled" || record["gbrainMode"] === "required"
        ? (record["gbrainMode"] as "disabled" | "required")
        : "preferred",
    gbrainAdapterSecret:
      typeof record["gbrainAdapterSecret"] === "string" && record["gbrainAdapterSecret"].length > 0
        ? (record["gbrainAdapterSecret"] as string)
        : randomSecret(24),
    // UI-TARS fields backfilled for configs written before they existed.
    uiTarsMode:
      record["uiTarsMode"] === "disabled" || record["uiTarsMode"] === "required"
        ? (record["uiTarsMode"] as "disabled" | "required")
        : "optional",
    uiTarsAdapterSecret:
      typeof record["uiTarsAdapterSecret"] === "string" && record["uiTarsAdapterSecret"].length > 0
        ? (record["uiTarsAdapterSecret"] as string)
        : randomSecret(24),
    // CAD fields backfilled for configs written before the service existed.
    cadMode: record["cadMode"] === "disabled" ? "disabled" : "optional",
    cadServiceSecret:
      typeof record["cadServiceSecret"] === "string" && record["cadServiceSecret"].length > 0
        ? (record["cadServiceSecret"] as string)
        : randomSecret(24),
    // ColPali fields backfilled for configs written before the service existed.
    colpaliMode: record["colpaliMode"] === "disabled" ? "disabled" : "optional",
    colpaliServiceSecret:
      typeof record["colpaliServiceSecret"] === "string" &&
      record["colpaliServiceSecret"].length > 0
        ? (record["colpaliServiceSecret"] as string)
        : randomSecret(24),
    // Humanizer fields backfilled for configs written before the service
    // existed. An install that explicitly turned it off keeps it off.
    humanizerMode: record["humanizerMode"] === "disabled" ? "disabled" : "local",
    humanizerDevice:
      record["humanizerDevice"] === "cuda" || record["humanizerDevice"] === "cpu"
        ? (record["humanizerDevice"] as "cuda" | "cpu")
        : "auto",
    humanizerServiceSecret:
      typeof record["humanizerServiceSecret"] === "string" &&
      record["humanizerServiceSecret"].length > 0
        ? (record["humanizerServiceSecret"] as string)
        : randomSecret(24),
    // Backfilled for configs written before the subscription proxy was
    // supervised. Existing installs gain it as `optional`, which is what makes
    // already-connected subscriptions start working without any user action.
    cliproxyMode:
      record["cliproxyMode"] === "disabled" || record["cliproxyMode"] === "required"
        ? (record["cliproxyMode"] as "disabled" | "required")
        : "optional",
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
    // Backfill a stable, private account for installations created before the
    // native Scriberr sidecar existed. The dashboard registers it only when
    // the dedicated local database contains no users yet.
    scriberrUsername:
      typeof record["scriberrUsername"] === "string" && record["scriberrUsername"].length >= 3
        ? (record["scriberrUsername"] as string)
        : "breadboard",
    scriberrPassword:
      typeof record["scriberrPassword"] === "string" && record["scriberrPassword"].length >= 24
        ? (record["scriberrPassword"] as string)
        : randomSecret(24),
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
    const normalized = validatePersistentConfig(parsed);
    // Persist additive defaults and the v1 -> v2 Hermes migration so generated
    // secrets remain stable across launches.
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      atomicWriteFile(file, JSON.stringify(normalized, null, 2));
    }
    return normalized;
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
    agentRuntime: "hermes",
    gbrainMode: config.persistent.gbrainMode,
    uiTarsMode: config.persistent.uiTarsMode,
    cadMode: config.persistent.cadMode,
    colpaliMode: config.persistent.colpaliMode,
    humanizerMode: config.persistent.humanizerMode,
    humanizerDevice: config.persistent.humanizerDevice,
    cliproxyMode: config.persistent.cliproxyMode,
    scriberrEnabled: config.persistent.scriberrEnabled,
    migratedFrom: config.persistent.migratedFrom,
    migrationVersion: config.persistent.migrationVersion,
    // Hermes's port is deliberately omitted: diagnostics are renderer-visible.
    ports: {
      dashboard: config.ports.dashboard,
      chatmock: config.ports.chatmock,
      postiz: config.ports.postiz,
      quartz: config.ports.quartz,
      quartzWs: config.ports.quartzWs,
      ...(config.ports.gbrain ? { gbrain: config.ports.gbrain } : {}),
      ...(config.ports.uiTars ? { uiTars: config.ports.uiTars } : {}),
      ...(config.ports.cad ? { cad: config.ports.cad } : {}),
      ...(config.ports.cliproxy ? { cliproxy: config.ports.cliproxy } : {}),
    },
  };
}

/** Redact any known secret values from a log line. */
export function redactSecrets(line: string, config: PersistentDesktopConfig): string {
  let out = line;
  for (const secret of [
    config.nextAuthSecret,
    config.hermesSessionToken,
    config.hermesToolSecret,
    config.hermesCapabilitySecret,
    config.gbrainAdapterSecret,
    config.uiTarsAdapterSecret,
    config.cadServiceSecret,
    config.humanizerServiceSecret,
    config.scriberrPassword,
  ]) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out;
}
