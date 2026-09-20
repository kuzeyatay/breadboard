import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("address typing and caret survive a brief toolbar blur", { timeout: 30_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const source = ts.createSourceFile("browser-client.tsx", fs.readFileSync(
    path.join(root, "src/app/browser/browser-client.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let addressInput;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "input" &&
        node.attributes.properties.some(prop => ts.isJsxAttribute(prop) &&
          prop.name.getText(source) === "aria-label" && prop.initializer?.text === "Address and search")) addressInput = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(addressInput, "production address input exists");
  // Exercise the actual production input/handlers with a small stateful host.
  // Services and the native view stack are covered by the desktop fixture.
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState,useRef} from 'react';
      import {createRoot} from 'react-dom/client';
      const browser = {address:'https://example.test/'};
      window.commands = [];
      const sendDesktopTabsCommand = command => window.commands.push(command);
      const handleAddressKeys = () => {};
      function App() {
        const inputRef=useRef(null), addressBlurTimer=useRef(null);
        const [draftAddress,setDraftAddress]=useState(null);
        const [addressFocused,setAddressFocused]=useState(false);
        const [highlightedAddressSuggestion,setHighlightedAddressSuggestion]=useState(-1);
        const addressDisplay=draftAddress ?? browser.address;
        const addressSuggestions=[{value:'example'}];
        return <><button id="outside">Outside</button>${addressInput.getText(source)}</>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  });
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<!doctype html><div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const input = page.getByRole("combobox", { name: "Address and search" });
  await input.click();
  await page.keyboard.type("abc");
  await expect(input).toHaveValue("abc");
  await input.evaluate(node => {
    node.setSelectionRange(1, 1);
    document.getElementById('outside').focus();
    node.focus();
  });
  await page.waitForTimeout(180);
  await expect(input).toBeFocused();
  assert.equal(await input.evaluate(node => node.selectionStart), 1, "refocus preserves the caret");
  await page.keyboard.type("defghijklmnop", { delay: 15 });
  await expect(input).toHaveValue("adefghijklmnopbc");
  assert.deepEqual(await page.evaluate(() => window.commands), [], "the stale timer cannot dismiss suggestions");

  await page.locator("#outside").click();
  await expect(input).toHaveValue("https://example.test/");
  assert.deepEqual(await page.evaluate(() => window.commands), [{ type: "browser-address-suggestions", open: false }]);
  assert.deepEqual(errors, []);
});

test("browser snapshots do not steal address focus on the home page", { timeout: 30_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const source = ts.createSourceFile("browser-client.tsx", fs.readFileSync(
    path.join(root, "src/app/browser/browser-client.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const focusStatements = [];
  function visit(node) {
    if ((ts.isVariableStatement(node) || ts.isExpressionStatement(node)) &&
        ts.isBlock(node.parent) && ts.isFunctionDeclaration(node.parent.parent)) {
      const text = node.getText(source);
      if (text.includes("breadboard:focus-browser-address") || text.includes("browserHomeActive")) {
        focusStatements.push(text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(focusStatements.length, "production browser focus effects exist");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState,useRef,useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      function App() {
        const inputRef=useRef(null), searchRef=useRef(null);
        const [revision,setRevision]=useState(0);
        const [isActive,setIsActive]=useState(true);
        const browser={address:''};
        window.refreshBrowser=()=>setRevision(value=>value+1);
        window.activateBrowser=setIsActive;
        ${focusStatements.join('\n')}
        return <div data-revision={revision}><input ref={inputRef} aria-label="Address"/>
          <input ref={searchRef} aria-label="Home search"/></div>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  });
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const input = page.getByRole("textbox", { name: "Address", exact: true });
  const home = page.getByRole("textbox", { name: "Home search" });
  await expect(home).toBeFocused();
  await input.click();
  await page.keyboard.type("abc");
  for (let revision = 1; revision <= 5; revision++) {
    await page.evaluate(() => window.refreshBrowser());
    await expect(page.locator('[data-revision]')).toHaveAttribute('data-revision', String(revision));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(input).toBeFocused();
    await page.keyboard.type("d");
  }
  await expect(input).toHaveValue("abcddddd");
  await page.evaluate(() => window.activateBrowser(false));
  await page.waitForTimeout(30);
  await page.evaluate(() => window.activateBrowser(true));
  await expect(home).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event("breadboard:focus-browser-address")));
  await expect(input).toBeFocused();
});
