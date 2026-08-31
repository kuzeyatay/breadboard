import * as fs from "node:fs";
import * as path from "node:path";
import { test, expect } from "../../fixtures";
import { isPathInside } from "../../environment";
import {
  assertAuthenticatedDashboard,
  assertGardenWorkspace,
  closeTerminal,
  createGarden,
  ensureAuthenticatedDashboard,
  openGardenWorkspace,
  openTerminal,
  registerAndSignIn,
  reloadAndAssertCoreState,
  uploadDocuments,
  type GardenInfo,
  type UploadedDocument,
} from "../../user-journeys";

test.describe.serial("critical actual-Electron user journeys", () => {
  let garden: GardenInfo | undefined;
  let uploaded: readonly UploadedDocument[] = [];

  test("cold startup uses a least-privilege renderer and reaches local auth", async ({
    qa,
    scenarios,
  }, testInfo) => {
    const startupPage = qa.app.startupPage;
    await startupPage.waitForLoadState("domcontentloaded");
    expect(startupPage.url()).toMatch(/^file:/);

    await scenarios.attempt(
      testInfo,
      "desktop-preload-least-privilege",
      async () => {
        const bridge = await startupPage.evaluate(async () => {
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

        expect(bridge.apiKeys).toEqual(
          expect.arrayContaining([
            "awaitDashboardReady",
            "continueToDashboard",
            "getStartupState",
            "getVersions",
            "onStartupState",
          ]),
        );
        expect(
          bridge.apiKeys.some((key) =>
            /(?:secret|token|password|credential|filesystem|command)/i.test(key),
          ),
        ).toBe(false);
        expect(bridge.processType).toBe("undefined");
        expect(bridge.requireType).toBe("undefined");
        expect(bridge.versions?.app).toEqual(expect.any(String));
        expect(bridge.versions?.electron).toEqual(expect.any(String));

        const security = await qa.app.securitySnapshot();
        expect(security.isPackaged).toBe(false);
        expect(path.resolve(security.userData)).toBe(
          path.resolve(qa.run.paths.userDataDir),
        );
        expect(security.windows.length).toBeGreaterThan(0);
        for (const window of security.windows) {
          expect(window.sandbox).toBe(true);
          expect(window.contextIsolation).toBe(true);
          expect(window.nodeIntegration).toBe(false);
          expect(window.webviewTag).toBe(false);
        }
        return {
          actual: "The narrow preload API was callable and every Electron window retained hardened webPreferences.",
          evidence: [qa.diagnostics.eventLogPath],
        };
      },
    );

    await scenarios.attempt(
      testInfo,
      "desktop-startup-welcome-gate",
      async () => {
        // Hot development starts with an empty compiler cache. Wait for the
        // real startup gate before reading Runtime V2's endpoint publication;
        // the standalone path used to win this race by accident.
        await startupPage
          .getByRole("button", {
            name: "Welcome to Breadboard. Press space to continue.",
          })
          .waitFor({ state: "visible", timeout: 6 * 60_000 });
        const startupState = await startupPage.evaluate(async () => {
          const desktop = (
            globalThis as typeof globalThis & {
              breadboardDesktop?: {
                getStartupState(): Promise<{
                  phase: string;
                  services: Array<{ id: string; required: boolean }>;
                }>;
              };
            }
          ).breadboardDesktop;
          return desktop?.getStartupState() ?? null;
        });
        expect(startupState?.phase).toBe("ready");
        expect(startupState?.services).toHaveLength(32);
        expect(new Set(startupState?.services.map(({ id }) => id)).size).toBe(32);
        expect(startupState?.services.every(({ required }) => required)).toBe(true);
        expect(startupState?.services.some(({ id }) => id === "gbrain")).toBe(true);

        const page = await qa.dismissWelcome();
        const endpoints = qa.readEndpoints();
        expect(endpoints.pid).toBeGreaterThan(0);
        expect(endpoints.pid).not.toBe(await qa.mainProcessPid());
        expect(endpoints.urls).not.toHaveProperty("hermes");
        for (const service of ["dashboard", "chatmock", "quartz"] as const) {
          const url = new URL(requiredEndpoint(endpoints.urls, service));
          expect(url.protocol).toBe("http:");
          expect(url.hostname).toBe("127.0.0.1");
        }

        await expect(
          page.getByRole("heading", { name: "Sign in", exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        expect(new URL(page.url()).pathname).toBe("/auth/login");
        qa.diagnostics.assertNoFatal("cold startup");
        return {
          actual: "The welcome gate swapped to an interactable local authentication page.",
          evidence: [qa.diagnostics.eventLogPath],
        };
      },
    );
  });

  test("a disposable invited user can register, sign in, and refresh", async ({
    qa,
    scenarios,
  }, testInfo) => {
    await scenarios.attempt(testInfo, "local-account-onboarding", async () => {
      await registerAndSignIn(qa.page, qa.run.bootstrap.auth);
      await qa.page.reload({ waitUntil: "domcontentloaded" });
      await assertAuthenticatedDashboard(qa.page);
      expect(new URL(qa.page.url()).pathname).toBe("/dashboard");
      return {
        actual: "Invite registration and credentials login reached the dashboard, and the authenticated session survived refresh.",
        evidence: [qa.diagnostics.eventLogPath],
      };
    });
  });

  test("garden creation remains inside the isolated QA tree", async ({ qa }) => {
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
    for (const mutablePath of mutablePaths) {
      expect(isPathInside(qa.run.paths.runRoot, mutablePath)).toBe(true);
    }
    expect(
      isPathInside(
        qa.run.paths.runRoot,
        path.join(qa.run.paths.dataDir, "runtime", "endpoints.json"),
      ),
    ).toBe(true);

    garden = await createGarden(qa.page, {
      name: `Critical QA Garden ${qa.run.runId.slice(-8)}`,
      description: "Disposable local state for the actual Electron critical journey.",
    });
    const isolatedGardenIndex = path.join(
      qa.run.paths.dataDir,
      "quartz",
      "content",
      garden.slug,
      "_index.md",
    );
    const repositoryGardenDirectory = path.join(
      qa.run.paths.repoRoot,
      "quartz",
      "content",
      garden.slug,
    );
    await expect
      .poll(
        () => ({
          isolatedGardenExists: fs.existsSync(isolatedGardenIndex),
          repositoryGardenExists: fs.existsSync(repositoryGardenDirectory),
        }),
        {
          timeout: 10_000,
          message:
            "Garden creation must remain inside the disposable QA data root",
        },
      )
      .toEqual({
        isolatedGardenExists: true,
        repositoryGardenExists: false,
      });
    await assertAuthenticatedDashboard(qa.page, garden);
  });

  test("a deterministic Markdown fixture ingests through Add documents", async ({
    qa,
    scenarios,
  }, testInfo) => {
    const currentGarden = requireGarden(garden);
    const fixture = path.join(
      qa.run.paths.repoRoot,
      "qa",
      "fixtures",
      "firefly-brief.md",
    );
    expect(fs.existsSync(fixture)).toBe(true);

    await scenarios.attempt(testInfo, "markdown-upload-ingestion", async () => {
      await openGardenWorkspace(qa.page, currentGarden);
      uploaded = await uploadDocuments(qa.page, [fixture]);
      await assertGardenWorkspace(
        qa.page,
        currentGarden,
        uploaded.map((document) => document.displayedTitle),
      );

      const sourceLink = qa.page.getByRole("link", {
        name: uploaded[0]?.displayedTitle ?? "firefly-brief",
        exact: true,
      });
      await Promise.all([
        qa.page.waitForURL(
          (url) => url.pathname === `/garden/${currentGarden.slug}`,
          { timeout: 60_000 },
        ),
        sourceLink.click(),
      ]);
      await expect(
        qa.page.frameLocator("iframe").getByText("FIREFLY-COPPER-17", {
          exact: false,
        }).first(),
      ).toBeVisible({ timeout: 60_000 });

      const back = qa.page.getByRole("link", { name: /Back to garden/ });
      await Promise.all([
        qa.page.waitForURL(
          (url) => url.pathname === new URL(currentGarden.workspaceHref, url).pathname,
          { timeout: 60_000 },
        ),
        back.click(),
      ]);
      await assertGardenWorkspace(
        qa.page,
        currentGarden,
        uploaded.map((document) => document.displayedTitle),
      );
      return {
        actual: "The real upload UI completed and Quartz rendered the deterministic validation phrase from the stored Markdown source.",
        evidence: [fixture, qa.diagnostics.eventLogPath],
      };
    });
  });

  test("renderer refresh preserves the garden and uploaded source", async ({ qa }) => {
    await reloadAndAssertCoreState(qa.page, {
      surface: "garden-workspace",
      garden: requireGarden(garden),
      uploadedDocuments: uploaded,
    });
    qa.diagnostics.assertNoFatal("renderer refresh");
  });

  test("the dashboard terminal boots brown, then opens and closes through visible controls", async ({
    qa,
  }) => {
    await Promise.all([
      qa.page.waitForURL((url) => url.pathname === "/dashboard"),
      qa.page
        .getByRole("link", { name: "Back to dashboard", exact: true })
        .click(),
    ]);

    // This assertion deliberately runs before the first terminal click. The
    // collapsed dock must already be the real, initialized terminal rather
    // than a white activation placeholder that mounts the terminal on click.
    const openButton = qa.page.getByRole("button", {
      name: "Open terminal",
      exact: true,
    });
    await expect(openButton).toBeVisible({ timeout: 60_000 });
    const dockColors = await qa.page.locator("[data-terminal-dock]").evaluate((dock) => {
      const probe = document.createElement("div");
      probe.style.background = "var(--terminal-bar)";
      document.body.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        actual: getComputedStyle(dock).backgroundColor,
        expected,
      };
    });
    expect(dockColors.expected).not.toBe("rgba(0, 0, 0, 0)");
    expect(dockColors.actual).toBe(dockColors.expected);

    await openTerminal(qa.page);
    await closeTerminal(qa.page);
    await assertAuthenticatedDashboard(qa.page, requireGarden(garden));
  });

  test("restart with the same isolated profile preserves durable state", async ({
    qa,
    scenarios,
  }, testInfo) => {
    await scenarios.attempt(
      testInfo,
      "desktop-relaunch-durable-state",
      async () => {
        const firstEndpoints = qa.readEndpoints();
        const firstUserData = path.resolve(qa.run.paths.userDataDir);
        const shutdown = await qa.restart();
        expect(shutdown.endpoints.pid).toBe(firstEndpoints.pid);
        expect(shutdown.exitCode).toBe(0);
        expect(shutdown.signalCode).toBeNull();
        // Runtime V2 exposes Quartz through the dashboard lease route, so the
        // dashboard and Quartz endpoint URLs can intentionally share a port.
        expect(shutdown.releasedPorts.length).toBeGreaterThanOrEqual(2);

        const page = await qa.dismissWelcome();
        await ensureAuthenticatedDashboard(page, qa.run.bootstrap.auth);
        await assertAuthenticatedDashboard(page, requireGarden(garden));

        const secondSecurity = await qa.app.securitySnapshot();
        const secondEndpoints = qa.readEndpoints();
        expect(path.resolve(secondSecurity.userData)).toBe(firstUserData);
        expect(secondEndpoints.pid).not.toBe(firstEndpoints.pid);
        await openGardenWorkspace(page, requireGarden(garden));
        await assertGardenWorkspace(
          page,
          requireGarden(garden),
          uploaded.map((document) => document.displayedTitle),
        );
        qa.diagnostics.assertNoFatal("same-profile relaunch");
        return {
          actual: "The old process and owned ports exited before a fresh launch reopened the same account, garden, and uploaded source.",
          evidence: [qa.diagnostics.eventLogPath],
        };
      },
    );
  });

  test("clean shutdown exits the main process and releases owned ports", async ({
    qa,
  }) => {
    await Promise.all([
      qa.page.waitForURL((url) => url.pathname === "/dashboard"),
      qa.page
        .getByRole("link", { name: "Back to dashboard", exact: true })
        .click(),
    ]);
    await assertAuthenticatedDashboard(qa.page, requireGarden(garden));
    qa.diagnostics.assertNoFatal("before clean shutdown");

    const endpoints = qa.readEndpoints();
    const receipt = await qa.shutdown({ assertPortsReleased: true });
    expect(receipt.endpoints.pid).toBe(endpoints.pid);
    expect(receipt.mainPid).not.toBe(endpoints.pid);
    expect(receipt.exitCode).toBe(0);
    expect(receipt.signalCode).toBeNull();
    expect(receipt.releasedPorts.length).toBeGreaterThanOrEqual(2);
    expect(qa.isRunning).toBe(false);
  });
});

function requireGarden(garden: GardenInfo | undefined): GardenInfo {
  if (!garden) throw new Error("The serial garden setup did not complete");
  return garden;
}

function requiredEndpoint(
  urls: Readonly<Record<string, string>>,
  service: string,
): string {
  const endpoint = urls[service];
  if (!endpoint) throw new Error(`Missing ${service} runtime endpoint`);
  return endpoint;
}
