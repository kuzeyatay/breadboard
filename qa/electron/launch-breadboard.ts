import { createRequire } from "node:module";
import * as path from "node:path";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";
import type { QaRunEnvironment } from "./environment";
import type { DiagnosticsCollector } from "./diagnostics";

export interface NativeDialogPlan {
  openPaths?: readonly string[];
  savePath?: string | null;
  messageResponse?: number;
}

export interface LaunchBreadboardOptions {
  run: QaRunEnvironment;
  onWindow?: (page: Page) => void | Promise<void>;
  onMainConsole?: (type: string, text: string) => void;
  diagnostics?: DiagnosticsCollector;
  dialogPlan?: NativeDialogPlan;
  /** Keep native dialogs untouched when validating an already packaged app. */
  mockNativeDialogs?: boolean;
  executablePath?: string;
  packaged?: boolean;
}

export interface BreadboardElectron {
  readonly application: ElectronApplication;
  readonly run: QaRunEnvironment;
  readonly startupPage: Page;
  dismissWelcome(): Promise<Page>;
  dashboardPage(): Promise<Page>;
  setDialogPlan(plan: NativeDialogPlan): Promise<void>;
  externalOpenAttempts(): Promise<readonly string[]>;
  securitySnapshot(): Promise<ElectronSecuritySnapshot>;
  close(): Promise<void>;
}

export interface ElectronSecuritySnapshot {
  readonly isPackaged: boolean;
  readonly userData: string;
  readonly downloads: string;
  readonly windows: Array<{
    url: string;
    sandbox: boolean;
    contextIsolation: boolean;
    nodeIntegration: boolean;
    webviewTag: boolean;
  }>;
}

export async function launchBreadboard(
  options: LaunchBreadboardOptions,
): Promise<BreadboardElectron> {
  const { run } = options;
  const repoRoot = run.paths.repoRoot;
  const desktopRoot = path.join(repoRoot, "desktop");
  const packaged = options.packaged === true;
  const executablePath = options.executablePath ?? electronExecutable(desktopRoot);
  const args = packaged
    ? [`--breadboard-user-data-dir=${run.paths.userDataDir}`]
    : [desktopRoot, ...run.electronArgs];

  const application = await electron.launch({
    executablePath,
    args,
    cwd: packaged ? path.dirname(executablePath) : desktopRoot,
    env: definedEnvironment(run.env),
    acceptDownloads: true,
    artifactsDir: run.paths.artifactsDir,
    tracesDir: run.paths.artifactsDir,
    timeout: 60_000,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
  });

  let startupPage: Page;
  try {
    // This is deliberately the first post-launch operation so the hidden
    // preloaded dashboard window and main-process streams cannot outrun evidence
    // collection while the fixture waits for the welcome page.
    options.diagnostics?.attachElectron(application);

    if (options.onMainConsole) {
      application.on("console", (message) => {
        options.onMainConsole?.(message.type(), message.text());
      });
    }

    const seen = new Set<Page>();
    const attach = (page: Page): void => {
      if (seen.has(page)) return;
      seen.add(page);
      void options.onWindow?.(page);
    };
    application.on("window", attach);
    for (const page of application.windows()) attach(page);

    if (options.mockNativeDialogs !== false) {
      await installNativeDialogPlan(application, options.dialogPlan ?? {});
    }
    await installExternalOpenInterceptor(application);
    startupPage = await application.firstWindow({ timeout: 60_000 });
    attach(startupPage);
  } catch (error) {
    options.diagnostics?.markExpectedShutdown();
    try {
      await closeElectronApplication(application);
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "Breadboard Electron launch setup failed and the exact launched process did not close cleanly",
      );
    }
    throw error;
  }

  const handle: BreadboardElectron = {
    application,
    run,
    startupPage,
    dismissWelcome: async () => {
      const welcome = application
        .windows()
        .find((page) => !page.isClosed() && page.url().startsWith("file:")) ?? startupPage;
      const button = welcome.getByRole("button", {
        name: "Welcome to Breadboard. Click to continue.",
      });
      const failure = welcome.locator("#failure:not([hidden])");
      await Promise.race([
        button.waitFor({ state: "visible", timeout: 6 * 60_000 }),
        failure.waitFor({ state: "visible", timeout: 6 * 60_000 }).then(async () => {
          const title = await welcome.locator("#failure-title").textContent();
          const reason = await welcome.locator("#failure-reason").textContent();
          throw new Error(
            `Breadboard startup failed: ${title?.trim() || "unknown service"}: ${reason?.trim() || "no reason"}`,
          );
        }),
      ]);
      await button.click();
      return waitForDashboardWindow(application);
    },
    dashboardPage: () => waitForDashboardWindow(application),
    setDialogPlan: (plan) => installNativeDialogPlan(application, plan),
    externalOpenAttempts: () => readExternalOpenAttempts(application),
    securitySnapshot: () =>
      application.evaluate(({ app, BrowserWindow }) => ({
        isPackaged: app.isPackaged,
        userData: app.getPath("userData"),
        downloads: app.getPath("downloads"),
        windows: BrowserWindow.getAllWindows().map((window: {
          webContents: {
            getLastWebPreferences(): Record<string, unknown>;
            getURL(): string;
          };
        }) => {
          const preferences = window.webContents.getLastWebPreferences();
          return {
            url: window.webContents.getURL(),
            sandbox: preferences.sandbox === true,
            contextIsolation: preferences.contextIsolation !== false,
            nodeIntegration: preferences.nodeIntegration === true,
            webviewTag: preferences.webviewTag === true,
          };
        }),
      })),
    close: () => {
      options.diagnostics?.markExpectedShutdown();
      return closeElectronApplication(application);
    },
  };
  return handle;
}

