import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import {
  expect,
  test as playwrightTest,
  type TestInfo,
} from "@playwright/test";
import type { Page } from "playwright";
import { DiagnosticsCollector } from "./diagnostics";
import {
  createQaEnvironment,
  type QaRunEnvironment,
  type QaRunOutcome,
} from "./environment";
import {
  launchBreadboard,
  type BreadboardElectron,
} from "./launch-breadboard";
import { ScenarioRecorder } from "./scenario-recorder";

const PORT_RELEASE_TIMEOUT_MS = 30_000;
const TRACE_OPTIONS = {
  screenshots: true,
  snapshots: true,
  sources: true,
} as const;

export interface QaRuntimeEndpoints {
  readonly pid: number;
  readonly startedAt: string;
  readonly urls: Readonly<Record<string, string>>;
}

export interface QaShutdownOptions {
  /** Defaults to true and checks dashboard, ChatMock, and Quartz. */
  readonly assertPortsReleased?: boolean;
  readonly timeoutMs?: number;
}

export interface QaShutdownReceipt {
  readonly mainPid: number | null;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly releasedPorts: readonly number[];
  readonly endpoints: QaRuntimeEndpoints;
}

interface ActiveTrace {
  readonly slug: string;
  readonly title: string;
  readonly paths: string[];
  segment: number;
}

/**
 * Owns one isolated data root across one or more actual Electron launches.
 * Relaunches deliberately create a fresh diagnostics collector/context trace,
 * while the durable QA data directory remains unchanged.
 */
export class ElectronQaHarness {
  readonly run: QaRunEnvironment;
  readonly resultsDir: string;
  readonly scenarios: ScenarioRecorder;

  private currentApp: BreadboardElectron | null = null;
  private currentPage: Page | null = null;
  private currentDiagnostics: DiagnosticsCollector | null = null;
  private lastDiagnostics: DiagnosticsCollector | null = null;
  private launchSequence = 0;
  private traceStarted = false;
  private traceChunkActive = false;
  private activeTrace: ActiveTrace | null = null;
  private failed = false;

  constructor(run: QaRunEnvironment) {
    this.run = run;
    this.resultsDir = path.join(
      run.paths.repoRoot,
      ".qa-results",
      "runs",
      run.runId,
    );
    fs.mkdirSync(this.resultsDir, { recursive: true });
    this.scenarios = new ScenarioRecorder(
      run.paths.repoRoot,
      run.runId,
      this.resultsDir,
    );
  }

  get app(): BreadboardElectron {
    if (!this.currentApp) throw new Error("Breadboard Electron is not running");
    return this.currentApp;
  }

  get page(): Page {
    if (!this.currentPage || this.currentPage.isClosed()) {
      throw new Error("The dashboard page is not active; dismiss the welcome gate first");
    }
    return this.currentPage;
  }

  get diagnostics(): DiagnosticsCollector {
    const collector = this.currentDiagnostics ?? this.lastDiagnostics;
    if (!collector) throw new Error("No Electron diagnostics collector is available");
    return collector;
  }

  get isRunning(): boolean {
    return this.currentApp !== null;
  }

  get hasFailed(): boolean {
    return this.failed;
  }

  async start(): Promise<void> {
    if (this.currentApp) throw new Error("Breadboard Electron is already running");
    await this.launchCurrent();
  }

  async dismissWelcome(): Promise<Page> {
    if (this.currentPage && !this.currentPage.isClosed()) return this.currentPage;
    this.currentPage = await this.app.dismissWelcome();
    return this.currentPage;
  }

  /** Close, prove release of QA-owned ports, then launch with the same data. */
  async restart(options: QaShutdownOptions = {}): Promise<QaShutdownReceipt> {
    const receipt = await this.closeCurrent({
      assertPortsReleased: options.assertPortsReleased !== false,
      timeoutMs: options.timeoutMs,
    });
    await this.launchCurrent();
    return receipt;
  }

  /** Cleanly stop the current app. Safe to call once before fixture teardown. */
  async shutdown(options: QaShutdownOptions = {}): Promise<QaShutdownReceipt> {
    return this.closeCurrent({
      assertPortsReleased: options.assertPortsReleased !== false,
      timeoutMs: options.timeoutMs,
    });
  }

