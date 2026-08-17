import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "../../fixtures";
import {
  createGarden,
  ensureAuthenticatedDashboard,
  openGardenWorkspace,
  registerAndSignIn,
  uploadDocuments,
} from "../../user-journeys";

/**
 * Week 2 / B-1 investigation: is the modal backdrop that intercepted the source
 * link click a real product-state defect, or a harness race?
 *
 * The Week 1 failure said a `.bb-modal-backdrop` was still intercepting pointer
 * events after `uploadDocuments` had asserted the "Add documents" panel hidden.
 * Guessing which modal that was would be speculation, so this probe records the
 * facts: after every upload it enumerates every backdrop in the DOM with its
 * identity, geometry, computed pointer-events and z-index, and the element that
 * actually sits at the point the source link occupies.
 *
 * It runs several uploads inside one Electron launch so an intermittent state
 * has several chances to appear without paying for a relaunch each time.
 *
 * This is an investigation probe, not a gate. It records evidence and only fails
 * if it cannot gather any.
 */

const ITERATIONS = Number(process.env["BREADBOARD_QA_BACKDROP_ITERATIONS"] ?? "4");

test.skip(
  process.env["BREADBOARD_QA_INVESTIGATE"] !== "1",
  "Set BREADBOARD_QA_INVESTIGATE=1 to run the Week 2 backdrop investigation.",
);

interface BackdropObservation {
  readonly iteration: number;
  readonly stage: string;
  readonly backdrops: ReadonlyArray<Record<string, unknown>>;
  readonly elementAtSourceLink: Record<string, unknown> | null;
  readonly sourceLinkBox: Record<string, number> | null;
  readonly backdropEvents?: ReadonlyArray<Record<string, unknown>>;
  readonly clickOutcome?: Record<string, unknown>;
}

