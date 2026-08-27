import { expect, test } from "../../fixtures";
import {
  openTerminal,
  registerAndSignIn,
} from "../../user-journeys";

type EngineResponse = {
  readonly status: number;
  readonly text: string;
  readonly payload: Record<string, unknown>;
};

test.skip(
  process.env["BREADBOARD_QA_INVESTIGATE"] !== "1",
  "Set BREADBOARD_QA_INVESTIGATE=1 to run the Spotify/Hermes coexistence probe.",
);

test("a live Spotify view does not block Hermes from starting and answering", async ({ qa }) => {
  test.setTimeout(8 * 60_000);
  const page = await qa.dismissWelcome();
  await registerAndSignIn(page, qa.run.bootstrap.auth);

  const viewId = crypto.randomUUID();
  let leaseHeld = false;
  try {
    const engine = await page.evaluate(async (activeViewId): Promise<EngineResponse> => {
      const response = await fetch("/api/hermes/connections/spotify/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewId: activeViewId }),
        cache: "no-store",
      });
      const text = await response.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // The raw body is retained below for the assertion diagnostic.
      }
      return { status: response.status, text, payload };
    }, viewId);
    expect(engine.status, engine.text).toBe(200);
    leaseHeld = true;

    // Opening the terminal is the real renderer path that cold-starts Hermes.
    // Keep the Spotify view lease alive until the assistant turn completes so
    // this covers the exact false heavyweight-concurrency denial seen in dev.
    await openTerminal(page, 180_000);
    const composer = page.getByPlaceholder("Ask anything.", { exact: true });
    await expect(composer).toBeEditable({ timeout: 180_000 });

    const marker = `SPOTIFY-HERMES-${Math.floor(100000 + Math.random() * 900000)}`;
    const beforeAssistantCount = await page
      .locator('div[class~="text-gray-200"]')
      .count();
    await composer.fill(`Reply with exactly ${marker}.`);
    await page.getByRole("button", { name: "Send", exact: true }).last().click();

    await expect
      .poll(
        async () => {
          const blocks = page.locator('div[class~="text-gray-200"]');
          const response =
            (await blocks.count()) > beforeAssistantCount
              ? await blocks.last().innerText().catch(() => "")
              : "";
          const errors = await page
            .getByRole("alert")
            .allTextContents()
            .then((items) => items.join("\n"))
            .catch(() => "");
          return `${response}\n${errors}`;
        },
        {
          timeout: 180_000,
          message: "Hermes did not answer while the Spotify service lease remained active",
        },
      )
      .toContain(marker);

    const visibleErrors = await page
      .getByRole("alert")
      .allTextContents()
      .then((items) => items.join("\n"))
      .catch(() => "");
    expect(visibleErrors).not.toMatch(
      /heavyweight_concurrency|agent runtime is unavailable|agent connection closed/i,
    );
    qa.diagnostics.assertNoFatal("Spotify and Hermes coexistence");
  } finally {
    if (leaseHeld) {
      const released = await page.evaluate(async (activeViewId) => {
        const response = await fetch("/api/hermes/connections/spotify/engine", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewId: activeViewId }),
          cache: "no-store",
        }).catch(() => null);
        return response?.status ?? null;
      }, viewId);
      expect(released).toBe(200);
    }
  }
});
