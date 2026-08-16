#!/usr/bin/env node
/**
 * Regenerate src/lib/review/fsrs/ from the ts-fsrs clone.
 *
 * ts-fsrs ships as a rollup bundle, but its scheduler source is pure TypeScript
 * with zero runtime dependencies, so Breadboard vendors the source rather than
 * building the package. That avoids a pnpm/turbo/rollup toolchain this repo does
 * not otherwise need, and it keeps the algorithm inside the Next.js module graph
 * where `next build` already type-checks and bundles it.
 *
 * Run this after pulling the clone. Everything under src/lib/review/fsrs/ is
 * overwritten; Breadboard's own code lives one level up in src/lib/review/ and
 * is never touched, so an upstream pull stays a reviewable diff confined to one
 * directory.
 *
 *   node dashboard/scripts/vendor-fsrs.mjs [--clone <path>]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const cloneArg = process.argv.indexOf("--clone");
const clone =
  cloneArg !== -1 && process.argv[cloneArg + 1]
    ? path.resolve(process.argv[cloneArg + 1])
    : process.env.TS_FSRS_DIR
      ? path.resolve(process.env.TS_FSRS_DIR)
      : path.join(repoRoot, "ts-fsrs");

const sourceDir = path.join(clone, "packages", "fsrs", "src");
if (!fs.existsSync(sourceDir)) {
  console.error(
    `no ts-fsrs source at ${sourceDir}\n` +
      `clone it first: git clone https://github.com/open-spaced-repetition/ts-fsrs ${clone}`,
  );
  process.exit(1);
}

let sha = "unknown";
let committedAt = "unknown";
try {
  sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: clone, encoding: "utf8" }).trim();
  committedAt = execFileSync("git", ["log", "-1", "--format=%cs"], {
    cwd: clone,
    encoding: "utf8",
  }).trim();
} catch {
  // A clone without git metadata still vendors fine; the header just says so.
}

let version = "unknown";
try {
  version = JSON.parse(
    fs.readFileSync(path.join(clone, "packages", "fsrs", "package.json"), "utf8"),
  ).version;
} catch {
  // Same reasoning as the sha: missing provenance is not a reason to fail.
}

const outDir = path.join(repoRoot, "dashboard", "src", "lib", "review", "fsrs");

function collect(dir, base = "") {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) entries.push(...collect(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".ts")) entries.push(rel);
  }
  return entries;
}

const files = collect(sourceDir).sort();
/** Every vendored path, so relative imports can be resolved rather than guessed. */
const fileSet = new Set(files.map((rel) => rel.replace(/\\/g, "/")));
if (files.length === 0) {
  console.error(`no .ts files under ${sourceDir}`);
  process.exit(1);
}

// A stale file from a previous upstream layout must not survive the copy, or the
// vendored tree slowly stops matching the clone it claims to mirror.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const header =
  `// Vendored from ts-fsrs — DO NOT EDIT BY HAND.\n` +
  `// Upstream: https://github.com/open-spaced-repetition/ts-fsrs (MIT)\n` +
  `// Version:  ${version}\n` +
  `// Commit:   ${sha} (${committedAt})\n` +
  `// Regenerate with: node dashboard/scripts/vendor-fsrs.mjs\n\n`;

/**
 * Upstream writes relative imports without a file extension (`from './models'`).
 * Next.js resolves those, but Node's native ESM loader does not, and this repo's
 * tests run under `node --experimental-strip-types` — so an unrewritten copy
 * imports fine in the app and fails in every test. The extension is appended
 * here rather than by hand: the vendored tree is regenerated wholesale, never
 * merged, so a deterministic transform costs nothing on the next upstream pull.
 */
function addExtensions(source, relFile) {
  const dir = path.posix.dirname(relFile.replace(/\\/g, "/"));
  const fromDir = dir === "." ? "" : dir;
  return source.replace(
    /(\bfrom\s*['"])(\.[^'"]*)(['"])/g,
    (match, prefix, specifier, suffix) => {
      if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(specifier)) return match;
      // `./strategies` may mean strategies.ts or strategies/index.ts. Resolved
      // against the real tree rather than guessed, so a future upstream that
      // adds either form keeps working.
      const target = path.posix.normalize(path.posix.join(fromDir, specifier));
      const asFile = `${target}.ts`;
      const asIndex = `${target}/index.ts`;
      if (fileSet.has(asFile)) return `${prefix}${specifier}.ts${suffix}`;
      if (fileSet.has(asIndex)) return `${prefix}${specifier}/index.ts${suffix}`;
      console.error(
        `cannot resolve import ${specifier} from ${relFile} — tried ${asFile} and ${asIndex}.`,
      );
      process.exit(1);
    },
  );
}

/**
 * Strip-only mode also rejects the angle-bracket cast `<T>expr`, which upstream
 * still uses in a dozen places. Rewritten to `expr as T`.
 *
 * The lookbehind is what keeps generics safe: `createEmptyCard<Card>(x)` and
 * `repeat<R>(...)` are preceded by an identifier character, a cast never is. The
 * operand pattern covers an identifier, a property chain, and a single call —
 * every form upstream actually casts — and anything it fails to convert is
 * caught by the leftover check below rather than shipped broken.
 */
const ANGLE_CAST =
  /(?<![A-Za-z0-9_$>\])])<([A-Z][A-Za-z0-9_]*)>([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\([^()]*\))?)/g;

function convertAngleCasts(source) {
  return source.replace(ANGLE_CAST, (_match, type, operand) => `${operand} as ${type}`);
}

