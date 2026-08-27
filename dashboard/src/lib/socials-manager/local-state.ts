// Process-free Postiz state shared by the dashboard and the Runtime-owned
// coordinator. This module may read Breadboard's credential file and probe the
// loopback Postiz HTTP endpoint, but it deliberately cannot import Docker,
// Compose, WSL, or child_process.

import { randomBytes } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";

import type { SocialsManagerConfig, PostizCredentials } from "./config.ts";

export type StackState =
  | "running"
  | "starting"
  | "stopped"
  | "docker_unavailable"
  | "not_installed";

export interface StackStatus {
  state: StackState;
  /** Present only on an explicit engine diagnostic performed by the coordinator. */
  docker?: {
    cliInstalled: boolean;
    desktopInstalled: boolean;
    daemonRunning: boolean;
    reason?: string;
  };
  reachable: boolean;
  reason?: string;
}

export function readCredentials(config: SocialsManagerConfig): PostizCredentials | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(config.credentialsFile, "utf8"),
    ) as Partial<PostizCredentials>;
    if (!parsed.email || !parsed.password || !parsed.jwtSecret) return null;
    return {
      email: parsed.email,
      password: parsed.password,
      apiKey: parsed.apiKey ?? "",
      jwtSecret: parsed.jwtSecret,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeCredentials(
  config: SocialsManagerConfig,
  credentials: PostizCredentials,
): void {
  fs.mkdirSync(config.stateDir, { recursive: true });
  fs.writeFileSync(
    config.credentialsFile,
    `${JSON.stringify(credentials, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export function ensureCredentials(config: SocialsManagerConfig): PostizCredentials {
  const existing = readCredentials(config);
  if (existing) return existing;
  const credentials: PostizCredentials = {
    email: "breadboard@localhost.local",
    password: randomBytes(24).toString("base64url"),
    apiKey: "",
    jwtSecret: randomBytes(48).toString("base64url"),
    createdAt: new Date().toISOString(),
  };
  writeCredentials(config, credentials);
  return credentials;
}

/** Does the Postiz backend answer yet (not merely its frontend/nginx shell)? */
export async function reachable(config: SocialsManagerConfig): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${config.appApiUrl}/auth/can-register`, {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
