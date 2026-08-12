// The Inbox Zero Docker Compose stack.
//
// Breadboard runs Inbox Zero's *upstream* compose file untouched and layers a
// generated override on top. Nothing in the vendored clone is edited or written
// to, so pulling upstream stays a plain `git pull`, while the override carries
// the things that must not ship as upstream defaults: minted secrets, the ports
// Breadboard published, the user's own OAuth client, and an LLM pointed at the
// local ChatMock rather than at a paid provider.
//
// Upstream puts the database and Redis behind compose profiles, so a start that
// omits `--profile all` brings up a web container with nothing behind it and
// leaves it crash-looping on a connection error. Both profiles are always
// passed for that reason.
//
// The container engine module is shared with the Socials Manager stack: one
// answer to "is there a daemon, and may Breadboard start it?" rather than two
// that can disagree.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  composeCommand,
  ensureDockerRunning,
  run,
  type DockerStatus,
} from "../socials-manager/docker.ts";
import {
  databaseUrls,
  oauthFromEnvironment,
  type InboxZeroConfig,
  type InboxZeroCredentials,
} from "./config.ts";

export type StackState =
  | "running"
  | "starting"
  | "stopped"
  | "docker_unavailable"
  | "not_installed";

export interface StackStatus {
  state: StackState;
  docker: DockerStatus;
  /** True once the Inbox Zero web app answers its own health endpoint. */
  reachable: boolean;
  reason?: string;
}

