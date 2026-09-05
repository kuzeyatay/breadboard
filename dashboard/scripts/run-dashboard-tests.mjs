import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DASHBOARD_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const TESTS_ROOT = path.join(DASHBOARD_ROOT, "tests");

/** These files open a real Chromium/Edge process. Keep the local QA lane
 * serial so each test retains deterministic browser cleanup proof; production
 * admission now permits independently bounded heavyweight classes to overlap. */
export const SERIAL_BROWSER_TEST_FILES = Object.freeze([
  "cloud-speech-ui.test.mjs",
  "queued-steering-ui.test.mjs",
  "thought-topology-browser.test.mjs",
  "generated-visual-presentation-convergence.test.mjs",
  "interactive-visualizer.test.mjs",
  "generated-visual-spatial-scene.test.mjs",
  "generated-visualization-pipeline.test.mjs",
]);

function isDashboardTestFile(name) {
  return typeof name === "string" && name.endsWith(".test.mjs") &&
    path.basename(name) === name;
}

export function discoverDashboardTestFiles(
  testsRoot = TESTS_ROOT,
  readDirectory = fs.readdirSync,
) {
  return readDirectory(testsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isDashboardTestFile(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function partitionDashboardTestFiles(discoveredFiles) {
  const files = [...new Set(discoveredFiles)]
    .filter(isDashboardTestFile)
    .sort((left, right) => left.localeCompare(right));
  const discovered = new Set(files);
  const missing = SERIAL_BROWSER_TEST_FILES.filter((file) => !discovered.has(file));
  if (missing.length > 0) {
    throw new Error(
      `Dashboard browser-test lane is missing required file(s): ${missing.join(", ")}`,
    );
  }
  const browserFiles = new Set(SERIAL_BROWSER_TEST_FILES);
  return {
    parallel: files.filter((file) => !browserFiles.has(file)),
    browser: [...SERIAL_BROWSER_TEST_FILES],
  };
}

export function dashboardTestLanes(discoveredFiles) {
  const partition = partitionDashboardTestFiles(discoveredFiles);
  return [
    {
      id: "parallel",
      mode: "parallel",
      files: partition.parallel,
    },
    ...partition.browser.map((file) => ({
      id: `browser:${file}`,
      mode: "serial-browser",
      files: [file],
    })),
  ];
}

export function nodeTestArguments(lane, extraArguments = []) {
  return [
    "--test",
    "--experimental-strip-types",
    ...extraArguments,
    ...lane.files.map((file) => path.join("tests", file)),
  ];
}

export async function runDashboardTestPlan(discoveredFiles, runLane) {
  for (const lane of dashboardTestLanes(discoveredFiles)) {
    const status = await runLane(lane);
    if (!Number.isSafeInteger(status) || status !== 0) {
      return Number.isSafeInteger(status) && status > 0 ? status : 1;
    }
  }
  return 0;
}

async function spawnNodeTestLane(
  lane,
  extraArguments,
  dependencies = {},
) {
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const executable = dependencies.executable ?? process.execPath;
  const dashboardRoot = dependencies.dashboardRoot ?? DASHBOARD_ROOT;
  const output = dependencies.output ?? process.stderr;
  const laneDescription = lane.mode === "parallel"
    ? `${lane.files.length} ordinary files with Node's default parallelism`
    : lane.files[0];
  output.write(`[dashboard:test] ${lane.id}: ${laneDescription}\n`);
  const child = spawnProcess(
    executable,
    nodeTestArguments(lane, extraArguments),
    {
      cwd: dashboardRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) {
        output.write(`[dashboard:test] ${lane.id} ended by signal ${signal}.\n`);
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
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

const invokedDirectly = typeof process.argv[1] === "string" &&
  samePath(process.argv[1], SCRIPT_PATH);
if (invokedDirectly) {
  const discoveredFiles = discoverDashboardTestFiles();
  const extraArguments = process.argv.slice(2);
  try {
    process.exitCode = await runDashboardTestPlan(
      discoveredFiles,
      (lane) => spawnNodeTestLane(lane, extraArguments),
    );
  } catch (error) {
    process.stderr.write(
      `[dashboard:test] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
