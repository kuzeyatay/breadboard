import * as fs from "node:fs";
import * as path from "node:path";
import type { TestInfo } from "@playwright/test";
import type { Page, Request } from "playwright";
import {
  test,
  expect,
  type ElectronQaHarness,
} from "../../fixtures";
import { isPathInside } from "../../environment";
import type { DiagnosticEntry } from "../../diagnostics";
import {
  locate,
  SELECTORS,
} from "../../selectors";
import type {
  ScenarioAttempt,
  ScenarioDegradationInput,
  ScenarioDefinition,
  ScenarioFailureDecision,
  ScenarioProbeOutcome,
} from "../../scenario-recorder";
import {
  assertAuthenticatedDashboard,
  assertGardenWorkspace,
  closeTerminal,
  createGarden,
  ensureAuthenticatedDashboard,
  gardenCard,
  openGardenWorkspace,
  openTerminal,
  registerAndSignIn,
  reloadAndAssertCoreState,
  uploadDocuments,
  type GardenInfo,
  type UploadedDocument,
} from "../../user-journeys";

const SELECTED_SCENARIO_IDS = [
  "desktop-preload-least-privilege",
  "desktop-startup-welcome-gate",
  "desktop-required-service-readiness",
  "local-account-onboarding",
  "qa-state-isolation",
  "garden-create-rename-return",
  "markdown-upload-ingestion",
  "pdf-upload-ingestion",
  "unsupported-upload-visible-error",
  "upload-background-dismissal",
  "garden-link-ingestion",
  "garden-chat-document-grounding",
  "garden-chat-follow-up-context",
  "conversation-isolation",
  "conversation-history-search-reopen",
  "conversation-branch-independence",
  "chat-cancel-and-recover",
  "chat-empty-submission",
  "skills-catalog-search-detail",
  "skill-install-and-invoke",
  "terminal-command-completion",
  "terminal-cancel-and-reuse",
  "terminal-error-recovery",
  "terminal-refresh-run-state",
  "agent-safe-run-completion",
  "agent-cancel-and-recover",
  "artifact-create-open-content",
  "artifact-refresh-restart-persistence",
  "learn-plan-confirm-build",
  "learn-cancel-and-retry",
  "video-transcription-unavailable-state",
  "desktop-relaunch-durable-state",
  "desktop-renderer-refresh-persistence",
  "desktop-required-service-recovery",
  "windows-paths-with-spaces",
  "packaged-critical-restart-path",
  "desktop-navigation-security",
  "desktop-clean-exit-process-tree",
] as const;

type SelectedScenarioId = (typeof SELECTED_SCENARIO_IDS)[number];

interface InventoryState {
  dashboardAvailable: boolean;
  authenticated: boolean;
  primaryGarden?: GardenInfo;
  uploadedDocuments: readonly UploadedDocument[];
  quartzNavigationObserved: boolean;
  terminalOpen: boolean;
}

interface ProbeContext {
  readonly qa: ElectronQaHarness;
  readonly state: InventoryState;
  readonly definition: ScenarioDefinition;
}

interface ScenarioPlan {
  readonly timeoutMs: number;
  run(context: ProbeContext): Promise<ScenarioProbeOutcome>;
}

const plans: Record<SelectedScenarioId, ScenarioPlan> = {
  "desktop-preload-least-privilege": plan(60_000, probePreloadSecurity),
  "desktop-startup-welcome-gate": plan(6 * 60_000, probeStartupWelcome),
  "desktop-required-service-readiness": plan(90_000, probeServiceReadiness),
  "local-account-onboarding": plan(2 * 60_000, probeLocalOnboarding),
  "qa-state-isolation": plan(90_000, probeStateIsolation),
  "garden-create-rename-return": plan(2 * 60_000, probeGardenRenameReturn),
  "markdown-upload-ingestion": plan(3 * 60_000, probeMarkdownIngestion),
  "desktop-navigation-security": plan(30_000, probeNavigationSecurity),
  "pdf-upload-ingestion": requiredBlock(
    "small QA PDF fixture",
    "No small deterministic PDF fixture is committed to qa/fixtures, so the PDF ingestion path was not exercised.",
  ),
  "unsupported-upload-visible-error": requiredBlock(
    "harmless unsupported-extension fixture",
    "No harmless unsupported-extension fixture is committed; inventing one at runtime would make the evidence non-reproducible.",
  ),
  "upload-background-dismissal": requiredBlock(
    "deterministic ingestion fixture",
    "The committed fixtures finish too quickly to guarantee a background-upload state, so dismissal and continuation cannot be asserted truthfully.",
  ),
  "garden-link-ingestion": requiredBlock(
    "controlled public fixture URL",
    "This run has no controlled public Reader fixture URL or approved outbound-network dependency.",
  ),
  "garden-chat-document-grounding": requiredBlock(
    "configured local model path",
    "ChatMock and Hermes are healthy, but the credential-free critical profile has no configured model capable of completing a grounded turn.",
  ),
  "garden-chat-follow-up-context": requiredBlock(
    "completed grounded Garden Chat turn",
    "A grounded first turn cannot be established without the configured model dependency, so follow-up context was not fabricated.",
  ),
  "conversation-isolation": requiredBlock(
    "configured local model path",
    "Two meaningful model-backed conversations cannot be created in the credential-free critical profile.",
  ),
  "conversation-history-search-reopen": requiredBlock(
    "two persisted Hermes sessions",
    "The run cannot create two completed Hermes sessions without a configured model-backed turn.",
  ),
  "conversation-branch-independence": requiredBlock(
    "completed multi-turn Hermes session",
    "No completed multi-turn session exists to branch in the credential-free critical profile.",
  ),
  "chat-cancel-and-recover": requiredBlock(
    "bounded cancellable QA prompt",
    "No deterministic model execution is configured from which to obtain a real cancellable chat run.",
  ),
  "chat-empty-submission": plan(90_000, probeEmptyChatSubmission),
  "skills-catalog-search-detail": plan(90_000, probeSkillsCatalog),
  "skill-install-and-invoke": requiredBlock(
    "reviewed harmless QA skill",
    "No reviewed public QA skill and immutable catalog revision are supplied for an isolated install-and-invoke workflow.",
  ),
  "terminal-command-completion": plan(60_000, probeTerminalSurface),
  "terminal-cancel-and-reuse": requiredBlock(
    "cancellable QA terminal task",
    "A real cancellable terminal task cannot start without usable model execution and a QA workspace grant.",
  ),
  "terminal-error-recovery": requiredBlock(
    "QA-only workspace grant",
    "The critical profile does not provision a QA-only terminal workspace grant or deterministic failing model task.",
  ),
  "terminal-refresh-run-state": requiredBlock(
    "bounded terminal task",
    "No bounded active terminal task can be created without configured model execution.",
  ),
  "agent-safe-run-completion": plan(60_000, probeAgentsSurface),
  "agent-cancel-and-recover": requiredBlock(
    "configured cancellable harmless agent",
    "Optional agent runtimes are intentionally absent from the critical profile, so no cancellable harmless run can be started.",
  ),
  "artifact-create-open-content": plan(60_000, probeArtifactsSurface),
  "artifact-refresh-restart-persistence": requiredBlock(
    "completed artifact creation",
    "No model-backed artifact can be created first, so refresh and restart persistence cannot be asserted.",
  ),
  "learn-plan-confirm-build": requiredBlock(
    "ChatMock generation",
    "ChatMock is supervised, but it has no credential-free provider capable of producing the required Learn plan and build content.",
  ),
  "learn-cancel-and-retry": requiredBlock(
    "approved Learn plan",
    "No approved generated Learn plan exists from which to start a cancellable Quartz build.",
  ),
  "video-transcription-unavailable-state": plan(
    60_000,
    probeVideoUnavailable,
  ),
  "desktop-relaunch-durable-state": plan(7 * 60_000, probeDurableRelaunch),
  "desktop-renderer-refresh-persistence": plan(
    90_000,
    probeRendererRefresh,
  ),
  "desktop-required-service-recovery": requiredBlock(
    "QA process ownership map",
    "The harness has no ownership map or controlled required-service termination hook, so recovery cannot safely kill a service.",
  ),
  "windows-paths-with-spaces": requiredBlock(
    "spaced disposable QA path",
    "The shared Electron worker was not launched from a deliberately spaced QA runtime root; a second topology launch is outside this inventory run.",
  ),
  "packaged-critical-restart-path": requiredBlock(
    "verified installer path",
    "No verified installer path or scoped APPROVE LOOP ACTION approval was provided for install, restart, rollback, and uninstall.",
  ),
  "desktop-clean-exit-process-tree": plan(90_000, probeCleanExit),
};

