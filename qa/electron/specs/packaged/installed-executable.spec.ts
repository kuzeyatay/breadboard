import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "playwright";
import { DiagnosticsCollector } from "../../diagnostics";
import {
  createQaEnvironment,
  type QaRunEnvironment,
  type QaRunOutcome,
} from "../../environment";
import {
  launchBreadboard,
  type BreadboardElectron,
} from "../../launch-breadboard";

const PACKAGED_EXE_ENV = "BREADBOARD_QA_PACKAGED_EXE";
const suppliedExecutable = process.env[PACKAGED_EXE_ENV]?.trim() ?? "";
const BLOCKER =
  `BLOCKED (TEST_ENVIRONMENT): set ${PACKAGED_EXE_ENV} to an explicit packaged Breadboard.exe; ` +
  "this Playwright slice never installs, discovers, or substitutes an executable.";
const EXPECTED_PRELOAD_API_KEYS = [
  "allowThemeLocation",
  "awaitDashboardReady",
  "continueToDashboard",
  "copyDiagnostics",
  "getStartupSound",
  "getStartupState",
  "getVersions",
  "onStartupState",
  "openLogsFolder",
  "openMicrophoneSettings",
  "pickFolder",
  "quit",
  "retryService",
  "setStartupSound",
  "setTheme",
] as const;
const PACKAGED_BEHAVIOR_ENVIRONMENT_KEYS = [
  "BREADBOARD_QA_MODE",
  "BREADBOARD_QA_SERVICE_PROFILE",
  "BREADBOARD_QA_RUN_ID",
  "BREADBOARD_QA_RUN_DIR",
  "BREADBOARD_QA_ARTIFACTS_DIR",
  "BREADBOARD_DATA_DIR",
  "BREADBOARD_REPO_ROOT",
  "GBRAIN_MODE",
  "UI_TARS_MODE",
  "CAD_MODE",
  "CLIPROXY_MODE",
  "VIDEO_TRANSCRIPTION_ENABLED",
  "CI",
] as const;

test.skip(process.platform !== "win32", "BLOCKED (TEST_ENVIRONMENT): packaged executable QA currently requires Windows.");
test.skip(suppliedExecutable.length === 0, BLOCKER);

