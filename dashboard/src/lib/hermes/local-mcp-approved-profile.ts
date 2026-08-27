import crypto from "node:crypto";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";

export const LOCAL_MCP_PROFILE_REVISION = 1 as const;

const PROFILE_DIGEST = /^[a-f0-9]{64}$/u;
const SLUG = /^[a-z0-9_-]{1,48}$/u;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const MAX_PROFILE_BYTES = 512 * 1024;
const MAX_LAUNCH_ENVELOPE_BYTES = 512 * 1024;
const MAX_ENVIRONMENT_BYTES = 256 * 1024;
const MAX_EXECUTABLE_BYTES = 1024 * 1024 * 1024;
const LAUNCH_ENVELOPE_LIFETIME_MS = 60_000;
const LAUNCH_ENVELOPE_AAD = Buffer.from(
  "breadboard/local-mcp/launch-envelope/v1",
  "utf8",
);

export interface LegacyApprovedLocalMcpDefinition {
  transport: "local";
  executable: string;
  args: string[];
  cwd?: string;
  environmentNames: string[];
  timeout: number;
}

export interface ApprovedLocalMcpProfileReference {
  transport: "local";
  profileRevision: typeof LOCAL_MCP_PROFILE_REVISION;
  profileDigest: string;
}

export interface ApprovedLocalMcpProfile {
  schemaVersion: typeof LOCAL_MCP_PROFILE_REVISION;
  scope: {
    userId: number;
    slug: string;
  };
  executable: {
    path: string;
    sizeBytes: number;
    sha256: string;
  };
  arguments: string[];
  cwd: string | null;
  environmentNames: string[];
  timeoutMs: number;
}

interface ProfileOptions {
  registryRoot?: string;
  environment?: NodeJS.ProcessEnv;
}

interface LaunchOptions extends ProfileOptions {
  token?: string;
  now?: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function safeSlug(value: string): string {
  if (!SLUG.test(value)) fail("The approved local MCP scope is invalid.");
  return value;
}

function safeUserId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("The approved local MCP scope is invalid.");
  }
  return value;
}

function ensurePrivateDirectory(directory: string, label: string): string {
  const resolved = path.resolve(directory);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${label} is unavailable.`);
  }
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) fail(`${label} is indirect.`);
  try {
    fs.chmodSync(canonical, 0o700);
  } catch {
    // Windows enforces the private data-root ACL outside POSIX mode bits.
  }
  return canonical;
}

function directRegularFile(filePath: string, label: string): string {
  const canonical = fs.realpathSync.native(path.resolve(filePath));
  const metadata = fs.lstatSync(canonical);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${label} is unavailable.`);
  if (!samePath(fs.realpathSync.native(canonical), canonical)) fail(`${label} is indirect.`);
  return canonical;
}

function directDirectory(directory: string, label: string): string {
  const canonical = fs.realpathSync.native(path.resolve(directory));
  const metadata = fs.lstatSync(canonical);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(`${label} is unavailable.`);
  if (!samePath(fs.realpathSync.native(canonical), canonical)) fail(`${label} is indirect.`);
  return canonical;
}

function registryRoot(options: ProfileOptions = {}): string {
  const environment = options.environment ?? process.env;
  const configured = options.registryRoot ??
    environment.BREADBOARD_LOCAL_MCP_REGISTRY_ROOT?.trim() ??
    (environment.BREADBOARD_DATA_DIR?.trim()
      ? path.join(environment.BREADBOARD_DATA_DIR.trim(), "runtime-v2", "local-mcp-definitions")
      : path.join(process.cwd(), ".runtime-v2", "local-mcp-definitions"));
  if (!configured || !path.isAbsolute(configured) || /[\u0000\r\n]/u.test(configured)) {
    fail("The local MCP approved-definition registry is not configured.");
  }
  return ensurePrivateDirectory(configured, "The local MCP approved-definition registry");
}

function scopeDirectory(
  root: string,
  branch: "definitions" | "launch",
  userId: number,
  slug: string,
  create = true,
): string {
  const directory = path.join(root, branch, `user-${safeUserId(userId)}`, safeSlug(slug));
  return create
    ? ensurePrivateDirectory(directory, `The local MCP ${branch} scope`)
    : directDirectory(directory, `The local MCP ${branch} scope`);
}

