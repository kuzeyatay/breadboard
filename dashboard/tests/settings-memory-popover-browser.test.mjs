import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = path.resolve(import.meta.dirname, "..");

test("Intelligence Settings keeps Memory details clickable at the edges of its scroll area", { timeout: 60_000 }, async (t) => {
  const bundle = await build({
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    outfile: "settings-memory-test.js",
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import { useRef, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import SettingsDialog from '@/app/components/settings-dialog';
      import ViewportPopover from '@/app/components/viewport-popover';

      function App() {
        const intelligence = useRef(null);
        const settings = useRef(null);
        const [menuOpen, setMenuOpen] = useState(false);
        const [settingsOpen, setSettingsOpen] = useState(false);
        return <>
          <button ref={intelligence} className="fixed right-8 bottom-4" onClick={() => setMenuOpen(true)}>Intelligence</button>
          {menuOpen && <ViewportPopover anchorRef={intelligence} ariaLabel="Intelligence" role="dialog"
            onClose={() => setMenuOpen(false)} className="fixed z-[100] bg-white p-2">
            <button ref={settings} onClick={() => setSettingsOpen(true)}>Settings</button>
            <SettingsDialog anchorRef={settings} presentation="popover" open={settingsOpen} initialTab="memory"
              onClose={() => setSettingsOpen(false)} />
          </ViewportPopover>}
        </>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, "utf8"), { from: stylesheet })).css;
  const componentStyles = bundle.outputFiles.find((file) => file.path.endsWith(".css"));
  const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"));
  const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
  t.after(() => browser.close());

  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const lessons = Array.from({ length: 20 }, (_, index) => ({
    title: `Page ${index + 1}`,
    lesson: { key: `page-${index}`, why: "You visited this page on several days.", sources: ["https://example.test/notes"] },
  }));
  await page.route("http://memory-settings.test/**", (route) => {
    switch (new URL(route.request().url()).pathname) {
      case "/": return route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="light"><div id="root"></div>' });
      case "/api/personal-context": return route.fulfill({ json: { lessons } });
      case "/api/agent-memory": return route.fulfill({ json: { durable: [], conversations: [] } });
      default: return route.fulfill({ json: {} });
    }
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 640 }]) {
    await page.setViewportSize(viewport);
    await page.goto("http://memory-settings.test/");
    await page.addStyleTag({ content: css + componentStyles.text });
    await page.addScriptTag({ content: script.text });
    await page.getByRole("button", { name: "Intelligence", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();

    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    const memory = settings.getByRole("tabpanel", { name: "Memory" });
    await expect(memory.getByRole("heading")).toHaveText(["Memory", "Chat summaries", "Learned from your work"]);
    await expect(settings.getByRole("tab", { name: "MCP", exact: true })).toHaveCount(0);

    // A transformed scroll container still clips a viewport-fixed descendant
    // unless the details panel is placed in the top layer.
    await memory.evaluate((element) => { element.parentElement.style.transform = "translateZ(0)"; });
    const info = memory.getByRole("button", { name: "Why this?" }).last();
    await info.click();
    const details = settings.getByRole("dialog", { name: "Why this?" });
    await expect(details.getByText(lessons[0].lesson.why)).toBeVisible();
    assert.ok(await details.evaluate((element) => {
      const { top, right, bottom, left } = element.getBoundingClientRect();
      return left >= 0 && right <= innerWidth && top >= 0 && bottom <= innerHeight &&
        [left + 10, right - 10].every((x) => element.contains(document.elementFromPoint(x, top + 16)));
    }), "both edges of the details popover are visible and clickable");
    await details.getByRole("button", { name: "Correct" }).click();
    await expect(details.getByRole("textbox", { name: "Correction" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await expect(info).toBeFocused();
    await expect(settings).toBeVisible();

    await info.click();
    await expect(details).toBeVisible();
    await memory.evaluate((element) => { element.parentElement.scrollTop = 0; });
    await expect(details).toHaveCount(0);

    await settings.getByRole("tab", { name: "Connections" }).click();
    const connections = settings.getByRole("tabpanel", { name: "Connections" });
    await expect(connections.getByRole("heading", { name: "MCP servers" })).toBeVisible();
    await expect(connections.getByRole("button", { name: "Add MCP" })).toBeVisible();
    await expect(connections.getByRole("textbox", { name: "Search connections" })).toBeVisible();
  }
  assert.deepEqual(errors, []);
});
