import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
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
import { waitForPortsReleased } from "./process-ports";
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
  private readonly traceCaptureFailures: string[] = [];
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

  /** Evidence that a trace could not be written, so a gap is never silent. */
  get traceFailures(): readonly string[] {
    return [...this.traceCaptureFailures];
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

    if (page) {
      // Week 2: a click intercepted by a leftover overlay was the single most
      // expensive Week 1 failure to diagnose, because the evidence bundle said
      // nothing about what was covering the page. Capture every fixed overlay
      // at the moment of failure so the next occurrence identifies itself.
      try {
        const overlays = await page.evaluate(() => {
          const interesting = new Set(["fixed", "sticky", "absolute"]);
          return [...document.querySelectorAll("body *")]
            .filter((element) => {
              const style = window.getComputedStyle(element);
              if (!interesting.has(style.position)) return false;
              if (style.pointerEvents === "none") return false;
              if (style.visibility === "hidden" || style.display === "none") return false;
              const rect = element.getBoundingClientRect();
              // Only overlays large enough to swallow a click on something else.
              return rect.width >= window.innerWidth * 0.5 && rect.height >= window.innerHeight * 0.5;
            })
            .slice(0, 20)
            .map((element) => {
              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return {
                className: typeof element.className === "string" ? element.className : null,
                tagName: element.tagName,
                position: style.position,
                zIndex: style.zIndex,
                pointerEvents: style.pointerEvents,
                opacity: style.opacity,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                headings: [...element.querySelectorAll("h1,h2,h3")]
                  .map((heading) => (heading.textContent ?? "").trim())
                  .slice(0, 4),
                text: (element.textContent ?? "").trim().slice(0, 200),
              };
            });
        });
        this.currentDiagnostics?.record({
          source: "renderer",
          level: overlays.length > 0 ? "warning" : "info",
          event: "failure-overlay-inventory",
          message:
            overlays.length > 0
              ? `${overlays.length} full-page overlay(s) were present when the scenario failed`
              : "no full-page overlay was present when the scenario failed",
          actionable: false,
          data: { overlays },
        });
      } catch {
        // A closed or crashed page cannot be inventoried; the screenshot and
        // diagnostics above remain the evidence.
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
      if (process.env["BREADBOARD_QA_NO_TRACE"] !== "1") {
        await this.currentApp.application.context().tracing.start(TRACE_OPTIONS);
        this.traceStarted = true;
      }
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

  /**
   * Stop the active trace chunk.
   *
   * Playwright can reject `stopChunk` while the Electron context is already
   * tearing down ("file data stream has unexpected number of bytes"). Letting
   * that reject would replace the real scenario failure with a trace error and,
   * worse, leave `traceChunkActive` true so teardown tries to stop a chunk that
   * no longer exists and kills the whole worker. A missing trace is recorded as
   * an evidence gap; it is never allowed to abort the run or hide the failure
   * that was being traced.
   */
  private async stopTraceChunk(persist: boolean): Promise<void> {
    if (!this.currentApp || !this.traceChunkActive) return;
    const trace = this.activeTrace;
    // Reset first: every exit path below leaves this chunk unusable.
    this.traceChunkActive = false;
    const tracing = this.currentApp.application.context().tracing;
    if (persist && trace) {
      trace.segment += 1;
      const traceDir = path.join(this.resultsDir, "traces");
      fs.mkdirSync(traceDir, { recursive: true });
      const tracePath = path.join(
        traceDir,
        `${trace.slug}-segment-${trace.segment}.zip`,
      );
      try {
        await tracing.stopChunk({ path: tracePath });
        trace.paths.push(tracePath);
      } catch (error) {
        this.recordTraceCaptureFailure(tracePath, error);
      }
      return;
    }
    try {
      await tracing.stopChunk();
    } catch (error) {
      this.recordTraceCaptureFailure(null, error);
    }
  }

  private recordTraceCaptureFailure(tracePath: string | null, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const detail = tracePath
      ? `Playwright trace could not be written to ${tracePath}: ${message}`
      : `Playwright trace chunk could not be discarded cleanly: ${message}`;
    this.traceCaptureFailures.push(detail);
    (this.currentDiagnostics ?? this.lastDiagnostics)?.record({
      source: "electron",
      level: "warning",
      event: "trace-capture-failed",
      message: detail,
      // An evidence gap is a harness problem, not a Breadboard defect.
      actionable: false,
    });
  }

  private async stopContextTrace(persistActiveChunk: boolean): Promise<void> {
    if (!this.currentApp || !this.traceStarted) return;
    if (this.traceChunkActive) await this.stopTraceChunk(persistActiveChunk);
    this.traceStarted = false;
    try {
      await this.currentApp.application.context().tracing.stop();
    } catch (error) {
      // Same reasoning as stopTraceChunk: a tracing teardown problem is an
      // evidence gap to report, not a reason to abandon shutdown checks such as
      // process exit and port release.
      this.recordTraceCaptureFailure(null, error);
    }
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
        providerAuthFile: process.env["BREADBOARD_QA_PROVIDER_AUTH_FILE"],
        env: {
          BREADBOARD_DESKTOP_DASHBOARD_MODE:
            process.env["BREADBOARD_QA_DASHBOARD_MODE"] === "hot"
              ? "hot"
              : "standalone",
        },
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
      const knownTraceFailures = qa.traceFailures.length;
      const traces = await qa.finishTestTrace(failed);
      for (const trace of traces) {
        await testInfo.attach("electron-trace", {
          path: trace,
          contentType: "application/zip",
        });
      }
      // An unwritable trace is a reportable evidence gap, never a silent one.
      for (const gap of qa.traceFailures.slice(knownTraceFailures)) {
        testInfo.annotations.push({ type: "qa-evidence-gap", description: gap });
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
