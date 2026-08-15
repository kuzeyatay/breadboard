import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  InteractiveVisualizerBrowserTests,
  InteractiveVisualizerMode,
} from "./interactive-visualizer-types.ts";
import { interactiveVisualizerConfig } from "./interactive-visualizer-config.ts";

const activeWork = new Map<number, {
  controller: AbortController;
  child: ChildProcess | null;
}>();

const MAX_BROWSER_OUTPUT_CHARS = 750_000;
const BROWSER_OUTPUT_HEAD_CHARS = 375_000;
const BROWSER_OUTPUT_TRUNCATION_MARKER = "\n...[browser output truncated]...\n";

export function appendBoundedBrowserOutput(
  current: string,
  chunk: Buffer | string,
): string {
  const next = current + (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  if (next.length <= MAX_BROWSER_OUTPUT_CHARS) return next;
  const tailChars = MAX_BROWSER_OUTPUT_CHARS -
    BROWSER_OUTPUT_HEAD_CHARS -
    BROWSER_OUTPUT_TRUNCATION_MARKER.length;
  return next.slice(0, BROWSER_OUTPUT_HEAD_CHARS) +
    BROWSER_OUTPUT_TRUNCATION_MARKER +
    next.slice(-tailChars);
}

function executable(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = String(env.BREADBOARD_VISUAL_BROWSER_PATH ?? "").trim();
  return [
    configured,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function terminate(child: ChildProcess | null): Promise<void> {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

export async function cancelInteractiveVisualizerWork(
  runtimeSessionId: number,
): Promise<boolean> {
  const active = activeWork.get(runtimeSessionId);
  if (!active) return false;
  activeWork.delete(runtimeSessionId);
  active.controller.abort(new Error("interactive visualizer cancelled by user"));
  await terminate(active.child);
  return true;
}

async function runBrowser(input: {
  executable: string;
  args: string[];
  timeoutMs: number;
  active: { controller: AbortController; child: ChildProcess | null };
}): Promise<{ exitCode: number | null; stdout: string; stderr: string; aborted: boolean }> {
  if (input.active.controller.signal.aborted) {
    return { exitCode: null, stdout: "", stderr: "cancelled", aborted: true };
  }
  return await new Promise((resolve) => {
    const child = spawn(input.executable, input.args, {
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    input.active.child = child;
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendBoundedBrowserOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendBoundedBrowserOutput(stderr, chunk);
    });
    let settled = false;
    const finish = (exitCode: number | null, aborted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.active.controller.signal.removeEventListener("abort", onAbort);
      input.active.child = null;
      resolve({ exitCode, stdout, stderr, aborted });
    };
    const onAbort = () => {
      void terminate(child).finally(() => finish(child.exitCode, true));
    };
    input.active.controller.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      stderr = appendBoundedBrowserOutput(stderr, "\nBrowser test timed out.");
      void terminate(child).finally(() => finish(child.exitCode, false));
    }, input.timeoutMs);
    child.once("error", (error) => {
      stderr = appendBoundedBrowserOutput(stderr, error.message);
      finish(null, false);
    });
    child.once("close", (code) => finish(code, input.active.controller.signal.aborted));
  });
}

export async function runInteractiveVisualizerBrowserTests(input: {
  html: string;
  mode: InteractiveVisualizerMode;
  outputDir: string;
  runtimeSessionId: number;
  timeoutMs?: number;
}): Promise<InteractiveVisualizerBrowserTests> {
  const browser = executable();
  const checkedAt = new Date().toISOString();
  if (!browser) {
    return {
      passed: false,
      checkedAt,
      viewports: [],
      checks: [{
        name: "browser availability",
        passed: false,
        detail: "No configured Chromium or Microsoft Edge executable was found.",
      }],
      screenshotCreated: false,
    };
  }
  const previous = activeWork.get(input.runtimeSessionId);
  if (previous) {
    previous.controller.abort(new Error("superseded by a newer visualizer test"));
    await terminate(previous.child);
  }
  const active = { controller: new AbortController(), child: null as ChildProcess | null };
  activeWork.set(input.runtimeSessionId, active);
  fs.mkdirSync(input.outputDir, { recursive: true });
  const htmlPath = path.join(input.outputDir, "candidate.html");
  fs.writeFileSync(htmlPath, input.html, "utf8");
  const timeoutMs = input.timeoutMs ??
    interactiveVisualizerConfig().browserScenarioTimeoutMs;
  const scenarios = [
    { name: "375x667 light", width: 375, height: 667, flags: [] as string[] },
    { name: "1280x800 dark", width: 1280, height: 800, flags: ["--force-dark-mode"] },
    {
      name: "1280x800 reduced-motion",
      width: 1280,
      height: 800,
      flags: ["--force-prefers-reduced-motion"],
    },
  ];
  const checks: InteractiveVisualizerBrowserTests["checks"] = [];
  try {
    const externalReference =
      /(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:/i.test(input.html);
    checks.push({
      name: "offline bundle",
      passed: !externalReference && input.html.includes("connect-src 'none'"),
      detail: externalReference
        ? "The compiled document contains an external resource reference."
        : "Self-contained bundle with network denied by CSP.",
    });
    for (const scenario of scenarios) {
      const url = `${pathToFileURL(htmlPath).href}?test=1&channel=browser-gate`;
      const result = await runBrowser({
        executable: browser,
        timeoutMs,
        active,
        args: [
          "--headless=new",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-component-update",
          "--no-first-run",
          "--no-default-browser-check",
          "--hide-scrollbars",
          "--disable-dev-shm-usage",
          ...(input.mode !== "2d"
            ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
            : ["--disable-gpu"]),
          ...scenario.flags,
          `--window-size=${scenario.width},${scenario.height}`,
          "--virtual-time-budget=3000",
          "--dump-dom",
          url,
        ],
      });
      if (result.aborted) throw new Error("interactive visualizer cancelled by user");
      const output = `${result.stdout}\n${result.stderr}`;
      const passed =
        result.exitCode === 0 &&
        output.includes('data-breadboard-runtime-tests="passed"') &&
        output.includes('data-breadboard-interaction-tests="passed"') &&
        !output.includes('data-breadboard-overflow="true"') &&
        (input.mode === "2d" || output.includes('data-breadboard-webgl="ready"'));
      checks.push({
        name: `browser mount ${scenario.name}`,
        passed,
        detail: passed
          ? "mounted, exercised controls, and passed runtime checks"
          : output.match(/<html[^>]*>/i)?.[0] ?? output.slice(-700),
      });
    }
    if (input.mode !== "2d") {
      const fallback = await runBrowser({
        executable: browser,
        timeoutMs,
        active,
        args: [
          "--headless=new",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-3d-apis",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--no-first-run",
          "--window-size=900,640",
          "--virtual-time-budget=2000",
          "--dump-dom",
          `${pathToFileURL(htmlPath).href}?test=1&channel=webgl-fallback`,
        ],
      });
      if (fallback.aborted) throw new Error("interactive visualizer cancelled by user");
      const output = `${fallback.stdout}\n${fallback.stderr}`;
      const passed =
        fallback.exitCode === 0 &&
        output.includes("3D rendering is unavailable on this device.");
      checks.push({
        name: "WebGL unavailable fallback",
        passed,
        detail: passed
          ? "Accessible fallback rendered with WebGL disabled."
          : output.match(/<html[^>]*>/i)?.[0] ?? output.slice(-700),
      });
    }
    const screenshotUrl = `${pathToFileURL(htmlPath).href}?test=1&channel=browser-screenshot`;
    let screenshotCreated = true;
    for (const preview of [
      { name: "desktop", width: 1000, height: 720 },
      { name: "mobile", width: 375, height: 667 },
    ]) {
      const screenshotPath = path.join(input.outputDir, `${preview.name}.png`);
      const screenshot = await runBrowser({
        executable: browser,
        timeoutMs,
        active,
        args: [
          "--headless=new",
          "--disable-extensions",
          "--disable-background-networking",
          "--no-first-run",
          "--hide-scrollbars",
          "--disable-dev-shm-usage",
          ...(input.mode !== "2d"
            ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
            : ["--disable-gpu"]),
          `--window-size=${preview.width},${preview.height}`,
          "--virtual-time-budget=3000",
          `--screenshot=${screenshotPath}`,
          screenshotUrl,
        ],
      });
      if (screenshot.aborted) throw new Error("interactive visualizer cancelled by user");
      const created =
        screenshot.exitCode === 0 &&
        fs.existsSync(screenshotPath) &&
        fs.statSync(screenshotPath).size > 0;
      screenshotCreated = screenshotCreated && created;
      checks.push({
        name: `${preview.name} preview screenshot`,
        passed: created,
        detail: created ? "created" : (screenshot.stderr || "Screenshot was not created.").slice(-700),
      });
    }
    return {
      passed: checks.every((check) => check.passed),
      checkedAt,
      executable: browser,
      viewports: scenarios.map((scenario) => scenario.name),
      checks,
      screenshotCreated,
    };
  } finally {
    if (activeWork.get(input.runtimeSessionId) === active) activeWork.delete(input.runtimeSessionId);
  }
}
