/**
 * Execution snapshots — source identity plus the environment identity a test
 * run actually depends on.
 *
 * The previous pass established that `baseCommit` is not the product: the
 * source fingerprint is. This pass establishes that the source fingerprint is
 * not the *execution* either. Breadboard vendors ~60 gitignored clones at the
 * repository root, and several dashboard tests read them directly, so a
 * reconstruction that is byte-perfect on authored source can still execute
 * differently.
 *
 *   baseCommit           which commit the repository is on
 *   sourceFingerprint    what the authored source was
 *   environmentFingerprint  what the surrounding inputs were
 *   executionSnapshotId  the pair of the last two, which is what a run means
 *
 * Nothing here captures secrets, credentials, userData, gardens, browser
 * profiles, or caches. Vendored clones are identified, never copied: a clone's
 * identity is its name plus its own git HEAD, which is enough to detect drift
 * without moving gigabytes.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { captureSourceSnapshot } from "./source-snapshot.mjs";

export const EXECUTION_SNAPSHOT_VERSION = 1;

/**
 * Environment variables whose values change deterministic behaviour. Anything
 * that could carry a credential is recorded as *set or unset*, never by value.
 */
const RECORDED_ENV = Object.freeze([
  "NODE_ENV",
  "CI",
  "BREADBOARD_DATA_DIR",
  "BREADBOARD_QA_MODE",
  "GBRAIN_MODE",
  "UI_TARS_MODE",
  "CAD_MODE",
  "CLIPROXY_MODE",
  "VIDEO_TRANSCRIPTION_ENABLED",
]);

const LOCKFILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "dashboard/package.json",
  "dashboard/package-lock.json",
  "desktop/package.json",
  "desktop/package-lock.json",
]);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: (result.stdout ?? "").trim() };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileDigest(absolute) {
  try {
    return sha256(fs.readFileSync(absolute));
  } catch {
    return null;
  }
}

/**
 * Root-level directories git ignores but the product needs at runtime. These
 * are the inputs a source snapshot provably cannot carry.
 */
export function discoverIgnoredRoots(repoRoot) {
  const resolved = path.resolve(repoRoot);
  const roots = [];
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".git" || entry.name.startsWith(".qa-")) continue;
    if (run("git", ["check-ignore", "-q", entry.name], resolved).status !== 0) continue;

    const absolute = path.join(resolved, entry.name);
    // A vendored clone's identity is its own HEAD. That detects an upstream
    // bump without copying the clone.
    const head = run("git", ["-C", absolute, "rev-parse", "HEAD"], resolved);
    roots.push({
      name: entry.name,
      isGitRepository: head.status === 0,
      head: head.status === 0 ? head.stdout : null,
      present: true,
    });
  }
  return roots.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Checkout semantics — the third identity gap this Week-2 sequence found.
 *
 * `core.autocrlf=true` made every worktree checkout rewrite text files to CRLF
 * while the developer's tree held LF. Ten source-contract assertions failed in
 * QA reconstructions and passed for the developer, and the source fingerprint
 * matched throughout because `git diff` normalises line endings. Source identity
 * is therefore not sufficient execution identity, and the policy that decides
 * on-disk bytes has to be recorded rather than remembered.
 */
export function captureCheckoutPolicy({ repoRoot }) {
  const resolved = path.resolve(repoRoot);
  const configured = (key) => {
    const result = run("git", ["config", "--get", key], resolved);
    return result.status === 0 && result.stdout !== "" ? result.stdout : null;
  };
  const attributesPath = path.join(resolved, ".gitattributes");
  const hasAttributes = fs.existsSync(attributesPath);
  return {
    repositoryAutocrlf: configured("core.autocrlf"),
    repositoryEol: configured("core.eol"),
    gitattributesPresent: hasAttributes,
    gitattributesSha256: hasAttributes ? fileDigest(attributesPath) : null,
    platform: process.platform,
    // QA does not inherit the machine's policy: reconstruction worktrees are
    // checked out with autocrlf disabled so they carry committed bytes.
    qaReconstructionPolicy: "core.autocrlf=false (deterministic, committed bytes)",
    inheritsMachineGlobalPolicy: false,
  };
}