test("explicit installed executable keeps production hardening and exits cleanly", async ({}, testInfo) => {
  test.setTimeout(20 * 60_000);

  const executablePath = validatePackagedExecutable(suppliedExecutable);
  const run = createQaEnvironment({
    preserve:
      process.env["BREADBOARD_QA_PRESERVE_RUNTIME"] === "1"
        ? "always"
        : "on-failure",
  });
  // `launchBreadboard({ packaged: true })` ignores electronArgs, so no dev or
  // QA command-line gate is passed. Clear the environment half as well: this
  // probe must exercise the production packaged lifecycle, not QA service
  // filtering, while retaining the isolated paths created above.
  const packagedEnv = { ...run.env };
  for (const key of PACKAGED_BEHAVIOR_ENVIRONMENT_KEYS) {
    delete packagedEnv[key];
  }
  const packagedRun: QaRunEnvironment = {
    ...run,
    env: packagedEnv,
  };
  const resultsDir = path.join(
    run.paths.repoRoot,
    ".qa-results",
    "packaged",
    run.runId,
  );
  const tracePath = path.join(resultsDir, "packaged-trace.zip");
  const receiptPath = path.join(resultsDir, "packaged-receipt.json");
  const screenshotPath = path.join(resultsDir, "failure.png");

  let diagnostics: DiagnosticsCollector | null = null;
  let app: BreadboardElectron | null = null;
  let traceStarted = false;
  let ownedProcesses: WindowsProcessIdentity[] = [];
  let ownedListeningPorts: OwnedListeningPort[] = [];
  let mainPid = 0;
  let outerPid = 0;
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;
  let externalOpenAttempts: readonly string[] = [];
  let securitySnapshot: Awaited<ReturnType<BreadboardElectron["securitySnapshot"]>> | null = null;
  let endpoints: RuntimeEndpoints | null = null;
  let launchSnapshot: MainProcessLaunchSnapshot | null = null;
  let primaryError: unknown = null;
  const teardownErrors: unknown[] = [];

  try {
    fs.mkdirSync(resultsDir, { recursive: true });
    diagnostics = new DiagnosticsCollector({
      outputDir: path.join(resultsDir, "diagnostics"),
      serviceLogsDir: run.paths.serviceLogsDir,
      secretValues: Object.values(run.bootstrap.auth),
    });
    app = await launchBreadboard({
      run: packagedRun,
      executablePath,
      packaged: true,
      mockNativeDialogs: false,
      diagnostics,
    });
    await app.application.context().tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    traceStarted = true;

    mainPid = await app.application.evaluate(() => process.pid);
    outerPid = app.application.process().pid ?? mainPid;
    launchSnapshot = await inspectMainProcessLaunch(app);
    expect(sameWindowsPath(launchSnapshot.execPath, executablePath)).toBe(true);
    expect(launchSnapshot.argv).not.toContain("--breadboard-dev");
    expect(launchSnapshot.argv).not.toContain("--breadboard-qa");
    const userDataArguments = launchSnapshot.argv.filter((argument) =>
      argument.startsWith("--breadboard-user-data-dir="),
    );
    expect(userDataArguments).toHaveLength(1);
    expect(
      sameWindowsPath(
        userDataArguments[0]!.slice("--breadboard-user-data-dir=".length),
        run.paths.userDataDir,
      ),
    ).toBe(true);
    expect(launchSnapshot.qaMode).toBeNull();
    expect(launchSnapshot.qaServiceProfile).toBeNull();
    expect(launchSnapshot.qaEnvironment).toEqual({});

    securitySnapshot = await app.securitySnapshot();
    expect(securitySnapshot.isPackaged).toBe(true);
    expect(sameWindowsPath(securitySnapshot.userData, run.paths.userDataDir)).toBe(true);
    expect(securitySnapshot.windows.length).toBeGreaterThan(0);
    for (const window of securitySnapshot.windows) {
      expect(window.sandbox).toBe(true);
      expect(window.contextIsolation).toBe(true);
      expect(window.nodeIntegration).toBe(false);
      expect(window.webviewTag).toBe(false);
    }

    const startupPage = app.startupPage;
    await startupPage.waitForLoadState("domcontentloaded");
    expect(startupPage.url()).toMatch(/^file:/);
    const preload = await inspectPreload(startupPage);
    expect(preload.apiKeys).toEqual(EXPECTED_PRELOAD_API_KEYS);
    expect(preload.processType).toBe("undefined");
    expect(preload.requireType).toBe("undefined");
    expect(preload.versions?.app).toEqual(expect.any(String));
    expect(preload.versions?.electron).toEqual(expect.any(String));

    await expect(
      startupPage.getByRole("button", {
        name: "Welcome to Breadboard. Click to continue.",
        exact: true,
      }),
    ).toBeVisible({ timeout: 10 * 60_000 });

    endpoints = readRuntimeEndpoints(run);
    expect(endpoints.pid).toBe(mainPid);
    ownedProcesses = await captureOwnedWindowsProcessTree([mainPid, outerPid]);
    expect(ownedProcesses.some((process) => process.pid === mainPid)).toBe(true);
    ownedListeningPorts = await discoverOwnedListeningPorts(
      endpoints,
      ownedProcesses,
      true,
    );

    const page = await app.dismissWelcome();
    await expect(
      page.getByRole("heading", { name: "Sign in", exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    expect(new URL(page.url()).pathname).toBe("/auth/login");
    externalOpenAttempts = await app.externalOpenAttempts();
    expect(externalOpenAttempts).toEqual([]);
    diagnostics.assertNoFatal("packaged startup and welcome");
  } catch (error) {
    primaryError = error;
    const page = failurePage(app);
    if (page) {
      await page
        .screenshot({ path: screenshotPath, fullPage: true })
        .catch(() => undefined);
    }
    try {
      diagnostics?.writeSnapshot("failure-diagnostics.json");
    } catch {
      // Finalization below gets another chance to persist the evidence.
    }
  } finally {
    // Establish the broadest exact ownership proof still available before
    // asking the app to stop, even when an earlier assertion failed.
    if (app && mainPid === 0) {
      try {
        mainPid = await app.application.evaluate(() => process.pid);
        outerPid = app.application.process().pid ?? mainPid;
      } catch (error) {
        teardownErrors.push(error);
      }
    }
    if (app && mainPid > 0) {
      try {
        ownedProcesses = mergeOwnedProcessIdentities(
          ownedProcesses,
          await captureOwnedWindowsProcessTree([mainPid, outerPid]),
        );
        if (!ownedProcesses.some((process) => process.pid === mainPid)) {
          throw new Error(
            `TEST_ENVIRONMENT: could not capture a stable creation identity for packaged main PID ${mainPid}`,
          );
        }
      } catch (error) {
        teardownErrors.push(error);
      }
    }
    if (!endpoints && fs.existsSync(path.join(run.paths.dataDir, "runtime", "endpoints.json"))) {
      try {
        endpoints = readRuntimeEndpoints(run);
      } catch (error) {
        teardownErrors.push(error);
      }
    }
    if (endpoints && ownedProcesses.length > 0) {
      try {
        ownedListeningPorts = mergeOwnedListeningPorts(
          ownedListeningPorts,
          await discoverOwnedListeningPorts(
            endpoints,
            ownedProcesses,
            false,
          ),
        );
      } catch (error) {
        teardownErrors.push(error);
      }
    }

    if (traceStarted && app) {
      try {
        await app.application.context().tracing.stop({ path: tracePath });
      } catch (error) {
        teardownErrors.push(error);
      }
      traceStarted = false;
    }

    if (app) {
      const processHandle = app.application.process();
      const exitedBeforeRequestedClose =
        processHandle.exitCode !== null || processHandle.signalCode !== null;
      const observedExit = observeProcessExit(processHandle, 75_000);
      if (exitedBeforeRequestedClose) {
        teardownErrors.push(
          new Error(
            "Packaged Electron exited before the QA harness requested a normal close",
          ),
        );
      } else {
        try {
          await app.close();
        } catch (error) {
          teardownErrors.push(error);
        }
      }
      try {
        ({ exitCode, signalCode } = await observedExit);
        if (exitCode !== 0 || signalCode !== null) {
          teardownErrors.push(
            new Error(
              `Packaged Electron did not close cleanly (exit=${String(exitCode)}, signal=${String(signalCode)})`,
            ),
          );
        }
      } catch (error) {
        teardownErrors.push(error);
      }
    }

    if (ownedListeningPorts.length > 0) {
      try {
        await waitForPortsReleased(ownedListeningPorts, 45_000);
      } catch (error) {
        teardownErrors.push(error);
      }
    }
    if (ownedProcesses.length > 0) {
      try {
        const lingering = await waitForOwnedProcessesReleased(ownedProcesses, 45_000);
        if (lingering.length > 0) {
          throw new Error(
            `Packaged QA-owned process identities did not release: ${lingering.join(", ")}`,
          );
        }
      } catch (error) {
        teardownErrors.push(error);
      }
    }

    if (diagnostics) {
      try {
        await diagnostics.finalize();
        if (primaryError === null) {
          diagnostics.assertNoFatal("packaged clean shutdown");
        }
      } catch (error) {
        teardownErrors.push(error);
      }
      try {
        await diagnostics.dispose();
      } catch (error) {
        teardownErrors.push(error);
      }
    }

    let cleanupOutcome: QaRunOutcome =
      primaryError === null && teardownErrors.length === 0 ? "passed" : "failed";
    try {
      await run.cleanup(cleanupOutcome);
    } catch (error) {
      teardownErrors.push(error);
      cleanupOutcome = "failed";
    }

    if (primaryError === null && teardownErrors.length === 0) {
      try {
        const receipt = {
          schemaVersion: 1,
          executablePath,
          executableBytes: fs.statSync(executablePath).size,
          runId: run.runId,
          isolatedUserData: run.paths.userDataDir,
          launch: launchSnapshot,
          externalOpenAttempts,
          security: securitySnapshot,
          endpoints,
          mainPid,
          outerPid,
          ownedProcesses,
          releasedListeningPorts: ownedListeningPorts,
          exitCode,
          signalCode,
          cleanupOutcome,
          completedAt: new Date().toISOString(),
        };
        fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      } catch (error) {
        teardownErrors.push(error);
      }
    }

    for (const [name, artifact, contentType] of [
      ["packaged-diagnostics", path.join(resultsDir, "diagnostics", "diagnostics.json"), "application/json"],
      ["packaged-failure-diagnostics", path.join(resultsDir, "diagnostics", "failure-diagnostics.json"), "application/json"],
      ["packaged-trace", tracePath, "application/zip"],
      ["packaged-receipt", receiptPath, "application/json"],
      ["packaged-failure-screenshot", screenshotPath, "image/png"],
    ] as const) {
      if (fs.existsSync(artifact)) {
        try {
          await testInfo.attach(name, { path: artifact, contentType });
        } catch (error) {
          teardownErrors.push(error);
        }
      }
    }

    const failures = [
      ...(primaryError === null ? [] : [primaryError]),
      ...teardownErrors,
    ];
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        "Packaged Electron QA failed and teardown evidence found additional errors",
      );
    }
  }
});

interface RuntimeEndpoints {
  readonly pid: number;
  readonly startedAt: string;
  readonly urls: Readonly<Record<string, string>>;
}

interface MainProcessLaunchSnapshot {
  readonly execPath: string;
  readonly argv: readonly string[];
  readonly qaMode: string | null;
  readonly qaServiceProfile: string | null;
  readonly qaEnvironment: Readonly<Record<string, string>>;
}

interface WindowsProcessIdentity {
  readonly pid: number;
  readonly parentPid: number;
  readonly creationDate: string;
  readonly executablePath: string | null;
}

interface WindowsProcessRecord {
  readonly pid: number;
  readonly parentPid: number;
  readonly creationDate: string | null;
  readonly executablePath: string | null;
}

interface WindowsListeningPort {
  readonly localAddress: string;
  readonly port: number;
  readonly ownerPid: number;
}

interface OwnedListeningPort {
  readonly port: number;
  readonly services: readonly string[];
  readonly ownerPids: readonly number[];
  readonly localAddresses: readonly string[];
}

async function inspectMainProcessLaunch(
  app: BreadboardElectron,
): Promise<MainProcessLaunchSnapshot> {
  return app.application.evaluate(() => ({
    execPath: process.execPath,
    argv: [...process.argv],
    qaMode: process.env["BREADBOARD_QA_MODE"] ?? null,
    qaServiceProfile: process.env["BREADBOARD_QA_SERVICE_PROFILE"] ?? null,
    qaEnvironment: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[0].toUpperCase().startsWith("BREADBOARD_QA_") &&
          typeof entry[1] === "string",
      ),
    ),
  }));
}

