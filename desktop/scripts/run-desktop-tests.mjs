import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DESKTOP_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const COMPILED_TESTS_ROOT = path.join(DESKTOP_ROOT, "dist-tests", "tests");

/** This fixture captures the physical desktop and must not overlap others. */
export const SERIAL_SCREEN_TEST_FILES = Object.freeze([
  "tab-manager.test.js",
]);

function isDesktopTestFile(name) {
  return typeof name === "string" && name.endsWith(".test.js") && path.basename(name) === name;
}

export function discoverDesktopTestFiles(
  testsRoot = COMPILED_TESTS_ROOT,
  readDirectory = fs.readdirSync,
  sourceRoot = path.join(DESKTOP_ROOT, "tests"),
  fileExists = fs.existsSync,
) {
  return readDirectory(testsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isDesktopTestFile(entry.name))
    .map((entry) => entry.name)
    // TypeScript does not remove output for a deleted test. Only run compiled
    // files that still have source, so a renamed integration fixture cannot
    // haunt every subsequent local run until someone deletes dist-tests.
    .filter((name) => fileExists(path.join(sourceRoot, name.replace(/\.js$/, ".ts"))))
    .sort((left, right) => left.localeCompare(right));
}

export function partitionDesktopTestFiles(discoveredFiles) {
  const files = [...new Set(discoveredFiles)]
    .filter(isDesktopTestFile)
    .sort((left, right) => left.localeCompare(right));
  const discovered = new Set(files);
  const missing = SERIAL_SCREEN_TEST_FILES.filter((file) => !discovered.has(file));
  if (missing.length > 0) {
    throw new Error(`Desktop screen-test lane is missing required file(s): ${missing.join(", ")}`);
  }
  const screenFiles = new Set(SERIAL_SCREEN_TEST_FILES);
  return {
    parallel: files.filter((file) => !screenFiles.has(file)),
    screen: [...SERIAL_SCREEN_TEST_FILES],
  };
}

export function desktopTestLanes(discoveredFiles) {
  const partition = partitionDesktopTestFiles(discoveredFiles);
  return [
    { id: "parallel", mode: "parallel", files: partition.parallel },
    ...partition.screen.map((file) => ({
      id: `screen:${file}`,
      mode: "serial-screen",
      files: [file],
    })),
  ];
}

export function nodeTestArguments(lane, extraArguments = []) {
  return [
    "--test",
    ...extraArguments,
    ...lane.files.map((file) => path.join("dist-tests", "tests", file)),
  ];
}

export async function runDesktopTestPlan(discoveredFiles, runLane) {
  for (const lane of desktopTestLanes(discoveredFiles)) {
    const status = await runLane(lane);
    if (!Number.isSafeInteger(status) || status !== 0) {
      return Number.isSafeInteger(status) && status > 0 ? status : 1;
    }
  }
  return 0;
}

async function spawnNodeTestLane(lane, extraArguments, dependencies = {}) {
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const executable = dependencies.executable ?? process.execPath;
  const desktopRoot = dependencies.desktopRoot ?? DESKTOP_ROOT;
  const output = dependencies.output ?? process.stderr;
  const laneDescription = lane.mode === "parallel"
    ? `${lane.files.length} ordinary files with Node's default parallelism`
    : lane.files[0];
  output.write(`[desktop:test] ${lane.id}: ${laneDescription}\n`);
  const child = spawnProcess(executable, nodeTestArguments(lane, extraArguments), {
    cwd: desktopRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) {
        output.write(`[desktop:test] ${lane.id} ended by signal ${signal}.\n`);
        resolve(1);
        return;
      }
      resolve(Number.isSafeInteger(code) ? code : 1);
    });
  });
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

const invokedDirectly = typeof process.argv[1] === "string" && samePath(process.argv[1], SCRIPT_PATH);
if (invokedDirectly) {
  try {
    process.exitCode = await runDesktopTestPlan(
      discoverDesktopTestFiles(),
      (lane) => spawnNodeTestLane(lane, process.argv.slice(2)),
    );
  } catch (error) {
    process.stderr.write(
      `[desktop:test] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
