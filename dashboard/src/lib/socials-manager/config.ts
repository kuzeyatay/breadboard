// Configuration for the real Postiz stack.
//
// Postiz runs as a Docker Compose stack (its own upstream compose file, plus a
// Breadboard-generated override). Breadboard starts the stack itself and, when
// needed, starts Docker only after disabling its dashboard window. Credentials
// minted during bootstrap live next to the app database.

import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

export type SocialsManagerMode = "stack" | "adapter" | "disabled";

export interface SocialsManagerConfig {
  /**
   * `stack`   — drive the real Postiz, auto-starting Docker and the containers,
   *             falling back to local drafting while it comes up.
   * `adapter` — never touch Docker; draft locally only.
   * `disabled` — the agent is off.
   */
  mode: SocialsManagerMode;
  /** Where the Postiz web app and its API are published on the host. */
  baseUrl: string;
  /** The public API root: `<baseUrl>/api/public/v1`. */
  publicApiUrl: string;
  /** The authenticated app API root, used only during bootstrap. */
  appApiUrl: string;
  /** The vendored clone holding the upstream compose file. */
  cloneRoot: string;
  /** Breadboard-owned files: the compose override and minted credentials. */
  stateDir: string;
  overrideFile: string;
  credentialsFile: string;
  /** Compose project name, so Breadboard's stack is addressable on its own. */
  projectName: string;
  /** How long to wait for the stack to answer before falling back. */
  readyTimeoutMs: number;
  /** Whether Breadboard may launch the container engine when it is down. */
  autoStartDocker: boolean;
  /**
   * Stop Docker Desktop's dashboard opening when Breadboard starts it. This is
   * on by default because a background integration must not steal focus.
   */
  suppressDockerUi: boolean;
}

const DEFAULT_PORT = 4007;

/**
 * Read a setting under its current name, falling back to the `POSTIZ_` name it
 * had before the agent was renamed.
 *
 * Environment variables live in files Breadboard does not own — a `.env`, a
 * shell profile, a deployment's secret store — so renaming one cannot be a
 * migration. An old name that silently stopped being read would look exactly
 * like the setting not working, which is the worst way for a rename to fail.
 */
export function socialsManagerEnv(
  env: NodeJS.ProcessEnv,
  suffix: string,
): string | undefined {
  const current = env[`SOCIALS_MANAGER_${suffix}`];
  if (current !== undefined && current.trim() !== "") return current;
  return env[`POSTIZ_${suffix}`];
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

export function socialsManagerMode(env: NodeJS.ProcessEnv = process.env): SocialsManagerMode {
  const raw = socialsManagerEnv(env, "MODE")?.trim().toLowerCase();
  if (raw === "disabled" || raw === "off") return "disabled";
  if (raw === "adapter" || raw === "local") return "adapter";
  return "stack";
}

export function resolveSocialsManagerConfig(
  env: NodeJS.ProcessEnv = process.env,
): SocialsManagerConfig {
  const baseUrl = (socialsManagerEnv(env, "URL")?.trim() || `http://localhost:${DEFAULT_PORT}`)
    .replace(/\/$/, "");
  // Named for the service whose credentials and compose override it holds, and
  // deliberately left alone by the rename: moving it would strand the API key
  // bootstrap already minted against the running stack.
  const stateDir = path.join(dashboardDataDir(), "postiz");

  return {
    mode: socialsManagerMode(env),
    baseUrl,
    publicApiUrl: `${baseUrl}/api/public/v1`,
    appApiUrl: `${baseUrl}/api`,
    cloneRoot:
      socialsManagerEnv(env, "ROOT")?.trim() || path.join(repositoryRoot(), "postiz-app"),
    stateDir,
    overrideFile: path.join(stateDir, "docker-compose.breadboard.yaml"),
    credentialsFile: path.join(stateDir, "credentials.json"),
    projectName: socialsManagerEnv(env, "PROJECT")?.trim() || "breadboard-postiz",
    readyTimeoutMs: Number(socialsManagerEnv(env, "READY_TIMEOUT_MS")?.trim() || 20_000),
    autoStartDocker: flag(socialsManagerEnv(env, "AUTOSTART_DOCKER"), true),
    suppressDockerUi: flag(socialsManagerEnv(env, "SUPPRESS_DOCKER_UI"), true),
  };
}

export interface PostizCredentials {
  email: string;
  password: string;
  /** The organization API key the public API authenticates with. */
  apiKey: string;
  jwtSecret: string;
  createdAt: string;
}
