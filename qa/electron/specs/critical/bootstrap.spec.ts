import { expect, test } from "@playwright/test";
import * as path from "node:path";
import { DiagnosticsCollector } from "../../diagnostics";
import { createQaEnvironment } from "../../environment";
import { launchBreadboard } from "../../launch-breadboard";

test("actual Electron starts in isolated QA mode and reaches local auth", async () => {
  const run = createQaEnvironment({ preserve: "on-failure" });
  let failed = true;
  const diagnostics = new DiagnosticsCollector({
    outputDir: path.join(run.paths.repoRoot, ".qa-results", "runs", run.runId, "diagnostics"),
    serviceLogsDir: run.paths.serviceLogsDir,
    secretValues: Object.values(run.bootstrap.auth),
  });
  const app = await launchBreadboard({
    run,
    diagnostics,
  });
  try {
    const snapshot = await app.securitySnapshot();
    expect(snapshot.isPackaged).toBe(false);
    expect(snapshot.userData).toBe(run.paths.userDataDir);
    expect(snapshot.downloads).toBe(run.paths.downloadsDir);
    expect(snapshot.windows.length).toBeGreaterThan(0);
    for (const window of snapshot.windows) {
      expect(window.sandbox).toBe(true);
      expect(window.contextIsolation).toBe(true);
      expect(window.nodeIntegration).toBe(false);
      expect(window.webviewTag).toBe(false);
    }

    const page = await app.dismissWelcome();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 60_000,
    });
    expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/login/);
    diagnostics.assertNoFatal("cold startup");
    failed = false;
  } catch (error) {
    await diagnostics.snapshotFailure();
    throw error;
  } finally {
    await app.close();
    await diagnostics.finalize();
    await diagnostics.dispose();
    await run.cleanup(failed ? "failed" : "passed");
  }
});
