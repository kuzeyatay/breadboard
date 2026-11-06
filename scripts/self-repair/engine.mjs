import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertAutomaticRepairPatch, claimSourceRepairEngine, readSourceRepair, updateSourceRepair,
  readRepairJournal, repairFileHash, redactedRepairText, signSourceRepairRelease,
  MAX_SOURCE_REPAIR_ATTEMPTS,
} from "../../desktop/src/shared/source-repair.ts";
import { captureSourceSnapshot, snapshotStillCurrent, sourceManifest } from "../../qa/autonomous/lib/source-snapshot.mjs";
import { createSnapshotWorktree } from "../../qa/autonomous/lib/repair-worktree.mjs";
import { issueRepairCapability, applyGatedMutation, finalizeRepairCapability } from "../../qa/autonomous/lib/repair-capability.mjs";
import { proposeSourceRepair, reviewSourceRepair } from "./model.mjs";
import { availableDashboardBuild } from "../../desktop/scripts/dashboard-build-cache.mjs";

const CONTROLLER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TERMINAL = new Set(["ready", "activating", "probation", "committed", "rollback_requested", "rolled_back", "cancelled", "blocked", "failed"]);
const OUTPUT_BOUND = 64 * 1024;
const SOURCE_ROOTS = ["dashboard", "desktop", "scripts", "qa", "native", "package.json", "package-lock.json", ".gitignore"];
const delayBeat = () => new Promise(resolve => setImmediate(resolve));

