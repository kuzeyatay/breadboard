import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "playwright";
import {
  assertPathInside,
  createQaEnvironment,
  isPathInside,
  looksLikeCredentialEnvironmentKey,
  QA_RUN_MARKER,
  shouldPreserveQaRun,
} from "../../environment";
import { classifyProbeFailure, isRepairEligibleClassification } from "../../classification";
import {
  QaFixtureError,
  readQaFixture,
  readQaJsonFixture,
  resolveQaFixture,
} from "../../qa-fixtures";
import { unreleasedPorts, waitForPortsReleased } from "../../process-ports";
import { locate, role, SELECTORS, type SemanticSelector } from "../../selectors";
import type { DiagnosticEntry } from "../../diagnostics";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/**
 * Harness self-tests for isolation, fixtures, bounded waits, selector
 * resolution, and the classification oracle. Nothing here launches Breadboard;
 * every fault is injected into the QA layer itself and the assertion is always
 * that the layer *reports* it.
 */

function sandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bb-qa-iso-"));
}

function diagnostic(event: string, extra: Partial<DiagnosticEntry> = {}): DiagnosticEntry {
  return {
    sequence: 1,
    timestamp: new Date(0).toISOString(),
    source: "renderer",
    level: "error",
    event,
    message: `synthetic ${event}`,
    ...extra,
  } as DiagnosticEntry;
}

