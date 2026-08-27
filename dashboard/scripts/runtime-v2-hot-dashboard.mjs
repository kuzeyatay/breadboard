import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const DEVELOPMENT_DOTENV_FILES = [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
];
const MAX_DOTENV_BYTES = 1024 * 1024;
const MAX_DOTENV_KEYS = 256;
export const HOT_DASHBOARD_DIST_DIR = ".next-dev";
// Keep this entry grammar aligned with the dotenv parser compiled into
// @next/env. The match consumes the opaque value only to distinguish a valid
// declaration from malformed input; only the key capture survives the scan.
const DOTENV_ENTRY = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;
const IGNORABLE_DOTENV_TEXT = /^(?:[^\S\r\n]*(?:#[^\r\n]*)?(?:\r\n|\r|\n|$))*$/u;

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function rejectDotenv(fileName, reason) {
  // Never include source text in this error. Dotenv values are secrets even
  // when the input is malformed.
  throw new Error(`Breadboard hot QA rejected ${reason} ${fileName}`);
}

function collectDotenvKeys(contents, fileName, names, declarationCount) {
  let cursor = 0;
  DOTENV_ENTRY.lastIndex = 0;
  for (
    let match = DOTENV_ENTRY.exec(contents);
    match;
    match = DOTENV_ENTRY.exec(contents)
  ) {
    if (!IGNORABLE_DOTENV_TEXT.test(contents.slice(cursor, match.index))) {
      rejectDotenv(fileName, "malformed");
    }
    cursor = DOTENV_ENTRY.lastIndex;
    declarationCount += 1;
    if (declarationCount > MAX_DOTENV_KEYS) {
      rejectDotenv(fileName, "too-many-keys");
    }
    names.add(match[1]);
  }
  if (!IGNORABLE_DOTENV_TEXT.test(contents.slice(cursor))) {
    rejectDotenv(fileName, "malformed");
  }
  return declarationCount;
}

/**
 * Keep disposable hot QA from importing credentials or developer overrides
 * from the real dashboard checkout. Only names survive validation; values are
 * never expanded, copied, returned, or logged. Existing trusted Runtime V2
 * values win.
 */
export function shadowProjectDotenvKeys(
  projectRoot = process.cwd(),
  environment = process.env,
) {
  const resolvedRoot = fs.realpathSync(projectRoot);
  const names = new Set();
  let declarationCount = 0;
  for (const fileName of DEVELOPMENT_DOTENV_FILES) {
    const candidate = path.join(resolvedRoot, fileName);
    let metadata;
    try {
      metadata = fs.lstatSync(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      rejectDotenv(fileName, "non-regular");
    }
    const realFile = fs.realpathSync(candidate);
    if (!isInside(resolvedRoot, realFile)) {
      rejectDotenv(fileName, "external");
    }
    if (metadata.size > MAX_DOTENV_BYTES) {
      rejectDotenv(fileName, "oversized");
    }

    const contents = fs.readFileSync(realFile);
    if (contents.byteLength > MAX_DOTENV_BYTES) {
      rejectDotenv(fileName, "oversized");
    }
    declarationCount = collectDotenvKeys(
      contents.toString("utf8"),
      fileName,
      names,
      declarationCount,
    );
  }

  // process.env is case-insensitive on Windows. Fold names explicitly so the
  // focused tests exercise the same "trusted value wins" rule with plain
  // objects and no differently-cased duplicate can replace it.
  const foldName = process.platform === "win32"
    ? (name) => name.toUpperCase()
    : (name) => name;
  const present = new Set(Object.keys(environment).map(foldName));
  for (const name of names) {
    const folded = foldName(name);
    if (present.has(folded)) continue;
    environment[name] = "";
    present.add(folded);
  }
}

export function shouldShadowProjectDotenv(environment = process.env) {
  return Boolean(environment.BREADBOARD_DATA_DIR?.trim());
}

/**
 * Keep the supervised Hot compiler isolated from production output and from
 * old unsupervised `.next` caches. The fixed relative directory stays inside
 * the already-pinned dashboard working directory and cannot be redirected by
 * an inherited shell variable.
 */
export function pinHotDashboardOutput(environment = process.env) {
  environment.BREADBOARD_NEXT_DIST_DIR = HOT_DASHBOARD_DIST_DIR;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && samePath(process.argv[1], thisFile)) {
  const projectRoot = fs.realpathSync(path.join(import.meta.dirname, ".."));
  const workingRoot = fs.realpathSync(process.cwd());
  if (!samePath(projectRoot, workingRoot)) {
    throw new Error("Breadboard Runtime V2 Hot requires the dashboard working directory");
  }

  if (shouldShadowProjectDotenv()) {
    shadowProjectDotenvKeys(projectRoot);
  }
  pinHotDashboardOutput();

  const require = createRequire(import.meta.url);
  require(path.join(import.meta.dirname, "..", "node_modules", "next", "dist", "bin", "next"));
}