/** Compose profiles that turn the optional services on. */
const PROFILES = ["all", "queue-worker"] as const;

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function readCredentials(config: InboxZeroConfig): InboxZeroCredentials | null {
  try {
    const parsed = JSON.parse(
      readFileSync(config.credentialsFile, "utf8"),
    ) as Partial<InboxZeroCredentials>;
    if (!parsed.authSecret || !parsed.postgresPassword) return null;
    return {
      authSecret: parsed.authSecret,
      internalApiKey: parsed.internalApiKey ?? "",
      redisToken: parsed.redisToken ?? "",
      cronSecret: parsed.cronSecret ?? "",
      postgresPassword: parsed.postgresPassword,
      googleClientId: parsed.googleClientId ?? "",
      googleClientSecret: parsed.googleClientSecret ?? "",
      microsoftClientId: parsed.microsoftClientId ?? "",
      microsoftClientSecret: parsed.microsoftClientSecret ?? "",
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeCredentials(
  config: InboxZeroConfig,
  credentials: InboxZeroCredentials,
): void {
  mkdirSync(config.stateDir, { recursive: true });
  writeFileSync(
    config.credentialsFile,
    `${JSON.stringify(credentials, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

/**
 * Mint this instance's secrets on first use, folding in whichever OAuth client
 * the environment supplies.
 *
 * The generated halves are stable once written: rotating `authSecret` would
 * invalidate every session in the database, including the one Breadboard signs
 * its own requests with, so it is generated once and then left alone. The OAuth
 * client is refreshed from the environment on every read, because that one is
 * the user's and they change it from outside Breadboard.
 */
export function ensureCredentials(
  config: InboxZeroConfig,
  env: NodeJS.ProcessEnv = process.env,
): InboxZeroCredentials {
  const fromEnv = oauthFromEnvironment(env);
  const existing = readCredentials(config);
  const next: InboxZeroCredentials = {
    authSecret: existing?.authSecret ?? randomBytes(32).toString("base64url"),
    internalApiKey: existing?.internalApiKey || randomBytes(24).toString("base64url"),
    redisToken: existing?.redisToken || randomBytes(24).toString("base64url"),
    cronSecret: existing?.cronSecret || randomBytes(24).toString("base64url"),
    postgresPassword: existing?.postgresPassword ?? randomBytes(18).toString("base64url"),
    // The environment wins when it names a client; otherwise whatever the
    // settings dialog last saved stands.
    googleClientId: fromEnv.googleClientId || existing?.googleClientId || "",
    googleClientSecret: fromEnv.googleClientSecret || existing?.googleClientSecret || "",
    microsoftClientId: fromEnv.microsoftClientId || existing?.microsoftClientId || "",
    microsoftClientSecret:
      fromEnv.microsoftClientSecret || existing?.microsoftClientSecret || "",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  if (JSON.stringify(existing) !== JSON.stringify(next)) writeCredentials(config, next);
  return next;
}

/** True once the user has supplied an OAuth client for at least one provider. */
export function hasEmailProvider(credentials: InboxZeroCredentials): boolean {
  return Boolean(
    (credentials.googleClientId && credentials.googleClientSecret) ||
      (credentials.microsoftClientId && credentials.microsoftClientSecret),
  );
}

export function upstreamComposeFile(config: InboxZeroConfig): string {
  return path.join(config.cloneRoot, "docker-compose.yml");
}

export function cloneInstalled(config: InboxZeroConfig): boolean {
  return existsSync(upstreamComposeFile(config));
}

/**
 * The model configuration handed to Inbox Zero's own AI.
 *
 * Inbox Zero speaks to whatever `DEFAULT_LLMS` names. `openai-compatible` is the
 * provider that takes a base URL, which is how the whole assistant — reading
 * threads, drafting replies, writing rules — runs on the local ChatMock instead
 * of on a key the user would have to buy. The URL is rewritten to
 * `host.docker.internal` because it is resolved from inside a container, where
 * `localhost` is the container itself.
 */
export function containerModelSettings(input: {
  chatmockBaseUrl: string;
  chatmockApiKey: string;
  model: string;
}): Record<string, string> {
  const url = new URL(input.chatmockBaseUrl);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") {
    url.hostname = "host.docker.internal";
  }
  const base = `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  return {
    DEFAULT_LLMS: `openai-compatible:${input.model}`,
    OPENAI_COMPATIBLE_BASE_URL: base.endsWith("/v1") ? base : `${base}/v1`,
    OPENAI_COMPATIBLE_MODEL: input.model,
    OPENAI_COMPATIBLE_AUTH_HEADER: `Bearer ${input.chatmockApiKey}`,
    // Premium gates exist to bill a hosted customer. This is the user's own
    // machine talking to their own mailbox, so every feature is simply on.
    NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS: "true",
    NEXT_PUBLIC_EMAIL_SEND_ENABLED: "true",
  };
}

/** Generate the override layered over Inbox Zero's own compose file. */
export function renderOverride(
  config: InboxZeroConfig,
  credentials: InboxZeroCredentials,
  model: Record<string, string>,
): string {
  const { internal } = databaseUrls(config, credentials);
  const redisUrl = `http://serverless-redis-http:80`;
  const shared: Record<string, string> = {
    DATABASE_URL: internal,
    DIRECT_URL: internal,
    NEXT_PUBLIC_BASE_URL: config.baseUrl,
    AUTH_SECRET: credentials.authSecret,
    NEXTAUTH_SECRET: credentials.authSecret,
    INTERNAL_API_KEY: credentials.internalApiKey,
    INTERNAL_API_URL: "http://web:3000",
    UPSTASH_REDIS_URL: redisUrl,
    UPSTASH_REDIS_TOKEN: credentials.redisToken,
    CRON_SECRET: credentials.cronSecret,
    ...model,
  };
  if (credentials.googleClientId && credentials.googleClientSecret) {
    shared.GOOGLE_CLIENT_ID = credentials.googleClientId;
    shared.GOOGLE_CLIENT_SECRET = credentials.googleClientSecret;
  }
  if (credentials.microsoftClientId && credentials.microsoftClientSecret) {
    shared.MICROSOFT_CLIENT_ID = credentials.microsoftClientId;
    shared.MICROSOFT_CLIENT_SECRET = credentials.microsoftClientSecret;
  }

  const block = (indent: string) =>
    Object.entries(shared)
      .map(([key, value]) => `${indent}${key}: ${quote(value)}`)
      .join("\n");

  return [
    "# Generated by Breadboard. Layered over inbox-zero/docker-compose.yml;",
    "# edit Inbox Zero's settings in Breadboard rather than this file — it is",
    "# rewritten every time the stack starts.",
    "services:",
    "  db:",
    "    environment:",
    `      POSTGRES_USER: 'postgres'`,
    `      POSTGRES_DB: 'inboxzero'`,
    `      POSTGRES_PASSWORD: ${quote(credentials.postgresPassword)}`,
    "    ports:",
    `      - '127.0.0.1:${config.ports.postgres}:5432'`,
    "  redis:",
    "    ports:",
    `      - '127.0.0.1:${config.ports.redis}:6379'`,
    "  serverless-redis-http:",
    "    environment:",
    "      SRH_MODE: 'env'",
    `      SRH_TOKEN: ${quote(credentials.redisToken)}`,
    "      SRH_CONNECTION_STRING: 'redis://redis:6379'",
    "    ports:",
    `      - '127.0.0.1:${config.ports.redisHttp}:80'`,
    "  web:",
    "    ports:",
    `      - '127.0.0.1:${config.ports.web}:3000'`,
    "    environment:",
    block("      "),
    "  worker:",
    "    environment:",
    block("      "),
    "  cron:",
    "    environment:",
    block("      "),
    "",
  ].join("\n");
}

export function writeOverride(config: InboxZeroConfig, contents: string): void {
  mkdirSync(config.stateDir, { recursive: true });
  writeFileSync(config.overrideFile, contents, "utf8");
}

/** Compose arguments common to every invocation against Breadboard's project. */
export function composeArgs(config: InboxZeroConfig): string[] {
  return [
    "-p",
    config.projectName,
    "-f",
    upstreamComposeFile(config),
    "-f",
    config.overrideFile,
    ...PROFILES.flatMap((profile) => ["--profile", profile]),
  ];
}

/** Does the web app answer? Its own health route is the honest test. */
export async function webReachable(config: InboxZeroConfig): Promise<boolean> {
  try {
    const response = await fetch(`${config.baseUrl}/api/health`, {
      signal: AbortSignal.timeout(5_000),
      redirect: "manual",
    });
    // Any answer at all means the Next.js server is up; a redirect to the login
    // page is still the app running.
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function stackStatus(
  config: InboxZeroConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StackStatus> {
  if (!cloneInstalled(config)) {
    return {
      state: "not_installed",
      docker: { cliInstalled: false, desktopInstalled: false, daemonRunning: false },
      reachable: false,
      reason: `The Inbox Zero clone is not at ${config.cloneRoot}.`,
    };
  }
  if (await webReachable(config)) {
    return {
      state: "running",
      docker: { cliInstalled: true, desktopInstalled: true, daemonRunning: true },
      reachable: true,
    };
  }
  const docker = await ensureDockerRunning({
    timeoutMs: 0,
    autoStart: false,
    env,
  });
  if (!docker.daemonRunning) {
    return {
      state: "docker_unavailable",
      docker,
      reachable: false,
      reason: docker.reason ?? "No container engine is running.",
    };
  }
  return { state: "stopped", docker, reachable: false };
}

export interface StartResult {
  started: boolean;
  status: StackStatus;
  /** Compose output, kept for the settings panel's diagnostics. */
  log: string;
}

/**
 * Bring the stack up and wait for the web app to answer.
 *
 * Cold starts pull four images and run the Prisma migrations on first boot, so
 * this is slow the first time and quick afterwards. The caller passes the budget
 * it is willing to wait; running out is reported as `starting` rather than as a
 * failure, because the containers really are still coming up.
 */
export async function startStack(input: {
  config: InboxZeroConfig;
  credentials: InboxZeroCredentials;
  model: Record<string, string>;
  env?: NodeJS.ProcessEnv;
}): Promise<StartResult> {
  const env = input.env ?? process.env;
  const { config } = input;

  if (!cloneInstalled(config)) {
    return {
      started: false,
      status: await stackStatus(config, env),
      log: "",
    };
  }

  if (await webReachable(config)) {
    return {
      started: true,
      status: { state: "running", docker: await dockerOnly(env), reachable: true },
      log: "",
    };
  }

  const docker = await ensureDockerRunning({
    timeoutMs: 120_000,
    autoStart: config.autoStartDocker,
    suppressUi: config.suppressDockerUi,
    env,
  });
  if (!docker.daemonRunning) {
    return {
      started: false,
      status: {
        state: "docker_unavailable",
        docker,
        reachable: false,
        reason: docker.reason ?? "The container engine is not running.",
      },
      log: "",
    };
  }

  writeOverride(config, renderOverride(config, input.credentials, input.model));

  const compose = await composeCommand(env);
  if (!compose) {
    return {
      started: false,
      status: { state: "docker_unavailable", docker, reachable: false, reason: "No compose command is available." },
      log: "",
    };
  }

  const [command, ...leading] = compose;
  const result = await run(
    command,
    [...leading, ...composeArgs(config), "up", "-d", "--remove-orphans"],
    {
      cwd: config.cloneRoot,
      timeoutMs: Math.max(config.readyTimeoutMs, 300_000),
      // Compose interpolates `${VAR}` from its own environment. Supplying the
      // same values the override sets keeps the two from disagreeing when
      // upstream reads a variable Breadboard has not overridden.
      env: {
        ...env,
        POSTGRES_USER: "postgres",
        POSTGRES_DB: "inboxzero",
        POSTGRES_PASSWORD: input.credentials.postgresPassword,
        UPSTASH_REDIS_TOKEN: input.credentials.redisToken,
        CRON_SECRET: input.credentials.cronSecret,
        WEB_PORT: String(config.ports.web),
      },
    },
  );
  const log = `${result.stdout}\n${result.stderr}`.trim();

  const deadline = Date.now() + config.readyTimeoutMs;
  while (Date.now() < deadline) {
    if (await webReachable(config)) {
      return {
        started: true,
        status: { state: "running", docker, reachable: true },
        log,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return {
    started: false,
    status: {
      state: "starting",
      docker,
      reachable: false,
      reason: "Inbox Zero is still starting. First start pulls its images and migrates its database.",
    },
    log,
  };
}

export async function stopStack(
  config: InboxZeroConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const compose = await composeCommand(env);
  if (!compose || !cloneInstalled(config) || !existsSync(config.overrideFile)) return false;
  const [command, ...leading] = compose;
  const result = await run(command, [...leading, ...composeArgs(config), "down"], {
    cwd: config.cloneRoot,
    timeoutMs: 120_000,
    env,
  });
  return result.code === 0;
}

async function dockerOnly(env: NodeJS.ProcessEnv): Promise<DockerStatus> {
  return ensureDockerRunning({ timeoutMs: 0, autoStart: false, env });
}
