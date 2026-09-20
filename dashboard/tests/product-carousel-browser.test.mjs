import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

test("product cards preserve scrolling and actions across themes and mobile widths", { timeout: 60_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const resource = {
    schemaVersion: 1, kind: "product-search", renderer: "product-carousel", id: "products:qa", title: "External SSDs", createdAt: new Date().toISOString(), actions: ["open-details", "find-similar", "compare", "visit"],
    data: { query: "external SSD", sources: [], products: [
      { id: "one", title: "Acme X4 External SSD 2 TB", merchant: "Example Store", price: { amount: "199", currency: "EUR", display: "€199.00" }, rating: 4.8, reviewCount: 128, imageUrl: "https://images.example/ssd.svg" },
      { id: "two", title: "Acme Portable USB4 SSD 1 TB", merchant: "Example Electronics", price: { amount: "149", currency: "EUR", display: "€149.00" }, imageUrl: "https://images.example/broken.jpg" },
      { id: "three", title: "Acme Pro External SSD 4 TB", merchant: "Example Store", price: { amount: "349", currency: "EUR", display: "€349.00" } },
    ].map(product => ({ ...product, url: `https://shop.example/products/${product.id}`, sourceIds: [] })) },
  };
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import ProductCarousel from './src/app/components/hermes/product-carousel';
      const resource = ${JSON.stringify(resource)};
      function App() {
        const [selected, select] = useState([]);
        window.actions = [];
        const onAction = action => { window.actions.push(action); if(action.type === 'product.select') select(ids => ids.includes(action.productId) ? ids.filter(id => id !== action.productId) : [...ids, action.productId]); };
        return <ProductCarousel resource={resource} onAction={onAction} activeCompareProductIds={selected}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: "widget.js", format: "iife", platform: "browser", jsx: "automatic",
  });
  const css = await postcss([tailwind({ base: root })]).process(
    '@import "tailwindcss" source(none); @source "./src/app/components/hermes/product-carousel.tsx";',
    { from: path.join(root, "product-qa.css") },
  );
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1120, height: 720 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://images.example/**", route => route.request().url().endsWith("broken.jpg") ? route.abort() : route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect x="100" y="8" width="100" height="144" rx="14" fill="#48494c"/><rect x="112" y="18" width="76" height="120" rx="9" fill="#66676b"/><text x="150" y="85" fill="white" font-size="16" text-anchor="middle" font-family="Arial">SSD</text></svg>' }));
  await page.setContent('<!doctype html><html data-theme="light"><body><main><div id="root"></div></main></body></html>');
  await page.addStyleTag({ content: `${css.css}\n${bundle.outputFiles.find(file => file.path.endsWith(".css")).text}\nbody{background:#faf8f2;margin:0} main{max-width:1024px;margin:auto;padding:32px 20px} :root{--color-white:#13201b}` });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });
  const cards = page.locator("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(1).getByText("Image unavailable")).toBeVisible();
  const track = page.locator(".grid-flow-col");
  const original = await track.evaluate(element => ({ width: element.clientWidth, behavior: getComputedStyle(element).scrollBehavior, snap: getComputedStyle(element).scrollSnapType, touch: getComputedStyle(element).touchAction }));
  assert.equal(original.behavior, "smooth");
  assert.equal(original.snap, "x mandatory");
  assert.equal(original.touch, "pan-x");
  await track.evaluate(element => { const scrollBy = element.scrollBy.bind(element); element.scrollBy = options => { window.scrollOptions = options; scrollBy(options); }; });
  await page.getByRole("button", { name: "Next products" }).click();
  await expect.poll(() => track.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  assert.deepEqual(await page.evaluate(() => window.scrollOptions), { left: original.width, behavior: "smooth" });
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.getByRole("button", { name: "Previous products" }).click();
  await expect.poll(() => track.evaluate(element => element.scrollLeft)).toBe(0);
  await cards.first().getByRole("button", { name: /Select .* for comparison/ }).click();
  await expect(cards.first().getByRole("button", { name: /Deselect .* for comparison/ })).toHaveAttribute("aria-pressed", "true");
  for (const [name, type] of [[/Open details/, "product.open-details"], [/Find products similar/, "product.find-similar"], [/Visit Example/, "product.visit"]]) {
    await cards.first().getByRole("button", { name }).click();
    assert.equal(await page.evaluate(() => window.actions.at(-1).type), type);
  }
  const artifacts = path.join(root, "artifacts", "product-widget");
  fs.mkdirSync(artifacts, { recursive: true });
  await page.locator("section").screenshot({ path: path.join(artifacts, "desktop.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.body.style.background = "#161617"; });
  assert.equal(await cards.first().evaluate(element => getComputedStyle(element).backgroundColor), "rgb(36, 36, 38)");
  await page.locator("section").screenshot({ path: path.join(artifacts, "dark.png") });
  await page.setViewportSize({ width: 390, height: 750 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; document.body.style.background = "#faf8f2"; });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(await cards.first().evaluate(element => element.clientWidth < innerWidth));
  await page.locator("section").screenshot({ path: path.join(artifacts, "mobile.png") });
  assert.deepEqual(errors, []);
});