function readBoundedDirectFile(filePath: string, maximumBytes: number, label: string): Buffer {
  const resolved = path.resolve(filePath);
  const before = fs.lstatSync(resolved);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > maximumBytes ||
    !samePath(fs.realpathSync.native(resolved), resolved)
  ) fail(`${label} is not a bounded direct regular file.`);
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== before.size) {
      fail(`${label} changed while opening.`);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      bytes.byteLength !== opened.size ||
      after.size !== opened.size ||
      after.nlink !== 1 ||
      after.mtimeMs !== opened.mtimeMs ||
      (opened.ino !== 0 && after.ino !== opened.ino)
    ) fail(`${label} changed while it was read.`);
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function hashExecutable(filePath: string): { sizeBytes: number; sha256: string } {
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > MAX_EXECUTABLE_BYTES) {
      fail("The approved local MCP executable exceeds its safe bound.");
    }
    const digest = crypto.createHash("sha256");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const count = fs.readSync(descriptor, chunk, 0, chunk.byteLength, null);
      if (count === 0) break;
      digest.update(chunk.subarray(0, count));
    }
    const after = fs.fstatSync(descriptor);
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      (before.ino !== 0 && after.ino !== before.ino)
    ) fail("The approved local MCP executable changed during approval.");
    return { sizeBytes: before.size, sha256: digest.digest("hex") };
  } finally {
    fs.closeSync(descriptor);
  }
}