test("upload does not leave a pointer-blocking backdrop over the garden", async ({
  qa,
}, testInfo) => {
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);
  await ensureAuthenticatedDashboard(page);

  const fixture = path.join(qa.run.paths.repoRoot, "qa", "fixtures", "firefly-brief.md");
  expect(fs.existsSync(fixture)).toBe(true);

  const observations: BackdropObservation[] = [];
  const blockedIterations: number[] = [];

  /**
   * Record every backdrop attach/detach with a timestamp. A backdrop that only
   * exists for a few hundred milliseconds will never be caught by point-in-time
   * sampling, and "it was gone when I looked" is not evidence that it was never
   * there.
   */
  const installBackdropRecorder = async (): Promise<void> => {
    await page.evaluate(() => {
      const scope = globalThis as typeof globalThis & {
        __bbBackdropLog?: Array<Record<string, unknown>>;
        __bbBackdropObserver?: MutationObserver;
      };
      if (scope.__bbBackdropObserver) return;
      scope.__bbBackdropLog = [];
      const note = (action: string, node: Element): void => {
        scope.__bbBackdropLog?.push({
          action,
          at: performance.now(),
          className: node.className,
          headings: [...node.querySelectorAll("h1,h2,h3")]
            .map((heading) => (heading.textContent ?? "").trim())
            .slice(0, 4),
          text: (node.textContent ?? "").trim().slice(0, 120),
        });
      };
      const scan = (nodes: NodeList, action: string): void => {
        for (const node of nodes) {
          if (!(node instanceof Element)) continue;
          if (node.classList?.contains("bb-modal-backdrop")) note(action, node);
          for (const nested of node.querySelectorAll?.(".bb-modal-backdrop") ?? []) {
            note(`${action}-nested`, nested);
          }
        }
      };
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          scan(record.addedNodes, "added");
          scan(record.removedNodes, "removed");
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      scope.__bbBackdropObserver = observer;
    });
  };

  const drainBackdropLog = async (): Promise<ReadonlyArray<Record<string, unknown>>> =>
    page.evaluate(() => {
      const scope = globalThis as typeof globalThis & {
        __bbBackdropLog?: Array<Record<string, unknown>>;
      };
      const entries = [...(scope.__bbBackdropLog ?? [])];
      if (scope.__bbBackdropLog) scope.__bbBackdropLog.length = 0;
      return entries;
    });

  const snapshot = async (
    iteration: number,
    stage: string,
    sourceTitle: string | null,
  ): Promise<BackdropObservation> => {
    // Scroll the link into view first: `elementFromPoint` uses viewport
    // coordinates, so an off-screen link reports whatever occupies those
    // coordinates and would look "blocked" when nothing is wrong.
    if (sourceTitle) {
      await page
        .getByRole("link", { name: sourceTitle, exact: true })
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => undefined);
    }
    const result = await page.evaluate((title) => {
      const describe = (element: Element): Record<string, unknown> => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          id: element.id || null,
          pointerEvents: style.pointerEvents,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          zIndex: style.zIndex,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          text: (element.textContent ?? "").trim().slice(0, 160),
          headings: [...element.querySelectorAll("h1,h2,h3")]
            .map((heading) => (heading.textContent ?? "").trim())
            .slice(0, 5),
        };
      };

      const backdrops = [...document.querySelectorAll(".bb-modal-backdrop")].map(describe);

      let elementAtSourceLink: Record<string, unknown> | null = null;
      let sourceLinkBox: Record<string, number> | null = null;
      if (title) {
        const link = [...document.querySelectorAll("a")].find(
          (anchor) => (anchor.textContent ?? "").trim() === title,
        );
        if (link) {
          const rect = link.getBoundingClientRect();
          sourceLinkBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          const hit = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          if (hit) {
            elementAtSourceLink = {
              ...describe(hit),
              isTheLink: hit === link || link.contains(hit),
            };
          }
        }
      }
      return { backdrops, elementAtSourceLink, sourceLinkBox };
    }, sourceTitle);
    const observation: BackdropObservation = { iteration, stage, ...result };
    observations.push(observation);
    return observation;
  };

  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    const garden = await createGarden(page, {
      name: `Backdrop probe ${iteration}`,
      description: `Week 2 backdrop investigation run ${iteration}`,
    });
    await openGardenWorkspace(page, garden);
    await installBackdropRecorder();

    await snapshot(iteration, "before-upload", null);
    const uploaded = await uploadDocuments(page, [fixture]);
    const title = uploaded[0]?.displayedTitle ?? "firefly-brief";

    // Immediately after uploadDocuments returns is the exact moment the failing
    // scenario tried to click the source link.
    const immediate = await snapshot(iteration, "immediately-after-upload", title);
    if (immediate.elementAtSourceLink && immediate.elementAtSourceLink["isTheLink"] !== true) {
      blockedIterations.push(iteration);
    }

    // Reproduce the failing action itself. Playwright's own actionability check
    // is the oracle that reported the interception in Week 1, so use it rather
    // than a hand-rolled approximation, with a short bound so an interception
    // surfaces quickly instead of retrying for 30s.
    let clickOutcome: Record<string, unknown>;
    const sourceLink = page.getByRole("link", { name: title, exact: true }).first();
    try {
      await sourceLink.click({ timeout: 5_000, trial: true });
      clickOutcome = { intercepted: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      clickOutcome = {
        intercepted: true,
        interceptedByBackdrop: /bb-modal-backdrop/.test(message),
        message: message.slice(0, 1_200),
      };
      if (!blockedIterations.includes(iteration)) blockedIterations.push(iteration);
    }

    const events = await drainBackdropLog();
    observations.push({
      iteration,
      stage: "click-attempt",
      backdrops: [],
      elementAtSourceLink: null,
      sourceLinkBox: null,
      backdropEvents: events,
      clickOutcome,
    });

    // Then again after the DOM has settled, to separate "never clears" from
    // "clears late" — a transient blocker is a race, a permanent one is a bug.
    await page.waitForTimeout(1_500);
    await snapshot(iteration, "1500ms-after-upload", title);

    await ensureAuthenticatedDashboard(page);
  }

  const evidenceDir = path.join(qa.scenarios.outputPath, "..", "backdrop-investigation");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, `observations-${qa.run.runId}.json`);
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        iterations: ITERATIONS,
        blockedIterations,
        observations,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await testInfo.attach("backdrop-observations", {
    path: evidencePath,
    contentType: "application/json",
  });

  // The probe must have actually observed something, or it proves nothing.
  expect(observations.length).toBe(ITERATIONS * 4);
  for (const observation of observations) {
    if (observation.stage === "before-upload" || observation.stage === "click-attempt") continue;
    expect(
      observation.sourceLinkBox,
      `iteration ${observation.iteration}: the uploaded source link was not rendered`,
    ).not.toBeNull();
  }

  // Report, do not assert: an intermittent blocker will not appear every run,
  // and failing here would hide the observations behind a timeout.
  testInfo.annotations.push({
    type: "backdrop-blocked-iterations",
    description: blockedIterations.length
      ? `pointer-blocked in iterations: ${blockedIterations.join(", ")}`
      : "no iteration observed a pointer-blocking backdrop",
  });
});