  readEndpoints(): QaRuntimeEndpoints {
    const endpointFile = path.join(
      this.run.paths.dataDir,
      "runtime",
      "endpoints.json",
    );
    const raw: unknown = JSON.parse(fs.readFileSync(endpointFile, "utf8"));
    if (!isRecord(raw) || typeof raw["pid"] !== "number") {
      throw new Error(`Invalid QA runtime endpoint file: ${endpointFile}`);
    }
    if (typeof raw["startedAt"] !== "string" || !isStringRecord(raw["urls"])) {
      throw new Error(`Invalid QA runtime endpoint payload: ${endpointFile}`);
    }
    return {
      pid: raw["pid"],
      startedAt: raw["startedAt"],
      urls: { ...raw["urls"] },
    };
  }

  /** The Electron main PID can differ from the outer launcher PID on Windows. */
  async mainProcessPid(): Promise<number> {
    return this.app.application.evaluate(() => process.pid);
  }

  markFailed(): void {
    this.failed = true;
  }

  async beginTestTrace(testInfo: TestInfo): Promise<void> {
    if (this.activeTrace) throw new Error("A QA test trace is already active");
    this.activeTrace = {
      slug: safeArtifactName(`${testInfo.testId}-${testInfo.title}`),
      title: testInfo.titlePath.join(" > "),
      paths: [],
      segment: 0,
    };
    if (this.currentApp) await this.startTraceChunk();
  }

  async finishTestTrace(failed: boolean): Promise<readonly string[]> {
    const active = this.activeTrace;
    if (!active) return [];
    const persist = failed || process.env["BREADBOARD_QA_TRACE"] === "1";
    if (this.traceChunkActive) await this.stopTraceChunk(persist);
    this.activeTrace = null;
    return [...active.paths];
  }

  async captureFailure(testInfo: TestInfo): Promise<readonly string[]> {
    this.markFailed();
    const artifacts: string[] = [];
    const slug = safeArtifactName(`${testInfo.testId}-${testInfo.title}`);
    const failureDir = path.join(this.resultsDir, "failures");
    fs.mkdirSync(failureDir, { recursive: true });

    const page = this.failurePage();
    if (page) {
      const screenshot = path.join(failureDir, `${slug}.png`);
      try {
        await page.screenshot({ path: screenshot, fullPage: true });
        artifacts.push(screenshot);
        await testInfo.attach("electron-failure-screenshot", {
          path: screenshot,
          contentType: "image/png",
        });
      } catch (error) {
        this.currentDiagnostics?.record({
          source: "electron",
          level: "warning",
          event: "failure-screenshot-unavailable",
          message: error instanceof Error ? error.message : String(error),
          actionable: false,
        });
      }
    }

    const collector = this.currentDiagnostics ?? this.lastDiagnostics;
    if (collector) {
      try {
        await collector.snapshotFailure(`${slug}.json`);
        const snapshot = path.join(collector.outputDir, `${slug}.json`);
        artifacts.push(snapshot);
        await testInfo.attach("electron-failure-diagnostics", {
          path: snapshot,
          contentType: "application/json",
        });
      } catch {
        // Preserve the original assertion failure even if the evidence disk is
        // unavailable. The collector retains an in-memory/event-log copy.
      }
    }
    return artifacts;
  }

  async teardown(): Promise<void> {
    let teardownError: unknown;
    if (this.currentApp) {
      try {
        await this.closeCurrent({ assertPortsReleased: true });
      } catch (error) {
        this.failed = true;
        teardownError = error;
      }
    }

    const outcome: QaRunOutcome = this.failed ? "failed" : "passed";
    try {
      await this.run.cleanup(outcome);
    } catch (error) {
      this.failed = true;
      teardownError ??= error;
    }
    if (teardownError) throw teardownError;
  }