function executableCandidates(
  executable: string,
  cwd: string | null,
  environment: NodeJS.ProcessEnv,
): string[] {
  if (path.isAbsolute(executable)) return [executable];
  if (/[\\/]/u.test(executable)) return [path.resolve(cwd ?? process.cwd(), executable)];
  const search = (environment.PATH ?? environment.Path ?? environment.path ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const extensions = process.platform === "win32"
    ? (path.extname(executable)
        ? [""]
        : (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
            .split(";")
            .filter(Boolean)
            .map((value) => value.toLowerCase()))
    : [""];
  return search.flatMap((directory) =>
    extensions.map((extension) => path.join(directory, `${executable}${extension}`)));
}

function resolveExecutable(
  executable: string,
  cwd: string | null,
  environment: NodeJS.ProcessEnv,
): string {
  if (
    !executable ||
    executable.trim() !== executable ||
    Buffer.byteLength(executable, "utf8") > 4_096 ||
    /[\u0000\r\n]/u.test(executable)
  ) fail("The approved local MCP executable is invalid.");
  for (const candidate of executableCandidates(executable, cwd, environment)) {
    try {
      return directRegularFile(candidate, "The approved local MCP executable");
    } catch {
      // Continue the trusted server-side executable search.
    }
  }
  fail("The approved local MCP executable is unavailable.");
}

function validatedDefinition(
  definition: LegacyApprovedLocalMcpDefinition,
  environment: NodeJS.ProcessEnv,
): ApprovedLocalMcpProfile["executable"] & {
  arguments: string[];
  cwd: string | null;
  environmentNames: string[];
  timeoutMs: number;
} {
  if (!definition || definition.transport !== "local") {
    fail("The approved local MCP definition is invalid.");
  }
  const cwd = definition.cwd
    ? directDirectory(definition.cwd, "The approved local MCP working directory")
    : null;
  if (
    !Array.isArray(definition.args) ||
    definition.args.length > 100 ||
    definition.args.some((value) =>
      typeof value !== "string" ||
      Buffer.byteLength(value, "utf8") > 2_000 ||
      /[\u0000\r\n]/u.test(value))
  ) fail("The approved local MCP arguments are invalid.");
  if (
    !Array.isArray(definition.environmentNames) ||
    definition.environmentNames.length > 50 ||
    new Set(definition.environmentNames).size !== definition.environmentNames.length ||
    definition.environmentNames.some((name) => !ENVIRONMENT_NAME.test(name))
  ) fail("The approved local MCP environment names are invalid.");
  if (
    !Number.isSafeInteger(definition.timeout) ||
    definition.timeout < 1_000 ||
    definition.timeout > 120_000
  ) fail("The approved local MCP timeout is invalid.");
  const executablePath = resolveExecutable(definition.executable, cwd, environment);
  const executable = hashExecutable(executablePath);
  return {
    path: executablePath,
    ...executable,
    arguments: [...definition.args],
    cwd,
    environmentNames: [...definition.environmentNames],
    timeoutMs: definition.timeout,
  };
}

function validateProfile(value: unknown, userId: number, slug: string): ApprovedLocalMcpProfile {
  if (
    !exactRecord(value, [
      "schemaVersion", "scope", "executable", "arguments", "cwd", "environmentNames",
      "timeoutMs",
    ]) ||
    value.schemaVersion !== LOCAL_MCP_PROFILE_REVISION ||
    !exactRecord(value.scope, ["userId", "slug"]) ||
    value.scope.userId !== userId ||
    value.scope.slug !== slug ||
    !exactRecord(value.executable, ["path", "sizeBytes", "sha256"]) ||
    typeof value.executable.path !== "string" ||
    !path.isAbsolute(value.executable.path) ||
    Buffer.byteLength(value.executable.path, "utf8") > 4_096 ||
    /[\u0000\r\n]/u.test(value.executable.path) ||
    typeof value.executable.sizeBytes !== "number" ||
    !Number.isSafeInteger(value.executable.sizeBytes) ||
    value.executable.sizeBytes < 1 ||
    value.executable.sizeBytes > MAX_EXECUTABLE_BYTES ||
    typeof value.executable.sha256 !== "string" ||
    !PROFILE_DIGEST.test(value.executable.sha256) ||
    !Array.isArray(value.arguments) ||
    value.arguments.length > 100 ||
    value.arguments.some((argument) =>
      typeof argument !== "string" ||
      Buffer.byteLength(argument, "utf8") > 2_000 ||
      /[\u0000\r\n]/u.test(argument)) ||
    (value.cwd !== null &&
      (typeof value.cwd !== "string" ||
        !path.isAbsolute(value.cwd) ||
        Buffer.byteLength(value.cwd, "utf8") > 4_096 ||
        /[\u0000\r\n]/u.test(value.cwd))) ||
    !Array.isArray(value.environmentNames) ||
    value.environmentNames.length > 50 ||
    new Set(value.environmentNames).size !== value.environmentNames.length ||
    value.environmentNames.some((name) => typeof name !== "string" || !ENVIRONMENT_NAME.test(name)) ||
    typeof value.timeoutMs !== "number" ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 1_000 ||
    value.timeoutMs > 120_000
  ) fail("The approved local MCP profile is invalid.");
  return value as unknown as ApprovedLocalMcpProfile;
}

function profilePath(
  userId: number,
  slug: string,
  digest: string,
  options: ProfileOptions = {},
  create = true,
): string {
  if (!PROFILE_DIGEST.test(digest)) fail("The approved local MCP profile digest is invalid.");
  return path.join(
    scopeDirectory(registryRoot(options), "definitions", userId, slug, create),
    `${digest}.json`,
  );
}

export function sealApprovedLocalMcpProfile(
  userId: number,
  slug: string,
  definition: LegacyApprovedLocalMcpDefinition,
  options: ProfileOptions = {},
): { reference: ApprovedLocalMcpProfileReference; profile: ApprovedLocalMcpProfile } {
  safeUserId(userId);
  safeSlug(slug);
  const environment = options.environment ?? process.env;
  const validated = validatedDefinition(definition, environment);
  const profile: ApprovedLocalMcpProfile = {
    schemaVersion: LOCAL_MCP_PROFILE_REVISION,
    scope: { userId, slug },
    executable: {
      path: validated.path,
      sizeBytes: validated.sizeBytes,
      sha256: validated.sha256,
    },
    arguments: validated.arguments,
    cwd: validated.cwd,
    environmentNames: validated.environmentNames,
    timeoutMs: validated.timeoutMs,
  };
  const bytes = Buffer.from(`${JSON.stringify(profile)}\n`, "utf8");
  if (bytes.byteLength > MAX_PROFILE_BYTES) fail("The approved local MCP profile is too large.");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const target = profilePath(userId, slug, digest, options);
  const pending = `${target}.pending-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  try {
    const descriptor = fs.openSync(pending, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    try {
      fs.linkSync(pending, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
  } finally {
    fs.rmSync(pending, { force: true });
  }
  if (fs.existsSync(target)) {
    const existing = readBoundedDirectFile(target, MAX_PROFILE_BYTES, "The approved local MCP profile");
    if (existing.byteLength !== bytes.byteLength || !crypto.timingSafeEqual(existing, bytes)) {
      fail("The approved local MCP profile collided with different bytes.");
    }
  } else {
    fail("The approved local MCP profile could not be published.");
  }
  return {
    reference: {
      transport: "local",
      profileRevision: LOCAL_MCP_PROFILE_REVISION,
      profileDigest: digest,
    },
    profile,
  };
}

export function loadApprovedLocalMcpProfile(
  userId: number,
  slug: string,
  reference: ApprovedLocalMcpProfileReference,
  options: ProfileOptions = {},
): ApprovedLocalMcpProfile {
  if (
    reference.transport !== "local" ||
    reference.profileRevision !== LOCAL_MCP_PROFILE_REVISION ||
    !PROFILE_DIGEST.test(reference.profileDigest)
  ) fail("The approved local MCP profile reference is invalid.");
  const bytes = readBoundedDirectFile(
    profilePath(userId, slug, reference.profileDigest, options, false),
    MAX_PROFILE_BYTES,
    "The approved local MCP profile",
  );
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== reference.profileDigest) fail("The approved local MCP profile digest mismatched.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("The approved local MCP profile is not valid JSON.");
  }
  return validateProfile(parsed, userId, slug);
}

function launchToken(value: string | undefined): string {
  const token = value?.trim();
  const bytes = token ? Buffer.from(token, "utf8") : Buffer.alloc(0);
  if (
    !token ||
    bytes.byteLength < 32 ||
    bytes.byteLength > 1_024 ||
    !bytes.every((byte) => byte >= 0x21 && byte <= 0x7e)
  ) fail("The local MCP launch-envelope authority is unavailable.");
  return token;
}

function launchKey(token: string): Buffer {
  return crypto
    .createHash("sha256")
    .update("breadboard/local-mcp/launch-key/v1\0", "utf8")
    .update(token, "utf8")
    .digest();
}

export function prepareApprovedLocalMcpLaunch(
  userId: number,
  slug: string,
  reference: ApprovedLocalMcpProfileReference,
  options: LaunchOptions = {},
): { envelopePath: string; expiresAtMs: number } {
  const environment = options.environment ?? process.env;
  const profile = loadApprovedLocalMcpProfile(userId, slug, reference, options);
  const selectedEnvironment = Object.fromEntries(profile.environmentNames.flatMap((name) => {
    const value = environment[name];
    return value === undefined ? [] : [[name, value]];
  }));
  let environmentBytes = 0;
  for (const [name, value] of Object.entries(selectedEnvironment)) {
    if (!ENVIRONMENT_NAME.test(name) || typeof value !== "string" || /\u0000/u.test(value)) {
      fail("The approved local MCP launch environment is invalid.");
    }
    environmentBytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
  }
  if (environmentBytes > MAX_ENVIRONMENT_BYTES) {
    fail("The approved local MCP launch environment is too large.");
  }
  const createdAtMs = options.now ?? Date.now();
  const expiresAtMs = createdAtMs + LAUNCH_ENVELOPE_LIFETIME_MS;
  const payload = Buffer.from(JSON.stringify({
    schemaVersion: LOCAL_MCP_PROFILE_REVISION,
    scope: { userId, slug },
    profile: {
      revision: reference.profileRevision,
      digest: reference.profileDigest,
    },
    createdAtMs,
    expiresAtMs,
    environment: selectedEnvironment,
  }), "utf8");
  if (payload.byteLength > MAX_LAUNCH_ENVELOPE_BYTES / 2) {
    fail("The approved local MCP launch envelope is too large.");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", launchKey(launchToken(
    options.token ?? environment.BREADBOARD_LOCAL_MCP_BROKER_TOKEN,
  )), iv);
  cipher.setAAD(LAUNCH_ENVELOPE_AAD);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const envelope = Buffer.from(`${JSON.stringify({
    schemaVersion: LOCAL_MCP_PROFILE_REVISION,
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  })}\n`, "utf8");
  if (envelope.byteLength > MAX_LAUNCH_ENVELOPE_BYTES) {
    fail("The approved local MCP launch envelope is too large.");
  }
  const directory = scopeDirectory(registryRoot(options), "launch", userId, slug);
  const envelopePath = path.join(
    directory,
    `${reference.profileDigest}-${crypto.randomBytes(16).toString("hex")}.json`,
  );
  const pending = `${envelopePath}.pending-${process.pid}`;
  const descriptor = fs.openSync(pending, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, envelope);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(pending, envelopePath);
  } catch (error) {
    fs.rmSync(pending, { force: true });
    throw error;
  }
  const cleanup = setTimeout(() => {
    try {
      const metadata = fs.lstatSync(envelopePath);
      if (metadata.isFile() && !metadata.isSymbolicLink()) fs.rmSync(envelopePath);
    } catch {
      // The broker normally consumes the one-shot envelope first.
    }
  }, LAUNCH_ENVELOPE_LIFETIME_MS + 5_000);
  cleanup.unref?.();
  return { envelopePath, expiresAtMs };
}

export function isApprovedLocalMcpProfileReference(
  value: unknown,
): value is ApprovedLocalMcpProfileReference {
  return exactRecord(value, ["transport", "profileRevision", "profileDigest"]) &&
    value.transport === "local" &&
    value.profileRevision === LOCAL_MCP_PROFILE_REVISION &&
    typeof value.profileDigest === "string" &&
    PROFILE_DIGEST.test(value.profileDigest);
}
