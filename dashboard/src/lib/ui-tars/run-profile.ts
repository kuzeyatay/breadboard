// Private, durable launch material for one Agent TARS Runtime job.
//
// The authenticated dashboard writes this before submitting the finite job.
// Only an opaque profile id enters the canonical request; provider credentials
// and the complete operator configuration never enter Runtime input,
// checkpoints, worker environment variables, or browser responses.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  validateAgentConfiguration,
  type UITarsAgentConfiguration,
} from "./config.ts";

const PROFILE_VERSION = 1;
const MAX_PROFILE_BYTES = 64 * 1024;
const PROFILE_ID = /^utp_[0-9a-f]{32}$/u;
const AGENT_ID = /^uta_[0-9a-f]{32}$/u;

export interface UITarsRunProfile {
  readonly protocolVersion: 1;
  readonly profileId: string;
  readonly ownerUserId: number;
  readonly agentId: string;
  readonly task: string;
  readonly configuration: UITarsAgentConfiguration;
  readonly providerApiKey: string | null;
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as object).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validTask(value: unknown): value is string {
  return typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= 8_000 &&
    Buffer.byteLength(value, "utf8") <= 32 * 1024 &&
    !value.includes("\0");
}

function validCredential(value: unknown): value is string | null {
  return value === null || (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 4_096 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validateProfile(value: unknown): UITarsRunProfile {
  if (
    !exactRecord(value, [
      "protocolVersion",
      "profileId",
      "ownerUserId",
      "agentId",
      "task",
      "configuration",
      "providerApiKey",
    ]) ||
    value.protocolVersion !== PROFILE_VERSION ||
    typeof value.profileId !== "string" ||
    !PROFILE_ID.test(value.profileId) ||
    !Number.isSafeInteger(value.ownerUserId) ||
    Number(value.ownerUserId) < 1 ||
    typeof value.agentId !== "string" ||
    !AGENT_ID.test(value.agentId) ||
    !validTask(value.task) ||
    !validCredential(value.providerApiKey)
  ) {
    throw new Error("The private Agent TARS Runtime profile is invalid.");
  }
  const parsed = validateAgentConfiguration(value.configuration);
  if (!parsed.ok || !parsed.value || !parsed.value.model.trim()) {
    throw new Error("The private Agent TARS Runtime profile is invalid.");
  }
  return {
    protocolVersion: PROFILE_VERSION,
    profileId: value.profileId,
    ownerUserId: Number(value.ownerUserId),
    agentId: value.agentId,
    task: value.task,
    configuration: parsed.value,
    providerApiKey: value.providerApiKey,
  };
}

export function uiTarsProfileId(
  userId: number,
  agentId: string,
  requestId: string,
): string {
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    !AGENT_ID.test(agentId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(requestId)
  ) {
    throw new Error("The Agent TARS request identity is invalid.");
  }
  const digest = crypto
    .createHash("sha256")
    .update(`agent-tars-runtime-v2\0${userId}\0${agentId}\0${requestId}`)
    .digest("hex")
    .slice(0, 32);
  return `utp_${digest}`;
}

function profileDirectory(dataRoot: string): string {
  return path.join(path.resolve(dataRoot), "runtime-v2", "private", "ui-tars-profiles");
}

function profilePath(dataRoot: string, profileId: string): string {
  if (!PROFILE_ID.test(profileId)) {
    throw new Error("The Agent TARS profile identity is invalid.");
  }
  return path.join(profileDirectory(dataRoot), `${profileId}.json`);
}

function serialized(profile: UITarsRunProfile): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(profile)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PROFILE_BYTES) {
    throw new Error("The private Agent TARS Runtime profile exceeded its bound.");
  }
  return bytes;
}

function readDirectProfile(dataRoot: string, profileId: string): UITarsRunProfile {
  const target = profilePath(dataRoot, profileId);
  const root = profileDirectory(dataRoot);
  let metadata: fs.Stats;
  let canonicalRoot: string;
  let canonicalTarget: string;
  try {
    metadata = fs.lstatSync(target);
    canonicalRoot = fs.realpathSync.native(root);
    canonicalTarget = fs.realpathSync.native(target);
  } catch {
    throw new Error("The private Agent TARS Runtime profile is unavailable.");
  }
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAX_PROFILE_BYTES ||
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error("The private Agent TARS Runtime profile is unavailable.");
  }
  const bytes = fs.readFileSync(canonicalTarget);
  if (bytes.byteLength !== metadata.size || bytes.byteLength > MAX_PROFILE_BYTES) {
    throw new Error("The private Agent TARS Runtime profile changed while it was read.");
  }
  try {
    return validateProfile(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new Error("The private Agent TARS Runtime profile is invalid.");
  }
}

/** Atomically create one immutable profile; an idempotent retry must be exact. */
export function prepareUITarsRunProfile(
  dataRoot: string,
  input: Omit<UITarsRunProfile, "protocolVersion">,
): UITarsRunProfile {
  const profile = validateProfile({ protocolVersion: PROFILE_VERSION, ...input });
  const target = profilePath(dataRoot, profile.profileId);
  const bytes = serialized(profile);
  try {
    const existing = readDirectProfile(dataRoot, profile.profileId);
    if (!serialized(existing).equals(bytes)) {
      throw new Error("The Agent TARS request identity was reused with different inputs.");
    }
    return existing;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "The private Agent TARS Runtime profile is unavailable."
    ) {
      throw error;
    }
  }

  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch {
      // The temporary was never created or was already moved into place.
    }
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      const existing = readDirectProfile(dataRoot, profile.profileId);
      if (serialized(existing).equals(bytes)) return existing;
      throw new Error("The Agent TARS request identity was reused with different inputs.");
    }
    throw error;
  }
  return profile;
}

/** Load a profile only when all public Runtime-bound fields match exactly. */
export function loadUITarsRunProfile(
  dataRoot: string,
  expected: {
    readonly profileId: string;
    readonly ownerUserId: number;
    readonly agentId: string;
    readonly task: string;
  },
): UITarsRunProfile {
  const profile = readDirectProfile(dataRoot, expected.profileId);
  if (
    profile.ownerUserId !== expected.ownerUserId ||
    profile.agentId !== expected.agentId ||
    profile.task !== expected.task
  ) {
    throw new Error("The private Agent TARS Runtime profile does not match this job.");
  }
  return profile;
}
