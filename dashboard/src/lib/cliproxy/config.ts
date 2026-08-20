import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * CLIProxyAPI runtime configuration.
 *
 * CLIProxyAPI (https://github.com/router-for-me/CLIProxyAPI, MIT) is a Go proxy
 * for Google (via Antigravity), Kimi and Grok subscription OAuth. Claude is
 * deliberately different: the official Claude Code CLI owns its login, while
 * ChatMock adapts Claude Code into the same public `cliproxy/<model>` namespace.
 * That keeps one subscription catalog without handing Claude credentials to a
 * third-party proxy.
 *
 * This module owns paths, the generated YAML, and the local secrets. It is
 * imported by both the dashboard server and scripts/start-cliproxy.mjs, so it
 * must stay free of Next-only imports.
 */

export const CLIPROXY_DEFAULT_PORT = 8317;
export const CLIPROXY_REPO = "router-for-me/CLIProxyAPI";

/** Providers this build can authorize over OAuth, verified against v7.2.111. */
export interface CliproxyProviderSpec {
  id: string;
  label: string;
  /** Management endpoint prefix: `/v0/management/<endpoint>`. */
  endpoint: string;
  /** Credential filenames in auth-dir start with one of these. */
  filePrefixes: string[];
  /** `redirect` opens a browser page; `device` shows a code to type. */
  flow: "redirect" | "device";
  /**
   * Who makes the models this sign-in unlocks. The account list and the model
   * picker are named the same way, so "Claude" and "Anthropic" cannot look like
   * two different things.
   */
  vendorLabel: string;
  description: string;
  /**
   * True when this vendor can only ever hold one signed-in account, so the UI
   * disables "Add another". Claude is the only one: its credential belongs to
   * the official Claude Code CLI, which keeps a single login at a time, and
   * signing in again replaces it rather than adding a sibling.
   */
  singleAccount?: boolean;
}

export const CLIPROXY_PROVIDERS: readonly CliproxyProviderSpec[] = [
  {
    id: "claude",
    label: "Claude",
    // Shared settings metadata only. Claude branches to the official CLI
    // before this legacy management endpoint can be used.
    endpoint: "anthropic-auth-url",
    filePrefixes: ["claude-", "anthropic-"],
    flow: "redirect",
    vendorLabel: "Anthropic",
    description: "Your Claude Pro or Max subscription.",
    singleAccount: true,
  },
  // ChatGPT is deliberately absent. CLIProxyAPI can sign into it
  // (`codex-auth-url`), but ChatMock already owns that account through its own
  // OAuth on the Account tab — and does more with it: the Responses API,
  // reasoning efforts, fast mode, prompt caching and rate-limit tracking, none
  // of which survive a trip through a generic chat-completions proxy. Offering
  // both produced two sign-ins for one account and two model ids per model.
  // See CHATGPT_VIA_CLIPROXY_NOTE below.
  {
    id: "antigravity",
    label: "Google Gemini",
    endpoint: "antigravity-auth-url",
    filePrefixes: ["antigravity-"],
    flow: "redirect",
    vendorLabel: "Google",
    description: "Gemini models through a Google account (Antigravity).",
  },
  {
    id: "kimi",
    label: "Kimi",
    endpoint: "kimi-auth-url",
    filePrefixes: ["kimi-"],
    flow: "device",
    vendorLabel: "Moonshot",
    description: "Kimi Code subscription.",
  },
  {
    id: "xai",
    label: "Grok (xAI)",
    endpoint: "xai-auth-url",
    filePrefixes: ["xai-"],
    flow: "device",
    vendorLabel: "xAI",
    description: "Grok through an x.ai account.",
  },
] as const;

export function cliproxyProvider(id: string): CliproxyProviderSpec | null {
  return CLIPROXY_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/**
 * Credential prefixes CLIProxyAPI writes for accounts Breadboard does not
 * manage here. A ChatGPT account can still end up in the proxy's auth-dir if it
 * was added with CLIProxyAPI's own CLI; ChatMock serves the same models
 * natively, so those are filtered out of the synced catalog rather than
 * appearing a second time under `cliproxy/`.
 */
export const CHATGPT_VIA_CLIPROXY_NOTE = "codex-";

/** Breadboard's own directory for the binary, config and OAuth credentials. */
export function cliproxyHome(): string {
  const configured = process.env.CLIPROXY_HOME?.trim();
  if (configured) return path.resolve(configured);
  const base =
    process.env.BREADBOARD_DATA_DIR?.trim() ||
    path.join(os.homedir(), ".breadboard");
  return path.join(base, "cliproxy");
}

export function cliproxyBinaryPath(): string {
  const configured = process.env.CLIPROXY_BINARY?.trim();
  if (configured) return path.resolve(configured);
  const name = process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
  return path.join(cliproxyHome(), "bin", name);
}

export function cliproxyConfigPath(): string {
  return path.join(cliproxyHome(), "config.yaml");
}

/** OAuth credentials land here, one file per signed-in account. */
export function cliproxyAuthDir(): string {
  return path.join(cliproxyHome(), "auth");
}

export function cliproxyPort(): number {
  const raw = process.env.CLIPROXY_PORT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : CLIPROXY_DEFAULT_PORT;
}

export function cliproxyBaseUrl(): string {
  const configured = process.env.CLIPROXY_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${cliproxyPort()}/v1`;
}

export function cliproxyManagementUrl(): string {
  return `http://127.0.0.1:${cliproxyPort()}/v0/management`;
}

/**
 * Local shared secrets. Both are loopback-only credentials, not user secrets,
 * but they are generated per install rather than hardcoded so a process on the
 * machine cannot guess them and drive the management API.
 */
function readOrCreateSecret(fileName: string, envName: string): string {
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return fromEnv;

  const secretPath = path.join(cliproxyHome(), fileName);
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // Fall through and mint one.
  }

  const secret = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(cliproxyHome(), { recursive: true });
  fs.writeFileSync(secretPath, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

/** Bearer token ChatMock presents when calling CLIProxyAPI's OpenAI surface. */
export function cliproxyApiKey(): string {
  return readOrCreateSecret("api-key", "CLIPROXY_API_KEY");
}

/** `X-Management-Key` for the OAuth/management endpoints. */
export function cliproxyManagementKey(): string {
  return readOrCreateSecret("management-key", "CLIPROXY_MANAGEMENT_KEY");
}

function yamlString(value: string): string {
  // Forward slashes even on Windows: the Go binary accepts both and this avoids
  // YAML escaping of backslashes.
  return JSON.stringify(value.replace(/\\/g, "/"));
}

/** Render the config.yaml CLIProxyAPI is started with. */
export function renderCliproxyConfig(options?: {
  port?: number;
  authDir?: string;
  apiKey?: string;
  managementKey?: string;
}): string {
  const port = options?.port ?? cliproxyPort();
  const authDir = options?.authDir ?? cliproxyAuthDir();
  const apiKey = options?.apiKey ?? cliproxyApiKey();
  const managementKey = options?.managementKey ?? cliproxyManagementKey();

  return `# Generated by Breadboard (scripts/start-cliproxy.mjs). Edits are overwritten.
# Loopback only: this process holds subscription OAuth tokens.
host: "127.0.0.1"
port: ${port}
auth-dir: ${yamlString(authDir)}
api-keys:
  - ${yamlString(apiKey)}
debug: false
usage-statistics-enabled: false
logging-to-file: false
request-retry: 3
max-retry-interval: 30

remote-management:
  # Never expose the management API beyond loopback: it can start OAuth flows
  # and read credential state.
  allow-remote: false
  secret-key: ${yamlString(managementKey)}
  # Breadboard drives OAuth from its own settings UI; the bundled control panel
  # would be a second, unauthenticated surface onto the same actions.
  disable-control-panel: true

quota-exceeded:
  switch-project: true
  switch-preview-model: false

routing:
  strategy: "round-robin"
`;
}

/** True when the binary has been downloaded. */
export function isCliproxyInstalled(): boolean {
  try {
    return fs.statSync(cliproxyBinaryPath()).isFile();
  } catch {
    return false;
  }
}

export interface CliproxyAccount {
  provider: string;
  label: string;
  /** Vendor behind the models, e.g. Anthropic for a Claude sign-in. */
  vendorLabel: string;
  file: string;
  /** Who the credential belongs to — usually the email CLIProxyAPI named it after. */
  account: string;
}

/**
 * Signed-in accounts, read from the credential files in auth-dir. CLIProxyAPI
 * writes one file per account; the filename prefix identifies the provider and
 * the remainder is the account it was issued for
 * (`claude-someone@example.com.json`).
 */
export function readCliproxyAccounts(): CliproxyAccount[] {
  let files: string[];
  try {
    files = fs.readdirSync(cliproxyAuthDir());
  } catch {
    return [];
  }

  const accounts: CliproxyAccount[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const spec = CLIPROXY_PROVIDERS.find((provider) =>
      provider.filePrefixes.some((prefix) => file.startsWith(prefix)),
    );
    if (!spec) continue;

    const prefix = spec.filePrefixes.find((candidate) => file.startsWith(candidate)) ?? "";
    const identity = file.slice(prefix.length).replace(/\.json$/i, "").trim();
    accounts.push({
      provider: spec.id,
      label: spec.label,
      vendorLabel: spec.vendorLabel,
      file,
      account: identity || "Signed in",
    });
  }
  return accounts;
}
