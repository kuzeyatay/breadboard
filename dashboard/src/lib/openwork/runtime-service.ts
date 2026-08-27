import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { createHash, randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import type { OpenworkService, StartOptions } from "./service.ts";
import {
  callRuntimeAgentService,
  inspectRuntimeAgentService,
  scopedAgentRequest,
  withRuntimeAgentServiceLease,
  type RuntimeAgentScope,
} from "../runtime-agent-service.ts";
import type { SetupStatus } from "./setup.ts";
import type { RuntimeAvailability } from "./runtime.ts";
import { dashboardDataDir } from "../runtime-paths.ts";

export interface OpenworkRuntimeStatus {
  availability: RuntimeAvailability;
  setup: SetupStatus;
  service: OpenworkService | null;
}

const PROFILE_SCHEMA_VERSION = 1;
const PROFILE_MAX_BYTES = 16 * 1024;
const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface OpenworkRunProfileScope {
  readonly userId: number;
  readonly runId: string;
}

interface OpenworkRunProfile {
  readonly schemaVersion: 1;
  readonly serviceId: "openwork";
  readonly scope: OpenworkRunProfileScope;
  readonly options: StartOptions;
}

function validateProfileScope(scope: OpenworkRunProfileScope): void {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !PROFILE_ID.test(scope.runId)
  ) {
    throw new TypeError("The OpenWork service profile scope is invalid.");
  }
}

function profileStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BREADBOARD_AGENT_SERVICE_STATE_ROOT?.trim();
  if (configured) return path.join(path.resolve(configured), "openwork");
  if (env.BREADBOARD_DATA_DIR?.trim()) {
    return path.join(
      path.resolve(env.BREADBOARD_DATA_DIR),
      "runtime-v2",
      "agent-services",
      "openwork",
    );
  }
  return path.join(dashboardDataDir(), ".runtime", "agent-services", "openwork");
}

function profileFileName(scope: OpenworkRunProfileScope): string {
  const digest = createHash("sha256")
    .update(`${scope.userId}\0${scope.runId}`, "utf8")
    .digest("hex");
  return `${scope.userId}-${digest}.json`;
}

/**
 * The private file read by the Runtime-owned OpenWork gateway. Its opaque name
 * is derived only from the authenticated user and server-selected request id;
 * no renderer path can participate in resolution.
 */
export function openworkRunProfilePath(
  scope: OpenworkRunProfileScope,
  env: NodeJS.ProcessEnv = process.env,
): string {
  validateProfileScope(scope);
  return path.join(profileStateRoot(env), profileFileName(scope));
}

function canonicalProfile(scope: OpenworkRunProfileScope, options: StartOptions): OpenworkRunProfile {
  const baseUrl = options.baseUrl.trim();
  const apiKey = options.apiKey.trim();
  const model = options.model.trim();
  const parsed = new URL(baseUrl);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !apiKey ||
    Buffer.byteLength(apiKey, "utf8") > 1_024 ||
    !model ||
    Buffer.byteLength(model, "utf8") > 256 ||
    /\p{Cc}/u.test(model) ||
    typeof options.prompt.deliverFiles !== "boolean" ||
    typeof options.prompt.allowCommands !== "boolean"
  ) {
    throw new TypeError("The OpenWork service profile is invalid.");
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    serviceId: "openwork",
    scope: { userId: scope.userId, runId: scope.runId },
    options: {
      baseUrl: parsed.toString().replace(/\/$/u, ""),
      apiKey,
      model,
      prompt: {
        deliverFiles: options.prompt.deliverFiles === true,
        allowCommands: options.prompt.allowCommands === true,
      },
    },
  };
}

function samePath(left: string, right: string): boolean {
  const normalized = (value: string) => {
    const resolved = path.normalize(path.resolve(value));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalized(left) === normalized(right);
}

function readExistingProfile(target: string): string {
  const metadata = fs.lstatSync(target);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 2 ||
    metadata.size > PROFILE_MAX_BYTES ||
    !samePath(fs.realpathSync.native(target), target)
  ) {
    throw new Error("The existing OpenWork service profile is indirect or invalid.");
  }
  return fs.readFileSync(target, "utf8");
}

/**
 * Atomically seal the provider/model/prompt shape before the outer job is
 * submitted. Reusing a request id with different settings fails closed; an
 * HTTP retry with the same settings is idempotent.
 */
export function prepareOpenworkRunProfile(
  scope: OpenworkRunProfileScope,
  options: StartOptions,
  env: NodeJS.ProcessEnv = process.env,
): void {
  validateProfileScope(scope);
  const profile = canonicalProfile(scope, options);
  const encoded = `${JSON.stringify(profile)}\n`;
  if (Buffer.byteLength(encoded, "utf8") > PROFILE_MAX_BYTES) {
    throw new TypeError("The OpenWork service profile exceeded its bound.");
  }
  const target = openworkRunProfilePath(scope, env);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const directory = path.dirname(target);
  const directoryMetadata = fs.lstatSync(directory);
  if (
    !directoryMetadata.isDirectory() ||
    directoryMetadata.isSymbolicLink() ||
    !samePath(fs.realpathSync.native(directory), directory)
  ) {
    throw new Error("The OpenWork service profile directory is indirect.");
  }
  try {
    const existing = readExistingProfile(target);
    if (existing === encoded) return;
    throw new Error("The OpenWork request identity already has different settings.");
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      (error as { code?: unknown }).code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, encoded, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      // Linking a fully written private temporary file is atomic and, unlike a
      // rename, cannot replace a different profile that won the same request id.
      fs.linkSync(temporary, target);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["EEXIST", "EPERM"].includes(String((error as { code?: unknown }).code))
      ) {
        const existing = readExistingProfile(target);
        if (existing === encoded) return;
      }
      throw error;
    }
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: unknown }).code !== "ENOENT"
      ) throw error;
    }
  }
}

export function stopOpenworkRuntime(scope: RuntimeAgentScope): Promise<void> {
  return withRuntimeAgentServiceLease("openwork", "user-authorized-stop", async () => {
    await callRuntimeAgentService(
      "openwork",
      "/v1/stop",
      scopedAgentRequest(scope),
    );
  });
}

export function inspectOpenworkRuntime(userId: number) {
  return inspectRuntimeAgentService("openwork", { userId });
}

export function readOpenworkRuntimeStatus(
  scope: RuntimeAgentScope,
): Promise<OpenworkRuntimeStatus> {
  return withRuntimeAgentServiceLease("openwork", "authenticated-status", () =>
    callRuntimeAgentService(
      "openwork",
      "/v1/status",
      scopedAgentRequest(scope),
      { timeoutMs: 30_000 },
    ));
}