  private async launchCurrent(): Promise<void> {
    const launch = ++this.launchSequence;
    const diagnostics = new DiagnosticsCollector({
      outputDir: path.join(this.resultsDir, "diagnostics", `launch-${launch}`),
      serviceLogsDir: this.run.paths.serviceLogsDir,
      secretValues: Object.values(this.run.bootstrap.auth),
    });
    this.currentDiagnostics = diagnostics;
    this.lastDiagnostics = diagnostics;

    try {
      this.currentApp = await launchBreadboard({
        run: this.run,
        diagnostics,
      });
      this.currentPage = null;
      await this.currentApp.application.context().tracing.start(TRACE_OPTIONS);
      this.traceStarted = true;
      if (this.activeTrace) await this.startTraceChunk();
    } catch (error) {
      this.failed = true;
      await diagnostics.snapshotFailure("launch-failure.json").catch(() => undefined);
      await diagnostics.dispose().catch(() => undefined);
      this.currentDiagnostics = null;
      throw error;
    }
  }

  private async closeCurrent(
    options: Required<Pick<QaShutdownOptions, "assertPortsReleased">> &
      Pick<QaShutdownOptions, "timeoutMs">,
  ): Promise<QaShutdownReceipt> {
    const handle = this.app;
    const diagnostics = this.currentDiagnostics;
    const endpoints = this.readEndpoints();
    const releasedPorts = criticalOwnedPorts(endpoints);
    const child = handle.application.process();
    const mainPid = await this.mainProcessPid();
    // `BreadboardElectron.close()` has its own 60-second emergency bound. Keep
    // this observer alive beyond it so it cannot reject unobserved while that
    // close is still awaiting the supported shutdown path.
    const exit = observeProcessExit(
      child,
      Math.max(options.timeoutMs ?? PORT_RELEASE_TIMEOUT_MS, 75_000),
    );
    let lifecycleError: unknown;

    try {
      await this.stopContextTrace(true);
    } catch (error) {
      lifecycleError = error;
    }

    try {
      await handle.close();
    } catch (error) {
      lifecycleError ??= error;
    }

    let processExit = {
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    };
    try {
      processExit = await exit;
    } catch (error) {
      lifecycleError ??= error;
    }

    if (options.assertPortsReleased) {
      try {
        await waitForPortsReleased(
          releasedPorts,
          options.timeoutMs ?? PORT_RELEASE_TIMEOUT_MS,
        );
      } catch (error) {
        lifecycleError ??= error;
      }
    }

    if (diagnostics) {
      try {
        await diagnostics.finalize();
      } catch (error) {
        lifecycleError ??= error;
      }
      try {
        await diagnostics.dispose();
      } catch (error) {
        lifecycleError ??= error;
      }
    }

    this.currentApp = null;
    this.currentPage = null;
    this.currentDiagnostics = null;
    this.traceStarted = false;
    this.traceChunkActive = false;
    if (lifecycleError) {
      this.failed = true;
      throw lifecycleError;
    }
    return {
      mainPid,
      exitCode: processExit.exitCode,
      signalCode: processExit.signalCode,
      releasedPorts,
      endpoints,
    };
  }

  private async startTraceChunk(): Promise<void> {
    if (!this.currentApp || !this.traceStarted || !this.activeTrace) return;
    await this.currentApp.application.context().tracing.startChunk({
      title: this.activeTrace.title,
    });
    this.traceChunkActive = true;
  }

  private async stopTraceChunk(persist: boolean): Promise<void> {
    if (!this.currentApp || !this.traceChunkActive) return;
    const trace = this.activeTrace;
    if (persist && trace) {
      trace.segment += 1;
      const traceDir = path.join(this.resultsDir, "traces");
      fs.mkdirSync(traceDir, { recursive: true });
      const tracePath = path.join(
        traceDir,
        `${trace.slug}-segment-${trace.segment}.zip`,
      );
      await this.currentApp.application.context().tracing.stopChunk({
        path: tracePath,
      });
      trace.paths.push(tracePath);
    } else {
      await this.currentApp.application.context().tracing.stopChunk();
    }
    this.traceChunkActive = false;
  }

  private async stopContextTrace(persistActiveChunk: boolean): Promise<void> {
    if (!this.currentApp || !this.traceStarted) return;
    if (this.traceChunkActive) await this.stopTraceChunk(persistActiveChunk);
    await this.currentApp.application.context().tracing.stop();
    this.traceStarted = false;
  }

