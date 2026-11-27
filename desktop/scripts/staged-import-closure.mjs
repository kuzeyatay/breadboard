// Close staged Runtime worker/service scripts over the files they import.
//
// app-services mirrors the checkout (app-services/dashboard <-> dashboard,
// app-services/scripts <-> scripts), and packaged workers run straight from
// it. The scripts were staged from hand-kept lists that never followed their
// imports, so 0.1.15 shipped workers whose first import was missing:
// dashboard/scripts/host-path.mjs (every managed setup, the Claude account
// check and the terminal command worker crashed at start, reported only as
// "interrupted"), src/lib/external-runtime-path.ts (everything importing
// runtime-paths.ts), and others. This follows every relative import from the
// staged entrypoints, transitively, and copies what is missing from the same
// path in the checkout. Bare package imports that will not resolve from the
// staged location are reported so the caller can refuse the build.
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const CODE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/iu;
const SUFFIXES = [
  "", ".mjs", ".js", ".cjs", ".ts", ".tsx", ".jsx", ".mts", ".json",
  "/index.mjs", "/index.js", "/index.ts", "/index.tsx",
];
// Specifiers the dashboard's worker import hooks answer themselves
// (dashboard/scripts/learn-worker-import-hook.mjs).
const HOOK_PROVIDED = new Set(["server-only"]);

/**
 * The dashboard's tsconfig aliases, as its worker import hooks apply them:
 * `@/x` is <source root>/x and `@genoffice/p/x` is
 * <source root>/vendor/genoffice/p/src/x, where the source root is the
 * dashboard's: the enclosing `worker-src`, or the `src` directly inside a
 * `dashboard` directory (not a vendored package's own src). Returns an
 * absolute path or null.
 */
function aliasTarget(fromFile, specifier) {
  const match = /^@\/(.*)$/u.exec(specifier) ?? /^@genoffice\/([^/]+)(?:\/(.*))?$/u.exec(specifier);
  if (!match) return null;
  let root = path.dirname(fromFile);
  while (
    path.basename(root) !== "worker-src" &&
    !(path.basename(root) === "src" && path.basename(path.dirname(root)) === "dashboard")
  ) {
    const parent = path.dirname(root);
    if (parent === root) return null;
    root = parent;
  }
  return specifier.startsWith("@/")
    ? path.join(root, match[1])
    : path.join(root, "vendor", "genoffice", match[1], "src", match[2] ?? "");
}
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

