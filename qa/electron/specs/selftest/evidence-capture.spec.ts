import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import type {
  ElectronApplication,
  Page,
  Request,
  Response,
} from "playwright";
import { DiagnosticsCollector } from "../../diagnostics";
import { classifyProbeFailure } from "../../classification";

/**
 * Harness self-tests: does the evidence collector actually report a failure,
 * and does it report it as the right *kind* of failure?
 *
 * These drive `DiagnosticsCollector` with faults it cannot distinguish from the
 * real thing — real event emitters, real stream chunks, real JSONL on disk —
 * rather than launching Electron thirteen times. The end-to-end proof that a
 * live renderer failure produces a screenshot, trace, and diagnostics bundle is
 * the separate injected-fault meta-run (`npm run qa:selftest:electron`).
 *
 * Every test here asserts the harness *notices*. A self-test that merely
 * confirms an injected fault occurred would prove nothing about the tester.
 */

class StubProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
}

class StubPage extends EventEmitter {
  private currentUrl: string;
  private closed = false;

  constructor(url = "http://127.0.0.1:41234/dashboard") {
    super();
    this.currentUrl = url;
  }

  url(): string {
    return this.currentUrl;
  }

  isClosed(): boolean {
    return this.closed;
  }

  off(event: string, listener: (...args: never[]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

class StubApplication extends EventEmitter {
  private readonly child = new StubProcess();
  private readonly pages: StubPage[];

  constructor(pages: StubPage[] = []) {
    super();
    this.pages = pages;
  }

  windows(): Page[] {
    return this.pages as unknown as Page[];
  }

  process(): StubProcess {
    return this.child;
  }

  get childProcess(): StubProcess {
    return this.child;
  }
}

function stubResponse(options: {
  status: number;
  url?: string;
  method?: string;
  contentType?: string;
  body?: string;
  contentLength?: number | null;
  onText?: () => void;
}): Response {
  const body = options.body ?? '{"error":"cluster index write failed"}';
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json",
  };
  if (options.contentLength !== null) {
    headers["content-length"] = String(
      options.contentLength ?? Buffer.byteLength(body, "utf8"),
    );
  }
  return {
    status: () => options.status,
    statusText: () => (options.status === 500 ? "Internal Server Error" : "Error"),
    url: () => options.url ?? "http://127.0.0.1:41234/api/clusters",
    headers: () => headers,
    request: () => ({ method: () => options.method ?? "POST" }) as unknown as Request,
    text: async () => {
      options.onText?.();
      return body;
    },
  } as unknown as Response;
}

function stubFailedRequest(errorText: string): Request {
  return {
    failure: () => ({ errorText }),
    method: () => "GET",
    resourceType: () => "fetch",
    headers: () => ({ accept: "application/json" }),
    url: () => "http://127.0.0.1:41234/api/hermes/sessions",
    postData: () => null,
  } as unknown as Request;
}

function withCollector(
  run: (context: {
    collector: DiagnosticsCollector;
    application: StubApplication;
    page: StubPage;
    outputDir: string;
  }) => Promise<void> | void,
): () => Promise<void> {
  return async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-selftest-"));
    const page = new StubPage();
    const application = new StubApplication([page]);
    const collector = new DiagnosticsCollector({ outputDir });
    try {
      collector.attach(application as unknown as ElectronApplication);
      await run({ collector, application, page, outputDir });
    } finally {
      await collector.dispose().catch(() => undefined);
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  };
}

function eventsNamed(
  collector: DiagnosticsCollector,
  event: string,
): ReadonlyArray<{ level: string; message: string; actionable?: boolean }> {
  return collector.entries.filter((entry) => entry.event === event);
}

test.describe("fault category B: renderer uncaught exception", () => {
  test(
    "an uncaught page exception is recorded as an actionable renderer error",
    withCollector(async ({ collector, page }) => {
      page.emit(
        "pageerror",
        Object.assign(new Error("Cannot read properties of undefined (reading 'slug')"), {
          stack: "TypeError: Cannot read properties of undefined\n    at GardenCard",
        }),
      );

      const errors = eventsNamed(collector, "page-error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.level).toBe("error");
      expect(errors[0]?.message).toContain("Cannot read properties of undefined");
      expect(collector.hasActionableErrors).toBe(true);
      // A renderer exception is product evidence, so it must reach the gate as
      // a PRODUCT_BUG rather than being written off as flakiness.
      expect(
        classifyProbeFailure(new Error("assertion failed"), collector.entries).classification,
      ).toBe("PRODUCT_BUG");
    }),
  );

  test(
    "a renderer crash is fatal and fails assertNoFatal",
    withCollector(async ({ collector, page }) => {
      page.emit("crash");
      expect(eventsNamed(collector, "renderer-crash")[0]?.level).toBe("fatal");
      expect(() => collector.assertNoFatal()).toThrow(/fatal event/);
    }),
  );
});

test.describe("fault category C: Electron main-process error and controlled crash", () => {
  test(
    "an uncaught main-process exception on stderr is recorded as fatal",
    withCollector(async ({ collector, application }) => {
      application.childProcess.stderr.emit(
        "data",
        "Uncaught Exception: Error: QA_INJECTED_MAIN_FAULT at supervisor.ts:88\n",
      );

      const captured = eventsNamed(collector, "uncaught-exception");
      expect(captured).toHaveLength(1);
      expect(captured[0]?.level).toBe("fatal");
      expect(() => collector.assertNoFatal()).toThrow(/QA_INJECTED_MAIN_FAULT/);
      expect(
        classifyProbeFailure(new Error("startup never completed"), collector.entries)
          .classification,
      ).toBe("PRODUCT_BUG");
    }),
  );

  test(
    "an unexpected main-process exit is fatal but a requested shutdown is not",
    withCollector(async ({ collector, application }) => {
      application.childProcess.emit("exit", 3, null);
      const unexpected = eventsNamed(collector, "main-process-exit");
      expect(unexpected).toHaveLength(1);
      expect(unexpected[0]?.level).toBe("fatal");
      expect(unexpected[0]?.actionable).toBe(true);
    }),
  );

  test(
    "a shutdown the fixture requested is recorded as clean",
    withCollector(async ({ collector, application }) => {
      collector.markExpectedShutdown();
      application.childProcess.emit("exit", 0, null);
      const exits = eventsNamed(collector, "main-process-exit");
      expect(exits[0]?.level).toBe("info");
      expect(collector.hasActionableErrors).toBe(false);
    }),
  );

  test(
    "an unhandled rejection in the main process is captured separately",
    withCollector(async ({ collector, application }) => {
      application.childProcess.stdout.emit(
        "data",
        "UnhandledPromiseRejection: cluster index write rejected\n",
      );
      expect(eventsNamed(collector, "unhandled-rejection")[0]?.level).toBe("fatal");
    }),
  );
});

test.describe("fault category D: meaningful HTTP failure", () => {
  test(
    "a 500 from a Breadboard API is an actionable error carrying its body",
    withCollector(async ({ collector, page }) => {
      page.emit("response", stubResponse({ status: 500 }));
      await collector.finalize({ snapshotServiceLogs: false });

      const errors = eventsNamed(collector, "http-error-response");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.level).toBe("error");
      expect(errors[0]?.actionable).toBe(true);
      const entry = collector.entries.find((item) => item.event === "http-error-response");
      expect(JSON.stringify(entry?.data)).toContain("cluster index write failed");
    }),
  );

  test(
    "a 404 is retained as evidence but is not called a defect on its own",
    withCollector(async ({ collector, page }) => {
      page.emit("response", stubResponse({ status: 404, method: "GET" }));
      await collector.finalize({ snapshotServiceLogs: false });

      const entry = collector.entries.find((item) => item.event === "http-error-response");
      expect(entry).toBeDefined();
      expect(entry?.actionable).toBe(false);
      expect(collector.hasActionableErrors).toBe(false);
    }),
  );

  test(
    "a malformed JSON API response is reported instead of being parsed away",
    withCollector(async ({ collector, page }) => {
      page.emit(
        "response",
        stubResponse({ status: 200, body: '{"clusters": [' }),
      );
      await collector.finalize({ snapshotServiceLogs: false });

      const malformed = eventsNamed(collector, "malformed-json-response");
      expect(malformed).toHaveLength(1);
      expect(malformed[0]?.level).toBe("error");
    }),
  );

  test(
    "a valid oversized JSON response is not misreported after bounded evidence truncation",
    withCollector(async ({ collector, page }) => {
      const body = JSON.stringify({
        skills: [{
          name: "publisher-metadata",
          description: `line one\nline two\t\u0000${"x".repeat(40 * 1024)}`,
        }],
      });
      let bodyRead = false;
      page.emit(
        "response",
        stubResponse({
          status: 200,
          url: "http://127.0.0.1:41234/api/hermes/skills",
          body,
          onText: () => { bodyRead = true; },
        }),
      );
      await collector.finalize({ snapshotServiceLogs: false });

      expect(bodyRead).toBe(false);
      expect(eventsNamed(collector, "malformed-json-response")).toHaveLength(0);
      const skipped = collector.entries.find(
        (entry) => entry.event === "json-response-validation-skipped",
      );
      expect(skipped?.actionable).toBe(false);
      expect(skipped?.data).toMatchObject({
        reason: "content_length_exceeds_limit",
      });
      expect(JSON.stringify(skipped?.data)).toContain("[truncated]");
      expect(collector.hasActionableErrors).toBe(false);
    }),
  );

  test(
    "a chunked JSON response is not read without a bounded content length",
    withCollector(async ({ collector, page }) => {
      let bodyRead = false;
      page.emit(
        "response",
        stubResponse({
          status: 200,
          url: "http://127.0.0.1:41234/api/hermes/skills?filter=all",
          body: JSON.stringify({ skills: [{ description: "x".repeat(40 * 1024) }] }),
          contentLength: null,
          onText: () => { bodyRead = true; },
        }),
      );
      await collector.finalize({ snapshotServiceLogs: false });

      expect(bodyRead).toBe(false);
      expect(eventsNamed(collector, "malformed-json-response")).toHaveLength(0);
      const skipped = collector.entries.find(
        (entry) => entry.event === "json-response-validation-skipped",
      );
      expect(skipped?.data).toMatchObject({
        reason: "content_length_unavailable",
        body: "[body not read: content length unavailable]",
      });
      expect(collector.hasActionableErrors).toBe(false);
    }),
  );

  test(
    "a failed request is actionable but a deliberate abort is not",
    withCollector(async ({ collector, page }) => {
      page.emit("requestfailed", stubFailedRequest("net::ERR_CONNECTION_REFUSED"));
      page.emit("requestfailed", stubFailedRequest("net::ERR_ABORTED"));

      const failed = eventsNamed(collector, "request-failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]?.actionable).toBe(true);
      expect(eventsNamed(collector, "request-aborted")[0]?.actionable).toBe(false);
    }),
  );
});

test.describe("fault category E: required service unavailable", () => {
  test(
    "a service startup failure is recorded and classified as an environment blocker",
    withCollector(async ({ collector, application }) => {
      application.childProcess.stderr.emit(
        "data",
        "[supervisor] required service quartz could not start: EADDRINUSE 127.0.0.1:8080\n",
      );

      const startup = eventsNamed(collector, "service-startup-failure");
      expect(startup).toHaveLength(1);
      // The port conflict is recorded so the classifier has concrete evidence.
      const entry = collector.entries.find(
        (item) => item.event === "service-startup-failure",
      );
      expect(JSON.stringify(entry?.data)).toContain("port-conflict");
      // A service that never started proves nothing about Breadboard's logic,
      // so it must not become a licence to edit production source.
      expect(
        classifyProbeFailure(new Error("dashboard never became ready"), collector.entries)
          .classification,
      ).toBe("TEST_ENVIRONMENT");
    }),
  );

  test(
    "service log lines are ingested with their own severity",
    withCollector(async ({ collector, outputDir }) => {
      const logsDir = path.join(outputDir, "service-logs-source");
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(
        path.join(logsDir, "quartz.log"),
        ["[quartz] listening", "[quartz] ERROR failed to build index"].join("\n"),
        "utf8",
      );

      const scoped = new DiagnosticsCollector({
        outputDir: path.join(outputDir, "scoped"),
        serviceLogsDir: logsDir,
      });
      const snapshots = await scoped.snapshotServiceLogs();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.service).toBe("quartz");
      const captured = scoped.entries.filter((entry) => entry.source === "service");
      expect(captured.some((entry) => entry.level === "error")).toBe(true);
      await scoped.dispose();
    }),
  );
});

test.describe("evidence bundle completeness", () => {
  test(
    "a failure snapshot is written to disk with counts and a JSONL event log",
    withCollector(async ({ collector, page, application, outputDir }) => {
      page.emit("pageerror", new Error("QA_INJECTED_RENDERER_FAULT"));
      application.childProcess.stderr.emit("data", "[supervisor] ERROR chatmock exited\n");
      page.emit("response", stubResponse({ status: 503 }));
      await collector.snapshotFailure("selftest-failure.json");

      const snapshotPath = path.join(outputDir, "selftest-failure.json");
      expect(fs.existsSync(snapshotPath)).toBe(true);
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
        counts: { byLevel: Record<string, number>; bySource: Record<string, number> };
        entries: Array<{ event: string }>;
      };
      expect(snapshot.counts.bySource["renderer"]).toBeGreaterThan(0);
      expect(snapshot.counts.bySource["main"]).toBeGreaterThan(0);
      expect(snapshot.counts.bySource["network"]).toBeGreaterThan(0);
      expect(snapshot.entries.some((entry) => entry.event === "page-error")).toBe(true);

      const jsonl = fs.readFileSync(collector.eventLogPath, "utf8").trim().split("\n");
      expect(jsonl.length).toBe(snapshot.entries.length);
      for (const line of jsonl) expect(() => JSON.parse(line)).not.toThrow();
    }),
  );

  test(
    "credentials never reach the evidence bundle",
    withCollector(async ({ collector, page }) => {
      const disposableSecret = "Breadboard-QA-eKQ3ZmR2ZmZm";
      collector.addSecrets([disposableSecret]);
      page.emit(
        "pageerror",
        new Error(
          `sign-in failed for password=${disposableSecret} with Authorization: Bearer abcdefghijklmnop0123`,
        ),
      );

      const recorded = collector.entries.find((entry) => entry.event === "page-error");
      expect(recorded?.message).not.toContain(disposableSecret);
      expect(recorded?.message).not.toContain("abcdefghijklmnop0123");
      expect(recorded?.message).toContain("[REDACTED]");
    }),
  );
});
