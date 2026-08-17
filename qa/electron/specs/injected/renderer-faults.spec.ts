import { expect, test } from "../../fixtures";

/**
 * Deliberately failing real-Electron scenarios.
 *
 * These exist so `npm run qa:selftest:electron` can prove, end to end, that an
 * injected fault in a live renderer becomes a *reported failure with evidence*
 * rather than a quietly green run. The meta-runner expects this project to
 * fail; nothing here is a statement about Breadboard's behaviour.
 *
 * The gate below is a run-selection guard, not a repair: without the explicit
 * environment flag these specs are not part of any normal QA run, exactly like
 * the pre-existing `failure-artifacts` probe.
 */
test.skip(
  process.env["BREADBOARD_QA_INJECT_FAULTS"] !== "1",
  "Set BREADBOARD_QA_INJECT_FAULTS=1; this project is expected to fail by design.",
);

test("INJECTED-A renderer assertion failure is reported with evidence", async ({ qa }) => {
  const page = await qa.dismissWelcome();
  // No such heading exists. A harness that cannot fail here cannot be trusted
  // to report a real regression either.
  await expect(
    page.getByRole("heading", {
      name: "INJECTED QA FAULT A: THIS HEADING DOES NOT EXIST",
      exact: true,
    }),
  ).toBeVisible({ timeout: 3_000 });
});

test("INJECTED-B renderer uncaught exception fails the scenario", async ({ qa }) => {
  const page = await qa.dismissWelcome();
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("QA_INJECTED_RENDERER_FAULT");
    }, 0);
  });
  await page.waitForTimeout(1_000);

  // The collector saw the exception, so the run must not be allowed to pass.
  const injected = qa.diagnostics.entries.filter((entry) =>
    entry.message.includes("QA_INJECTED_RENDERER_FAULT"),
  );
  expect(injected.length, "the collector must capture the injected page error").toBeGreaterThan(0);
  expect(
    qa.diagnostics.hasActionableErrors,
    "an uncaught renderer exception must fail the scenario",
  ).toBe(false);
});

test("INJECTED-C the worker survives earlier injected failures", async ({ qa }) => {
  // Regression guard for the trace-teardown defect the Week 1 baseline exposed.
  // A failed trace write used to leave the chunk state inconsistent, so teardown
  // raised a second, spurious error and the worker's Electron app was left in an
  // unusable state. This file is deliberately not `describe.serial`, so reaching
  // this test at all proves the worker survived the two failures above.
  const page = await qa.dismissWelcome();
  expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  expect(qa.isRunning).toBe(true);
});
