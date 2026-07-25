// Read-only view of the ChatGPT account ChatMock is currently signed in as,
// plus the sign-out half of account switching.
//
// The selection rules mirror `chatmock/chatmock/utils.py:_read_auth_file_with_path`
// exactly, because that is the file the running `chatmock serve` process reads
// on every upstream request (`get_effective_chatgpt_auth`). Reporting a
// different profile than the proxy actually uses would make the settings panel
// lie about which account is answering.

import fs from "fs";
import os from "os";
import path from "path";

export type ChatmockPlan =
  | "Free"
  | "Plus"
  | "Pro"
  | "Team"
  | "Enterprise"
  | "Unknown";

export interface ChatmockAccount {
  signedIn: boolean;
  email: string | null;
  plan: ChatmockPlan;
  accountId: string | null;
  lastRefresh: string | null;
  /** Absolute path of the auth.json ChatMock resolves to, when one is readable. */
  authPath: string | null;
  /** Where that path came from, for the "signed in via" hint in the UI. */
  profile: "configured" | "chatmock" | "codex" | null;
  /** Other readable profiles that would take over if this one is signed out. */
  fallbackProfiles: string[];
}

interface AuthFileTokens {
  id_token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  account_id?: unknown;
}

interface AuthFile {
  auth_mode?: unknown;
  tokens?: AuthFileTokens;
  last_refresh?: unknown;
}

const SIGNED_OUT: ChatmockAccount = {
  signedIn: false,
  email: null,
  plan: "Unknown",
  accountId: null,
  lastRefresh: null,
  authPath: null,
  profile: null,
  fallbackProfiles: [],
};

const PLAN_LABELS: Record<string, ChatmockPlan> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
};

function trimEnv(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function uniqueAuthPaths(homes: Array<string | null>): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const home of homes) {
    if (!home) continue;
    const authPath = path.resolve(home, "auth.json");
    const key = process.platform === "win32" ? authPath.toLowerCase() : authPath;
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(authPath);
  }
  return paths;
}

function readAuthPath(authPath: string): AuthFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AuthFile)
      : null;
  } catch {
    return null;
  }
}

/** Base64url JWT payload decode. Signatures are never trusted or checked here. */
export function parseJwtClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const parsed = JSON.parse(
      Buffer.from(padded, "base64").toString("utf-8"),
    ) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Freshness ranking used when both ~/.chatgpt-local and ~/.codex hold a
 * profile: newest issued token wins, then file mtime. Mirrors
 * `_auth_freshness` so the dashboard and the proxy never disagree.
 */