const INVENTORY_TIMEOUT_MS = Math.max(
  45 * 60_000,
  Object.values(plans).reduce((total, scenarioPlan) => {
    return total + scenarioPlan.timeoutMs;
  }, 0) + 10 * 60_000,
);

test("manifest-selected actual-Electron exploratory inventory", async ({
  qa,
  scenarios,
}, testInfo) => {
  testInfo.setTimeout(INVENTORY_TIMEOUT_MS);
  expect(SELECTED_SCENARIO_IDS.length).toBeGreaterThanOrEqual(25);
  expect(new Set(SELECTED_SCENARIO_IDS).size).toBe(
    SELECTED_SCENARIO_IDS.length,
  );

  const manifestIds = new Set(
    scenarios.allDefinitions().map((definition) => definition.id),
  );
  for (const id of SELECTED_SCENARIO_IDS) expect(manifestIds.has(id)).toBe(true);

  const state: InventoryState = {
    dashboardAvailable: false,
    authenticated: false,
    uploadedDocuments: [],
    quartzNavigationObserved: false,
    terminalOpen: false,
  };

  let inventoryStopReason: string | undefined;
  for (const id of SELECTED_SCENARIO_IDS) {
    if (inventoryStopReason) {
      const attempt = scenarios.notRun(id, inventoryStopReason, [qa.resultsDir]);
      annotateAttempt(testInfo, attempt);
      continue;
    }
    const definition = scenarios.definition(id);
    const scenarioPlan = plans[id];
    const diagnosticSequence = qa.diagnostics.entries.at(-1)?.sequence ?? 0;
    const attempt = await scenarios.probe(
      testInfo,
      id,
      () => scenarioPlan.run({ qa, state, definition }),
      {
        timeoutMs: scenarioPlan.timeoutMs,
        failureEvidence: [qa.resultsDir, qa.diagnostics.eventLogPath],
        classifyFailure: (error) => ({
          ...classifyProbeFailure(
            error,
            qa.diagnostics.entries.filter(
              (entry) => entry.sequence > diagnosticSequence,
            ),
          ),
          actual: qa.diagnostics.redactor.redactText(
            error instanceof Error ? error.message : String(error),
          ),
        }),
      },
    );
    annotateAttempt(testInfo, attempt);
    if (
      !definition.blockerPolicy.continueInventory &&
      (attempt.status === "FAIL" || attempt.status === "BLOCKED")
    ) {
      inventoryStopReason =
        `NOT_RUN because ${id} ended ${attempt.status} and its manifest ` +
        "blocker policy sets continueInventory=false.";
    }
  }

  await testInfo.attach("autonomous-scenario-results", {
    path: scenarios.outputPath,
    contentType: "application/json",
  });

  const failures = scenarios
    .list()
    .filter((attempt) => attempt.status === "FAIL");
  if (failures.length > 0) qa.markFailed();
  expect(
    failures.map((attempt) => `${attempt.id}: ${attempt.actual}`),
    "Exploratory probes recorded unexpected FAIL results (see each receipt classification); BLOCKED and NOT_RUN remain truthful non-passes in the attached inventory.",
  ).toEqual([]);
});

function plan(
  timeoutMs: number,
  run: ScenarioPlan["run"],
): ScenarioPlan {
  return { timeoutMs, run };
}

function requiredBlock(
  requirement: string,
  reason: string,
): ScenarioPlan {
  return plan(1_000, async ({ definition }) => {
    assertRequiredDependency(definition, requirement);
    return blocked(reason);
  });
}

function assertRequiredDependency(
  definition: ScenarioDefinition,
  requirement: string,
): void {
  expect(
    definition.dependencies.required,
    `${definition.id} manifest dependencies changed; update its truthful blocker instead of silently retaining stale taxonomy.`,
  ).toContain(requirement);
}

function passed(
  actual: string,
  evidence: readonly string[] = [],
  optionalDegradations: readonly ScenarioDegradationInput[] = [],
): ScenarioProbeOutcome {
  return { status: "PASS", actual, evidence, optionalDegradations };
}

function blocked(
  reason: string,
  evidence: readonly string[] = [],
): ScenarioProbeOutcome {
  return {
    status: "BLOCKED",
    dependency: "required",
    reason,
    evidence,
  };
}

