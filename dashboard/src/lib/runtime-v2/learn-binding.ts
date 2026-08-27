import type { Stats } from "node:fs";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
import { randomUUID } from "node:crypto";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";

const BINDING_VERSION = 1 as const;
const MAX_BINDING_BYTES = 4 * 1024;
const RUNTIME_JOB_ID = /^job_[0-9a-f]{64}$/u;

export interface RuntimeV2LearnBinding {
  readonly version: typeof BINDING_VERSION;
  readonly runtimeJobId: string;
  readonly learnJobId: string;
  readonly userId: number;
  readonly gardenId: string;
  readonly boundAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/\p{Cc}/u.test(value)
  );
}

function gardenRoot(contentPath: string, gardenId: string): string {
  if (!boundedText(gardenId, 256)) {
    throw new TypeError("The Learn binding garden identity is invalid.");
  }
  const root = fs.realpathSync.native(path.resolve(contentPath));
  const candidate = path.resolve(root, gardenId);
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new TypeError("The Learn binding garden path is outside its authority.");
  }
  const candidateStat = fs.lstatSync(candidate);
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) {
    throw new TypeError("The Learn binding garden is not a regular directory.");
  }
  const canonicalCandidate = fs.realpathSync.native(candidate);
  const canonicalRelative = path.relative(root, canonicalCandidate);
  if (
    canonicalRelative === "" ||
    canonicalRelative === ".." ||
    canonicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(canonicalRelative)
  ) {
    throw new TypeError("The Learn binding garden escaped its data authority.");
  }
  return canonicalCandidate;
}

interface BindingLocation {
  readonly garden: string;
  readonly directory: string;
  readonly target: string;
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function bindingLocation(
  contentPath: string,
  gardenId: string,
  runtimeJobId: string,
): BindingLocation {
  if (!RUNTIME_JOB_ID.test(runtimeJobId)) {
    throw new TypeError("The Learn binding Runtime job identity is invalid.");
  }
  const garden = gardenRoot(contentPath, gardenId);
  const directory = path.join(
    garden,
    ".breadboard",
    "runtime-v2-learn-bindings",
  );
  return {
    garden,
    directory,
    target: path.join(directory, `${runtimeJobId}.json`),
  };
}

function inspectBindingDirectory(
  location: BindingLocation,
  create: boolean,
): string | null {
  let current = location.garden;
  for (const segment of [".breadboard", "runtime-v2-learn-bindings"]) {
    current = path.join(current, segment);
    if (create) {
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      }
    }
    let stat: Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("The Runtime V2 Learn binding directory is not a regular directory.");
    }
  }
  const canonicalDirectory = fs.realpathSync.native(current);
  if (!pathIsWithin(location.garden, canonicalDirectory)) {
    throw new Error("The Runtime V2 Learn binding directory escaped its garden authority.");
  }
  return canonicalDirectory;
}

function validBinding(
  value: unknown,
  expected: { readonly runtimeJobId: string; readonly userId: number; readonly gardenId: string },
): value is RuntimeV2LearnBinding {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "version",
      "runtimeJobId",
      "learnJobId",
      "userId",
      "gardenId",
      "boundAt",
    ]) &&
    value.version === BINDING_VERSION &&
    value.runtimeJobId === expected.runtimeJobId &&
    value.userId === expected.userId &&
    value.gardenId === expected.gardenId &&
    boundedText(value.learnJobId, 512) &&
    typeof value.boundAt === "string" &&
    Number.isFinite(Date.parse(value.boundAt))
  );
}

export function readRuntimeV2LearnBinding(input: {
  readonly contentPath: string;
  readonly gardenId: string;
  readonly userId: number;
  readonly runtimeJobId: string;
}): RuntimeV2LearnBinding | null {
  const location = bindingLocation(input.contentPath, input.gardenId, input.runtimeJobId);
  let descriptor: number | undefined;
  try {
    const directory = inspectBindingDirectory(location, false);
    if (!directory) return null;
    const target = path.join(directory, path.basename(location.target));
    const pathStat = fs.lstatSync(target);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      throw new Error("The Runtime V2 Learn binding is not a regular file.");
    }
    const canonicalTarget = fs.realpathSync.native(target);
    if (!pathIsWithin(directory, canonicalTarget)) {
      throw new Error("The Runtime V2 Learn binding escaped its garden authority.");
    }
    descriptor = fs.openSync(
      target,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.dev !== pathStat.dev ||
      stat.ino !== pathStat.ino ||
      stat.size < 1 ||
      stat.size > MAX_BINDING_BYTES
    ) {
      throw new Error("The Runtime V2 Learn binding is invalid.");
    }
    const bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.byteLength - offset, null);
      if (count === 0) throw new Error("The Runtime V2 Learn binding is truncated.");
      offset += count;
    }
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!validBinding(value, input)) {
      throw new Error("The Runtime V2 Learn binding is outside its authenticated scope.");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function writeRuntimeV2LearnBinding(input: {
  readonly contentPath: string;
  readonly gardenId: string;
  readonly userId: number;
  readonly runtimeJobId: string;
  readonly learnJobId: string;
}): RuntimeV2LearnBinding {
  if (!Number.isSafeInteger(input.userId) || input.userId < 1) {
    throw new TypeError("The Learn binding user identity is invalid.");
  }
  if (!boundedText(input.learnJobId, 512)) {
    throw new TypeError("The durable Learn job identity is invalid.");
  }
  const location = bindingLocation(input.contentPath, input.gardenId, input.runtimeJobId);
  const existing = readRuntimeV2LearnBinding(input);
  if (existing) {
    if (existing.learnJobId !== input.learnJobId) {
      throw new Error("The Runtime V2 Learn job is already bound to another durable Learn job.");
    }
    return existing;
  }
  const binding: RuntimeV2LearnBinding = {
    version: BINDING_VERSION,
    runtimeJobId: input.runtimeJobId,
    learnJobId: input.learnJobId,
    userId: input.userId,
    gardenId: input.gardenId,
    boundAt: new Date().toISOString(),
  };
  const bytes = Buffer.from(`${JSON.stringify(binding)}\n`, "utf8");
  if (bytes.byteLength > MAX_BINDING_BYTES) {
    throw new Error("The Runtime V2 Learn binding exceeds its storage bound.");
  }
  const directory = inspectBindingDirectory(location, true);
  if (!directory) {
    throw new Error("The Runtime V2 Learn binding directory is unavailable.");
  }
  const target = path.join(directory, path.basename(location.target));
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.pending`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const temporaryPathStat = fs.lstatSync(temporary);
    const temporaryFileStat = fs.fstatSync(descriptor);
    if (
      !temporaryPathStat.isFile() ||
      temporaryPathStat.isSymbolicLink() ||
      temporaryPathStat.dev !== temporaryFileStat.dev ||
      temporaryPathStat.ino !== temporaryFileStat.ino
    ) {
      throw new Error("The Runtime V2 Learn binding staging file changed identity.");
    }
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (inspectBindingDirectory(location, false) !== directory) {
      throw new Error("The Runtime V2 Learn binding directory changed identity.");
    }
    fs.linkSync(temporary, target);
    fs.rmSync(temporary, { force: true });
    return binding;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    const raced = readRuntimeV2LearnBinding(input);
    if (raced?.learnJobId === input.learnJobId) return raced;
    throw error;
  }
}
