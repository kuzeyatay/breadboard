import { expect, test } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { DiagnosticsCollector } from "../../diagnostics";
import { createQaEnvironment } from "../../environment";
import { launchBreadboard } from "../../launch-breadboard";

test("an arbitrary local file cannot replace the Electron dashboard", async () => {
  const run = createQaEnvironment({ preserve: "on-failure" });
  const evidenceDir = path.join(
    run.paths.repoRoot,
    ".qa-results",
    "runs",
    run.runId,
    "navigation-security",
  );
  fs.mkdirSync(evidenceDir, { recursive: true });
  const diagnostics = new DiagnosticsCollector({
    outputDir: path.join(evidenceDir, "diagnostics"),
    serviceLogsDir: run.paths.serviceLogsDir,
    secretValues: Object.values(run.bootstrap.auth),
  });
  const app = await launchBreadboard({ run, diagnostics });
  const tracing = app.application.context().tracing;
  await tracing.start({ screenshots: true, snapshots: true, sources: true });
  let tracingActive = true;
  let failed = true;
  try {
    const page = app.startupPage;
    await page.waitForLoadState("domcontentloaded");
    const trustedStartupUrl = page.url();
    expect(trustedStartupUrl).toMatch(/^file:.*\/startup\/index\.html/);
    const untrustedFile = pathToFileURL(
      path.join(run.paths.repoRoot, "qa", "fixtures", "firefly-brief.md"),
    ).toString();

    // Add and activate the same kind of semantic link an untrusted document or
    // compromised renderer could use. A direct Playwright page.goto() uses the
    // debugging protocol and does not exercise Electron's will-navigate guard.
    await page.evaluate(({ href, label }) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      document.body.append(link);
    }, { href: untrustedFile, label: "Open local QA fixture" });
    const navigation = app.application.evaluate(
      async ({ BrowserWindow }, targetUrl) => {
        const window = BrowserWindow.getAllWindows().find(
          (candidate: { webContents: { getURL(): string } }) =>
            candidate.webContents.getURL().startsWith("file:") &&
            candidate.webContents.getURL().includes("/startup/index.html"),
        );
        if (!window) throw new Error("Could not find the startup BrowserWindow");
        return new Promise<{ url: string; prevented: boolean }>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`No renderer navigation event for ${targetUrl}`)),
            10_000,
          );
          window.webContents.on(
            "will-navigate",
            (event: { defaultPrevented: boolean }, url: string) => {
            if (url !== targetUrl) return;
            clearTimeout(timer);
            resolve({ url, prevented: event.defaultPrevented });
            },
          );
        });
      },
      untrustedFile,
    );
    await page
      .getByRole("link", { name: "Open local QA fixture", exact: true })
      .click({ noWaitAfter: true });
    const observed = await navigation;

    expect(observed.url).toBe(untrustedFile);
    expect(observed.prevented).toBe(true);
    expect(page.url()).toBe(trustedStartupUrl);
    diagnostics.assertNoFatal("arbitrary file navigation");
    failed = false;
  } catch (error) {
    const page = app.application.windows().find((candidate) => !candidate.isClosed());
    if (page) {
      await page.screenshot({
        path: path.join(evidenceDir, "failure-screenshot.png"),
        fullPage: true,
      }).catch(() => {});
    }
    await diagnostics.snapshotFailure();
    await tracing.stop({ path: path.join(evidenceDir, "playwright-trace.zip") });
    tracingActive = false;
    throw error;
  } finally {
    if (tracingActive) await tracing.stop();
    await app.close();
    await diagnostics.finalize();
    await diagnostics.dispose();
    await run.cleanup(failed ? "failed" : "passed");
  }
});