/** Detects a remaining angle-bracket cast, for the post-transform assertion. */
const ANGLE_CAST_LEFTOVER = /(?<![A-Za-z0-9_$>\])])<([A-Z][A-Za-z0-9_]*)>(?=[A-Za-z_$(])/;

/**
 * Node runs this repo's TypeScript in strip-only mode, which rejects `enum`
 * outright — the same constraint that keeps enums out of Breadboard's own
 * source (see src/lib/garden-directory.ts). Upstream declares three of them, so
 * each is rewritten to the const-object equivalent, which strips cleanly and
 * keeps both the value (`Rating.Good`) and the type (`Rating`) usable.
 */
function convertEnums(source) {
  return source.replace(
    /(export\s+)?enum\s+(\w+)\s*\{([^}]*)\}/g,
    (_match, exported, name, bodyText) => {
      const members = bodyText
        .split(",")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [key, value] = line.split("=").map((part) => part.trim());
          return `  ${key}: ${value},`;
        })
        .join("\n");
      const prefix = exported ?? "";
      return (
        `${prefix}const ${name} = {\n${members}\n} as const\n` +
        `${prefix}type ${name} = (typeof ${name})[keyof typeof ${name}]`
      );
    },
  );
}

/**
 * With `Rating` no longer an enum, the two places upstream uses an enum *member*
 * as a type need `typeof` to keep meaning the literal. These are matched exactly
 * so that an upstream change which moves or adds one fails this script loudly
 * instead of silently producing a tree that no longer type-checks.
 */
// Matched with regexes rather than literals because the clone checks out with
// CRLF line endings on Windows, which no literal containing "\n" would hit.
const MEMBER_TYPE_FIXES = [
  {
    file: "models.ts",
    from: /Exclude<Rating,\s*Rating\.Manual>/,
    to: "Exclude<Rating, typeof Rating.Manual>",
  },
  {
    // The type-literal occurrence, distinguished from the value assignments
    // elsewhere by having no trailing comma.
    file: "models.ts",
    from: /rating: Rating\.Manual(?!,)/,
    to: "rating: typeof Rating.Manual",
  },
  // `next_state` declares its grade loosely as `number` and validates the range
  // at runtime. That type-checked upstream only because TypeScript lets any
  // `number` flow into a numeric enum — an allowance the const-object rewrite
  // above removes, so the five Grade-typed calls in its body would now error.
  // Narrowing the parameter to `Grade` restores it, and matches what upstream's
  // own JSDoc already says the argument is.
  {
    file: "algorithm.ts",
    from: /(next_state\([^)]*?)g: number/,
    to: "$1g: Grade",
  },
  {
    // The Manual (0) short-circuit, which `Grade` alone would reject as a
    // comparison with no overlap. The runtime check is deliberately kept.
    file: "algorithm.ts",
    from: /if \(g === 0\)/,
    to: "if ((g as number) === 0)",
  },
];

/**
 * constant.ts pulls `version` out of the package's own package.json purely to
 * build a display string. That relative path points outside the vendored tree,
 * so it is replaced with the version resolved at vendor time — which keeps the
 * copy self-contained and the reported version honest.
 */
function inlinePackageVersion(source, resolvedVersion) {
  return source.replace(
    // Trailing whitespace is matched with [ \t] rather than \s so the newline
    // ending the import survives — without it the next statement is swallowed.
    /import\s*\{\s*version\s*\}\s*from\s*['"][^'"]*package\.json['"][ \t]*;?/g,
    `// Inlined by dashboard/scripts/vendor-fsrs.mjs (upstream reads its own package.json).\n` +
      `const version = ${JSON.stringify(resolvedVersion)}`,
  );
}

let bytes = 0;
let rewritten = 0;
for (const rel of files) {
  const body = fs.readFileSync(path.join(sourceDir, rel), "utf8");
  let patched = convertAngleCasts(
    convertEnums(addExtensions(inlinePackageVersion(body, version), rel)),
  );
  const leftover = patched.match(ANGLE_CAST_LEFTOVER);
  if (leftover) {
    console.error(
      `${rel} still contains an angle-bracket cast after rewriting: ${leftover[0]}\n` +
        `Node's strip-only mode would reject it. Widen convertAngleCasts in this script.`,
    );
    process.exit(1);
  }
  for (const fix of MEMBER_TYPE_FIXES) {
    if (fix.file !== rel) continue;
    if (!fix.from.test(patched)) {
      console.error(
        `expected to patch an enum-member type in ${rel} but did not match:\n  ${fix.from}\n` +
          `Upstream changed shape — re-check convertEnums/MEMBER_TYPE_FIXES in this script.`,
      );
      process.exit(1);
    }
    patched = patched.replace(fix.from, fix.to);
  }
  if (patched !== body) rewritten += 1;
  const target = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, header + patched, "utf8");
  bytes += body.length;
}

// The clone's LICENSE travels with the code: vendoring MIT source without its
// license text is the one thing that would make this copy non-compliant.
const licensePath = path.join(clone, "LICENSE");
if (fs.existsSync(licensePath)) {
  fs.copyFileSync(licensePath, path.join(outDir, "LICENSE"));
}

console.log(
  `vendored ${files.length} files (${(bytes / 1024).toFixed(1)} KB, ` +
    `${rewritten} with rewritten import paths) ` +
    `from ts-fsrs ${version} @ ${sha.slice(0, 12)} -> ${path.relative(repoRoot, outDir)}`,
);