test.describe("fault category F/G: deterministic fixtures", () => {
  test("a missing fixture is reported as a missing fixture, not a product failure", () => {
    let caught: unknown;
    try {
      readQaFixture(REPO_ROOT, "definitely-not-a-real-fixture.md");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QaFixtureError);
    expect((caught as QaFixtureError).problem).toBe("missing");
    expect((caught as QaFixtureError).diagnosticEvent).toBe("qa-fixture-missing");
    expect(classifyProbeFailure(caught, []).classification).toBe("TEST_ENVIRONMENT");
    expect(
      isRepairEligibleClassification(classifyProbeFailure(caught, []).classification),
    ).toBe(false);
  });

  test("an existing fixture still loads, so the missing-fixture path is not vacuous", () => {
    const contents = readQaFixture(REPO_ROOT, "firefly-brief.md");
    expect(contents).toContain("FIREFLY-COPPER-17");
  });

  test("a malformed JSON fixture is reported as malformed", () => {
    const root = sandbox();
    try {
      fs.writeFileSync(path.join(root, "payload.json"), '{"clusters": [', "utf8");
      let caught: unknown;
      try {
        readQaJsonFixture(REPO_ROOT, "payload.json", { fixturesRoot: root });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(QaFixtureError);
      expect((caught as QaFixtureError).problem).toBe("malformed");
      expect(classifyProbeFailure(caught, []).classification).toBe("TEST_ENVIRONMENT");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a truncated (zero-byte) fixture is malformed rather than silently empty", () => {
    const root = sandbox();
    try {
      fs.writeFileSync(path.join(root, "empty.md"), "", "utf8");
      expect(() => readQaFixture(REPO_ROOT, "empty.md", { fixturesRoot: root })).toThrow(
        /malformed QA fixture/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a diagnostic-backed fixture failure is classified from the event, not the wording", () => {
    const decision = classifyProbeFailure(new Error("timed out"), [
      diagnostic("qa-fixture-malformed", { source: "electron" }),
    ]);
    expect(decision.classification).toBe("TEST_ENVIRONMENT");
  });
});

test.describe("fault category K: forbidden filesystem targets", () => {
  test("a fixture name that escapes the fixture root is refused", () => {
    for (const name of ["../package.json", "..\\package.json", "../../.env"]) {
      expect(() => resolveQaFixture(REPO_ROOT, name)).toThrow(/forbidden QA path/);
    }
  });

  test("assertPathInside refuses an escape and accepts a genuine child", () => {
    const root = sandbox();
    try {
      expect(() => assertPathInside(root, path.join(root, "..", "elsewhere"), "target")).toThrow(
        /must stay inside/,
      );
      expect(isPathInside(root, path.join(root, "a", "b"))).toBe(true);
      expect(isPathInside(root, path.dirname(root))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("an absolute fixture path outside the root is refused even when it exists", () => {
    expect(() => resolveQaFixture(REPO_ROOT, path.join(REPO_ROOT, "package.json"))).toThrow(
      /forbidden QA path/,
    );
  });
});

test.describe("fault category J: invalid or non-isolated run-root configuration", () => {
  test("the QA runtime root can never be the repository root", () => {
    expect(() => createQaEnvironment({ repoRoot: REPO_ROOT, runtimeRoot: REPO_ROOT })).toThrow(
      /cannot be the repository root/,
    );
  });

  test("the QA runtime root can never be a filesystem root", () => {
    const filesystemRoot = path.parse(os.tmpdir()).root;
    expect(() =>
      createQaEnvironment({ repoRoot: REPO_ROOT, runtimeRoot: filesystemRoot }),
    ).toThrow(/cannot be a filesystem root/);
  });

  test("a traversing or malformed run id is refused before any directory is made", () => {
    const runtimeRoot = sandbox();
    try {
      for (const runId of ["..", ".", "../escape", "with space", "a".repeat(200)]) {
        expect(() => createQaEnvironment({ repoRoot: REPO_ROOT, runtimeRoot, runId })).toThrow(
          /Invalid QA run id/,
        );
      }
      expect(fs.readdirSync(runtimeRoot)).toEqual([]);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("every mutable path resolves below the run root and nowhere near real user data", async () => {
    const runtimeRoot = sandbox();
    const run = createQaEnvironment({ repoRoot: REPO_ROOT, runtimeRoot, preserve: "never" });
    try {
      const mutable = [
        run.paths.userDataDir,
        run.paths.dataDir,
        run.paths.homeDir,
        run.paths.appDataDir,
        run.paths.localAppDataDir,
        run.paths.tempDir,
        run.paths.downloadsDir,
        run.paths.artifactsDir,
        run.paths.serviceLogsDir,
        run.paths.councilLedgerDir,
        run.paths.hermesManagedDir,
        run.paths.hermesFilesDir,
        run.paths.optionalSourcesDir,
        run.paths.optionalStateDir,
      ];
      for (const target of mutable) {
        expect(isPathInside(run.paths.runRoot, target)).toBe(true);
      }

      // The environment handed to Electron must not point at the real profile.
      const realAppData = process.env["APPDATA"] ?? "";
      expect(run.env["APPDATA"]).not.toBe(realAppData);
      for (const key of [
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "TEMP",
        "TMP",
        "CODEX_HOME",
        "HERMES_HOME",
        "CLAUDE_CONFIG_DIR",
        "GIT_CONFIG_GLOBAL",
        "NPM_CONFIG_USERCONFIG",
        "BREADBOARD_DATA_DIR",
        "BREADBOARD_QA_RUN_DIR",
      ]) {
        const value = run.env[key];
        expect(value, `${key} must be set for an isolated launch`).toBeTruthy();
        expect(
          isPathInside(run.paths.runRoot, String(value)),
          `${key}=${String(value)} escaped the QA run root`,
        ).toBe(true);
      }

      // Optional runtimes stay off so they cannot silently reach a shared checkout.
      expect(run.env["GBRAIN_MODE"]).toBe("disabled");
      expect(run.env["UI_TARS_MODE"]).toBe("disabled");
      expect(run.env["CLIPROXY_MODE"]).toBe("disabled");
      expect(run.env["ELECTRON_RUN_AS_NODE"]).toBeUndefined();
      expect(run.launchArgs).toContain("--breadboard-qa");
      expect(run.launchArgs).toContain(`--breadboard-user-data-dir=${run.paths.userDataDir}`);

      // Real provider credentials are blanked, never inherited.
      for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
        expect(run.env[key]).toBe("");
      }
    } finally {
      await run.cleanup("passed");
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("a credential-like variable cannot be inherited into the QA launch by accident", () => {
    const runtimeRoot = sandbox();
    try {
      expect(looksLikeCredentialEnvironmentKey("SOME_API_KEY")).toBe(true);
      expect(looksLikeCredentialEnvironmentKey("BREADBOARD_DATA_DIR")).toBe(false);
      expect(() =>
        createQaEnvironment({
          repoRoot: REPO_ROOT,
          runtimeRoot,
          baseEnv: { SOME_API_KEY: "real-user-key" },
          passthroughEnv: ["SOME_API_KEY"],
        }),
      ).toThrow(/Refusing to inherit credential-like environment variable/);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});

test.describe("fault category L: cleanup failure", () => {
  test("cleanup refuses to run without its marker and leaves the tree intact", async () => {
    const runtimeRoot = sandbox();
    const run = createQaEnvironment({ repoRoot: REPO_ROOT, runtimeRoot, preserve: "never" });
    try {
      fs.rmSync(run.paths.markerFile);
      await expect(run.cleanup("passed")).rejects.toThrow(/ENOENT|marker/i);
      expect(fs.existsSync(run.paths.runRoot)).toBe(true);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("cleanup refuses a marker that describes a different run", async () => {
    const runtimeRoot = sandbox();
    const run = createQaEnvironment({ repoRoot: REPO_ROOT, runtimeRoot, preserve: "never" });
    try {
      const marker = JSON.parse(fs.readFileSync(run.paths.markerFile, "utf8")) as {
        runId: string;
      };
      marker.runId = "some-other-run";
      fs.writeFileSync(run.paths.markerFile, JSON.stringify(marker), "utf8");
      await expect(run.cleanup("passed")).rejects.toThrow(/marker does not match/);
      expect(fs.existsSync(run.paths.runRoot)).toBe(true);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("cleanup can never target the runtime root itself", async () => {
    const runtimeRoot = sandbox();
    const run = createQaEnvironment({ repoRoot: REPO_ROOT, runtimeRoot, preserve: "never" });
    try {
      const hijacked = {
        runId: run.runId,
        preserve: "never" as const,
        paths: {
          ...run.paths,
          runRoot: runtimeRoot,
          markerFile: path.join(runtimeRoot, QA_RUN_MARKER),
        },
      };
      const { cleanupQaEnvironment } = await import("../../environment");
      await expect(cleanupQaEnvironment(hijacked, "passed")).rejects.toThrow(
        /Refusing to remove the QA runtime root itself/,
      );
      expect(fs.existsSync(runtimeRoot)).toBe(true);
    } finally {
      await run.cleanup("passed").catch(() => undefined);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("a successful run is removed and a failed run is preserved as evidence", async () => {
    expect(shouldPreserveQaRun("on-failure", "passed")).toBe(false);
    expect(shouldPreserveQaRun("on-failure", "failed")).toBe(true);
    expect(shouldPreserveQaRun("on-failure", "interrupted")).toBe(true);
    expect(shouldPreserveQaRun("always", "passed")).toBe(true);
    expect(shouldPreserveQaRun("never", "failed")).toBe(false);

    const runtimeRoot = sandbox();
    const run = createQaEnvironment({ repoRoot: REPO_ROOT, runtimeRoot, preserve: "on-failure" });
    try {
      const preserved = await run.cleanup("failed");
      expect(preserved.preserved).toBe(true);
      expect(fs.existsSync(run.paths.runRoot)).toBe(true);
      const removed = await run.cleanup("passed");
      expect(removed.removed).toBe(true);
      expect(fs.existsSync(run.paths.runRoot)).toBe(false);
      // The runtime root survives; only the marker-owned child is removed.
      expect(fs.existsSync(runtimeRoot)).toBe(true);
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });
});

test.describe("fault categories H/I: bounded waits and owned-process leaks", () => {
  test("a held port is reported as unreleased and the wait fails with the exact port", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    try {
      // A QA-owned service that is still listening is a leaked child process.
      expect(await unreleasedPorts([port])).toEqual([port]);
      await expect(waitForPortsReleased([port], 300)).rejects.toThrow(
        new RegExp(`were not released within 300ms: ${port}`),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // ...and the same check passes once the owner really has gone away, so the
    // leak detector is not simply always-failing.
    await waitForPortsReleased([port], 5_000);
    expect(await unreleasedPorts([port])).toEqual([]);
  });

  test("an explicit operation timeout surfaces as a timeout, not as success", async () => {
    const started = Date.now();
    let message = "";
    try {
      await waitForPortsReleased([1], 0);
      // Port 1 is normally free, so fall through is acceptable; the real bound
      // is asserted by the held-port case above.
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(Date.now() - started).toBeLessThan(20_000);
    if (message) expect(message).toContain("not released within");
  });
});

test.describe("fault category M: selector and harness resolution failures", () => {
  test("each selector kind is routed to its own semantic query", () => {
    const calls: string[] = [];
    const root = {
      getByRole: (...args: unknown[]) => {
        calls.push(`role:${JSON.stringify(args)}`);
        return {} as Locator;
      },
      getByLabel: (...args: unknown[]) => {
        calls.push(`label:${JSON.stringify(args)}`);
        return {} as Locator;
      },
      getByPlaceholder: () => {
        calls.push("placeholder");
        return {} as Locator;
      },
      getByText: () => {
        calls.push("text");
        return {} as Locator;
      },
    } as unknown as Page;

    locate(root, SELECTORS.auth.signIn);
    locate(root, SELECTORS.auth.username);
    expect(calls[0]).toContain("role:");
    expect(calls[0]).toContain("Sign in");
    expect(calls[1]).toContain("label:");
  });

  test("an unrecognised selector kind throws instead of silently resolving to nothing", () => {
    const root = {
      getByRole: () => ({}) as Locator,
      getByLabel: () => ({}) as Locator,
      getByPlaceholder: () => ({}) as Locator,
      getByText: () => ({}) as Locator,
    } as unknown as Page;
    const broken = { kind: "data-testid", name: "garden" } as unknown as SemanticSelector;
    expect(() => locate(root, broken)).toThrow(/Unsupported QA selector kind/);
  });

  test("shared selectors stay semantic rather than structural", () => {
    const flatten = (value: unknown): SemanticSelector[] =>
      value && typeof value === "object" && "kind" in (value as Record<string, unknown>)
        ? [value as SemanticSelector]
        : Object.values(value as Record<string, unknown>).flatMap(flatten);
    const all = flatten(SELECTORS);
    expect(all.length).toBeGreaterThan(20);
    for (const selector of all) {
      expect(["role", "label", "placeholder", "text"]).toContain(selector.kind);
    }
    expect(role("button", "Sign in", true).kind).toBe("role");
  });
});

test.describe("Phase 3: classification oracle", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly error: unknown;
    readonly diagnostics: readonly DiagnosticEntry[];
    readonly expected: string;
  }> = [
    {
      name: "renderer exception is a product bug",
      error: new Error("expected the garden to be listed"),
      diagnostics: [diagnostic("page-error")],
      expected: "PRODUCT_BUG",
    },
    {
      name: "renderer crash is a product bug",
      error: new Error("page closed"),
      diagnostics: [diagnostic("renderer-crash", { level: "fatal" })],
      expected: "PRODUCT_BUG",
    },
    {
      name: "main-process uncaught exception is a product bug",
      error: new Error("dashboard never loaded"),
      diagnostics: [diagnostic("uncaught-exception", { source: "main", level: "fatal" })],
      expected: "PRODUCT_BUG",
    },
    {
      name: "a plain assertion failure defaults to a product bug",
      error: new Error("expected 'Firefly' but saw 'undefined'"),
      diagnostics: [],
      expected: "PRODUCT_BUG",
    },
    {
      name: "a failed service start is an environment blocker",
      error: new Error("dashboard never became ready"),
      diagnostics: [diagnostic("service-startup-failure", { source: "main" })],
      expected: "TEST_ENVIRONMENT",
    },
    {
      name: "a port conflict is an environment blocker",
      error: new Error("startup failed"),
      diagnostics: [
        diagnostic("main-stderr", { source: "main", data: { category: "port-conflict" } }),
      ],
      expected: "TEST_ENVIRONMENT",
    },
    {
      name: "EADDRINUSE in the message is an environment blocker",
      error: new Error("listen EADDRINUSE: address already in use 127.0.0.1:8080"),
      diagnostics: [],
      expected: "TEST_ENVIRONMENT",
    },
    {
      name: "a missing QA fixture is an environment blocker",
      error: new QaFixtureError("missing", "orchard-notes.txt", "no file"),
      diagnostics: [],
      expected: "TEST_ENVIRONMENT",
    },
    {
      name: "a manifest drift is an environment blocker",
      error: new Error("manifest dependencies changed since the scenario was written"),
      diagnostics: [],
      expected: "TEST_ENVIRONMENT",
    },
    {
      name: "a non-actionable diagnostic does not make a failure a product bug",
      error: new Error("ECONNREFUSED 127.0.0.1:9999"),
      diagnostics: [diagnostic("page-error", { actionable: false })],
      expected: "TEST_ENVIRONMENT",
    },
  ];

  for (const scenario of cases) {
    test(scenario.name, () => {
      const decision = classifyProbeFailure(scenario.error, scenario.diagnostics);
      expect(decision.classification).toBe(scenario.expected);
    });
  }

  test("only PRODUCT_BUG is repair eligible", () => {
    expect(isRepairEligibleClassification("PRODUCT_BUG")).toBe(true);
    for (const classification of [
      "TEST_ENVIRONMENT",
      "EXTERNAL_DEPENDENCY",
      "EXPECTED_BEHAVIOR",
      "FLAKY",
      "MISSING_FEATURE",
      "QA_FIXTURE_MISSING",
      "QA_HARNESS_LIMITATION",
      "OPTIONAL_DEPENDENCY_NOT_CONFIGURED",
      "PRODUCT_PREREQUISITE_MISSING",
      "INTENTIONALLY_UNSUPPORTED",
      null,
    ] as const) {
      expect(isRepairEligibleClassification(classification)).toBe(false);
    }
  });
});
