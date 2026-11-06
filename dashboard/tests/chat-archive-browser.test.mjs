import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = path.resolve(import.meta.dirname, "..");
function handler(file, name) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(result, `${name} exists`);
  return result;
}

test("terminal and garden menus archive, reopen and restore chats with failure recovery", { timeout: 120_000 }, async t => {
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    plugins: [{ name: "unused-artifact-icon", setup(build) {
      build.onResolve({ filter: /^\.\/artifact-panel$/ }, () => ({ path: "artifact-icon", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const ArtifactArchiveIcon = () => null;" }));
    } }],
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useEffect, useRef, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import TerminalSidebar from './src/app/components/hermes/terminal-sidebar';
      import ArchivedChatsPanel from './src/app/components/hermes/archived-chats-panel';
      import {HERMES_SESSIONS_CHANGED_EVENT, notifyHermesSessionsChanged} from './src/lib/hermes/session-client';
      const garden = location.pathname === '/garden';
      function App() {
        const [history, setHistory] = useState([]), [chatSessions, setChatSessions] = useState([]);
        const [historyError, setHistoryError] = useState(null), [railError, setRailError] = useState(null);
        const historyEpoch = useRef(0), chatHistoryEpoch = useRef(0);
        const archivingChatIds = useRef(new Set()), archivedChatIds = useRef(new Set());
        const [sidePanel, setSidePanel] = useState(null), [collapsed, setCollapsed] = useState(false);
        const [opened, setOpened] = useState('Transcript stays open');
        ${handler("src/app/components/hermes/dashboard-agent-terminal.tsx", "archiveHistorySession")}
        ${handler("src/app/gardens/[clusterSlug]/workspace-client.tsx", "patchChatMark")}
        useEffect(() => {
          const refresh = () => fetch('/history').then(r => r.json()).then(rows => {setHistory(rows.filter(r => !r.archived)); setChatSessions(rows)});
          refresh(); window.addEventListener(HERMES_SESSIONS_CHANGED_EVENT, refresh);
          return () => window.removeEventListener(HERMES_SESSIONS_CHANGED_EVENT, refresh);
        }, []);
        const chats = (garden ? chatSessions.filter(chat => !chat.archived) : history).map(chat => ({...chat, id:String(chat.id)}));
        return <main style={{display:'flex',height:'100vh'}}>
          <TerminalSidebar chats={chats} loading={false} error={garden ? railError : historyError} activeChatId={null}
            openPanel={sidePanel} onTogglePanel={panel=>setSidePanel(current=>current === panel ? null : panel)}
            collapsed={collapsed} onToggleCollapsed={()=>setCollapsed(c=>!c)} onNewChat={()=>{}} onOpenSearch={()=>{}}
            onOpenChat={chat=>setOpened(chat.id)} onRenameChat={()=>{}} onTogglePin={()=>{}}
            onArchiveChat={chat=>garden ? void patchChatMark(chat,{archived:true},'This chat could not be archived.') : void archiveHistorySession(chat)}
            onDeleteChat={()=>{}} onDeleteChats={()=>{}} onHighlightChat={()=>{}}/>
          <div style={{width:500}}>{sidePanel==='archived' && <ArchivedChatsPanel gardenSlug={garden?'garden':undefined} onOpenChat={setOpened}/>}</div>
          <output aria-label='Opened chat'>{opened}</output>
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
  for (const garden of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let archived = false, failPatch = false, releaseArchive;
    const id = garden ? 42 : "conv_terminal";
    const row = () => ({ id, title: "Saved lesson", updatedAt: "2026-09-26T12:00:00Z", archived, pinned: true, highlight: "sage", active: false, unread: false, isOwn: true });
    await page.route("https://archive.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/history") return route.fulfill({ json: [row()] });
      if (url.pathname === "/api/archived-chats") {
        assert.equal(url.searchParams.get("gardenSlug"), garden ? "garden" : null);
        return route.fulfill({ json: { chats: archived ? [{ id: "conv_terminal", chatId: String(id), title: "Saved lesson", originLabel: garden ? "Garden" : "Terminal", archivedAt: "2026-09-26T12:00:00Z" }] : [] } });
      }
      if (route.request().method() === "PATCH") {
        if (failPatch) return route.fulfill({ status: 500, json: { error: "Save failed" } });
        const body = route.request().postDataJSON();
        if (body.archived) await new Promise(resolve => { releaseArchive = resolve; });
        archived = body.archived;
        return route.fulfill({ json: { success: true } });
      }
      return route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0"><div id="root"></div></body></html>' });
    });
    async function mount() {
      await page.goto(`https://archive.test/${garden ? "garden" : "terminal"}`);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
    }
    await mount();
    const nav = page.getByRole("navigation", { name: "Terminal actions" });
    const labels = await nav.getByRole("button").allTextContents();
    assert.equal(labels.findIndex(label => label.trim() === "Archived"), labels.findIndex(label => label.trim() === "Starred") + 1);
    const more = page.locator('button[aria-label="More actions for Saved lesson"]');
    await page.getByText("Saved lesson", { exact: true }).hover();
    await more.click();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(more).toHaveCount(0);
    await expect.poll(() => typeof releaseArchive).toBe("function");
    releaseArchive();
    await nav.getByRole("button", { name: "Archived", exact: true }).click();
    const panel = page.getByRole("region", { name: "Archived chats" });
    await expect(panel.getByText("Saved lesson", { exact: true })).toBeVisible();
    if (process.env.BREADBOARD_ARCHIVE_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.BREADBOARD_ARCHIVE_SCREENSHOT_DIR, `archive-${garden ? "garden" : "terminal"}.png`) });
    }
    await panel.getByRole("button", { name: /Saved lesson.*(?:Terminal|Garden)/ }).click();
    await expect(page.getByLabel("Opened chat")).toHaveText(String(id));
    assert.equal(archived, true, "opening a chat must not restore it");
    await mount();
    await expect(more).toHaveCount(0);
    await nav.getByRole("button", { name: "Archived", exact: true }).click();
    const restore = panel.getByRole("button", { name: "Restore Saved lesson", exact: true });
    await expect(restore).toBeVisible();
    failPatch = true;
    await restore.click();
    await expect(panel.getByRole("alert")).toContainText("could not be restored");
    await expect(restore).toBeEnabled();
    failPatch = false;
    await restore.click();
    await expect(more).toHaveCount(1);
    await expect(panel).toContainText("No archived chats yet");
    failPatch = true;
    await page.getByText("Saved lesson", { exact: true }).hover();
    await more.click();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(more).toHaveCount(1);
    await expect(page.getByText("This chat could not be archived.", { exact: true })).toBeVisible();
    assert.equal(archived, false);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