  private failurePage(): Page | null {
    if (this.currentPage && !this.currentPage.isClosed()) return this.currentPage;
    if (!this.currentApp) return null;
    return (
      this.currentApp.application
        .windows()
        .find((page) => !page.isClosed() && page.url().startsWith("http")) ??
      this.currentApp.application
        .windows()
        .find((page) => !page.isClosed()) ??
      null
    );
  }
}

interface QaTestFixtures {
  readonly _qaEvidence: void;
}

interface QaWorkerFixtures {
  readonly qa: ElectronQaHarness;
  readonly scenarios: ScenarioRecorder;
}

export const test = playwrightTest.extend<QaTestFixtures, QaWorkerFixtures>({
  qa: [
    async ({}, use) => {
      const run = createQaEnvironment({
        preserve:
          process.env["BREADBOARD_QA_PRESERVE_RUNTIME"] === "1"
            ? "always"
            : "on-failure",
      });
      const harness = new ElectronQaHarness(run);
      try {
        await harness.start();
        await use(harness);
      } catch (error) {
        harness.markFailed();
        throw error;
      } finally {
        await harness.teardown();
      }
    },
    { scope: "worker" },
  ],

  scenarios: [
    async ({ qa }, use) => {
      await use(qa.scenarios);
    },
    { scope: "worker" },
  ],

  _qaEvidence: [
    async ({ qa }, use, testInfo) => {
      // A prior lifecycle-focused test may have deliberately shut the app
      // down. A later file using this shared worker fixture still gets a real
      // fresh launch against the same isolated run root.
      if (!qa.isRunning) await qa.start();
      await qa.beginTestTrace(testInfo);
      await use();
      const failed = testInfo.status !== testInfo.expectedStatus;
      if (failed) await qa.captureFailure(testInfo);
      const traces = await qa.finishTestTrace(failed);
      for (const trace of traces) {
        await testInfo.attach("electron-trace", {
          path: trace,
          contentType: "application/zip",
        });
      }
    },
    { auto: true },
  ],
});

export { expect };

function criticalOwnedPorts(endpoints: QaRuntimeEndpoints): number[] {
  const ports = new Set<number>();
  for (const service of ["dashboard", "chatmock", "quartz"] as const) {
    const value = endpoints.urls[service];
    if (!value) throw new Error(`QA runtime endpoints omit ${service}`);
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
      throw new Error(`QA ${service} endpoint is not restricted to loopback HTTP: ${value}`);
    }
    const port = Number(url.port);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`QA ${service} endpoint has an invalid port: ${value}`);
    }
    ports.add(port);
  }
  return [...ports].sort((left, right) => left - right);
}

async function waitForPortsReleased(
  ports: readonly number[],
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let unavailable = [...ports];
  while (Date.now() <= deadline) {
    const states = await Promise.all(
      ports.map(async (port) => ({ port, free: await isLoopbackPortFree(port) })),
    );
    unavailable = states.filter((state) => !state.free).map((state) => state.port);
    if (unavailable.length === 0) return;
    await boundedDelay(100);
  }
  throw new Error(
    `QA-owned loopback ports were not released within ${timeoutMs}ms: ${unavailable.join(", ")}`,
  );
}

async function isLoopbackPortFree(port: number): Promise<boolean> {
  return (await canBindPort(port)) && !(await canConnectToPort(port));
}

function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    const finish = (free: boolean): void => {
      server.removeAllListeners();
      resolve(free);
    };
    server.once("error", () => finish(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => finish(true));
    });
  });
}

function canConnectToPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(400, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function observeProcessExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ exitCode: number | null; signalCode: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    });
  }
  return new Promise((resolve, reject) => {
    const onExit = (
      exitCode: number | null,
      signalCode: NodeJS.Signals | null,
    ): void => {
      clearTimeout(timer);
      resolve({ exitCode, signalCode });
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error(`Electron main process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("exit", onExit);
    // Close the narrow race between the pre-listener check and registration.
    if (child.exitCode !== null || child.signalCode !== null) {
      child.off("exit", onExit);
      clearTimeout(timer);
      resolve({ exitCode: child.exitCode, signalCode: child.signalCode });
    }
  });
}

function boundedDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) && Object.values(value).every((item) => typeof item === "string")
  );
}

function safeArtifactName(value: string): string {
  const safe = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return safe || "electron-qa";
}