async function inspectPreload(page: Page): Promise<{
  apiKeys: string[];
  processType: string;
  requireType: string;
  versions: { app: string; electron: string } | null;
}> {
  return page.evaluate(async () => {
    type DesktopBridge = {
      getVersions(): Promise<{ app: string; electron: string }>;
    };
    const scope = globalThis as typeof globalThis & {
      breadboardDesktop?: DesktopBridge & Record<string, unknown>;
      process?: unknown;
      require?: unknown;
    };
    const desktop = scope.breadboardDesktop;
    return {
      apiKeys: desktop ? Object.keys(desktop).sort() : [],
      processType: typeof scope.process,
      requireType: typeof scope.require,
      versions: desktop ? await desktop.getVersions() : null,
    };
  });
}

function validatePackagedExecutable(input: string): string {
  if (!path.isAbsolute(input)) {
    throw new Error(
      `TEST_ENVIRONMENT: ${PACKAGED_EXE_ENV} must be an absolute path: ${input}`,
    );
  }
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(
      `TEST_ENVIRONMENT: ${PACKAGED_EXE_ENV} does not name an existing file: ${resolved}`,
    );
  }
  if (path.extname(resolved).toLowerCase() !== ".exe") {
    throw new Error(
      `TEST_ENVIRONMENT: ${PACKAGED_EXE_ENV} must name a Windows executable: ${resolved}`,
    );
  }
  return resolved;
}

