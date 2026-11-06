import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");

test("side-chat menus are limited to the message area", { timeout: 60_000 }, async (t) => {
  const bundle = await build({ bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import SideChatSurface from '@/app/components/side-chat-surface';
      import {SideChatContext} from '@/app/components/side-chat-context';
      import LinkContextMenu from '@/app/components/link-context-menu';
      import TerminalWorkspaceMenu from '@/app/components/hermes/terminal-workspace-menu';
      window.requests=[];
      createRoot(document.getElementById('root')).render(
        <SideChatContext.Provider value={request=>window.requests.push(request)}>
          <main style={{display:'flex',gap:20,padding:20}}>
            <aside aria-label="Left sidebar">
              <LinkContextMenu href="/history"><a href="/history">History</a></LinkContextMenu>
              <TerminalWorkspaceMenu selected={null} onSelect={()=>{}}><button>New chat</button></TerminalWorkspaceMenu>
            </aside>
            <div>
              <SideChatSurface>
                <section aria-label="Messages" style={{height:250,padding:20}}>
                  <p id="passage">A message to discuss</p>
                  <LinkContextMenu href="/source"><a href="/source">Message source</a></LinkContextMenu>
                </section>
              </SideChatSurface>
              <div aria-label="Composer" style={{padding:20}}>
                <textarea aria-label="Draft" defaultValue="Keep this draft"/><button>Send</button>
              </div>
            </div>
            <aside aria-label="Right sidebar">
              <LinkContextMenu href="/files"><a href="/files">Files</a></LinkContextMenu>
            </aside>
          </main>
        </SideChatContext.Provider>);
    ` },
  });
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://side-chat-surface.test/**", route => route.request().url().includes("/api/")
    ? route.fulfill({ json: { clusters: [] } })
    : route.fulfill({ contentType: "text/html", body: '<!doctype html><style>.contents{display:contents}aside{padding:20px} [role=menu]{background:white}</style><div id="root"></div>' }));
  await page.goto("https://side-chat-surface.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const action = page.getByRole("menuitem", { name: "Start side chat", exact: true });
  for (const target of [page.locator("main"), page.getByLabel("Left sidebar"), page.getByLabel("Right sidebar"),
    page.getByLabel("Composer"), page.getByLabel("Draft"), page.getByRole("button", { name: "Send", exact: true })]) {
    await target.click({ button: "right", position: { x: 4, y: 4 } });
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  for (const name of ["History", "Files"]) {
    await page.getByRole("link", { name, exact: true }).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Open in new tab", exact: true })).toBeVisible();
    await expect(action).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "New chat", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menu", { name: "New chat workspace" })).toBeVisible();
  await expect(action).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("region", { name: "Messages" }).click({ button: "right", position: { x: 4, y: 4 } });
  await action.click();
  await page.getByRole("link", { name: "Message source" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Open in new tab", exact: true })).toBeVisible();
  await action.click();
  await page.evaluate(() => {
    const selection = window.getSelection();
    selection.selectAllChildren(document.getElementById("passage"));
  });
  await page.locator("#passage").click({ button: "right" });
  await action.click();
  assert.deepEqual(await page.evaluate(() => window.requests), [
    { quote: "" }, { quote: "" }, { quote: "A message to discuss" },
  ]);
  await expect(page.getByLabel("Draft")).toHaveValue("Keep this draft");
  assert.deepEqual(errors, []);
});
