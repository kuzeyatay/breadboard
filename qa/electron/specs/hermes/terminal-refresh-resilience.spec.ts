import { expect, test } from "../../fixtures";
import type { Frame } from "@playwright/test";
import {
  assertAuthenticatedDashboard,
  registerAndSignIn,
} from "../../user-journeys";

test("Terminal paints through a renderer reload and Word route warmup", async ({ qa }) => {
  test.setTimeout(12 * 60_000);
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);
  await assertAuthenticatedDashboard(page, undefined, 180_000);

  const sessionId = "conv_qa_terminal_refresh_snapshot";
  const marker = `TERMINAL-SNAPSHOT-${Date.now()}`;
  let detailRequestStartedAt = 0;
  let releaseDetail!: () => void;
  const detailGate = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });

  await page.route(
    `**/api/hermes/sessions/${sessionId}?*`,
    async (route) => {
      detailRequestStartedAt = Date.now();
      await detailGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: sessionId,
            title: "Reload resilience",
            activeRun: null,
            messages: [
              {
                id: "msg_qa_snapshot",
                role: "assistant",
                content: marker,
              },
            ],
          },
        }),
      });
    },
  );

  await page.evaluate(
    ({ activeId, ownerKey, visibleMarker }) => {
      sessionStorage.setItem("breadboard:knowledge-terminal-open", "true");
      sessionStorage.setItem(
        "breadboard:terminal:active-chat",
        JSON.stringify({ ownerKey, sessionId: activeId }),
      );
      sessionStorage.setItem(
        "breadboard:terminal:active-chat-snapshot",
        JSON.stringify({
          ownerKey,
          sessionId: activeId,
          messages: [
            {
              id: "msg_qa_snapshot",
              role: "assistant",
              content: visibleMarker,
            },
          ],
        }),
      );
    },
    {
      activeId: sessionId,
      ownerKey: qa.run.bootstrap.auth.email.trim().toLowerCase(),
      visibleMarker: marker,
    },
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
  await expect.poll(() => detailRequestStartedAt, { timeout: 120_000 }).toBeGreaterThan(0);
  await expect(page.getByText(marker, { exact: true })).toBeVisible({
    // The server response remains gated. Seeing this row proves the renderer
    // painted the tab snapshot instead of falling through to New chat.
    timeout: 5_000,
  });
  expect(Date.now() - detailRequestStartedAt).toBeLessThan(5_000);

  releaseDetail();
  await expect(page.getByText(marker, { exact: true })).toBeVisible({ timeout: 30_000 });

  let unexpectedMainFrameNavigations = 0;
  const countNavigation = (frame: Frame) => {
    if (frame === page.mainFrame()) unexpectedMainFrameNavigations += 1;
  };
  page.on("framenavigated", countNavigation);
  const routeStatuses = await page.evaluate(async ({ activeId }) => {
    const query = new URLSearchParams({ conversationId: activeId });
    const artifactId = "art_qa_missing_word_route_probe";
    const paths = ["preview", "genoffice"];
    return Promise.all(
      paths.map(async (path) => {
        const response = await fetch(
          `/api/hermes/artifacts/${artifactId}/${path}?${query}`,
          { cache: "no-store" },
        );
        return response.status;
      }),
    );
  }, { activeId: sessionId });
  await page.waitForTimeout(3_000);
  page.off("framenavigated", countNavigation);

  expect(routeStatuses).toEqual([404, 404]);
  expect(unexpectedMainFrameNavigations).toBe(0);
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
});
