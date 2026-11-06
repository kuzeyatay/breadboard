import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";

test("restored chat images load while hidden, survive reloads, and stay centered at desktop and mobile widths", { timeout: 60000 }, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const styles = postcss.parse(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"));
  const css = styles.nodes.filter(node => node.type === "rule" &&
    node.selector.split(",").some(selector => [".chat-markdown", ".chat-markdown-image", ".chat-markdown img"].includes(selector.trim())))
    .map(node => node.toString()).join("\n");
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import ChatMarkdown from './src/app/components/chat-markdown';
      createRoot(document.getElementById('root')).render(<ChatMarkdown content={
        '![Garden diagram](/course/assets/diagram.svg)\\n\\n![External diagram](/external.svg)'
      } />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "src") },
  });
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.url === "/app.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (request.url.endsWith(".svg")) {
      requests.push(request.url);
      const width = request.url === "/external.svg" ? 1440 : 240;
      response.setHeader("content-type", "image/svg+xml");
      response.setHeader("cache-control", "private, no-cache");
      response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width * 2 / 3}"><rect width="100%" height="100%" fill="#659b82"/></svg>`);
    } else {
      response.setHeader("content-type", "text/html");
      response.end(`<style>body{margin:0;padding:16px}#root{max-width:900px;margin:auto}${css}</style><div id="root" style="display:none"></div><script src="/app.js"></script>`);
    }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "msedge" } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (let reload = 0; reload < 2; reload++) {
        const before = requests.length;
        if (reload) await page.reload();
        else await page.goto(`http://127.0.0.1:${server.address().port}`);
        // Restored tabs can mount while hidden. Do not reveal or scroll them to
        // trigger native lazy loading: the images must already be decoded.
        await page.waitForFunction(() => {
          const images = [...document.querySelectorAll(".chat-markdown img")];
          return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0);
        });
        assert.equal(requests.length - before, 2);
        await page.locator("#root").evaluate(element => { element.style.display = "block"; });
        // Already-open chats can still use the previous component bundle.
        // They and messages inserted later must center without migrating each
        // image element to a new class or reloading the active conversation.
        await page.locator(".chat-markdown").evaluate(markdown => {
          for (const image of markdown.querySelectorAll("img")) image.classList.remove("chat-markdown-image");
          const paragraph = document.createElement("p");
          paragraph.append(markdown.querySelector("img").cloneNode());
          markdown.append(paragraph);
        });
        await page.waitForFunction(() => [...document.querySelectorAll(".chat-markdown img")]
          .every(image => image.complete && image.naturalWidth > 0));
        const dimensions = await page.locator(".chat-markdown img").evaluateAll(images => images.map(image => {
          const box = image.getBoundingClientRect(), parent = image.parentElement.getBoundingClientRect();
          return { width: box.width, height: box.height, available: parent.width,
            centerError: Math.abs(box.x + box.width / 2 - parent.x - parent.width / 2) };
        }));
        for (const image of dimensions) {
          assert.ok(image.width > 0 && image.width <= image.available);
          assert.ok(image.centerError < 1, JSON.stringify(image));
          assert.ok(Math.abs(image.width / image.height - 1.5) < 0.01);
        }
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
