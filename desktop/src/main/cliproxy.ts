import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ResolvedPaths } from "./path-resolver";

/**
 * CLIProxyAPI, supervised by the desktop app.
 *
 * CLIProxyAPI (router-for-me/CLIProxyAPI, MIT) signs into AI *subscriptions* —
 * Claude Pro/Max, Google Gemini via Antigravity, Kimi, Grok — over OAuth and
 * serves them behind one OpenAI-compatible endpoint. ChatMock registers it as
 * the `cliproxy` provider, so those models reach every Breadboard surface
 * without an API key.
 *
 * Until this module existed only `scripts/dev-all.mjs` started it, so in the
 * desktop app the Subscriptions panel would sign an account in and sync its
 * models into ChatMock — filling the model picker with ids that nothing was
 * listening to serve.
 *
 * ## The contract with the dashboard
 *
 * `dashboard/src/lib/cliproxy/config.ts` resolves the same state from the same
 * places, and the two must agree or the dashboard will drive a proxy that is
 * not the one running. The shared interface is the *file layout* under the
 * home directory, not this code:
 *
 *   <home>/config.yaml       generated per launch; Breadboard owns it
 *   <home>/api-key           bearer ChatMock presents on /v1
 *   <home>/management-key    X-Management-Key for the OAuth endpoints
 *   <home>/auth/             one credential file per signed-in account
 *   <home>/bin/cli-proxy-api the downloaded binary
 *
 * The supervisor additionally exports CLIPROXY_HOME/PORT/BASE_URL/API_KEY/
 * MANAGEMENT_KEY into the dashboard's environment, which that module prefers
 * over its own defaults — so agreement does not depend on both sides deriving
 * the same paths.
 */

export const CLIPROXY_REPO = "router-for-me/CLIProxyAPI";
export const CLIPROXY_DEFAULT_PORT = 8317;

/**
 * Where the binary, config, secrets and OAuth credentials live.
 *
 * Packaged builds keep it with the rest of the mutable data. Dev mode uses
 * `~/.breadboard/cliproxy` rather than `dataRoot` (which is the repo checkout)
 * so the desktop shell and `npm run dev` share one cache and, more importantly,
 * one set of signed-in accounts — re-authorizing every subscription when
 * switching between the two would be its own bug.
 */
export function cliproxyHome(paths: ResolvedPaths): string {
  const configured = process.env["CLIPROXY_HOME"]?.trim();
  if (configured) return path.resolve(configured);
  if (paths.mode === "packaged" || paths.qaMode) {
    return path.join(paths.dataRoot, "cliproxy");
  }
  return path.join(os.homedir(), ".breadboard", "cliproxy");
}

export function cliproxyBinaryPath(home: string): string {
  const configured = process.env["CLIPROXY_BINARY"]?.trim();
  if (configured) return path.resolve(configured);
  const name = process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
  return path.join(home, "bin", name);
}

export function cliproxyConfigPath(home: string): string {
  return path.join(home, "config.yaml");
}

export function cliproxyAuthDir(home: string): string {
  return path.join(home, "auth");
}

export function isCliproxyInstalled(home: string): boolean {
  try {
    return fs.statSync(cliproxyBinaryPath(home)).isFile();
  } catch {
    return false;
  }
}

const MAX_LEGACY_AUTH_FILE_BYTES = 4 * 1024 * 1024;

function directRegularFile(filePath: string, maximumBytes = Number.MAX_SAFE_INTEGER): boolean {
  try {
    const metadata = fs.lstatSync(filePath);
    return (
      metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.size > 0 &&
      metadata.size <= maximumBytes
    );
  } catch {
    return false;
  }
}