async function installExternalOpenInterceptor(
  application: ElectronApplication,
): Promise<void> {
  await application.evaluate(({ shell }) => {
    const scope = globalThis as typeof globalThis & {
      __breadboardQaExternalOpenAttempts?: string[];
    };
    scope.__breadboardQaExternalOpenAttempts = [];
    shell.openExternal = (async (url: string) => {
      scope.__breadboardQaExternalOpenAttempts?.push(url);
    }) as typeof shell.openExternal;
  });
}

async function readExternalOpenAttempts(
  application: ElectronApplication,
): Promise<readonly string[]> {
  return application.evaluate(() => {
    const attempts = (
      globalThis as typeof globalThis & {
        __breadboardQaExternalOpenAttempts?: string[];
      }
    ).__breadboardQaExternalOpenAttempts;
    return [...(attempts ?? [])];
  });
}

export async function waitForDashboardWindow(
  application: ElectronApplication,
  timeoutMs = 90_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = application
      .windows()
      .find(
        (page) =>
          !page.isClosed() && /^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()),
      );
    if (candidate) {
      await candidate.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
      return candidate;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for the dashboard window; open URLs: ${application
      .windows()
      .map((page) => page.url())
      .join(", ")}`,
  );
}

export async function installNativeDialogPlan(
  application: ElectronApplication,
  plan: NativeDialogPlan,
): Promise<void> {
  const serializable = {
    openPaths: [...(plan.openPaths ?? [])],
    savePath: plan.savePath ?? null,
    messageResponse: plan.messageResponse ?? 0,
  };
  await application.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = (async () => ({
      canceled: value.openPaths.length === 0,
      filePaths: value.openPaths,
    })) as typeof dialog.showOpenDialog;
    dialog.showOpenDialogSync = (() =>
      value.openPaths.length > 0 ? value.openPaths : undefined) as typeof dialog.showOpenDialogSync;
    dialog.showSaveDialog = (async () => ({
      canceled: value.savePath === null,
      filePath: value.savePath ?? "",
    })) as typeof dialog.showSaveDialog;
    dialog.showSaveDialogSync = (() =>
      value.savePath ?? undefined) as typeof dialog.showSaveDialogSync;
    dialog.showMessageBox = (async () => ({
      response: value.messageResponse,
      checkboxChecked: false,
    })) as typeof dialog.showMessageBox;
    dialog.showMessageBoxSync = (() =>
      value.messageResponse) as typeof dialog.showMessageBoxSync;
  }, serializable);
}

function electronExecutable(desktopRoot: string): string {
  const requireFromDesktop = createRequire(path.join(desktopRoot, "package.json"));
  const executable = requireFromDesktop("electron") as unknown;
  if (typeof executable !== "string" || !path.isAbsolute(executable)) {
    throw new Error("Could not resolve the desktop Electron executable");
  }
  return executable;
}

function definedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string",
    ),
  );
}

async function closeElectronApplication(application: ElectronApplication): Promise<void> {
  const processHandle = application.process();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      application.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Electron did not shut down within 60 seconds")),
          60_000,
        );
      }),
    ]);
  } catch (error) {
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      processHandle.kill("SIGTERM");
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