// Static imports/exports, side-effect imports, literal dynamic import() and
// require(). Template or computed specifiers are runtime choices and skipped.
// Specifiers never contain whitespace, which keeps prose in JSX text (where an
// apostrophe reads as a quote) from matching.
const SPECIFIERS = [
  /(?:^|[\s;}])(?:import|export)\s+(?!type\b)[^;'"]*?\bfrom\s*(["'])([^"'\s]+)\1/gu,
  /(?:^|[\s;])import\s*(["'])([^"'\s]+)\1/gu,
  /\bimport\(\s*(["'])([^"'\s]+)\1\s*\)/gu,
  /\brequire\(\s*(["'])([^"'\s]+)\1\s*\)/gu,
  // Worker entrypoints spawned by path: new URL("../../scripts/x.mjs", import.meta.url).
  /\bnew\s+URL\(\s*(["'])(\.{1,2}\/[^"'\s]+)\1\s*,\s*import\.meta\.url\s*\)/gu,
];

/**
 * Blank comments and template-literal bodies, keeping quoted strings (where
 * specifiers live). Modules that generate source code (Remotion entrypoints,
 * Ajv validators) hold import statements inside template strings; those are
 * output, not dependencies. Interpolations inside templates are blanked too,
 * which only drops computed imports this scan skips anyway.
 */
function codeOnly(text) {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      out += "\n";
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 1;
      out += " ";
    } else if (char === "`") {
      for (index += 1; index < text.length && text[index] !== "`"; index += 1) {
        if (text[index] === "\\") index += 1;
      }
      out += "``";
    } else if (char === "'" || char === '"') {
      let literal = char;
      for (index += 1; index < text.length && text[index] !== char && text[index] !== "\n"; index += 1) {
        if (text[index] === "\\") literal += text[index++];
        literal += text[index];
      }
      out += `${literal}${char}`;
    } else {
      out += char;
    }
  }
  return out;
}

function specifiersOf(file) {
  const text = codeOnly(fs.readFileSync(file, "utf8"));
  const found = new Set();
  for (const pattern of SPECIFIERS) {
    for (const match of text.matchAll(pattern)) found.add(match[2]);
  }
  return [...found];
}

const existingFile = (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile();
const resolveWithSuffix = (absolute) => SUFFIXES.map((suffix) => `${absolute}${suffix}`).find(existingFile) ?? null;
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function bareResolves(fromFile, specifier, stagingRoot) {
  const name = packageName(specifier);
  for (let directory = path.dirname(fromFile); ; directory = path.dirname(directory)) {
    if (path.basename(directory) !== "node_modules" && existingFile(path.join(directory, "node_modules", name, "package.json"))) {
      return true;
    }
    if (!inside(stagingRoot, path.dirname(directory)) || path.dirname(directory) === directory) return false;
  }
}

/**
 * @param {{
 *   repoRoot: string,
 *   stagingRoot: string,
 *   entryDirectories: string[],
 *   mirrors?: Array<[string, string]>,
 *   checkBare?: boolean,
 * }} options
 *   entryDirectories are staging-relative ("dashboard/scripts"); a trailing
 *   "/**" scans recursively. mirrors maps a staging-relative prefix to the
 *   checkout path it was copied from, for trees not staged at their checkout
 *   path (the standalone dashboard's worker-src is the checkout's
 *   dashboard/src). Anything unmapped mirrors the same path.
 * @returns {{ added: string[], unresolvedBare: string[], missingEverywhere: string[] }}
 *   staging-relative paths; missingEverywhere lists imports absent from the
 *   checkout as well, which behave the same installed as in development.
 */
export function closeStagedImports({
  repoRoot,
  stagingRoot,
  entryDirectories = [],
  // Staging-relative modules loaded through computed paths.
  entryFiles = [],
  mirrors = [],
  // Off for source trees reached through computed paths (worker-src), whose
  // UI modules import packages Next bundled into the server build instead.
  checkBare = true,
}) {
  const mapped = mirrors
    .map(([staged, source]) => [path.join(stagingRoot, staged), path.join(repoRoot, source)])
    .sort((a, b) => b[0].length - a[0].length);
  const checkoutPathFor = (stagedPath) => {
    for (const [staged, source] of mapped) {
      if (inside(staged, stagedPath)) return path.join(source, path.relative(staged, stagedPath));
    }
    return path.join(repoRoot, path.relative(stagingRoot, stagedPath));
  };
  // The copy lands in the same mirrored tree as the path that asked for it.
  const stagedPathFor = (sourcePath, requested) => {
    for (const [staged, source] of mapped) {
      if (inside(staged, requested) && inside(source, sourcePath)) {
        return path.join(staged, path.relative(source, sourcePath));
      }
    }
    return path.join(stagingRoot, path.relative(repoRoot, sourcePath));
  };
  const added = [];
  const unresolvedBare = new Set();
  const missingEverywhere = new Set();
  const visited = new Set();
  const queue = [];
  const collect = (directory, recursive) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (recursive && entry.name !== "node_modules") collect(file, true);
      } else if (CODE.test(entry.name) && !/\.d\.[cm]?ts$/iu.test(entry.name)) {
        queue.push(file);
      }
    }
  };
  for (const directory of entryDirectories) {
    const recursive = directory.endsWith("/**");
    const staged = path.join(stagingRoot, recursive ? directory.slice(0, -3) : directory);
    if (fs.existsSync(staged)) collect(staged, recursive);
  }
  for (const entry of entryFiles) {
    const staged = path.join(stagingRoot, entry);
    if (existingFile(staged)) {
      queue.push(staged);
    } else {
      missingEverywhere.add(`${entry} <- (entry)`);
    }
  }
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of specifiersOf(file)) {
      if (HOOK_PROVIDED.has(specifier)) continue;
      const aliased = aliasTarget(file, specifier);
      if (specifier.startsWith(".") || aliased) {
        const absolute = aliased ?? path.resolve(path.dirname(file), specifier);
        if (!inside(stagingRoot, absolute)) {
          throw new Error(`Staged ${path.relative(stagingRoot, file)} imports outside app-services: ${specifier}`);
        }
        let resolved = resolveWithSuffix(absolute);
        if (!resolved) {
          const source = resolveWithSuffix(checkoutPathFor(absolute));
          if (!source) {
            // Missing in development too, so not an installed-only gap (dead
            // vendored code, or an import guarded at run time). Report it.
            missingEverywhere.add(
              `${specifier} <- ${path.relative(stagingRoot, file).split(path.sep).join("/")}`,
            );
            continue;
          }
          resolved = stagedPathFor(source, absolute);
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          fs.copyFileSync(source, resolved);
          added.push(path.relative(stagingRoot, resolved).split(path.sep).join("/"));
        }
        if (CODE.test(resolved) && !resolved.includes(`${path.sep}node_modules${path.sep}`)) queue.push(resolved);
      } else if (checkBare && !BUILTINS.has(specifier) && !specifier.startsWith("node:") && !/^[a-z]+:/iu.test(specifier)) {
        if (!bareResolves(file, specifier, stagingRoot)) {
          unresolvedBare.add(`${packageName(specifier)} <- ${path.relative(stagingRoot, file).split(path.sep).join("/")}`);
        }
      }
    }
  }
  return {
    added: added.sort(),
    unresolvedBare: [...unresolvedBare].sort(),
    missingEverywhere: [...missingEverywhere].sort(),
  };
}

/**
 * Source modules that worker scripts load through computed paths, such as
 * path.join(layout.sourceRoot, "lib", "learn.ts"). Returned relative to the
 * source root ("lib/learn.ts"), for entryFiles under worker-src.
 */
export function computedSourceEntries(scriptsDirectory) {
  const JOIN = /path\.join\(\s*[\w.]*(?:sourceRoot|SourceRoot)[\w.]*\s*((?:,\s*["'][\w.-]+["']\s*)+)\)/gu;
  const entries = new Set();
  for (const name of fs.readdirSync(scriptsDirectory)) {
    if (!CODE.test(name)) continue;
    const text = fs.readFileSync(path.join(scriptsDirectory, name), "utf8");
    for (const match of text.matchAll(JOIN)) {
      const parts = [...match[1].matchAll(/["']([\w.-]+)["']/gu)].map((part) => part[1]);
      if (parts.length && /\.tsx?$/u.test(parts.at(-1))) entries.add(parts.join("/"));
    }
  }
  return [...entries].sort();
}