/** Runtime, dependency and ignored-root identity, with no secret material. */
export function captureEnvironmentSnapshot({ repoRoot }) {
  const resolved = path.resolve(repoRoot);

  const runtimeVersions = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    npm: run("npm", ["--version"], resolved).stdout || null,
    git: run("git", ["--version"], resolved).stdout || null,
  };

  const dependencyInputs = {};
  for (const relative of LOCKFILES) {
    dependencyInputs[relative] = fileDigest(path.join(resolved, relative));
  }
  for (const relative of ["node_modules", "dashboard/node_modules", "desktop/node_modules"]) {
    dependencyInputs[`${relative}/present`] = fs.existsSync(path.join(resolved, relative));
  }

  const environmentVariables = {};
  for (const name of RECORDED_ENV) {
    const value = process.env[name];
    environmentVariables[name] = value === undefined ? null : value;
  }

  const ignoredRoots = discoverIgnoredRoots(resolved);
  const checkoutPolicy = captureCheckoutPolicy({ repoRoot: resolved });

  const manifest = [
    `executionSnapshotVersion ${EXECUTION_SNAPSHOT_VERSION}`,
    ...Object.entries(runtimeVersions).map(([key, value]) => `runtime ${key} ${value}`),
    ...Object.entries(dependencyInputs).map(([key, value]) => `dependency ${key} ${value}`),
    ...Object.entries(environmentVariables).map(([key, value]) => `env ${key} ${value}`),
    ...ignoredRoots.map((root) => `ignoredRoot ${root.name} ${root.head ?? "not-a-git-repo"}`),
  ].join("\n");

  return {
    capturedAt: new Date().toISOString(),
    runtimeVersions,
    dependencyInputs,
    environmentVariables,
    ignoredRoots,
    ignoredRootCount: ignoredRoots.length,
    checkoutPolicy,
    environmentFingerprint: sha256(manifest),
  };
}

/** Freeze one execution identity: source plus environment. */
export function captureExecutionSnapshot({ repoRoot, label = null }) {
  const source = captureSourceSnapshot({ repoRoot, label });
  const environment = captureEnvironmentSnapshot({ repoRoot });
  const executionSnapshotId = sha256(
    `${source.sourceFingerprint}\n${environment.environmentFingerprint}`,
  );
  return {
    executionSnapshotVersion: EXECUTION_SNAPSHOT_VERSION,
    label,
    frozenAt: new Date().toISOString(),
    executionSnapshotId,
    baseCommit: source.baseCommit,
    sourceFingerprint: source.sourceFingerprint,
    environmentFingerprint: environment.environmentFingerprint,
    source,
    environment,
  };
}

/** Identity without payloads, for receipts and comparisons. */
export function executionIdentity(snapshot) {
  return {
    executionSnapshotId: snapshot.executionSnapshotId,
    baseCommit: snapshot.baseCommit,
    sourceFingerprint: snapshot.sourceFingerprint,
    environmentFingerprint: snapshot.environmentFingerprint,
  };
}

/**
 * Compare a live environment against a frozen one and say precisely what moved.
 * Used both to detect developer drift and to check a reconstruction.
 */
export function compareEnvironments(expected, actual) {
  const differences = [];
  for (const [key, value] of Object.entries(expected.runtimeVersions)) {
    if (actual.runtimeVersions[key] !== value) {
      differences.push({ kind: "runtime", key, expected: value, actual: actual.runtimeVersions[key] });
    }
  }
  for (const [key, value] of Object.entries(expected.dependencyInputs)) {
    if (actual.dependencyInputs[key] !== value) {
      differences.push({ kind: "dependency", key, expected: value, actual: actual.dependencyInputs[key] });
    }
  }
  for (const [key, value] of Object.entries(expected.environmentVariables)) {
    if (actual.environmentVariables[key] !== value) {
      differences.push({ kind: "env", key, expected: value, actual: actual.environmentVariables[key] });
    }
  }
  for (const [key, value] of Object.entries(expected.checkoutPolicy ?? {})) {
    if ((actual.checkoutPolicy ?? {})[key] !== value) {
      differences.push({
        kind: "checkout",
        key,
        expected: value,
        actual: (actual.checkoutPolicy ?? {})[key],
      });
    }
  }
  const actualRoots = new Map(actual.ignoredRoots.map((root) => [root.name, root]));
  for (const root of expected.ignoredRoots) {
    const found = actualRoots.get(root.name);
    if (!found) {
      differences.push({ kind: "ignoredRoot", key: root.name, expected: root.head ?? "present", actual: "missing" });
    } else if (found.head !== root.head) {
      differences.push({ kind: "ignoredRoot", key: root.name, expected: root.head, actual: found.head });
    }
  }
  return {
    equivalent: differences.length === 0,
    differences,
    missingIgnoredRoots: differences
      .filter((entry) => entry.kind === "ignoredRoot" && entry.actual === "missing")
      .map((entry) => entry.key),
  };
}