function annotateAttempt(
  testInfo: TestInfo,
  attempt: ScenarioAttempt,
): void {
  testInfo.annotations.push({
    type: `scenario-${attempt.status.toLowerCase()}`,
    description: `${attempt.id}: ${attempt.actual}`,
  });
}

function classifyProbeFailure(
  error: unknown,
  diagnostics: readonly DiagnosticEntry[],
): ScenarioFailureDecision {
  const productEvents = new Set([
    "renderer-crash",
    "page-error",
    "unhandled-rejection",
    "uncaught-exception",
    "main-process-error",
  ]);
  if (
    diagnostics.some(
      (entry) => entry.actionable !== false && productEvents.has(entry.event),
    )
  ) {
    return { classification: "PRODUCT_BUG" };
  }

  const environmentEvidence = diagnostics.some((entry) => {
    if (entry.event === "service-startup-failure") return true;
    if (
      entry.data &&
      typeof entry.data === "object" &&
      !Array.isArray(entry.data)
    ) {
      return entry.data["category"] === "port-conflict";
    }
    return false;
  });
  const message = error instanceof Error ? error.message : String(error);
  if (
    environmentEvidence ||
    /(?:EADDRINUSE|ECONNREFUSED|ENOENT|runtime endpoints? omit|QA runtime marker|service readiness file|manifest dependencies changed|does not declare optional dependency)/i.test(
      message,
    )
  ) {
    return { classification: "TEST_ENVIRONMENT" };
  }

  // Assertion failures and renderer-visible timeouts default to product
  // failures unless the run captured concrete environment evidence above.
  return { classification: "PRODUCT_BUG" };
}