function sameWindowsPath(left: string, right: string): boolean {
  return (
    fs.realpathSync.native(path.resolve(left)).toLowerCase() ===
    fs.realpathSync.native(path.resolve(right)).toLowerCase()
  );
}

function readRuntimeEndpoints(run: QaRunEnvironment): RuntimeEndpoints {
  const endpointFile = path.join(run.paths.dataDir, "runtime", "endpoints.json");
  const raw: unknown = JSON.parse(fs.readFileSync(endpointFile, "utf8"));
  if (!isRecord(raw) || typeof raw["pid"] !== "number") {
    throw new Error(`Invalid packaged runtime endpoints: ${endpointFile}`);
  }
  if (typeof raw["startedAt"] !== "string" || !isStringRecord(raw["urls"])) {
    throw new Error(`Invalid packaged runtime endpoint payload: ${endpointFile}`);
  }
  return {
    pid: raw["pid"],
    startedAt: raw["startedAt"],
    urls: { ...raw["urls"] },
  };
}

async function discoverOwnedListeningPorts(
  endpoints: RuntimeEndpoints,
  ownedProcesses: readonly WindowsProcessIdentity[],
  requireCriticalServices: boolean,
): Promise<OwnedListeningPort[]> {
  const required = new Set(["dashboard", "chatmock", "quartz"]);
  const servicesByPort = new Map<number, string[]>();
  for (const [service, value] of Object.entries(endpoints.urls)) {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
      throw new Error(`Packaged ${service} endpoint escaped loopback HTTP: ${value}`);
    }
    const port = Number(url.port);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Packaged ${service} endpoint has an invalid port: ${value}`);
    }
    const services = servicesByPort.get(port) ?? [];
    services.push(service);
    servicesByPort.set(port, services);
  }

  const ownedPids = new Set(ownedProcesses.map((process) => process.pid));
  const listeners = await windowsListeningPortSnapshot([...ownedPids]);
  const listenersByPort = new Map<number, WindowsListeningPort[]>();
  for (const listener of listeners) {
    const samePort = listenersByPort.get(listener.port) ?? [];
    samePort.push(listener);
    listenersByPort.set(listener.port, samePort);
  }
  const result: OwnedListeningPort[] = [];
  for (const [port, owned] of listenersByPort) {
    const services = servicesByPort.get(port) ?? [];
    const escaped = owned.filter(
      (listener) => !isLoopbackAddress(listener.localAddress),
    );
    if (escaped.length > 0) {
      throw new Error(
        `Packaged ${services.join("/") || "unpublished owned"} service listened beyond loopback: ${escaped
          .map((listener) => `${listener.localAddress}:${listener.port} pid=${listener.ownerPid}`)
          .join(", ")}`,
      );
    }
    result.push({
      port,
      services: [...services].sort(),
      ownerPids: [...new Set(owned.map((listener) => listener.ownerPid))].sort(
        (left, right) => left - right,
      ),
      localAddresses: [
        ...new Set(owned.map((listener) => listener.localAddress)),
      ].sort(),
    });
  }

  if (requireCriticalServices) {
    for (const service of required) {
      const value = endpoints.urls[service];
      if (!value) {
        throw new Error(`Packaged runtime endpoints omit required service ${service}`);
      }
      const port = Number(new URL(value).port);
      if (!result.some((listener) => listener.port === port)) {
        const reachable = await canConnectToPort(port);
        throw new Error(
          reachable
            ? `TEST_ENVIRONMENT: could not tie packaged ${service} listener on port ${port} to the timestamp-guarded Electron process tree`
            : `Packaged required service ${service} was not listening on published port ${port}`,
        );
      }
    }
  }
  return result.sort((left, right) => left.port - right.port);
}

async function captureOwnedWindowsProcessTree(
  roots: readonly number[],
): Promise<WindowsProcessIdentity[]> {
  const processes = await windowsProcessSnapshot();
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const byParent = new Map<number, WindowsProcessRecord[]>();
  for (const process of processes) {
    const children = byParent.get(process.parentPid) ?? [];
    children.push(process);
    byParent.set(process.parentPid, children);
  }
  const owned = new Map<number, WindowsProcessIdentity>();
  const queue = [...new Set(roots.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || owned.has(pid)) continue;
    const identity = byPid.get(pid);
    if (identity) {
      if (!identity.creationDate) {
        throw new Error(
          `TEST_ENVIRONMENT: Windows did not expose a stable creation identity for owned PID ${pid}`,
        );
      }
      owned.set(pid, { ...identity, creationDate: identity.creationDate });
    }
    for (const child of byParent.get(pid) ?? []) queue.push(child.pid);
  }
  for (const identity of owned.values()) {
    const parent = owned.get(identity.parentPid);
    if (
      parent &&
      Date.parse(identity.creationDate) < Date.parse(parent.creationDate)
    ) {
      throw new Error(
        `TEST_ENVIRONMENT: PID ${identity.pid} predates alleged parent PID ${parent.pid}; refusing recycled-PID ownership inference`,
      );
    }
  }
  return [...owned.values()].sort((left, right) => left.pid - right.pid);
}

function mergeOwnedProcessIdentities(
  ...groups: readonly WindowsProcessIdentity[][]
): WindowsProcessIdentity[] {
  const identities = new Map<string, WindowsProcessIdentity>();
  for (const group of groups) {
    for (const identity of group) {
      identities.set(`${identity.pid}:${identity.creationDate}`, identity);
    }
  }
  return [...identities.values()].sort(
    (left, right) =>
      left.pid - right.pid || left.creationDate.localeCompare(right.creationDate),
  );
}

function mergeOwnedListeningPorts(
  ...groups: readonly OwnedListeningPort[][]
): OwnedListeningPort[] {
  const merged = new Map<
    number,
    { services: Set<string>; ownerPids: Set<number>; localAddresses: Set<string> }
  >();
  for (const group of groups) {
    for (const listener of group) {
      const entry = merged.get(listener.port) ?? {
        services: new Set<string>(),
        ownerPids: new Set<number>(),
        localAddresses: new Set<string>(),
      };
      for (const service of listener.services) entry.services.add(service);
      for (const pid of listener.ownerPids) entry.ownerPids.add(pid);
      for (const address of listener.localAddresses) {
        entry.localAddresses.add(address);
      }
      merged.set(listener.port, entry);
    }
  }
  return [...merged.entries()]
    .map(([port, entry]) => ({
      port,
      services: [...entry.services].sort(),
      ownerPids: [...entry.ownerPids].sort((left, right) => left - right),
      localAddresses: [...entry.localAddresses].sort(),
    }))
    .sort((left, right) => left.port - right.port);
}

async function waitForOwnedProcessesReleased(
  owned: readonly WindowsProcessIdentity[],
  timeoutMs: number,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let lingering = owned.map((process) => process.pid);
  while (Date.now() <= deadline) {
    const current = await windowsProcessSnapshot(lingering);
    lingering = owned
      .filter((original) => {
        const samePid = current.filter(
          (candidate) => candidate.pid === original.pid,
        );
        if (samePid.some((candidate) => candidate.creationDate === null)) {
          throw new Error(
            `TEST_ENVIRONMENT: Windows stopped exposing the creation identity for captured PID ${original.pid}`,
          );
        }
        return samePid.some((candidate) => sameProcess(original, candidate));
      })
      .map((process) => process.pid);
    if (lingering.length === 0) return [];
    await delay(250);
  }
  return lingering;
}

async function windowsProcessSnapshot(
  pids: readonly number[] = [],
): Promise<WindowsProcessRecord[]> {
  const uniquePids = [
    ...new Set(pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0)),
  ];
  const filter = uniquePids.length > 0
    ? "$items=Get-CimInstance -ClassName Win32_Process -Filter \"" +
      uniquePids.map((pid) => `ProcessId = ${pid}`).join(" OR ") +
      "\"; "
    : "$items=Get-CimInstance -ClassName Win32_Process; ";
  const command =
    filter +
    "$items | ForEach-Object { [pscustomobject]@{ " +
    "pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; " +
    "creationDate=$(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }); " +
    "executablePath=$(if ($_.ExecutablePath) { [string]$_.ExecutablePath } else { $null }) " +
    "} } | ConvertTo-Json -Compress";
  const stdout = await runPowerShell(command);
  if (!stdout.trim()) return [];
  const parsed: unknown = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => {
    if (
      !isRecord(row) ||
      typeof row["pid"] !== "number" ||
      typeof row["parentPid"] !== "number"
    ) {
      throw new Error(
        "TEST_ENVIRONMENT: Windows process inventory returned an invalid row",
      );
    }
    const creationDate =
      typeof row["creationDate"] === "string" &&
      Number.isFinite(Date.parse(row["creationDate"]))
        ? row["creationDate"]
        : null;
    return {
      pid: row["pid"],
      parentPid: row["parentPid"],
      creationDate,
      executablePath:
        typeof row["executablePath"] === "string" ? row["executablePath"] : null,
    };
  });
}

async function windowsListeningPortSnapshot(
  ownerPids: readonly number[],
): Promise<WindowsListeningPort[]> {
  const uniqueOwnerPids = [
    ...new Set(
      ownerPids.filter((pid) => Number.isSafeInteger(pid) && pid > 0),
    ),
  ];
  if (uniqueOwnerPids.length === 0) return [];
  const command =
    `$wanted=@(${uniqueOwnerPids.join(",")}); ` +
    "$items=Get-NetTCPConnection -State Listen -ErrorAction Stop | " +
    "Where-Object { $wanted -contains [int]$_.OwningProcess }; " +
    "$items | ForEach-Object { [pscustomobject]@{ " +
    "localAddress=[string]$_.LocalAddress; port=[int]$_.LocalPort; " +
    "ownerPid=[int]$_.OwningProcess } } | ConvertTo-Json -Compress";
  const stdout = await runPowerShell(command);
  if (!stdout.trim()) return [];
  const parsed: unknown = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => {
    if (
      !isRecord(row) ||
      typeof row["localAddress"] !== "string" ||
      typeof row["port"] !== "number" ||
      typeof row["ownerPid"] !== "number"
    ) {
      throw new Error(
        "TEST_ENVIRONMENT: Windows TCP ownership inventory returned an invalid row",
      );
    }
    return {
      localAddress: row["localAddress"],
      port: row["port"],
      ownerPid: row["ownerPid"],
    };
  });
}

function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `TEST_ENVIRONMENT: could not query Windows QA ownership evidence: ${stderr.trim() || error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function sameProcess(
  original: WindowsProcessIdentity,
  candidate: WindowsProcessRecord,
): boolean {
  return (
    original.pid === candidate.pid &&
    original.creationDate === candidate.creationDate
  );
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

async function waitForPortsReleased(
  listeners: readonly OwnedListeningPort[],
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const addresses = listeners.flatMap((listener) =>
    listener.localAddresses.map((address) => ({
      address,
      port: listener.port,
    })),
  );
  let occupied = [...addresses];
  while (Date.now() <= deadline) {
    const states = await Promise.all(
      addresses.map(async ({ address, port }) => ({
        address,
        port,
        free: await isLoopbackPortFree(address, port),
      })),
    );
    occupied = states
      .filter((state) => !state.free)
      .map(({ address, port }) => ({ address, port }));
    if (occupied.length === 0) return;
    await delay(100);
  }
  throw new Error(
    `Packaged QA-owned ports did not release within ${timeoutMs}ms: ${occupied
      .map(({ address, port }) => `${address}:${port}`)
      .join(", ")}`,
  );
}

async function isLoopbackPortFree(
  address: string,
  port: number,
): Promise<boolean> {
  return (
    (await canBindAddressPort(address, port)) &&
    !(await canConnectToAddressPort(address, port))
  );
}

function canBindAddressPort(address: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: address, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function canConnectToPort(port: number): Promise<boolean> {
  return canConnectToAddressPort("127.0.0.1", port);
}

function canConnectToAddressPort(address: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: address, port });
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
    let settled = false;
    const onExit = (
      observedExitCode: number | null,
      observedSignalCode: NodeJS.Signals | null,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: observedExitCode,
        signalCode: observedSignalCode,
      });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      reject(new Error(`Packaged Electron did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("exit", onExit);
    // Close the tiny gap between the initial status check and listener setup.
    if (child.exitCode !== null || child.signalCode !== null) {
      child.off("exit", onExit);
      onExit(child.exitCode, child.signalCode);
    }
  });
}

function failurePage(app: BreadboardElectron | null): Page | null {
  if (!app) return null;
  return (
    app.application
      .windows()
      .find((page) => !page.isClosed() && page.url().startsWith("http")) ??
    app.application.windows().find((page) => !page.isClosed()) ??
    null
  );
}

function delay(milliseconds: number): Promise<void> {
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