/** Commands are fixed by this controller. A model never supplies argv or env. */
export function runRepairCommand(command, args, { cwd, env, signal, timeoutMs = 120_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, signal, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = chunk => { output = (output + chunk.toString()).slice(-OUTPUT_BOUND); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, killedBy) => { clearTimeout(timeout); resolve({ code: code ?? -1, signal: killedBy, output: redactedRepairText(output, OUTPUT_BOUND) }); });
  });
}
function testEnvironment(root, directory) {
  const env = {};
  for (const key of ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "PATH", "LANG"]) if (process.env[key]) env[key] = process.env[key];
  return { ...env, NODE_ENV: "test", CI: "1", HOME: directory, USERPROFILE: directory, TEMP: directory, TMP: directory,
    BREADBOARD_DATA_DIR: directory, BREADBOARD_GOAL_HOME: path.join(directory, "goals"),
    BREADBOARD_REPO_ROOT: root, BREADBOARD_REPAIR_TEST_SOURCE: path.join(root, "dashboard", "src") };
}
function validateRegression(content) {
  if (typeof content !== "string" || content.length < 80 || content.length > 16000 ||
      !content.includes("node:test") || !content.includes("node:assert/strict") ||
      /(?:\.skip\s*\(|\.todo\s*\(|readFile|readFileSync|child_process|process\.|globalThis|\beval\s*\(|\bFunction\s*\(|\brequire\s*\(|\bimport\s*\(|\bfetch\s*\(|constructor)/.test(content)) throw new Error("Regression must test behavior without process, file or network authority.");
  for (const match of content.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
    if (!["node:test", "node:assert/strict"].includes(match[1]) && !match[1].startsWith("@/lib/")) throw new Error("Regression import is outside application behavior.");
  }
}
function relatedTests(root, sources) {
  const directory = path.join(root, "dashboard", "tests");
  if (!fs.existsSync(directory)) return [];
  const needles = sources.map(file => file.replace(/^dashboard\/src\//, ""));
  return fs.readdirSync(directory).filter(name => name.endsWith(".test.mjs"))
    .filter(name => { const content = fs.readFileSync(path.join(directory, name), "utf8"); return needles.some(needle => content.includes(needle)); })
    .sort().slice(0, 12).map(name => path.join(directory, name));
}
export async function copyRepairDashboardDependencies(baseRoot, root, { signal, runCommand = runRepairCommand } = {}) {
  signal?.throwIfAborted();
  const source = path.join(baseRoot, "dashboard", "node_modules");
  const target = path.join(root, "dashboard", "node_modules");
  if (!fs.existsSync(source)) return;
  if (fs.existsSync(target)) throw new Error("Repair dependency destination must be fresh.");
  const directories = [source], links = [];
  let bytes = 0, files = 0;
  while (directories.length) {
    signal?.throwIfAborted();
    for (const entry of fs.readdirSync(directories.pop(), { withFileTypes: true })) {
      const full = path.join(entry.parentPath, entry.name);
      if (entry.isSymbolicLink()) links.push(full);
      else if (entry.isDirectory()) directories.push(full);
      else if (entry.isFile()) { bytes += fs.statSync(full).size; files++; }
      if (files > 250_000 || bytes > 12 * 1024 ** 3) throw new Error("Installed dependencies exceed the isolated copy bound.");
    }
    await delayBeat();
  }
  const space = fs.statfsSync(root);
  if (Number(space.bavail) * Number(space.bsize) < bytes + 8 * 1024 ** 3) throw new Error("Insufficient disk headroom for isolated dependencies and build.");
  fs.mkdirSync(target, { recursive: true });
  // Turbopack fences its project filesystem. A junction for the entire
  // node_modules tree escapes that fence, even though Node itself accepts it.
  // Copy installed bytes only; never install, update, or hard-link packages.
  if (process.platform === "win32") {
    const copied = await runCommand(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "robocopy.exe"),
      [source, target, "/E", "/COPY:DAT", "/R:0", "/W:0", "/MT:64", "/XJ", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"],
      { cwd: root, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP }, signal, timeoutMs: 45 * 60_000 });
    if (copied.code < 0 || copied.code >= 8) throw new Error(`Installed dependency copy failed: ${copied.output.slice(-1500)}`);
    // Preserve the reviewed per-package links (notably mem0ai), whose pinned
    // source/bundle identities the normal build independently verifies.
    for (const full of links) {
      signal?.throwIfAborted();
      const destination = path.join(target, path.relative(source, full));
      if (!fs.existsSync(destination)) fs.symlinkSync(fs.realpathSync.native(full), destination, fs.statSync(full).isDirectory() ? "junction" : "file");
      await delayBeat();
    }
  } else {
    await fs.promises.cp(source, target, { recursive: true, verbatimSymlinks: true, filter: () => { signal?.throwIfAborted(); return true; } });
  }
}
async function linkInstalledInputs(baseRoot, root, options) {
  const relatives = ["node_modules", "dashboard/node_modules", "desktop/node_modules"];
  // Existing external source dependencies are environment inputs. Never link
  // data/config/temp roots; all model mutations are realpath-fenced by the gate.
  for (const entry of fs.readdirSync(baseRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || ["node_modules", "dashboard", "desktop", "native", "runtime", "runtime-v2", "audits"].includes(entry.name)) continue;
    if (fs.existsSync(path.join(baseRoot, entry.name, "package.json")) || fs.existsSync(path.join(baseRoot, entry.name, "pyproject.toml"))) relatives.push(entry.name);
  }
  for (const relative of relatives) {
    const source = path.join(baseRoot, relative), target = path.join(root, relative);
    if (!fs.existsSync(source) || fs.existsSync(target)) continue;
    if (relative === "dashboard/node_modules") await copyRepairDashboardDependencies(baseRoot, root, options);
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
    }
  }
}
async function releaseFiles(root, sources) {
  const files = Object.entries(sourceManifest({ repoRoot: root })).map(([file, sha256]) => ({ path: file, sha256 }));
  for (const file of sources) if (!files.some(entry => entry.path === file)) files.push({ path: file, sha256: repairFileHash(path.join(root, file)) });
  const build = path.join(root, "dashboard", ".next-desktop", "standalone");
  // Raw workers execute source, whereas the dashboard executes the standalone
  // bundle. Seal both closures, including unchanged source dependencies.
  const queue = [build, path.join(root, "dashboard", "src")];
  while (queue.length) {
    for (const entry of fs.readdirSync(queue.pop(), { withFileTypes: true })) {
      const full = path.join(entry.parentPath, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Release build contains a mutable dependency link.");
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile()) files.push({ path: path.relative(root, full).split(path.sep).join("/"), sha256: repairFileHash(full) });
      if (files.length > 100_000) throw new Error("Release build exceeds its manifest bound.");
    }
    await delayBeat();
  }
  return [...new Map(files.map(file => [file.path, file])).values()].sort((a, b) => a.path.localeCompare(b.path));
}
export async function executeSourceRepair({ dataRoot, repairId, endpoint, apiKey, signal, dependencies = {} }) {
  const releaseLock = claimSourceRepairEngine(dataRoot);
  if (!releaseLock) return { deferred: true };
  const runCommand = dependencies.runCommand ?? runRepairCommand;
  const propose = dependencies.propose ?? proposeSourceRepair;
  const review = dependencies.review ?? reviewSourceRepair;
  let request = readSourceRepair(dataRoot, repairId);
  const guard = () => {
    signal?.throwIfAborted();
    const current = readSourceRepair(dataRoot, repairId);
    if (!current || current.stage === "cancelled") throw new Error("Source repair cancelled.");
    if (Date.now() > current.deadline) throw new Error("Source repair deadline exhausted.");
  };
  try {
    if (!request || TERMINAL.has(request.stage)) return { skipped: true };
    const parent = readRepairJournal(dataRoot);
    if (parent.phase !== "stable") return { deferred: true };
    const sourceRoot = parent.active?.root ?? request.baseRoot;
    guard();
    if (!(dependencies.baselineReady ?? availableDashboardBuild)(sourceRoot).current) throw new Error("The running build does not match its source; rebuild the developer checkpoint before automatic repair.");
    const baseFiles = Object.entries(sourceManifest({ repoRoot: sourceRoot, roots: SOURCE_ROOTS })).map(([file, sha256]) => ({ path: file, sha256 }));
    const snapshot = captureSourceSnapshot({ repoRoot: sourceRoot, roots: SOURCE_ROOTS, maxUntrackedFiles: 5000 });
    for (let attempt = request.attempt + 1; attempt <= MAX_SOURCE_REPAIR_ATTEMPTS; attempt++) {
      guard();
      request = updateSourceRepair(dataRoot, repairId, { stage: "preparing", attempt, parentReleaseId: parent.active?.id ?? null, sourceFingerprint: snapshot.sourceFingerprint });
      const worktree = createSnapshotWorktree({ repoRoot: request.baseRoot, findingId: `${repairId}-${attempt}`, snapshot, linkExternal: false });
      const root = worktree.worktreePath;
      updateSourceRepair(dataRoot, repairId, { candidateRoot: root });
      await linkInstalledInputs(request.baseRoot, root, { signal, runCommand });
      const scratch = path.join(root, ".qa-results", "source-repair");
      fs.mkdirSync(scratch, { recursive: true });
      const env = testEnvironment(root, path.join(scratch, "data"));
      fs.mkdirSync(env.TEMP, { recursive: true });
      const proposal = await propose({ root, request, endpoint, apiKey, signal });
      guard();
      if (proposal.classification !== "PRODUCT_BUG") {
        updateSourceRepair(dataRoot, repairId, { stage: "blocked", reason: redactedRepairText(String(proposal.reason ?? "No reproducible application defect was found.")) });
        return { blocked: true };
      }
      assertAutomaticRepairPatch(proposal.edits);
      validateRegression(proposal.regression);
      if (typeof proposal.rootCause !== "string" || !proposal.rootCause.trim()) throw new Error("Repair diagnosis has no root cause.");
      const sources = [...new Set(proposal.edits.map(edit => edit.path))];
      const originals = Object.fromEntries(sources.map(file => [file, fs.readFileSync(path.join(root, file), "utf8")]));
      const replacements = { ...originals };
      for (const edit of proposal.edits) {
        if (replacements[edit.path].split(edit.before).length !== 2) throw new Error("Repair snippet is not unique in the verified source.");
        replacements[edit.path] = replacements[edit.path].replace(edit.before, edit.after);
      }
      const verdict = await review({ request, proposal, sources: originals, endpoint, apiKey, signal });
      if (!verdict.approved) throw new Error(`Repair review rejected the candidate: ${verdict.reason}`);
      const regression = path.join(scratch, "regression.test.mjs");
      fs.writeFileSync(regression, proposal.regression);
      const tests = dependencies.relatedTests?.(root, sources) ?? relatedTests(root, sources);
      if (!tests.length) throw new Error("No relevant existing regression suite could be identified; review is required.");
      // Proposed tests have deliberately little authority. Existing, unchanged
      // repository suites also exercise native SQLite and compiler subprocesses;
      // run those trusted suites with the scrubbed disposable environment, just
      // like the fixed build, without granting that authority to a new test.
      const testLoader = pathToFileURL(path.join(CONTROLLER_ROOT, "scripts", "self-repair", "test-loader.mjs")).href;
      const existingTestHashes = new Map(tests.map(file => [file, repairFileHash(file)]));
      const runExistingTest = file => {
        if (repairFileHash(file) !== existingTestHashes.get(file)) throw new Error("An existing regression suite changed after baseline capture.");
        return runCommand(process.execPath, ["--import", testLoader, file], { cwd: root, env, signal });
      };
      const runTest = file => runCommand(process.execPath, ["--permission",
        `--allow-fs-read=${root}`, `--allow-fs-read=${path.join(request.baseRoot, "dashboard", "node_modules")}`,
        `--allow-fs-read=${path.join(CONTROLLER_ROOT, "scripts", "self-repair", "test-loader.mjs")}`,
        `--allow-fs-write=${env.TEMP}`, "--import", testLoader, file], { cwd: root, env, signal });
      updateSourceRepair(dataRoot, repairId, { stage: "testing" });
      for (const test of tests) {
        guard(); const result = await runExistingTest(test);
        if (result.code !== 0) throw new Error(`The existing suite does not pass on the captured baseline; automatic repair is blocked. ${result.output.slice(-2500)}`);
      }
      const baseline = [await runTest(regression), await runTest(regression)];
      if (baseline.some(result => result.code === 0 || !/ERR_ASSERTION/.test(result.output))) throw new Error("The proposed behavioral regression did not reproduce an assertion failure twice.");
      guard();
      const regressionPath = `dashboard/tests/${repairId}.test.mjs`;
      const capability = issueRepairCapability({ repoRoot: request.baseRoot, worktree, allowedPaths: sources, regressionTestPaths: [regressionPath], finding: {
        id: repairId, scenario: "interrupted-user-task", revision: worktree.sourceRevision,
        sourceSnapshotFingerprint: snapshot.sourceFingerprint, status: "failed", classification: "PRODUCT_BUG",
        reproduction: { reproduced: true, attempts: 2 }, diagnosis: { rootCause: proposal.rootCause, responsibleCodePath: sources.join(", ") },
      } });
      const writeSources = values => { for (const file of sources) applyGatedMutation({ capability, targetPath: file, edit: () => values[file] }); };
      applyGatedMutation({ capability, targetPath: regressionPath, edit: () => proposal.regression });
      writeSources(replacements);
      const regressionFile = path.join(root, regressionPath);
      const repairedRegression = await runTest(regressionFile);
      if (repairedRegression.code !== 0) {
        updateSourceRepair(dataRoot, repairId, { reason: `The previous candidate did not pass its regression: ${repairedRegression.output.slice(-2500)}` });
        continue;
      }
      for (const test of tests) { guard(); if ((await runExistingTest(test)).code !== 0) throw new Error("The repair regressed an existing test."); }
      // Keep the oracle unchanged while reintroducing the exact original bug.
      writeSources(originals);
      const reintroduced = await runTest(regressionFile);
      if (reintroduced.code === 0 || !/ERR_ASSERTION/.test(reintroduced.output)) throw new Error("Regression still passed when the defect was reintroduced.");
      writeSources(replacements);
      if ((await runTest(regressionFile)).code !== 0) throw new Error("The repair did not pass its fresh-process replay.");
      const gateReceipt = finalizeRepairCapability({ capability, worktree });
      guard();
      updateSourceRepair(dataRoot, repairId, { stage: "building", checks: { baselineReproductions: 2, regressionPassed: true,
        defectReintroductionFailed: true, existingTests: tests.map(file => path.relative(root, file)), review: verdict, gate: gateReceipt } });
      const beforeBuild = sourceManifest({ repoRoot: root });
      if (dependencies.build) await dependencies.build(root, { env, signal });
      else {
        const space = fs.statfsSync(root);
        if (Number(space.bavail) * Number(space.bsize) < 8 * 1024 ** 3) throw new Error("Insufficient disk headroom for an isolated build.");
        const build = await runCommand(process.execPath, [path.join(root, "desktop", "scripts", "build-dashboard.mjs")],
          { cwd: root, env: { ...env, NODE_ENV: "production", BREADBOARD_SOURCE_REPAIR_BUILD: "1" }, signal, timeoutMs: 45 * 60_000 });
        if (build.code !== 0) throw new Error(`The isolated production build failed: ${build.output.slice(-3000)}`);
      }
      guard();
      // Build-generated outputs are excluded by the source manifest. Authored
      // source may not change after the reviewer and tests approved it.
      if (JSON.stringify(sourceManifest({ repoRoot: root })) !== JSON.stringify(beforeBuild)) throw new Error("The build changed reviewed source.");
      if (!snapshotStillCurrent({ repoRoot: sourceRoot, snapshot }).matches) throw new Error("The source changed while its candidate was being verified.");
      const files = await releaseFiles(root, [...sources, regressionPath]);
      const release = signSourceRepairRelease(dataRoot, { id: repairId, baseRoot: request.baseRoot, root,
        sourceFingerprint: snapshot.sourceFingerprint, files, baseFiles, changedSources: sources, createdAt: Date.now() });
      guard();
      updateSourceRepair(dataRoot, repairId, { stage: "ready", release, reason: "Behavioral regression, existing tests, independent review and isolated build passed." });
      return { ready: true, repairId };
    }
    throw new Error("Two repair candidates failed to resolve the reproduced defect.");
  } catch (error) {
    if (request) updateSourceRepair(dataRoot, repairId, { stage: signal?.aborted ? "cancelled" : "blocked",
      reason: redactedRepairText(error instanceof Error ? error.message : String(error)) });
    return { blocked: true };
  } finally { releaseLock(); }
}
