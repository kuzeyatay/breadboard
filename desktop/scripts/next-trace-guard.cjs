"use strict";

// Next and @vercel/nft expand dynamic fs expressions before documented
// outputFileTracingExcludes are applied. A broad expression such as
// dashboard/**/* can therefore enter live Chromium profiles and fail on their
// locked SQLite pseudo-files. This preload runs only in the production-build
// child: mutable runtime directories appear empty to every build-time scanner,
// while ordinary app processes and concrete source/package reads are unchanged.
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const dashboardDir = path.resolve(__dirname, "..", "..", "dashboard");
const nextCompiledDir = path.join(dashboardDir, "node_modules", "next", "dist", "compiled");
const picomatch = require(path.join(nextCompiledDir, "picomatch"));
const nft = require(path.join(nextCompiledDir, "@vercel", "nft"));

const mutableTraceSamples = [
  "dashboard/db/__breadboard_trace_guard__/locked",
  "dashboard/database/__breadboard_trace_guard__/locked",
  "dashboard/artifacts/__breadboard_trace_guard__/asset",
  "dashboard/.env.local",
  ".runtime/__breadboard_trace_guard__/state",
  ".agents/__breadboard_trace_guard__/state",
];
const mutableDirectories = [
  path.join(dashboardDir, "db"),
  path.join(dashboardDir, "database"),
  path.join(dashboardDir, "artifacts"),
  path.resolve(dashboardDir, "..", ".runtime"),
  path.resolve(dashboardDir, "..", ".agents"),
];
const matcherCache = new Map();

function isMutableDataPath(candidate) {
  if (typeof candidate !== "string" && !Buffer.isBuffer(candidate) && !(candidate instanceof URL)) {
    return false;
  }
  const resolved = path.resolve(candidate instanceof URL ? require("node:url").fileURLToPath(candidate) : String(candidate));
  const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return mutableDirectories.some((directory) => {
    const root = process.platform === "win32" ? directory.toLowerCase() : directory;
    return normalized === root || normalized.startsWith(`${root}${path.sep}`);
  });
}

function globTouchesMutableData(candidate) {
  const pattern = String(candidate).replaceAll("\\", "/");
  if (!pattern.includes("*")) return false;
  let matcher = matcherCache.get(pattern);
  if (!matcher) {
    matcher = picomatch(pattern, { dot: true });
    matcherCache.set(pattern, matcher);
  }
  return mutableTraceSamples.some((sample) => matcher(sample));
}

function guardTraceOptions(options = {}) {
  const originalIgnore = options.ignore;
  return {
    ...options,
    ignore(candidate) {
      if (globTouchesMutableData(candidate)) return true;
      return typeof originalIgnore === "function" ? originalIgnore(candidate) : false;
    },
  };
}

const patchKey = Symbol.for("breadboard.nextTraceMutableDataGuard");
if (!nft[patchKey]) {
  const originalNodeFileTrace = nft.nodeFileTrace;
  const guardedNodeFileTrace = (files, options) =>
    originalNodeFileTrace(files, guardTraceOptions(options));
  Object.defineProperty(nft, "nodeFileTrace", {
    configurable: true,
    enumerable: true,
    value: guardedNodeFileTrace,
  });
  Object.defineProperty(nft, patchKey, { value: true });
}

const originalReaddir = fs.readdir;
const originalReaddirSync = fs.readdirSync;
const originalPromiseReaddir = fsPromises.readdir;

fs.readdir = function guardedReaddir(candidate, ...args) {
  if (!isMutableDataPath(candidate)) return originalReaddir.call(this, candidate, ...args);
  const callback = args.at(-1);
  if (typeof callback !== "function") return originalReaddir.call(this, candidate, ...args);
  queueMicrotask(() => callback(null, []));
};

fs.readdirSync = function guardedReaddirSync(candidate, ...args) {
  return isMutableDataPath(candidate) ? [] : originalReaddirSync.call(this, candidate, ...args);
};

fsPromises.readdir = async function guardedPromiseReaddir(candidate, ...args) {
  return isMutableDataPath(candidate) ? [] : originalPromiseReaddir.call(this, candidate, ...args);
};

module.exports = { globTouchesMutableData, guardTraceOptions, isMutableDataPath };
