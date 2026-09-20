import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = fs.readFileSync(path.join(root, "src/app/components/hermes/terminal-sidebar.tsx"), "utf8");
const tree = ts.createSourceFile("sidebar.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const buttons = tree.statements.filter(node => ts.isFunctionDeclaration(node) && ["NavButton", "NewChatIcon"].includes(node.name?.text)).map(node => node.getText(tree)).join("\n");

test("the pen workspace menu works from a blank chat in both rail sizes", { timeout: 60000 }, async t => {
  const bundle = await build({ bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "src") }, logLevel: "silent", stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import TerminalWorkspaceMenu from '@/app/components/hermes/terminal-workspace-menu';
      ${buttons}
      function App() {
        const [selected, setSelected] = useState(null);
        const [compact, setCompact] = useState(false);
        return <section style={{position:'fixed',left:20,top:30,width:compact?52:260}}>
          <TerminalWorkspaceMenu selected={selected} onSelect={value=>{setSelected(value);window.selection=value;}}>
            <NavButton label='New chat' icon={<NewChatIcon/>} compact={compact} disabled allowContextMenuWhenDisabled onClick={()=>{window.clicked=true;}}/>
          </TerminalWorkspaceMenu>
          <button onClick={()=>setCompact(value=>!value)}>Toggle rail</button>
          <button>Outside</button>
        </section>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const stylesheet = path.join(root, "src/app/globals.css");
  const css = (await postcss([tailwindcss({ base: root })]).process(fs.readFileSync(stylesheet, "utf8"), { from: stylesheet })).css;
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let mode = "ready";
  await page.route("http://workspace.test/", route => route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }));
  await page.route("**/api/clusters", route => route.fulfill({ status: mode === "error" ? 500 : 200, contentType: "application/json", body: JSON.stringify({ clusters: mode === "empty" ? [] : [{ name: "Physics", slug: "physics" }, { name: "Biology", slug: "biology" }] }) }));
  await page.goto("http://workspace.test/");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const pen = page.getByRole("button", { name: "New chat", exact: true });
  // The left-click action is inactive, but native disabled must not swallow right-click.
  await pen.click({ force: true });
  assert.equal(await page.evaluate(() => window.clicked), undefined);
  for (const compact of [false, true]) {
    if (compact) await page.getByRole("button", { name: "Toggle rail" }).click();
    await pen.click({ button: "right", force: true });
    const physics = page.getByRole("menuitemradio", { name: "Physics" });
    await physics.waitFor();
    assert.deepEqual(await page.getByRole("menuitemradio").allTextContents(), compact ? ["No workspace", "Biology", "✓Physics"] : ["✓No workspace", "Biology", "Physics"]);
    await physics.click();
    assert.deepEqual(await page.evaluate(() => window.selection), { name: "Physics", slug: "physics" });
    assert.equal(await page.getByRole("menu").count(), 0);
  }
  await pen.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menu", { name: "New chat workspace" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu").count(), 0);
  await pen.click({ button: "right", force: true });
  await page.getByRole("menuitemradio", { name: "Physics" }).waitFor();
  await page.getByRole("menuitemradio", { name: "No workspace" }).click();
  assert.equal(await page.evaluate(() => window.selection), null);
  mode = "error";
  await pen.click({ button: "right", force: true });
  const retry = page.getByRole("menuitem", { name: "Couldn’t load workspaces. Retry" });
  await retry.waitFor();
  mode = "empty";
  await retry.click();
  await page.getByRole("menuitem", { name: "No workspaces yet" }).waitFor();
  await page.getByRole("button", { name: "Outside" }).click();
  assert.equal(await page.getByRole("menu").count(), 0);
  assert.deepEqual(errors, []);
});
