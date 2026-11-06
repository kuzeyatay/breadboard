import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = path.resolve(import.meta.dirname, "..");
const workspace = fs.readFileSync(path.join(root, "src/app/gardens/[clusterSlug]/workspace-client.tsx"), "utf8");
const menuStart = workspace.indexOf("{/* Menu panels cover");
assert.ok(menuStart >= 0);
const panelMarkup = workspace.slice(
  workspace.indexOf("<div", menuStart),
  workspace.indexOf("<KnowledgeGraph", menuStart),
).trim();
const onTogglePanel = workspace.match(/onTogglePanel=\{(\(panel\) => \{[\s\S]*?\n\s*\})\}/)?.[1];
const panelConstants = workspace.slice(workspace.indexOf("const GARDEN_PANELS:"), workspace.indexOf("const RAIL_WIDTH_KEY"));
assert.ok(onTogglePanel);
const panels = [
  ["Processes", "Processes"],
  ["Archived", "Archived chats"],
  ["Starred", "Starred messages"],
  ["Hooks", "Hooks"],
  ["Scheduled", "Scheduled chats"],
  ["Uploads", "Uploads"],
];

test("Garden menu panels open at the right edge, including after collapse and over artifacts", { timeout: 120_000 }, async (t) => {
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    plugins: [{ name: "unused-artifact-icon", setup(build) {
      build.onResolve({ filter: /^\.\/artifact-panel$/ }, () => ({ path: "artifact-icon", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const ArtifactArchiveIcon = () => null;" }));
    } }],
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {createPortal} from 'react-dom';
      import TerminalSidebar from './src/app/components/hermes/terminal-sidebar';
      import SidePanelDock from './src/app/components/hermes/side-panel-dock';
      import GardenArtifactDock from './src/app/components/hermes/garden-artifact-dock';
      import {useArtifactDockHost} from './src/app/components/hermes/artifact-dock-host';
      ${panelConstants}
      // Panel bodies have no role in docking; isolate their network requests.
      const body = name => () => <section><h2>{name}</h2><button>Use {name}</button></section>;
      const UploadsPanel = body('Uploads'), TerminalScheduledPanel = body('Scheduled chats');
      const HooksPanel = body('Hooks'), ArchivedChatsPanel = body('Archived chats');
      const StarredMessagesPanel = body('Starred messages'), ProcessesPanel = body('Processes');
      const ProductDetailsPanel = body('Product details');
      function Artifact() {
        const host = useArtifactDockHost();
        return host && createPortal(<div className="bb-artifact-dock h-full w-full bg-white"><h2>Open artifact</h2></div>, host);
      }
      function App() {
        const [sidePanel, setSidePanel] = useState(null), [productPanel, setProductPanel] = useState(null);
        const [collapsed, setCollapsed] = useState(false);
        const clusterSlug='test-garden', activeChatId=null;
        const openChatById=()=>{}, setStarredMessageTarget=()=>{}, handleGenerativeUiAction=()=>{};
        return <main className="relative flex h-screen min-h-0 overflow-hidden">
          <GardenArtifactDock>
            <TerminalSidebar chats={[]} loading={false} error={null} activeChatId={null}
              openPanel={sidePanel} panels={GARDEN_PANELS} onTogglePanel={${onTogglePanel}}
              collapsed={collapsed} onToggleCollapsed={()=>setCollapsed(value=>!value)}
              onNewChat={()=>{}} onOpenSearch={()=>{}} onOpenChat={()=>{}} onRenameChat={()=>{}}
              onTogglePin={()=>{}} onDeleteChat={()=>{}} onDeleteChats={()=>{}} onHighlightChat={()=>{}}/>
            <div className="min-w-0 flex-1">Garden chat</div>
            ${panelMarkup}
            <aside style={{width:460}}>Garden overview</aside>
            {location.search.includes('artifact') && <Artifact/>}
          </GardenArtifactDock>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
  });
  const stylesheet = path.join(root, "src/app/globals.css");
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, "utf8"), { from: stylesheet })).css;
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());

  async function mount({ storedWidth, artifact = false } = {}) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://garden-panels.test/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
    await page.goto(`https://garden-panels.test/${artifact ? "?artifact" : ""}`);
    if (storedWidth !== undefined) await page.evaluate(width => localStorage.setItem("breadboard:garden-workspace:panel-width", String(width)), storedWidth);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
    return page;
  }

  async function select(page, [button, label]) {
    await page.getByRole("navigation", { name: "Terminal actions" }).getByRole("button", { name: button, exact: true }).click();
    const panel = page.getByRole("complementary", { name: label, exact: true });
    await expect(panel.getByRole("heading", { name: label, exact: true })).toBeVisible({ timeout: 2_000 });
    const box = await panel.boundingBox();
    assert.ok(box && box.width >= 320 && box.height > 300, `${label} has a usable size`);
    assert.ok(Math.abs(box.x + box.width - 1440) < 1, `${label} stays on the right edge`);
    assert.equal(await panel.evaluate(node => node.contains(document.elementFromPoint(innerWidth - 30, 30))), true, `${label} is above other right-side content`);
    await panel.getByRole("button", { name: `Use ${label}`, exact: true }).click({ timeout: 2_000 });
    return panel;
  }

  await t.test("each navigation item opens its own visible panel", async () => {
    const page = await mount();
    for (const panel of panels) await select(page, panel);
    await page.getByRole("navigation", { name: "Terminal actions" }).getByRole("button", { name: "Uploads", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Uploads", exact: true })).toHaveCount(0);
  });

  await t.test("a previously saved collapsed width cannot hide menu selections", async () => {
    const page = await mount({ storedWidth: 0 });
    for (const panel of panels) await select(page, panel);
  });

  await t.test("switching and reopening collapsed panels restores the user's width", async () => {
    const page = await mount({ storedWidth: 580 });
    await select(page, panels[0]);
    await page.getByRole("button", { name: "Toggle the Processes panel", exact: true }).click();
    await expect(page.locator('aside[aria-label="Processes"]')).toHaveAttribute("inert", "");
    const uploads = await select(page, panels[5]);
    assert.equal(Math.round((await uploads.boundingBox()).width), 580);
    await page.getByRole("button", { name: "Toggle the Uploads panel", exact: true }).click();
    await page.getByRole("navigation", { name: "Terminal actions" }).getByRole("button", { name: "Uploads", exact: true }).click();
    const reopened = await select(page, panels[5]);
    assert.equal(Math.round((await reopened.boundingBox()).width), 580);
  });

  await t.test("an open artifact cannot cover the selected menu panel", async () => {
    const page = await mount({ artifact: true });
    await expect(page.getByRole("heading", { name: "Open artifact" })).toBeVisible();
    for (const panel of panels) await select(page, panel);
  });
});
