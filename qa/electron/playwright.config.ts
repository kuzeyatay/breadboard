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
      name: "packaged",
      testMatch: /packaged\/.*\.spec\.ts/,
    },
  ],
});