function copyDirectFileIfAbsent(
  source: string,
  destination: string,
  maximumBytes = Number.MAX_SAFE_INTEGER,
): boolean {
  if (!directRegularFile(source, maximumBytes) || fs.existsSync(destination)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Runtime V2 owns one subscription home below its mutable data root in every
 * mode. Before the cutover, development used `~/.breadboard/cliproxy`; migrate
 * its executable and OAuth files by copy so an existing Gemini/Kimi/Grok login
 * remains usable. Runtime's newly derived API and management keys deliberately
 * stay authoritative and are never copied from the legacy directory.
 */
export function migrateLegacyCliproxyState(
  legacyHome: string,
  runtimeHome: string,
): { binaryCopied: boolean; authFilesCopied: number } {
  const legacy = path.resolve(legacyHome);
  const runtime = path.resolve(runtimeHome);
  if (legacy === runtime) return { binaryCopied: false, authFilesCopied: 0 };

  const binaryName = process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
  const binaryCopied = copyDirectFileIfAbsent(
    path.join(legacy, "bin", binaryName),
    path.join(runtime, "bin", binaryName),
  );

  const sourceAuth = path.join(legacy, "auth");
  const destinationAuth = path.join(runtime, "auth");
  let authFilesCopied = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(sourceAuth, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (
      copyDirectFileIfAbsent(
        path.join(sourceAuth, entry.name),
        path.join(destinationAuth, entry.name),
        MAX_LEGACY_AUTH_FILE_BYTES,
      )
    ) {
      authFilesCopied += 1;
    }
  }
  return { binaryCopied, authFilesCopied };
}

/**
 * Prepare the data-root executable required by Runtime V2's hot/lean launch
 * profile. Packaged mode uses the reviewed binary bundled under runtime-root;
 * QA remains isolated and never imports a developer's real subscription state.
 */
export async function prepareDevelopmentCliproxyRuntime(
  paths: ResolvedPaths,
  log: (message: string) => void,
  options: {
    legacyHome?: string;
    provision?: typeof provisionCliproxyBinary;
  } = {},
): Promise<void> {
  if (paths.mode !== "dev" || paths.qaMode) return;

  const runtimeHome = path.join(paths.dataRoot, "cliproxy");
  const legacyHome = options.legacyHome ?? path.join(os.homedir(), ".breadboard", "cliproxy");
  const migrated = migrateLegacyCliproxyState(legacyHome, runtimeHome);
  if (migrated.binaryCopied || migrated.authFilesCopied > 0) {
    log(
      `migrated the legacy CLIProxyAPI runtime (${migrated.binaryCopied ? "binary and " : ""}` +
        `${migrated.authFilesCopied} account file${migrated.authFilesCopied === 1 ? "" : "s"})`,
    );
  }
  await (options.provision ?? provisionCliproxyBinary)(runtimeHome, log);
}

/**
 * Loopback shared secrets, read from disk or minted on first use.
 *
 * Deliberately file-backed rather than added to `desktop-config.json` with the
 * other per-install secrets: ChatMock stores the bearer in its own
 * `providers.json` when a subscription catalog is synced, so minting a new one
 * for an existing install would silently invalidate that stored copy and every
 * subscription model would answer 401 until the user re-synced.
 */
function readOrCreateSecret(home: string, fileName: string, envName: string): string {
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return fromEnv;

  const secretPath = path.join(home, fileName);
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // Not there yet — mint one below.
  }
  const secret = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(secretPath, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

export function cliproxyApiKey(home: string): string {
  return readOrCreateSecret(home, "api-key", "CLIPROXY_API_KEY");
}

export function cliproxyManagementKey(home: string): string {
  return readOrCreateSecret(home, "management-key", "CLIPROXY_MANAGEMENT_KEY");
}

function yamlString(value: string): string {
  // Forward slashes even on Windows: the Go binary accepts both and this avoids
  // YAML escaping of backslashes.
  return JSON.stringify(value.replace(/\\/g, "/"));
}

/** The config.yaml the proxy is started with. Regenerated every launch. */
export function renderCliproxyConfig(options: {
  home: string;
  port: number;
  apiKey: string;
  managementKey: string;
}): string {
  return `# Generated by Breadboard (desktop supervisor). Edits are overwritten.
# Loopback only: this process holds subscription OAuth tokens.
host: "127.0.0.1"
port: ${options.port}
auth-dir: ${yamlString(cliproxyAuthDir(options.home))}
api-keys:
  - ${yamlString(options.apiKey)}
debug: false
usage-statistics-enabled: false
logging-to-file: false
# ChatMock owns quota cooldowns and cross-model failover. Retrying a definite
# subscription-quota refusal here only repeats the same failed Google request
# (once per Antigravity project) and can hold the socket past Hermes' first-
# response watchdog. Let the proxy try each eligible project once, then return
# the 429 immediately so ChatMock can cool the Gemini family and use a healthy
# subscription model.
request-retry: 0
max-retry-interval: 30

remote-management:
  # Never expose the management API beyond loopback: it can start OAuth flows
  # and read credential state.
  allow-remote: false
  secret-key: ${yamlString(options.managementKey)}
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

/** Map this machine to a release asset name. */
function assetFor(version: string): { name: string; archive: "zip" | "tar" } | null {
  const arch = os.arch() === "arm64" ? "aarch64" : "amd64";
  if (process.platform === "win32") {
    return { name: `CLIProxyAPI_${version}_windows_${arch}.zip`, archive: "zip" };
  }
  if (process.platform === "darwin") {
    return { name: `CLIProxyAPI_${version}_darwin_${arch}.tar.gz`, archive: "tar" };
  }
  if (process.platform === "linux") {
    return { name: `CLIProxyAPI_${version}_linux_${arch}.tar.gz`, archive: "tar" };
  }
  return null;
}

async function latestVersion(): Promise<string> {
  const pinned = process.env["CLIPROXY_VERSION"]?.trim();
  if (pinned) return pinned.replace(/^v/, "");

  const response = await fetch(
    `https://api.github.com/repos/${CLIPROXY_REPO}/releases/latest`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  const tag =
    typeof body === "object" && body !== null && typeof (body as { tag_name?: unknown }).tag_name === "string"
      ? ((body as { tag_name: string }).tag_name)
      : "";
  if (!tag) throw new Error("no tag_name in the latest release");
  return tag.replace(/^v/, "");
}

function extract(archivePath: string, archiveType: "zip" | "tar", destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  const run = (command: string, args: string[]): number =>
    spawnSync(command, args, { stdio: "ignore" }).status ?? 1;

  const status =
    archiveType === "zip" && process.platform === "win32"
      ? run("powershell", [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath}' -DestinationPath '${destination}' -Force`,
        ])
      : archiveType === "zip"
        ? run("unzip", ["-o", archivePath, "-d", destination])
        : run("tar", ["-xzf", archivePath, "-C", destination]);

  if (status !== 0) throw new Error(`extraction failed (exit ${status})`);
}

function findFile(directory: string, name: string): string | null {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, name);
      if (nested) return nested;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

/**
 * Download the proxy into the home directory when it is not already there.
 *
 * Not bundled into the installer: it is a ~60MB platform-specific Go binary
 * that only users who connect a subscription ever need, and the download is
 * cached across app updates because it lives with the user data rather than in
 * app resources.
 *
 * Callers must treat a rejection as non-fatal — subscriptions are an optional
 * capability and the rest of Breadboard is unaffected by their absence.
 */
export async function provisionCliproxyBinary(
  home: string,
  log: (message: string) => void,
): Promise<void> {
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cliproxyAuthDir(home), { recursive: true });
  if (isCliproxyInstalled(home)) return;

  const version = await latestVersion();
  const asset = assetFor(version);
  if (!asset) throw new Error(`unsupported platform ${process.platform}/${os.arch()}`);

  log(`downloading CLIProxyAPI v${version} (${asset.name})`);
  const response = await fetch(
    `https://github.com/${CLIPROXY_REPO}/releases/download/v${version}/${asset.name}`,
  );
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);

  const stagingDir = path.join(home, "download");
  fs.mkdirSync(stagingDir, { recursive: true });
  const archivePath = path.join(stagingDir, asset.name);
  fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));

  try {
    extract(archivePath, asset.archive, stagingDir);
    const binaryName = process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
    const found = findFile(stagingDir, binaryName);
    if (!found) throw new Error(`${binaryName} not found in the downloaded archive`);

    const target = cliproxyBinaryPath(home);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(found, target);
    if (process.platform !== "win32") fs.chmodSync(target, 0o755);
    log(`installed CLIProxyAPI v${version}`);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

/** Write the config the supervised process is started with. */
export function writeCliproxyConfig(home: string, port: number): string {
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cliproxyAuthDir(home), { recursive: true });
  const configPath = cliproxyConfigPath(home);
  fs.writeFileSync(
    configPath,
    renderCliproxyConfig({
      home,
      port,
      apiKey: cliproxyApiKey(home),
      managementKey: cliproxyManagementKey(home),
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  return configPath;
}
