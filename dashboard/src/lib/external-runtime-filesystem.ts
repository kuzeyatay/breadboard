import type { Dirent, Stats } from "node:fs";

type NodeFilesystem = typeof import("node:fs");

// Turbopack propagates path.join/path.resolve values through ordinary imported
// wrappers before it honors a turbopackIgnore comment on the eventual fs call.
// Resolve the one fixed Node builtin through an opaque runtime boundary instead:
// the call remains the real Node filesystem API, while the production tracer
// cannot reinterpret a user-data/service path as a standalone build asset.
function loadRuntimeFilesystem(): NodeFilesystem {
  const getBuiltinModule = Reflect.get(process, "getBuiltinModule");
  if (typeof getBuiltinModule !== "function") {
    throw new Error("This Breadboard runtime does not expose Node builtin modules.");
  }
  const filesystem = Reflect.apply(getBuiltinModule, process, ["node:fs"]) as
    | NodeFilesystem
    | undefined;
  if (!filesystem) throw new Error("The Node filesystem builtin is unavailable.");
  return filesystem;
}

const runtimeFilesystem = loadRuntimeFilesystem();

/**
 * Opaque access for server modules that must interleave many bounded reads and
 * writes. Prefer the narrow helpers below; this remains the same fixed Node
 * builtin and never resolves a module name or path supplied by a caller.
 */
export const externalRuntimeFilesystem: NodeFilesystem = runtimeFilesystem;

/**
 * Files owned by a Runtime V2 service or disposable worker are runtime inputs,
 * not Next standalone assets. These small wrappers keep the real filesystem
 * checks intact while preventing Turbopack's static tracer from materializing
 * an entire mutable checkout, toolchain, or user-data tree in every route that
 * imports an availability helper.
 */
export function externalRuntimePathExists(candidate: string): boolean {
  return runtimeFilesystem.existsSync(/* turbopackIgnore: true */ candidate);
}

export function externalRuntimeLstat(candidate: string): Stats {
  return runtimeFilesystem.lstatSync(/* turbopackIgnore: true */ candidate);
}

export function externalRuntimeStat(candidate: string): Stats {
  return runtimeFilesystem.statSync(/* turbopackIgnore: true */ candidate);
}

export function externalRuntimeStatIfPresent(candidate: string): Stats | undefined {
  return runtimeFilesystem.statSync(/* turbopackIgnore: true */ candidate, { throwIfNoEntry: false });
}

export function externalRuntimeAccess(candidate: string, mode?: number): void {
  runtimeFilesystem.accessSync(/* turbopackIgnore: true */ candidate, mode);
}

export function externalRuntimeRealpath(candidate: string): string {
  return runtimeFilesystem.realpathSync.native(/* turbopackIgnore: true */ candidate);
}

export function externalRuntimePortableRealpath(candidate: string): string {
  // Runtime V2 intentionally carries extended Windows paths (\\?\C:\\...).
  // Node's JavaScript realpath walker truncates those paths to `C:` before an
  // lstat on Windows, while the native implementation canonicalizes them to a
  // normal drive-qualified path. Keep the portable walker on other platforms.
  if (process.platform === "win32") {
    return runtimeFilesystem.realpathSync.native(/* turbopackIgnore: true */ candidate);
  }
  return runtimeFilesystem.realpathSync(/* turbopackIgnore: true */ candidate);
}

export function externalRuntimeReadUtf8(candidate: string): string {
  return runtimeFilesystem.readFileSync(/* turbopackIgnore: true */ candidate, "utf8");
}

export function externalRuntimeReadFile(candidate: string): Buffer {
  return runtimeFilesystem.readFileSync(/* turbopackIgnore: true */ candidate);
}

export function externalRuntimeReadDirectory(candidate: string): string[] {
  return runtimeFilesystem.readdirSync(/* turbopackIgnore: true */ candidate);
}

export function externalRuntimeReadDirectoryEntries(candidate: string): Dirent[] {
  return runtimeFilesystem.readdirSync(/* turbopackIgnore: true */ candidate, { withFileTypes: true });
}

export function externalRuntimeCopyFile(source: string, destination: string): void {
  runtimeFilesystem.copyFileSync(/* turbopackIgnore: true */ source, destination);
}

export function externalRuntimeCopyTree(source: string, destination: string): void {
  runtimeFilesystem.cpSync(/* turbopackIgnore: true */ source, destination, { recursive: true });
}

export async function externalRuntimeStatAsync(candidate: string): Promise<Stats> {
  return runtimeFilesystem.promises.stat(/* turbopackIgnore: true */ candidate);
}

export async function externalRuntimeReadUtf8Async(candidate: string): Promise<string> {
  return runtimeFilesystem.promises.readFile(/* turbopackIgnore: true */ candidate, "utf8");
}

export async function externalRuntimeReadFileAsync(candidate: string): Promise<Buffer> {
  return runtimeFilesystem.promises.readFile(/* turbopackIgnore: true */ candidate);
}

export async function externalRuntimeCopyFileAsync(
  source: string,
  destination: string,
): Promise<void> {
  await runtimeFilesystem.promises.copyFile(/* turbopackIgnore: true */ source, destination);
}

export async function externalRuntimeReadDirectoryEntriesAsync(
  candidate: string,
): Promise<Dirent[]> {
  return runtimeFilesystem.promises.readdir(/* turbopackIgnore: true */ candidate, {
    withFileTypes: true,
  });
}
