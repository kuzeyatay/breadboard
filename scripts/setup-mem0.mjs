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
  sourceCommit: "94c3fe9f238f3dbf29c9ce98643bd71eb13077cd",
  sourceTree: "07bb30162782b2e1503a7a1a35d32fa9dbd03e9c",
  nodeVersion: "v24.14.1",
  packageManager: "pnpm@10.5.2",
  files: {
    "package.json": { size: 8_301, sha256: "3B5711FD86762C4E9DE35BF80D3EC2BBF27141F502ACA88D4664DD850C4D8DB7" },
    "pnpm-lock.yaml": { size: 341_930, sha256: "9435E55FBBAEF4A497DEC7A58E378ECC78D207C79F60783D2B8735E1485216BB" },
    "pnpm-workspace.yaml": { size: 1_457, sha256: "450F2C287DC2EE1C9642DD66EF9B87C33BC6AABCFF21BE2CD657A92EC50AFEB8" },
  },
  // Source maps are excluded: they embed the source text, whose line endings
  // follow the checkout (CRLF on an autocrlf workstation, LF on a clean
  // runner), and the staged bundle never ships them anyway.
  output: {
    fileCount: 8,
    sha256: "4971ACAC7225A62712E5ACC9040AB4771C8EF0E7FAE007760531BD133A10EE2D",
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
        if (entry.name.endsWith(".map")) continue;
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
    records: records.map((record) => record.replace(/\x00/gu, " ").trimEnd()),
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

if ((onlyIfNeeded || process.argv.includes("--verify-only")) && engineReady()) {
  console.log("mem0 engine matches the reviewed immutable build; nothing to do.");
  process.exit(0);
}
if (process.argv.includes("--verify-only")) throw new Error("Isolated repair requires the existing verified mem0 build; automatic dependency installation is disabled.");

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
  // Say exactly what was produced: a clean machine cannot be diffed by hand.
  const dist = path.join(packageDir, "dist");
  const actual = canonicalTreeIdentity(dist);
  console.error(
    `mem0 build output identity: ${actual.fileCount} files ${actual.sha256}; ` +
      `reviewed: ${PINNED_MEM0_BUILD.output.fileCount} files ${PINNED_MEM0_BUILD.output.sha256}`,
  );
  for (const record of actual.records) console.error(`  ${record}`);
  throw new Error("The mem0 build output does not match the reviewed immutable artifact identity.");
}

if (!engineReady()) {
  throw new Error(
    "The dashboard lockfile installation does not link mem0ai to the reviewed checkout. Run its frozen npm install first.",
  );
}

console.log(
  "\nThe reviewed mem0 engine is ready. Semantic recall and fact extraction are on by default\n" +
    "(turn extraction off in Settings → Memory). See docs/MEM0_INTEGRATION.md.",
);
