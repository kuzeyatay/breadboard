import type { BigIntStats } from "node:fs";
import path from "node:path";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);

/**
 * A runtime asset failed the direct-file contract. Callers should translate
 * this to the same unavailable/not-found result they use for an invalid asset;
 * the error deliberately carries no filesystem path.
 */
export class UnsafeRuntimeFileError extends Error {
  constructor() {
    super("The runtime file is not a bounded direct regular file.");
    this.name = "UnsafeRuntimeFileError";
  }
}

type DirectPathSnapshot = {
  root: BigIntStats;
  file: BigIntStats;
};

function unsafe(): never {
  throw new UnsafeRuntimeFileError();
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  if (left.dev !== right.dev) return false;
  if (left.ino !== BIGINT_ZERO || right.ino !== BIGINT_ZERO) {
    return left.ino === right.ino;
  }

  // Some filesystems do not expose inode numbers. These fields are not used as
  // a general file identity; they are only the fail-closed fallback around one
  // immediately repeated open/read operation.
  return (
    left.mode === right.mode &&
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function sameStableFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameIdentity(left, right) &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.birthtimeMs === right.birthtimeMs
  );
}

async function directPathSnapshot(
  allowedRoot: string,
  filePath: string,
  maximumBytes: bigint,
): Promise<DirectPathSnapshot> {
  const root = await fs.promises.lstat(
    /* turbopackIgnore: true */ allowedRoot,
    { bigint: true },
  );
  if (!root.isDirectory() || root.isSymbolicLink()) unsafe();

  const canonicalRoot = await fs.promises.realpath(
    /* turbopackIgnore: true */ allowedRoot,
  );
  if (!samePath(canonicalRoot, allowedRoot)) unsafe();

  const file = await fs.promises.lstat(
    /* turbopackIgnore: true */ filePath,
    { bigint: true },
  );
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.nlink !== BIGINT_ONE ||
    file.size > maximumBytes
  ) {
    unsafe();
  }

  const canonicalFile = await fs.promises.realpath(
    /* turbopackIgnore: true */ filePath,
  );
  if (
    !samePath(canonicalFile, filePath) ||
    !pathWithin(canonicalRoot, canonicalFile)
  ) {
    unsafe();
  }

  return { root, file };
}

/**
 * Read a small immutable runtime asset without reopening its pathname.
 *
 * The lexical and canonical paths must both be below one direct directory;
 * symlinks, junctions and multiply-linked files are rejected. The bytes come
 * from one held descriptor, and identity/metadata are checked before and after
 * the read as well as against the pathname after the read. This turns a path
 * replacement into a rejection instead of serving the replacement.
 */
export async function readBoundedDirectRuntimeFile(options: {
  allowedRoot: string;
  filePath: string;
  maximumBytes: number;
}): Promise<Buffer> {
  if (
    !Number.isSafeInteger(options.maximumBytes) ||
    options.maximumBytes < 0
  ) {
    throw new TypeError("maximumBytes must be a non-negative safe integer.");
  }

  const allowedRoot = path.resolve(options.allowedRoot);
  const filePath = path.resolve(options.filePath);
  if (!pathWithin(allowedRoot, filePath)) unsafe();

  const maximumBytes = BigInt(options.maximumBytes);
  const before = await directPathSnapshot(
    allowedRoot,
    filePath,
    maximumBytes,
  );
  const handle = await fs.promises.open(
    /* turbopackIgnore: true */ filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );

  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== BIGINT_ONE ||
      opened.size > maximumBytes ||
      !sameStableFile(before.file, opened)
    ) {
      unsafe();
    }

    const bytes = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    if (
      BigInt(bytes.byteLength) !== opened.size ||
      !sameStableFile(opened, afterRead)
    ) {
      unsafe();
    }

    const afterPath = await directPathSnapshot(
      allowedRoot,
      filePath,
      maximumBytes,
    );
    if (
      !sameIdentity(before.root, afterPath.root) ||
      !sameStableFile(opened, afterPath.file)
    ) {
      unsafe();
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
