// Configuration for the real Inbox Zero stack.
//
// Inbox Zero is a full application, not a library: a Next.js web app, Postgres,
// Redis behind an HTTP shim, a queue worker and a cron loop. Breadboard runs the
// upstream compose file untouched and layers a generated override on top, the
// same way it runs Postiz — so pulling the clone stays a plain `git pull` and
// nothing Breadboard generates is ever committed into it.
//
// Two things here are load-bearing and worth stating plainly.
//
// 1. The web image is `ghcr.io/elie222/inbox-zero:latest`, published upstream.
//    Nothing is built locally, so the integration needs a container engine and
//    no Node toolchain, no pnpm install and no Prisma generate.
//
// 2. Reading someone's mail requires their own Google (or Microsoft) OAuth
//    client. That credential belongs to the user, cannot be minted, and is the
//    one prerequisite Breadboard cannot satisfy for them — so it is read from
//    the environment or from a Breadboard-owned credentials file, and its
//    absence is reported as a setup step rather than swallowed as a failure.

import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

export type InboxZeroMode = "stack" | "disabled";

export interface InboxZeroConfig {
  /**
   * `stack`    — drive the real Inbox Zero, starting the container engine and
   *              the containers when they are down.
   * `disabled` — the agent is off; the palette entry does not appear.
   */
  mode: InboxZeroMode;
  /** Where the Inbox Zero web app is published on the host. */
  baseUrl: string;
  /** The vendored clone holding the upstream compose file. */
  cloneRoot: string;
  /** Breadboard-owned files: the compose override and minted secrets. */
  stateDir: string;
  overrideFile: string;
  credentialsFile: string;
  /** Compose project name, so Breadboard's stack is addressable on its own. */
  projectName: string;
  /** Host ports the stack publishes. Each is offset from the upstream default
   *  so a hand-run `docker compose up` in the clone does not collide. */
  ports: { web: number; postgres: number; redis: number; redisHttp: number };
  /** How long to wait for the web app to answer before giving up on a start. */
  readyTimeoutMs: number;
  /** Whether Breadboard may launch the container engine when it is down. */
  autoStartDocker: boolean;
  /** Stop Docker Desktop's dashboard opening when Breadboard starts it. */
  suppressDockerUi: boolean;
}

const DEFAULT_PORTS = { web: 4021, postgres: 5442, redis: 6390, redisHttp: 8089 };

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

function port(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

export function inboxZeroMode(env: NodeJS.ProcessEnv = process.env): InboxZeroMode {
  const raw = env.INBOX_ZERO_MODE?.trim().toLowerCase();
  return raw === "disabled" || raw === "off" ? "disabled" : "stack";
}

export function resolveInboxZeroConfig(
  env: NodeJS.ProcessEnv = process.env,
): InboxZeroConfig {
  const ports = {
    web: port(env.INBOX_ZERO_PORT, DEFAULT_PORTS.web),
    postgres: port(env.INBOX_ZERO_POSTGRES_PORT, DEFAULT_PORTS.postgres),
    redis: port(env.INBOX_ZERO_REDIS_PORT, DEFAULT_PORTS.redis),
    redisHttp: port(env.INBOX_ZERO_REDIS_HTTP_PORT, DEFAULT_PORTS.redisHttp),
  };
  const stateDir = path.join(dashboardDataDir(), "inbox-zero");
  return {
    mode: inboxZeroMode(env),
    // The base URL is not merely where Breadboard calls: the app signs its own
    // OAuth redirect URIs and session cookies against it, so it has to be the
    // exact origin the user's browser reaches too.
    baseUrl: (env.INBOX_ZERO_URL?.trim() || `http://localhost:${ports.web}`).replace(/\/$/, ""),
    cloneRoot: env.INBOX_ZERO_ROOT?.trim() || path.join(repositoryRoot(), "inbox-zero"),
    stateDir,
    overrideFile: path.join(stateDir, "docker-compose.breadboard.yaml"),
    credentialsFile: path.join(stateDir, "credentials.json"),
    projectName: env.INBOX_ZERO_PROJECT?.trim() || "breadboard-inbox-zero",
    ports,
    readyTimeoutMs: Number(env.INBOX_ZERO_READY_TIMEOUT_MS?.trim() || 180_000),
    autoStartDocker: flag(env.INBOX_ZERO_AUTOSTART_DOCKER, true),
    suppressDockerUi: flag(env.INBOX_ZERO_SUPPRESS_DOCKER_UI, true),
  };
}

/**
 * Secrets Breadboard mints for its own instance, plus the OAuth client the user
 * supplied. Everything but the OAuth client is generated on first start and
 * never shown to anyone — Breadboard is the only client of this stack.
 */
export interface InboxZeroCredentials {
  /** better-auth's signing secret. Also signs the session cookie Breadboard mints. */
  authSecret: string;
  /** Shared secret between the web app and its own worker/cron loops. */
  internalApiKey: string;
  /** Bearer the Redis HTTP shim expects. */
  redisToken: string;
  /** Bearer the cron container sends. */
  cronSecret: string;
  postgresPassword: string;
  /** The user's own Google OAuth client, when they have configured one. */
  googleClientId: string;
  googleClientSecret: string;
  /** The user's own Microsoft OAuth client, when they have configured one. */
  microsoftClientId: string;
  microsoftClientSecret: string;
  createdAt: string;
}

/** The Google/Microsoft client from the environment, when set there instead. */
export function oauthFromEnvironment(env: NodeJS.ProcessEnv = process.env): {
  googleClientId: string;
  googleClientSecret: string;
  microsoftClientId: string;
  microsoftClientSecret: string;
} {
  return {
    googleClientId: env.INBOX_ZERO_GOOGLE_CLIENT_ID?.trim() ?? "",
    googleClientSecret: env.INBOX_ZERO_GOOGLE_CLIENT_SECRET?.trim() ?? "",
    microsoftClientId: env.INBOX_ZERO_MICROSOFT_CLIENT_ID?.trim() ?? "",
    microsoftClientSecret: env.INBOX_ZERO_MICROSOFT_CLIENT_SECRET?.trim() ?? "",
  };
}

/**
 * The connection string the stack's own containers use, and the one Breadboard
 * uses from the host. They differ only in host and port: inside the compose
 * network Postgres is `db:5432`, from the host it is the published port.
 */
export function databaseUrls(
  config: InboxZeroConfig,
  credentials: Pick<InboxZeroCredentials, "postgresPassword">,
): { internal: string; host: string } {
  const auth = `postgres:${encodeURIComponent(credentials.postgresPassword)}`;
  return {
    internal: `postgresql://${auth}@db:5432/inboxzero?schema=public`,
    host: `postgresql://${auth}@127.0.0.1:${config.ports.postgres}/inboxzero?schema=public`,
  };
}
