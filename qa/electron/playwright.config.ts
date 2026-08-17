import { defineConfig } from "@playwright/test";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const resultsRoot = path.join(repoRoot, ".qa-results");

export default defineConfig({
  testDir: path.join(__dirname, "specs"),
  outputDir: path.join(resultsRoot, "test-output"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 8 * 60_000,
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env["CI"]),
  preserveOutput: "failures-only",
  reporter: [
    ["line"],
    ["json", { outputFile: path.join(resultsRoot, "results.json") }],
    ["html", { outputFolder: path.join(resultsRoot, "html"), open: "never" }],
  ],
  use: {
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "critical",
      testMatch: /critical\/.*\.spec\.ts/,
    },
    {
      name: "exploratory",
      testMatch: /exploratory\/.*\.spec\.ts/,
    },
    {
      name: "hermes",
      testMatch: /hermes\/.*\.spec\.ts/,
    },
    {
      name: "packaged",
      testMatch: /packaged\/.*\.spec\.ts/,
    },
    {
      // Harness self-tests: they exercise the QA layer itself, never Breadboard.
      name: "selftest",
      testMatch: /selftest\/.*\.spec\.ts/,
    },
    {
      // Week 2 deterministic product scenarios: gardens, folders, notes,
      // ingestion, routing and persistence. Separate from `critical` so the
      // Week 1 intermittency there cannot mask or be masked by these.
      name: "lifecycle",
      testMatch: /lifecycle\/.*\.spec\.ts/,
    },
    {
      // Week 2 investigation probes: they gather evidence about intermittent
      // behaviour and are opt-in so they never gate a normal run.
      name: "investigation",
      testMatch: /investigation\/.*\.spec\.ts/,
    },
    {
      // Deliberately failing Electron scenarios used to prove that the harness
      // reports faults with evidence. Never part of a normal QA run; driven by
      // `npm run qa:selftest:electron`, which expects this project to fail.
      name: "injected",
      testMatch: /injected\/.*\.spec\.ts/,
    },
  ],
});