function authFreshness(auth: AuthFile, authPath: string): number {
  const lastRefresh =
    typeof auth.last_refresh === "string" ? Date.parse(auth.last_refresh) : NaN;
  if (Number.isFinite(lastRefresh)) return lastRefresh / 1000;

  const issuedAt: number[] = [];
  for (const name of ["access_token", "id_token"] as const) {
    const claims = parseJwtClaims(auth.tokens?.[name]);
    const iat = claims?.iat;
    if (typeof iat === "number" && Number.isFinite(iat)) issuedAt.push(iat);
  }
  if (issuedAt.length) return Math.max(...issuedAt);

  try {
    return fs.statSync(authPath).mtimeMs / 1000;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

function profileLabel(authPath: string, configured: string[]): ChatmockAccount["profile"] {
  if (configured.includes(authPath)) return "configured";
  const home = path.basename(path.dirname(authPath)).toLowerCase();
  if (home === ".codex") return "codex";
  return "chatmock";
}

interface ResolvedAuth {
  auth: AuthFile;
  authPath: string;
  others: string[];
  configured: string[];
}

export function resolveChatmockAuthFile(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): ResolvedAuth | null {
  const configured = uniqueAuthPaths([
    trimEnv(env.CHATGPT_LOCAL_HOME),
    trimEnv(env.CODEX_HOME),
  ]);
  for (const authPath of configured) {
    const auth = readAuthPath(authPath);
    // A configured home stays authoritative, but a missing or malformed file
    // there falls through to the local stores — same as ChatMock.
    if (auth) return { auth, authPath, others: [], configured };
  }

  const defaults = uniqueAuthPaths([
    path.join(homeDir, ".chatgpt-local"),
    path.join(homeDir, ".codex"),
  ]);
  const candidates = defaults.flatMap((authPath) => {
    const auth = readAuthPath(authPath);
    return auth ? [{ auth, authPath }] : [];
  });
  if (!candidates.length) return null;

  const selected = candidates.reduce((best, candidate) =>
    authFreshness(candidate.auth, candidate.authPath) >
    authFreshness(best.auth, best.authPath)
      ? candidate
      : best,
  );
  return {
    ...selected,
    others: candidates
      .filter((candidate) => candidate.authPath !== selected.authPath)
      .map((candidate) => candidate.authPath),
    configured,
  };
}

export function readChatmockAccount(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): ChatmockAccount {
  const resolved = resolveChatmockAuthFile(env, homeDir);
  if (!resolved) return SIGNED_OUT;

  const { auth, authPath } = resolved;
  const idClaims = parseJwtClaims(auth.tokens?.id_token);
  const accessClaims = parseJwtClaims(auth.tokens?.access_token);
  if (!idClaims || !accessClaims) {
    return {
      ...SIGNED_OUT,
      authPath,
      profile: profileLabel(authPath, resolved.configured),
      fallbackProfiles: resolved.others,
    };
  }

  const email =
    typeof idClaims.email === "string" && idClaims.email.trim()
      ? idClaims.email.trim()
      : typeof idClaims.preferred_username === "string"
        ? idClaims.preferred_username.trim() || null
        : null;

  const authClaim = accessClaims["https://api.openai.com/auth"];
  const planRaw =
    authClaim && typeof authClaim === "object" && !Array.isArray(authClaim)
      ? (authClaim as Record<string, unknown>).chatgpt_plan_type
      : undefined;
  const plan =
    typeof planRaw === "string"
      ? PLAN_LABELS[planRaw.toLowerCase()] ?? "Unknown"
      : "Unknown";

  return {
    signedIn: true,
    email,
    plan,
    accountId:
      typeof auth.tokens?.account_id === "string" && auth.tokens.account_id.trim()
        ? auth.tokens.account_id.trim()
        : null,
    lastRefresh:
      typeof auth.last_refresh === "string" && auth.last_refresh.trim()
        ? auth.last_refresh.trim()
        : null,
    authPath,
    profile: profileLabel(authPath, resolved.configured),
    fallbackProfiles: resolved.others,
  };
}

export interface ChatmockSignOutResult {
  signedOut: boolean;
  /** Where the retired credential file was moved, when one was present. */
  archivedPath: string | null;
  detail?: string;
}

/**
 * Retire the active profile by renaming it aside rather than deleting it, so a
 * mistaken sign-out is recoverable and a still-valid refresh token is never
 * destroyed. Only the *selected* profile is touched: renaming ~/.codex/auth.json
 * as a side effect would sign the user out of the Codex CLI too.
 */
export function signOutChatmockAccount(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
  now: Date = new Date(),
): ChatmockSignOutResult {
  const resolved = resolveChatmockAuthFile(env, homeDir);
  if (!resolved) {
    return { signedOut: false, archivedPath: null, detail: "No signed-in profile was found." };
  }
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const archivedPath = `${resolved.authPath}.invalidated-${stamp}`;
  try {
    fs.renameSync(resolved.authPath, archivedPath);
    return { signedOut: true, archivedPath };
  } catch (error) {
    return {
      signedOut: false,
      archivedPath: null,
      detail: error instanceof Error ? error.message : "The credential file could not be retired.",
    };
  }
}
