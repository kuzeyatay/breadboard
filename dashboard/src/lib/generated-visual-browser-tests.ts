import fs from "node:fs";

import {
  runGeneratedVisualBrowserTests,
  type GeneratedVisualBrowserRunner,
  type GeneratedVisualBrowserTestResult,
  type GeneratedVisualBrowserTestRunnerInput,
} from "./generated-visuals.ts";
import { runObservedGeneratedVisualBrowserProcess } from "./generated-visual-browser-process.ts";

export interface LocalGeneratedVisualBrowserTestsInput
  extends GeneratedVisualBrowserTestRunnerInput {
  /** Test-only override for deterministic browser-discovery simulations. */
  browserExecutable?: string;
  /** Test-only override for the isolated browser process. */
  browserRunner?: GeneratedVisualBrowserRunner;
  /** Test-only override for bounded transient browser-mount retry sleeps. */
  browserMountRetryBackoff?: (delayMs: number) => void;
  /** Test-only override for bounded screenshot retry sleeps. */
  previewCaptureRetryBackoff?: (delayMs: number) => void;
}

export function findGeneratedVisualBrowserExecutable(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = String(env.BREADBOARD_VISUAL_BROWSER_PATH ?? "").trim();
  const candidates = [
    configured,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Worker-only adapter for Learn and disposable developer/test entrypoints.
 * Next-facing orchestration must inject the Runtime V2 runner instead.
 */
export async function runGeneratedVisualBrowserTestsLocally(
  input: LocalGeneratedVisualBrowserTestsInput,
): GeneratedVisualBrowserTestResult {
  return await runGeneratedVisualBrowserTests({
    ...input,
    browserExecutable:
      input.browserExecutable?.trim() ||
      findGeneratedVisualBrowserExecutable() ||
      "",
    browserRunner:
      input.browserRunner ??
      ((invocation) =>
        runObservedGeneratedVisualBrowserProcess({
          ...invocation,
          signal: input.signal,
        })),
  });
}
