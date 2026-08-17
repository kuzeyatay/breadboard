// A thousand-message conversation, driven through the real renderer.
//
// Breadboard's transcripts are virtualized: the conversation is held whole in
// application state but only the rows around the fold are put in the DOM. That
// is a claim about a running browser — how many rows are mounted, where the
// viewport sits after a flick of the wheel, whether text can still be selected
// out of an old message — so it is checked here rather than in a unit test.
//
// The dashboard Terminal is the surface used because its history lives in
// localStorage, which makes a genuinely long conversation seedable without
// inventing a thousand model turns. Every other virtualized transcript is the
// same component underneath.

import type { Page } from "playwright";
import { test, expect } from "../../fixtures";
import {
  ensureAuthenticatedDashboard,
  openTerminal,
  registerAndSignIn,
} from "../../user-journeys";

const MESSAGE_COUNT = 1_000;
const SESSION_TITLE = "Virtualization QA — long conversation";
const HISTORY_KEY = "breadboard:knowledge-terminal-history:mine";
/** Opened tall enough that a short transcript could not fake a small row count. */
const TERMINAL_HEIGHT_KEY = "breadboard:knowledge-terminal-height";

/** The transcript's sized container, which reports what it drew. */
const transcriptList = (page: Page) =>
  page.locator('[data-chat-virtual-list="knowledge-terminal"]');

const mountedRows = async (page: Page): Promise<number> =>
  Number(await transcriptList(page).getAttribute("data-mounted-rows"));

const scrollState = async (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector(
      '[data-chat-virtual-list="knowledge-terminal"]',
    );
    const scroller = list?.closest(".overflow-y-auto") as HTMLElement | null;
    if (!scroller) return null;
    return {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      distanceFromEnd:
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
    };
  });

