// Build the vendored mem0 OSS engine so the dashboard can import `mem0ai/oss`.
//
// The clone gitignores its own dist/, so a fresh checkout has the sources but
// no bundle. This script turns the exact reviewed checkout and frozen pnpm lock
// into the reviewed bundle identity; a mismatch is fatal because semantic
// memory is a required Runtime V2 service.
//
//   node scripts/setup-mem0.mjs        (or: npm run setup:mem0)
//   node scripts/setup-mem0.mjs --if-needed
//
// `--if-needed` is what the desktop build uses: it returns immediately only
// when the source, output, and dashboard link all match the reviewed closure.
// Without it, the exact frozen build is repeated for an explicit repair.
//
// Two non-obvious steps, both explained where they happen below.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPinnedCleanCheckout,
  pinnedSourceTree,
} from "../desktop/scripts/pinned-source-checkout.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = path.join(repoRoot, "mem0", "mem0-ts");
const bundle = path.join(packageDir, "dist", "oss", "index.js");
const dashboardDir = path.join(repoRoot, "dashboard");
const onlyIfNeeded = process.argv.includes("--if-needed");
const PINNED_MEM0_BUILD = Object.freeze({
  sourceCommit: "4debc58a83377b18be81ae1e5969a300736b2fac",
  sourceTree: "6d1ef35be8ee14a65bfa5dc213fbde9884cd8f38",
  nodeVersion: "v24.14.1",
  packageManager: "pnpm@10.5.2",
  files: {
    "package.json": { size: 7_991, sha256: "AEDF5C3F5CADFDEE10CD9933676B2487C2AEA5D0917B9BB98512980BA4F15136" },
    "pnpm-lock.yaml": { size: 343_440, sha256: "E34B558987E1276F3A0AB44E4CF5BAF8E54CE5786DD77AFB8359BD418B55DD68" },
    "pnpm-workspace.yaml": { size: 1_243, sha256: "D5858AF881395A9AD9F68545008197BAF0BBDDF69E06B7CD06D9B81E5215AC6B" },
  },
  output: {
    fileCount: 12,
    sha256: "D33627F29BF81CFC570E5E8AA8356EC4C4D0612AB7D2F8BBEA47B67A47A86167",
  },
});

function canonicalFileIdentity(filePath) {
  const source = fs.readFileSync(filePath);
  const canonical = source.includes(0)
    ? source
    : Buffer.from(source.toString("utf8").replace(/\r\n/gu, "\n"), "utf8");
  return {
    size: canonical.length,
    sha256: createHash("sha256").update(canonical).digest("hex").toUpperCase(),
  };
}

function canonicalTreeIdentity(root) {
  const records = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      const metadata = fs.lstatSync(fullPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`The mem0 build output contains an indirect file: ${relativePath}`);
      }
      if (metadata.isDirectory()) visit(fullPath);
      else if (metadata.isFile()) {
        const identity = canonicalFileIdentity(fullPath);
        records.push(`${relativePath}\0${identity.size}\0${identity.sha256}\n`);
      } else {
        throw new Error(`The mem0 build output contains a non-file entry: ${relativePath}`);
      }
    }
  }
  visit(root);
  return {
    fileCount: records.length,
    sha256: createHash("sha256").update(records.join("")).digest("hex").toUpperCase(),
  };
}

function assertPinnedSource() {
  assertPinnedCleanCheckout({
    label: "mem0",
    sourceRoot: path.join(repoRoot, "mem0"),
    expectedCommit: PINNED_MEM0_BUILD.sourceCommit,
    allowVendoredSnapshot: true,
  });
  const tree = pinnedSourceTree(path.join(repoRoot, "mem0"), "mem0-ts");
  if (tree !== PINNED_MEM0_BUILD.sourceTree) {
    throw new Error("The reviewed mem0-ts Git tree is unavailable.");
  }
  for (const [relativePath, expected] of Object.entries(PINNED_MEM0_BUILD.files)) {
    const filePath = path.join(packageDir, relativePath);
    const actual = canonicalFileIdentity(filePath);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`The reviewed mem0 build input changed: ${relativePath}`);
    }
  }
  if (process.version !== PINNED_MEM0_BUILD.nodeVersion) {
    throw new Error(
      `mem0 must be built with Node ${PINNED_MEM0_BUILD.nodeVersion}; found ${process.version}.`,
    );
  }
}

function exactBuildReady() {
  const dist = path.join(packageDir, "dist");
  if (!fs.existsSync(bundle) || !fs.existsSync(dist)) return false;
  const actual = canonicalTreeIdentity(dist);
  return actual.fileCount === PINNED_MEM0_BUILD.output.fileCount &&
    actual.sha256 === PINNED_MEM0_BUILD.output.sha256;
}

/**
 * Both halves have to hold: the clone must be built, and the dashboard must be
 * able to resolve it. They fail independently — a rebuilt clone with no link,
 * or a link to a clone whose dist/ was cleaned — so asking the dashboard's own
 * resolver is the only answer that matches what the running server will see.
 */
function engineReady() {
  if (!exactBuildReady()) return false;
  try {
    const linkedPackage = path.join(dashboardDir, "node_modules", "mem0ai");
    if (
      fs.realpathSync.native(linkedPackage).toLowerCase() !==
      fs.realpathSync.native(packageDir).toLowerCase()
    ) return false;
    const resolve = createRequire(path.join(dashboardDir, "package.json"));
    return fs.existsSync(resolve.resolve("mem0ai/oss"));
  } catch {
    return false;
  }
}

assertPinnedSource();

if (onlyIfNeeded && engineReady()) {
  console.log("mem0 engine matches the reviewed immutable build; nothing to do.");
  process.exit(0);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}.`);
  }
}

if (!fs.existsSync(packageDir)) {
  throw new Error(`The pinned mem0 checkout is missing: ${packageDir}`);
}

const corepackCli = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "corepack",
  "dist",
  "corepack.js",
);
if (!fs.existsSync(corepackCli)) {
  throw new Error(`The pinned Corepack launcher is missing beside Node: ${corepackCli}`);
}
const pnpm = [corepackCli, PINNED_MEM0_BUILD.packageManager];

console.log("Installing the exact frozen mem0-ts dependency graph…");
run(process.execPath, [...pnpm, "install", "--frozen-lockfile"], packageDir);

console.log("Building mem0-ts…");
run(process.execPath, [...pnpm, "exec", "tsup"], packageDir);

if (!exactBuildReady()) {
  throw new Error("The mem0 build output does not match the reviewed immutable artifact identity.");
}

if (!engineReady()) {
  throw new Error(
    "The dashboard lockfile installation does not link mem0ai to the reviewed checkout. Run its frozen npm install first.",
  );
}

console.log(
  "\nThe reviewed mem0 engine is ready. Semantic recall is on by default; enable fact extraction\n" +
    "with BREADBOARD_MEM0_EXTRACTION=on. See docs/MEM0_INTEGRATION.md.",
);