async function probePreloadSecurity({
  qa,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  const startupPage = qa.app.startupPage;
  await startupPage.waitForLoadState("domcontentloaded");
  expect(startupPage.url()).toMatch(/^file:/);

  const bridge = await startupPage.evaluate(async () => {
    type DesktopBridge = {
      getVersions(): Promise<{ app: string; electron: string }>;
      getStartupState(): Promise<unknown>;
    };
    const scope = globalThis as typeof globalThis & {
      breadboardDesktop?: DesktopBridge & Record<string, unknown>;
      process?: unknown;
      require?: unknown;
    };
    const desktop = scope.breadboardDesktop;
    const startupState = desktop ? await desktop.getStartupState() : null;
    return {
      apiKeys: desktop ? Object.keys(desktop).sort() : [],
      processType: typeof scope.process,
      requireType: typeof scope.require,
      versions: desktop ? await desktop.getVersions() : null,
      startupStateType: startupState === null ? "null" : typeof startupState,
    };
  });

  expect(bridge.apiKeys).toEqual([
    "allowThemeLocation",
    "awaitDashboardReady",
    "continueToDashboard",
    "copyDiagnostics",
    "getStartupState",
    "getVersions",
    "onStartupState",
    "openLogsFolder",
    "openMicrophoneSettings",
    "pickFolder",
    "quit",
    "retryService",
    "setTheme",
  ]);
  expect(
    bridge.apiKeys.some((key) =>
      /(?:secret|token|password|credential|filesystem|command)/i.test(key),
    ),
  ).toBe(false);
  expect(bridge.processType).toBe("undefined");
  expect(bridge.requireType).toBe("undefined");
  expect(bridge.versions?.app).toEqual(expect.any(String));
  expect(bridge.versions?.electron).toEqual(expect.any(String));
  expect(bridge.startupStateType).toBe("object");

  const security = await qa.app.securitySnapshot();
  expect(path.resolve(security.userData)).toBe(
    path.resolve(qa.run.paths.userDataDir),
  );
  expect(path.resolve(security.downloads)).toBe(
    path.resolve(qa.run.paths.downloadsDir),
  );
  expect(security.windows.length).toBeGreaterThan(0);
  for (const window of security.windows) {
    expect(window.sandbox).toBe(true);
    expect(window.contextIsolation).toBe(true);
    expect(window.nodeIntegration).toBe(false);
    expect(window.webviewTag).toBe(false);
  }
  return passed(
    "The documented preload bridge was callable, Node globals were absent, and every Electron window retained hardened webPreferences.",
    [qa.diagnostics.eventLogPath],
  );
}

async function probeStartupWelcome({
  qa,
  state,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  const startupPage = qa.app.startupPage;
  await expect(startupPage.locator("body")).not.toBeEmpty();
  await expect(startupPage.locator("#failure:not([hidden])")).toHaveCount(0);
  await expect(locate(startupPage, SELECTORS.startup.continue)).toBeVisible({
    timeout: 6 * 60_000,
  });
  const startupState = await startupPage.evaluate(async () => {
    const desktop = (
      globalThis as typeof globalThis & {
        breadboardDesktop?: {
          getStartupState(): Promise<{
            phase: string;
            services: Array<{
              id: string;
              required: boolean;
              state: string;
              lastError: string | null;
            }>;
          }>;
        };
      }
    ).breadboardDesktop;
    return desktop?.getStartupState() ?? null;
  });
  expect(startupState?.phase).toBe("ready");
  const requiredServices =
    startupState?.services.filter((service) => service.required) ?? [];
  expect(requiredServices.length).toBeGreaterThanOrEqual(3);
  expect(
    requiredServices.every(
      (service) => service.state === "healthy" && service.lastError === null,
    ),
  ).toBe(true);

  const dashboard = await qa.dismissWelcome();
  await expect(locate(dashboard, SELECTORS.auth.signInHeading)).toBeVisible({
    timeout: 60_000,
  });
  expect(new URL(dashboard.url()).pathname).toBe("/auth/login");
  state.dashboardAvailable = true;
  qa.diagnostics.assertNoFatal("exploratory cold startup");
  return passed(
    "The welcome action appeared only with every required supervisor service healthy, then handed off to a distinct, interactable loopback dashboard window without a fatal diagnostic.",
    [qa.diagnostics.eventLogPath],
  );
}

async function probeServiceReadiness({
  qa,
  state,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  if (!state.dashboardAvailable) {
    return blocked("The startup probe did not establish an active dashboard page.");
  }
  const endpoints = qa.readEndpoints();
  expect(endpoints.pid).toBe(await qa.mainProcessPid());

  const dashboard = requiredUrl(endpoints.urls, "dashboard");
  const chatmock = new URL("/health", requiredUrl(endpoints.urls, "chatmock"));
  const quartz = requiredUrl(endpoints.urls, "quartz");
  for (const url of [dashboard, chatmock.toString(), quartz]) {
    const response = await qa.page.request.get(url, { timeout: 20_000 });
    expect(response.status(), `${url} readiness status`).toBeGreaterThanOrEqual(200);
    expect(response.status(), `${url} readiness status`).toBeLessThan(400);
  }
  expect(endpoints.urls["gbrain"]).toBeUndefined();
  expect(endpoints.urls["uiTars"]).toBeUndefined();
  expect(qa.run.env["GBRAIN_MODE"]).toBe("disabled");
  expect(qa.run.env["UI_TARS_MODE"]).toBe("disabled");
  expect(qa.run.env["CAD_MODE"]).toBe("disabled");
  expect(qa.run.env["VIDEO_TRANSCRIPTION_ENABLED"]).toBe("false");
  await expect(locate(qa.page, SELECTORS.auth.signInHeading)).toBeVisible();
  qa.diagnostics.assertNoFatal("required service readiness");
  return passed(
    "Dashboard, ChatMock, and Quartz answered their meaningful loopback probes after the supervisor welcome gate; disabled optional services did not block login.",
    [qa.diagnostics.eventLogPath],
    [
      {
        dependencies: ["GBrain", "UI-TARS", "CAD", "Scriberr"],
        disposition: "MISSING",
        reason:
          "The credential-free critical profile intentionally disables optional model, browser-control, CAD, and transcription services.",
      },
    ],
  );
}

async function probeLocalOnboarding({
  qa,
  state,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  if (!state.dashboardAvailable) {
    return blocked("The dashboard is unavailable, so local registration cannot start.");
  }
  await registerAndSignIn(qa.page, qa.run.bootstrap.auth);
  await qa.page.reload({ waitUntil: "domcontentloaded" });
  await assertAuthenticatedDashboard(qa.page);
  state.authenticated = true;
  return passed(
    "The QA-only invite registered one local account, credentials login reached Gardens, and the session survived renderer refresh.",
    [qa.diagnostics.eventLogPath],
  );
}

async function probeStateIsolation({
  qa,
  state,
  definition,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  assertRequiredDependency(definition, "runtime path diagnostics");
  if (!state.authenticated) {
    return blocked("The disposable local account prerequisite was not established.");
  }
  const mutablePaths = [
    qa.run.paths.userDataDir,
    qa.run.paths.dataDir,
    qa.run.paths.homeDir,
    qa.run.paths.appDataDir,
    qa.run.paths.localAppDataDir,
    qa.run.paths.tempDir,
    qa.run.paths.downloadsDir,
    qa.run.paths.artifactsDir,
    qa.run.paths.diagnosticsDir,
    qa.run.paths.serviceLogsDir,
  ];
  for (const candidate of mutablePaths) {
    expect(isPathInside(qa.run.paths.runRoot, candidate)).toBe(true);
  }
  for (const key of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "CODEX_HOME",
    "HERMES_HOME",
  ]) {
    const candidate = qa.run.env[key];
    expect(candidate, `${key} must be explicitly isolated`).toEqual(
      expect.any(String),
    );
    expect(isPathInside(qa.run.paths.runRoot, candidate ?? "")).toBe(true);
  }
  expect(fs.existsSync(qa.run.paths.markerFile)).toBe(true);
  expect(isPathInside(qa.run.paths.repoRoot, qa.run.paths.runRoot)).toBe(false);

  const productStores = {
    dashboardDatabase: path.join(qa.run.paths.dataDir, "database"),
    quartzWorkspace: path.join(qa.run.paths.dataDir, "quartz"),
    quartzContent: path.join(qa.run.paths.dataDir, "quartz", "content"),
    hermesWorkspaces: path.join(
      qa.run.paths.dataDir,
      "runtime",
      "hermes-workspaces",
    ),
    hermesHome: path.join(qa.run.paths.dataDir, "runtime", "hermes"),
    hermesManaged: qa.run.paths.hermesManagedDir,
    hermesFiles: qa.run.paths.hermesFilesDir,
    comfyUiRuntime: qa.run.paths.comfyUiRuntimeDir,
    comfyUiEnvironment: qa.run.paths.comfyUiEnvDir,
    optionalIntegrationSources: qa.run.paths.optionalSourcesDir,
    optionalIntegrationState: qa.run.paths.optionalStateDir,
    codexHome: path.join(qa.run.paths.dataDir, "runtime", "codex"),
    skillsQuarantine: path.join(
      qa.run.paths.dataDir,
      "skills",
      "quarantine",
    ),
    skillsApproved: path.join(qa.run.paths.dataDir, "skills", "approved"),
    skillsConditional: path.join(
      qa.run.paths.dataDir,
      "skills",
      "conditional",
    ),
    serviceLogs: path.join(qa.run.paths.dataDir, "logs"),
    runtime: path.join(qa.run.paths.dataDir, "runtime"),
    config: path.join(qa.run.paths.dataDir, "config"),
    backups: path.join(qa.run.paths.dataDir, "backups"),
    productTemp: path.join(qa.run.paths.dataDir, "temp"),
    dashboardWorkspace: path.join(
      qa.run.paths.dataDir,
      "dashboard-workspace",
    ),
    chatmockCouncilLedger: qa.run.paths.councilLedgerDir,
    qaArtifacts: qa.run.paths.artifactsDir,
    xdgCache: qa.run.env["XDG_CACHE_HOME"] ?? "",
  };
  for (const [name, candidate] of Object.entries(productStores)) {
    expect(candidate, `${name} path must be absolute`).toEqual(
      path.resolve(candidate),
    );
    expect(isPathInside(qa.run.paths.runRoot, candidate), name).toBe(true);
    if (name !== "xdgCache") {
      expect(
        fs.existsSync(candidate),
        `${name} should exist after readiness`,
      ).toBe(true);
    }
  }

  const mainProcessPaths = await qa.app.application.evaluate(({ app }) => ({
    userData: app.getPath("userData"),
    downloads: app.getPath("downloads"),
    home: process.env["HOME"],
    userProfile: process.env["USERPROFILE"],
    dataDir: process.env["BREADBOARD_DATA_DIR"],
    qaMode: process.env["BREADBOARD_QA_MODE"],
    developmentDashboardDir:
      process.env["BREADBOARD_DEVELOPMENT_DASHBOARD_DIR"],
    codexHome: process.env["CODEX_HOME"],
    hermesHome: process.env["HERMES_HOME"],
    xdgCache: process.env["XDG_CACHE_HOME"],
  }));
  expect(path.resolve(mainProcessPaths.userData)).toBe(
    path.resolve(qa.run.paths.userDataDir),
  );
  expect(path.resolve(mainProcessPaths.downloads)).toBe(
    path.resolve(qa.run.paths.downloadsDir),
  );
  expect(mainProcessPaths.qaMode).toBe("1");
  expect(path.resolve(mainProcessPaths.dataDir ?? "")).toBe(
    path.resolve(qa.run.paths.dataDir),
  );
  expect(mainProcessPaths.developmentDashboardDir ?? "").toBe("");
  for (const candidate of [
    mainProcessPaths.home,
    mainProcessPaths.userProfile,
    mainProcessPaths.codexHome,
    mainProcessPaths.hermesHome,
    mainProcessPaths.xdgCache,
  ]) {
    expect(candidate).toEqual(expect.any(String));
    expect(isPathInside(qa.run.paths.runRoot, candidate ?? "")).toBe(true);
  }

  const security = await qa.app.securitySnapshot();
  expect(path.resolve(security.userData)).toBe(
    path.resolve(qa.run.paths.userDataDir),
  );
  state.primaryGarden = await createGarden(qa.page, {
    name: `Exploratory QA ${qa.run.runId.slice(-8)}`,
    description: "Disposable actual-Electron exploratory state.",
  });
  await assertAuthenticatedDashboard(qa.page, state.primaryGarden);
  const databaseFiles = fs
    .readdirSync(productStores.dashboardDatabase)
    .filter((entry) => entry.endsWith(".db"));
  expect(databaseFiles.length).toBeGreaterThan(0);

  const diagnostics = JSON.stringify(qa.diagnostics.entries);
  for (const secret of Object.values(qa.run.bootstrap.auth)) {
    expect(diagnostics).not.toContain(secret);
  }
  const isolationEvidence = path.join(
    qa.resultsDir,
    "qa-state-isolation.json",
  );
  fs.writeFileSync(
    isolationEvidence,
    `${JSON.stringify(
      {
        runRoot: qa.run.paths.runRoot,
        markerFile: qa.run.paths.markerFile,
        mainProcessPaths,
        productStores: Object.fromEntries(
          Object.entries(productStores).map(([name, candidate]) => [
            name,
            {
              path: candidate,
              insideRunRoot: isPathInside(qa.run.paths.runRoot, candidate),
              exists: fs.existsSync(candidate),
            },
          ]),
        ),
        databaseFiles,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return passed(
    "Main-process runtime diagnostics and physical product stores placed database/conversation, Quartz, tool, skill, cache, agent, log, config, temp, and evidence state below the marker-verified run root; a uniquely named garden was persisted there and diagnostics contained no bootstrap secret.",
    [
      qa.run.paths.markerFile,
      isolationEvidence,
      qa.diagnostics.eventLogPath,
    ],
  );
}

async function probeGardenRenameReturn({
  qa,
  state,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  const garden = state.primaryGarden;
  if (!state.authenticated || !garden) {
    return blocked("The isolated QA garden prerequisite was not established.");
  }
  await goToDashboard(qa.page);
  await assertAuthenticatedDashboard(qa.page, garden);

  const renamed = `${garden.name} Renamed`;
  const description = "Renamed through the semantic exploratory garden controls.";
  await gardenCard(qa.page, garden.name)
    .getByRole("button", { name: "Edit garden", exact: true })
    .click();
  const modal = qa.page.getByRole("dialog", {
    name: "Edit garden",
    exact: true,
  });
  await expect(modal).toBeVisible();
  try {
    await modal.getByLabel("Name", { exact: true }).fill(renamed);
    await modal.getByLabel("Description", { exact: true }).fill(description);
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(modal).toBeHidden();
  } catch (error) {
    // Keep one failed semantic edit from covering every later inventory item
    // with the same modal backdrop. Cleanup itself remains asserted so a
    // genuinely stuck dialog still escapes as a failure.
    if (await modal.isVisible()) {
      await modal.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(modal).toBeHidden();
    }
    throw error;
  }
  await expect(gardenCard(qa.page, garden.name)).toHaveCount(0);
  await expect(gardenCard(qa.page, renamed)).toBeVisible();
  await expect(
    gardenCard(qa.page, renamed).getByText(description, { exact: true }),
  ).toBeVisible();

  state.primaryGarden = { ...garden, name: renamed, description };
  await openGardenWorkspace(qa.page, state.primaryGarden);
  await assertGardenWorkspace(qa.page, state.primaryGarden);
  await Promise.all([
    // This is a physical user click, but the copied Next workspace may need
    // to compile /dashboard on first return. Wait for the route commit with
    // the same explicit cold-route budget used by goToDashboard, then let the
    // semantic dashboard assertions below prove readiness.
    qa.page.waitForURL((url) => url.pathname === "/dashboard", {
      waitUntil: "commit",
      timeout: 2 * 60_000,
    }),
    qa.page
      .getByRole("link", { name: "Back to dashboard", exact: true })
      .click(),
  ]);
  await assertAuthenticatedDashboard(qa.page, state.primaryGarden);
  await openGardenWorkspace(qa.page, state.primaryGarden);
  await assertGardenWorkspace(qa.page, state.primaryGarden);
  return passed(
    "The garden was renamed once, its description updated, and navigating away and back reopened the same durable workspace under the new name.",
    [qa.diagnostics.eventLogPath],
  );
}

async function probeMarkdownIngestion({
  qa,
  state,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  const garden = state.primaryGarden;
  if (!garden) return blocked("The garden prerequisite was not established.");
  await openGardenWorkspace(qa.page, garden);
  const fixture = path.join(
    qa.run.paths.repoRoot,
    "qa",
    "fixtures",
    "firefly-brief.md",
  );
  expect(fs.existsSync(fixture)).toBe(true);
  state.uploadedDocuments = await uploadDocuments(qa.page, [fixture]);
  await assertGardenWorkspace(
    qa.page,
    garden,
    state.uploadedDocuments.map((document) => document.displayedTitle),
  );

  const title = state.uploadedDocuments[0]?.displayedTitle ?? "firefly-brief";
  await Promise.all([
    qa.page.waitForURL((url) => url.pathname === `/garden/${garden.slug}`, {
      timeout: 60_000,
    }),
    qa.page.getByRole("link", { name: title, exact: true }).click(),
  ]);
  await expect(
    qa.page.frameLocator("iframe").getByText("FIREFLY-COPPER-17", {
      exact: false,
    }).first(),
  ).toBeVisible({ timeout: 60_000 });
  state.quartzNavigationObserved = true;
  await Promise.all([
    qa.page.waitForURL(
      (url) => url.pathname === new URL(garden.workspaceHref, url).pathname,
      { timeout: 60_000 },
    ),
    qa.page.getByRole("link", { name: /Back to garden/ }).click(),
  ]);
  await assertGardenWorkspace(qa.page, garden, [title]);
  qa.diagnostics.assertNoFatal("exploratory Markdown ingestion");
  return passed(
    "The real Add documents flow completed and the loopback Quartz reader rendered the deterministic Markdown fact.",
    [fixture, qa.diagnostics.eventLogPath],
    [
      {
        dependencies: ["GBrain indexing"],
        disposition: "MISSING",
        reason:
          "GBrain is intentionally disabled, so the probe validates built-in ingestion and Quartz rendering without semantic indexing assertions.",
      },
    ],
  );
}

async function probeNavigationSecurity({
  qa,
  state,
  definition,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  assertRequiredDependency(definition, "Electron QA external-open interceptor");
  expect(state.quartzNavigationObserved).toBe(true);
  const before = await qa.app.securitySnapshot();
  const currentUrl = qa.page.url();
  const target = `https://example.invalid/breadboard-qa-${qa.run.runId.slice(-8)}`;
  const linkName = "Open external QA destination";
  await qa.page.evaluate(
    ({ href, name }) => {
      document.getElementById("breadboard-qa-external-link")?.remove();
      const link = document.createElement("a");
      link.id = "breadboard-qa-external-link";
      link.href = href;
      link.textContent = name;
      link.style.position = "fixed";
      link.style.left = "16px";
      link.style.bottom = "64px";
      link.style.zIndex = "2147483647";
      document.body.appendChild(link);
    },
    { href: target, name: linkName },
  );
  await qa.page.getByRole("link", { name: linkName, exact: true }).click({
    noWaitAfter: true,
  });
  await expect
    .poll(async () => qa.app.externalOpenAttempts(), { timeout: 15_000 })
    .toContain(target);
  expect(qa.page.url()).toBe(currentUrl);
  const after = await qa.app.securitySnapshot();
  expect(after.windows).toHaveLength(before.windows.length);
  for (const window of after.windows) {
    expect(window.sandbox).toBe(true);
    expect(window.contextIsolation).toBe(true);
    expect(window.nodeIntegration).toBe(false);
    expect(window.webviewTag).toBe(false);
  }
  await qa.page.evaluate(() => {
    document.getElementById("breadboard-qa-external-link")?.remove();
  });
  return passed(
    "Configured loopback navigation remained usable; a semantic untrusted HTTPS link was prevented from replacing the renderer, delegated once through the intercepted external-open path, and created no privileged window.",
    [qa.diagnostics.eventLogPath],
  );
}

async function probeEmptyChatSubmission({
  qa,
  state,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  const garden = state.primaryGarden;
  if (!garden) return blocked("The garden chat prerequisite was not established.");
  await openGardenWorkspace(qa.page, garden);
  const composer = qa.page.getByPlaceholder(/Ask about your documents/);
  const send = qa.page.getByRole("button", { name: "Send", exact: true });
  await expect(composer).toBeVisible();
  await composer.fill("");
  await expect(send).toBeDisabled();

  const chatRequests: string[] = [];
  const pageOrigin = new URL(qa.page.url()).origin;
  const onRequest = (request: Request): void => {
    const url = new URL(request.url());
    if (
      url.origin === pageOrigin &&
      request.method() === "POST" &&
      url.pathname === "/api/chat"
    ) {
      chatRequests.push(`${request.method()} ${url.pathname}`);
    }
  };
  qa.page.on("request", onRequest);
  try {
    await composer.press("Enter");
    await settleRendererFrames(qa.page);
    expect(chatRequests).toEqual([]);
    await expect(send).toBeDisabled();

    const validMessage = `Bounded QA recovery ${qa.run.runId.slice(-8)}`;
    await composer.fill(validMessage);
    await expect(send).toBeEnabled();
    await send.click();
    await expect
      .poll(() => chatRequests.length, {
        message: "one valid submission should create one /api/chat request",
        timeout: 10_000,
      })
      .toBe(1);
    await expect(
      qa.page.getByText(validMessage, { exact: true }).last(),
    ).toBeVisible({ timeout: 15_000 });

    const stop = qa.page.getByRole("button", { name: /^Stop(?: generating)?$/i });
    try {
      await expect(stop).toBeHidden({ timeout: 25_000 });
    } catch {
      if (await stop.isVisible()) await stop.click();
      await expect(stop).toBeHidden({ timeout: 10_000 });
    }
    await expect(composer).toBeEnabled({ timeout: 10_000 });
    await expect(composer).toHaveValue("");
  } finally {
    qa.page.off("request", onRequest);
  }
  qa.diagnostics.assertNoFatal("empty chat submission recovery");
  return passed(
    "Enter on an empty composer created no /api/chat request; one valid follow-up created exactly one request and visible user turn, then restored the composer.",
    [qa.diagnostics.eventLogPath],
  );
}

async function probeSkillsCatalog({
  qa,
  state,
  definition,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  assertRequiredDependency(definition, "local cached skills catalog");
  const garden = state.primaryGarden;
  if (!garden) return blocked("The garden chat surface prerequisite is absent.");
  await openGardenWorkspace(qa.page, garden);
  await locate(qa.page, SELECTORS.capabilities.open).click();
  await locate(qa.page, SELECTORS.capabilities.skills).click();
  await expect(locate(qa.page, SELECTORS.capabilities.skillsCatalog)).toBeVisible();

  await locate(qa.page, SELECTORS.capabilities.filterSkills).click();
  const filterMenu = qa.page.getByRole("menu", { name: "Filter skills", exact: true });
  await expect(filterMenu).toBeVisible();
  await filterMenu
    .getByRole("menuitemradio", { name: "Prebuilt", exact: true })
    .click();
  const search = locate(qa.page, SELECTORS.capabilities.searchSkills);
  const catalogResponse = qa.page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/hermes/skills" &&
        url.searchParams.get("filter") === "prebuilt" &&
        url.searchParams.get("q") === "plan"
      );
    },
    { timeout: 30_000 },
  );
  await search.fill("plan");
  const response = await catalogResponse;

  const list = locate(qa.page, SELECTORS.capabilities.publicSkills);
  const loading = qa.page.getByText("Loading skills…", { exact: true });
  await expect(loading).toBeHidden({ timeout: 30_000 });
  if (!response.ok() || !(await list.isVisible())) {
    await locate(qa.page, SELECTORS.capabilities.close).last().click();
    return blocked(
      "The Skills surface opened, but the required local cached catalog supplied no searchable Prebuilt inventory; no external result was substituted as a pass.",
      [qa.diagnostics.eventLogPath],
    );
  }
  const matching = list.getByRole("option").filter({ hasText: /plan/i }).first();
  if (!(await matching.isVisible())) {
    await locate(qa.page, SELECTORS.capabilities.close).last().click();
    return blocked(
      "The cached catalog was present, but it supplied no stable Prebuilt plan skill for the deterministic detail probe.",
      [qa.diagnostics.eventLogPath],
    );
  }
  await matching.getByRole("button").first().click();

  const details = qa.page.getByRole("region", { name: /details$/ });
  await expect(details).toBeVisible();
  await expect(details.getByRole("heading").first()).not.toBeEmpty();
  await expect(details.getByText("Built into Breadboard", { exact: true })).toBeVisible();
  await locate(details, SELECTORS.capabilities.backToSkills).click();
  await expect(locate(qa.page, SELECTORS.capabilities.skillsCatalog)).toBeVisible();
  // Escape is the product's supported keyboard close path. It avoids racing
  // the two identically named close controls while the catalog swaps its
  // detail view back to the list.
  await qa.page.keyboard.press("Escape");
  await expect(
    qa.page.getByRole("dialog", { name: "Use a capability", exact: true }),
  ).toBeHidden();
  await expect(qa.page.getByPlaceholder(/Ask about your documents/)).toBeVisible();
  return passed(
    "The local Prebuilt skills catalog opened, filtered and searched to a stable plan skill, exposed its Breadboard provenance, and closed back to an intact chat.",
    [qa.diagnostics.eventLogPath],
    [
      {
        dependencies: ["live skills catalog endpoint"],
        disposition: "UNEXERCISED",
        reason:
          "The isolated run used only the required cached Prebuilt catalog and deliberately made no outbound live-catalog request or availability claim.",
      },
    ],
  );
}

async function probeTerminalSurface({
  qa,
  state,
  definition,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  assertRequiredDependency(definition, "QA-only workspace grant");
  if (!state.authenticated || !state.dashboardAvailable) {
    return blocked("The authenticated dashboard prerequisite was not established.");
  }
  return blockedAfterSupportingInspection(
    "No QA-only workspace grant or credential-free model execution is provisioned for a truthful completed command; terminal UI checks are supporting evidence only.",
    [qa.diagnostics.eventLogPath],
    async () => {
      await goToDashboard(qa.page);
      await openTerminal(qa.page);
      state.terminalOpen = true;
      const actions = await ensureTerminalActions(qa.page);
      for (const name of [
        "New chat",
        "Artifacts",
        "Uploads",
        "Search",
        "Scheduled",
        "Hooks",
        "Processes",
      ]) {
        await expect(
          actions.getByRole("button", { name, exact: true }),
        ).toBeVisible();
      }
    },
  );
}

async function probeAgentsSurface({
  qa,
  state,
  definition,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  assertRequiredDependency(definition, "one configured harmless agent runtime");
  if (!state.terminalOpen) {
    return blocked("The terminal surface prerequisite did not complete.");
  }
  return blockedAfterSupportingInspection(
    "The critical profile intentionally supplies no configured harmless agent runtime, so no run can be reported as completed; catalog checks are supporting evidence only.",
    [qa.diagnostics.eventLogPath],
    async () => {
      const actions = await ensureTerminalActions(qa.page);
      await actions.getByRole("button", { name: "New chat", exact: true }).click();
      await expect(locate(qa.page, SELECTORS.capabilities.open)).toBeVisible();
      await locate(qa.page, SELECTORS.capabilities.open).click();
      await locate(qa.page, SELECTORS.capabilities.agents).click();
      const search = locate(qa.page, SELECTORS.capabilities.searchAgents);
      const list = locate(qa.page, SELECTORS.capabilities.agentsList);
      await expect(search).toBeVisible();
      await expect(list).toBeVisible();
      await search.fill("agent");
      await settleRendererFrames(qa.page);
      await expect(list).toBeVisible();
      await search.fill("");
      await locate(qa.page, SELECTORS.capabilities.close).last().click();
    },
  );
}

async function probeArtifactsSurface({
  qa,
  state,
  definition,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  assertRequiredDependency(definition, "configured local model path");
  if (!state.terminalOpen) {
    return blocked("The terminal surface prerequisite did not complete.");
  }
  return blockedAfterSupportingInspection(
    "Artifact creation requires the absent configured model path, so an empty panel cannot be treated as a creation pass; panel checks are supporting evidence only.",
    [qa.diagnostics.eventLogPath],
    async () => {
      const actions = await ensureTerminalActions(qa.page);
      await actions.getByRole("button", { name: "Artifacts", exact: true }).click();
      const panel = locate(qa.page, SELECTORS.artifacts.panel);
      await expect(panel).toBeVisible();
      const search = locate(panel, SELECTORS.artifacts.search);
      await expect(search).toBeVisible();
      await search.fill("qa-owned-artifact");
      await search.fill("");
    },
  );
}

async function probeVideoUnavailable({
  qa,
  state,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  const garden = state.primaryGarden;
  if (!garden) return blocked("The garden prerequisite was not established.");
  if (state.terminalOpen) {
    await closeTerminal(qa.page);
    state.terminalOpen = false;
  }
  await openGardenWorkspace(qa.page, garden);
  const videos = locate(qa.page, SELECTORS.workspace.videos);
  if ((await videos.getAttribute("aria-expanded")) !== "true") await videos.click();
  const panel = qa.page.locator("#garden-videos-panel");
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText(
      /Video transcription is disabled|Scriberr is not reachable/i,
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(locate(panel, SELECTORS.workspace.videoFile)).toBeAttached();
  await expect(locate(panel, SELECTORS.workspace.videoFile)).toBeEnabled();
  await expect(locate(panel, SELECTORS.workspace.transcribeVideo)).toBeDisabled();
  await expect(panel.getByText("No videos yet.", { exact: true })).toBeVisible();
  const panelText = (await panel.innerText()).toLowerCase();
  expect(panelText).not.toContain(qa.run.paths.runRoot.toLowerCase());
  expect(panelText).not.toContain(qa.run.bootstrap.auth.password.toLowerCase());
  await videos.click();
  await expect(panel).toBeHidden();
  await expect(qa.page.getByPlaceholder(/Ask about your documents/)).toBeEnabled();
  return passed(
    "The garden reported disabled or unreachable local transcription dependencies, exposed no secret configuration, started no false job, and remained usable after the panel closed.",
    [qa.diagnostics.eventLogPath],
  );
}

async function probeDurableRelaunch({
  qa,
  state,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  const garden = state.primaryGarden;
  if (!garden) return blocked("No durable garden exists to verify after relaunch.");
  const firstEndpoints = qa.readEndpoints();
  const expectedUserData = path.resolve(qa.run.paths.userDataDir);
  const oldDiagnostic = qa.diagnostics.eventLogPath;
  state.dashboardAvailable = false;
  state.authenticated = false;
  state.terminalOpen = false;
  const receipt = await qa.restart();
  expect(receipt.endpoints.pid).toBe(firstEndpoints.pid);
  expect(receipt.exitCode).toBe(0);
  expect(receipt.signalCode).toBeNull();
  expect(receipt.releasedPorts.length).toBeGreaterThanOrEqual(3);

  await expect(locate(qa.app.startupPage, SELECTORS.startup.continue)).toBeVisible({
    timeout: 6 * 60_000,
  });
  const page = await qa.dismissWelcome();
  await ensureAuthenticatedDashboard(page, qa.run.bootstrap.auth);
  await assertAuthenticatedDashboard(page, garden);
  const secondEndpoints = qa.readEndpoints();
  expect(secondEndpoints.pid).not.toBe(firstEndpoints.pid);
  const security = await qa.app.securitySnapshot();
  expect(path.resolve(security.userData)).toBe(expectedUserData);
  await openGardenWorkspace(page, garden);
  await assertGardenWorkspace(
    page,
    garden,
    state.uploadedDocuments.map((document) => document.displayedTitle),
  );
  state.dashboardAvailable = true;
  state.authenticated = true;
  state.terminalOpen = false;
  qa.diagnostics.assertNoFatal("exploratory durable relaunch");
  return passed(
    "The first process and owned ports exited before a fresh Electron launch reused the isolated profile and reopened the same account, garden, and uploaded source.",
    [oldDiagnostic, qa.diagnostics.eventLogPath],
  );
}

async function probeRendererRefresh({
  qa,
  state,
  definition,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  assertRequiredDependency(definition, "completed QA conversation");
  const garden = state.primaryGarden;
  if (!garden || !state.authenticated || !state.dashboardAvailable) {
    return blocked("No active durable garden exists for renderer refresh.");
  }
  return blockedAfterSupportingInspection(
    "The manifest requires a completed conversation that cannot be created without configured model execution; garden refresh checks are supporting evidence only.",
    [qa.diagnostics.eventLogPath],
    async () => {
      await openGardenWorkspace(qa.page, garden);
      await reloadAndAssertCoreState(qa.page, {
        surface: "garden-workspace",
        garden,
        uploadedDocuments: state.uploadedDocuments,
      });
    },
  );
}

async function probeCleanExit({
  qa,
  state,
  definition,
}: ProbeContext): Promise<ScenarioProbeOutcome> {
  assertRequiredDependency(definition, "QA process ownership diagnostics");
  if (!qa.isRunning) {
    return blocked("Electron was no longer running after an earlier probe.");
  }
  if (!state.authenticated || !state.dashboardAvailable) {
    return blocked(
      "The active authenticated dashboard prerequisite was not re-established.",
    );
  }
  const diagnostic = qa.diagnostics.eventLogPath;
  return blockedAfterSupportingInspection(
    "No ownership map exists to prove that every child and grandchild exited without inspecting unrelated processes; clean main-process and port-release checks are supporting evidence only.",
    [diagnostic],
    async () => {
      if (state.terminalOpen) {
        await closeTerminal(qa.page);
        state.terminalOpen = false;
      }
      await goToDashboard(qa.page);
      await assertAuthenticatedDashboard(qa.page, state.primaryGarden);
      qa.diagnostics.assertNoFatal("before exploratory clean exit");
      const endpoints = qa.readEndpoints();
      const receipt = await qa.shutdown({ assertPortsReleased: true });
      expect(receipt.endpoints.pid).toBe(endpoints.pid);
      expect(receipt.mainPid).toBe(endpoints.pid);
      expect(receipt.exitCode).toBe(0);
      expect(receipt.signalCode).toBeNull();
      expect(receipt.releasedPorts.length).toBeGreaterThanOrEqual(3);
      expect(qa.isRunning).toBe(false);
    },
  );
}

async function blockedAfterSupportingInspection(
  reason: string,
  evidence: readonly string[],
  inspect: () => Promise<void>,
): Promise<ScenarioProbeOutcome> {
  // The missing manifest dependency still determines the terminal BLOCKED
  // status, but supported UI/lifecycle invariants remain real assertions. A
  // renderer crash, selector regression, hung shutdown, or leaked port must
  // escape to the recorder's evidence-based FAIL classifier.
  await inspect();
  return blocked(`${reason} Supporting surface checks passed.`, evidence);
}

async function ensureTerminalActions(page: Page) {
  const actions = locate(page, SELECTORS.terminal.actions);
  if (!(await actions.isVisible())) {
    await locate(page, SELECTORS.terminal.toggleSidebar).click();
  }
  await expect(actions).toBeVisible();
  return actions;
}

async function goToDashboard(page: Page): Promise<void> {
  if (new URL(page.url()).pathname === "/dashboard") return;
  const back = page.getByRole("link", {
    name: "Back to dashboard",
    exact: true,
  });
  if (await back.isVisible()) {
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/dashboard", {
        timeout: 2 * 60_000,
      }),
      // Next can cold-compile /dashboard for longer than Playwright's action
      // auto-wait timeout. Dispatch the semantic link event here and use the
      // independently bounded URL readiness assertion above as the source of
      // truth. The rename journey already exercises a physical link click.
      back.dispatchEvent("click"),
    ]);
    return;
  }
  const origin = new URL(page.url()).origin;
  await page.goto(new URL("/dashboard", origin).toString(), {
    waitUntil: "domcontentloaded",
    timeout: 2 * 60_000,
  });
}

async function settleRendererFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function requiredUrl(
  urls: Readonly<Record<string, string>>,
  service: string,
): string {
  const value = urls[service];
  if (!value) throw new Error(`Runtime endpoints omit ${service}`);
  const url = new URL(value);
  expect(url.protocol).toBe("http:");
  expect(url.hostname).toBe("127.0.0.1");
  return url.toString();
}