const wheel = async (page: Page, deltaY: number, times: number) => {
  for (let step = 0; step < times; step += 1) {
    await transcriptList(page).hover({ position: { x: 20, y: 20 } });
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(200);
};

test.describe.serial("a thousand-message transcript stays a small DOM", () => {
  test("seeding, scrolling, selecting, and switching all stay well-behaved", async ({
    qa,
    scenarios,
  }, testInfo) => {
    const page = qa.page;
    await registerAndSignIn(page, qa.run.bootstrap.auth);
    await ensureAuthenticatedDashboard(page);

    // 1. Two conversations, one of them genuinely long.
    await page.evaluate(
      ([key, heightKey, title, count]) => {
        const stamp = (minutesAgo: number) =>
          new Date(Date.now() - minutesAgo * 60_000).toISOString();
        const longMessages = Array.from({ length: count as number }, (_, index) => ({
          role: index % 2 === 0 ? "user" : "assistant",
          createdAt: stamp((count as number) - index),
          content:
            index % 2 === 0
              ? `Question ${index}: what connects these notes?`
              : [
                  `Answer ${index}. Marker-${index}.`,
                  "",
                  "It draws on several gardens at once, which is why the reply",
                  "runs to a few lines rather than one.",
                  "",
                  "```ts",
                  `const answer = ${index};`,
                  "```",
                ].join("\n"),
        }));
        window.localStorage.setItem(heightKey as string, "760");
        window.localStorage.setItem(
          key as string,
          JSON.stringify([
            {
              id: 2,
              title: title as string,
              created_at: stamp(count as number),
              updated_at: stamp(0),
              messages: longMessages,
            },
            {
              id: 1,
              title: "Virtualization QA — short conversation",
              created_at: stamp(5_000),
              updated_at: stamp(4_000),
              messages: [
                { role: "user", createdAt: stamp(5_000), content: "Short chat marker." },
                {
                  role: "assistant",
                  createdAt: stamp(4_999),
                  content: "Only-in-conversation-B.",
                },
              ],
            },
          ]),
        );
      },
      [HISTORY_KEY, TERMINAL_HEIGHT_KEY, SESSION_TITLE, MESSAGE_COUNT] as const,
    );
    await page.reload();
    await ensureAuthenticatedDashboard(page);

    await scenarios.attempt(
      testInfo,
      "long-conversation-mounts-a-viewport",
      async () => {
        await openTerminal(page);
        await page
          .getByRole("button", { name: new RegExp(SESSION_TITLE.slice(0, 24)) })
          .first()
          .click();

        const list = transcriptList(page);
        await expect(list).toBeVisible();
        await expect(list).toHaveAttribute(
          "data-message-count",
          String(MESSAGE_COUNT),
        );

        // 2. The whole point: a thousand messages, tens of rows.
        const rows = await mountedRows(page);
        expect(rows).toBeGreaterThan(0);
        expect(rows).toBeLessThanOrEqual(40);
        expect(await list.locator("[data-index]").count()).toBe(rows);

        // The container still stands for the whole conversation, so the
        // scrollbar means what it looks like it means.
        const state = await scrollState(page);
        expect(state).not.toBeNull();
        expect(state!.scrollHeight).toBeGreaterThan(state!.clientHeight * 20);
      },
    );

    await scenarios.attempt(
      testInfo,
      "long-conversation-scrolls-without-blanks",
      async () => {
        // 3 & 4. Rapidly up, then rapidly down. Rows must exist the whole way:
        // a blank band would show up as a moment with nothing mounted.
        for (const delta of [-1_200, 1_200]) {
          for (let burst = 0; burst < 8; burst += 1) {
            await wheel(page, delta, 3);
            const rows = await mountedRows(page);
            expect(rows).toBeGreaterThan(0);
            expect(rows).toBeLessThanOrEqual(40);
          }
        }

        // No duplicates and no gaps in what is drawn.
        const indexes = await transcriptList(page)
          .locator("[data-index]")
          .evaluateAll((nodes) =>
            nodes.map((node) => Number(node.getAttribute("data-index"))),
          );
        expect(new Set(indexes).size).toBe(indexes.length);
        const sorted = [...indexes].sort((a, b) => a - b);
        const first = sorted[0] ?? 0;
        const last = sorted[sorted.length - 1] ?? 0;
        expect(last - first).toBe(sorted.length - 1);
      },
    );

    await scenarios.attempt(
      testInfo,
      "long-conversation-text-stays-selectable",
      async () => {
        // 5. Text still selects and copies out of a mounted historical row.
        const selected = await page.evaluate(() => {
          const row = document.querySelector(
            '[data-chat-virtual-list="knowledge-terminal"] [data-index]',
          );
          if (!row) return "";
          const range = document.createRange();
          range.selectNodeContents(row);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return selection?.toString() ?? "";
        });
        expect(selected.trim().length).toBeGreaterThan(0);
      },
    );

    await scenarios.attempt(
      testInfo,
      "long-conversation-returns-to-the-newest-message",
      async () => {
        // 6. Back to the bottom the way a reader would: the jump control.
        await wheel(page, -1_200, 6);
        const jump = page.getByRole("button", {
          name: /jump to the newest message/i,
        });
        await expect(jump).toBeVisible();
        await jump.click();
        await expect
          .poll(async () => (await scrollState(page))!.distanceFromEnd, {
            timeout: 10_000,
          })
          .toBeLessThan(120);
        await expect(
          page.getByText(`Marker-${MESSAGE_COUNT - 1}`, { exact: false }),
        ).toBeVisible();
      },
    );

    await scenarios.attempt(
      testInfo,
      "reading-upward-keeps-the-viewport",
      async () => {
        // 8 & 9. Reading upward must not be undone by anything arriving below.
        // Nothing here streams — the assertion is that the viewport the reader
        // chose is exactly where it is left.
        await wheel(page, -1_200, 8);
        const parked = (await scrollState(page))!.scrollTop;
        expect(parked).toBeGreaterThan(0);
        await page.waitForTimeout(1_200);
        const settled = (await scrollState(page))!.scrollTop;
        expect(Math.abs(settled - parked)).toBeLessThan(8);
      },
    );

    await scenarios.attempt(
      testInfo,
      "switching-conversations-does-not-reuse-measurements",
      async () => {
        // 12, 13, 14. Into the short chat and back out again.
        await page
          .getByRole("button", { name: /short conversation/i })
          .first()
          .click();
        const list = transcriptList(page);
        await expect(list).toHaveAttribute("data-message-count", "2");
        await expect(page.getByText("Only-in-conversation-B")).toBeVisible();
        // The short chat's own height, not a leftover of the long one.
        const shortState = (await scrollState(page))!;
        expect(shortState.scrollHeight).toBeLessThan(shortState.clientHeight * 3);
        expect(shortState.scrollTop).toBe(0);

        await page
          .getByRole("button", { name: new RegExp(SESSION_TITLE.slice(0, 24)) })
          .first()
          .click();
        await expect(list).toHaveAttribute(
          "data-message-count",
          String(MESSAGE_COUNT),
        );
        // Opened at the top, with no stale row from the other conversation.
        expect((await scrollState(page))!.scrollTop).toBe(0);
        await expect(page.getByText("Only-in-conversation-B")).toHaveCount(0);
        const rows = await mountedRows(page);
        expect(rows).toBeGreaterThan(0);
        expect(rows).toBeLessThanOrEqual(40);
      },
    );
  });
});
