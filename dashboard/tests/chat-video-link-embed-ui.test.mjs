import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

test("a pasted video link plays inline and leaves enlarging to the player's own fullscreen control", { timeout: 60_000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import Embeds from './src/app/components/chat-video-link-embed';
      const root = createRoot(document.getElementById('root'));
      window.renderVideo = text => root.render(<Embeds text={text}/>);
      window.renderVideo('https://www.youtube.com/watch?v=1TKSfAkWWN0');
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    outfile: "video-embed.js", define: { "process.env.NODE_ENV": '"production"' },
  });
  const globalSource = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8")
    .replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/chat-video-link-embed.tsx";');
  const css = (await postcss([tailwind({ base: root })]).process(globalSource, {
    from: path.join(root, "src/app/globals.css"),
  })).css;
  const executablePath = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
  ].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  let playerLoads = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://i.ytimg.com/**", route => route.fulfill({
    contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#224488"/></svg>',
  }));
  await page.route("https://www.youtube-nocookie.com/**", route => {
    playerLoads++;
    return route.fulfill({ contentType: "text/html", body: '<body style="background:#224488;color:white"><p>Video playing</p></body>' });
  });
  // A transformed, clipped transcript must not constrain the enlarged player.
  await page.setContent('<html data-theme="light"><body><section style="width:500px;height:440px;overflow:auto;transform:translateY(20px)"><div id="root"></div><p id="next-message">Next message</p></section></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js")).text });

  // The only control before play is the facade; the card adds no enlarge
  // button of its own, since the player's iframe ships a fullscreen control.
  await expect(page.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Play video" })).toBeVisible();
  const caption = page.getByRole("link", { name: /YouTube/ });
  await expect(caption).toHaveAttribute("href", "https://www.youtube.com/watch?v=1TKSfAkWWN0");
  assert.equal(playerLoads, 0, "the facade must not load the player eagerly");
  const nextMessageBox = await page.locator("#next-message").boundingBox();

  await page.getByRole("button", { name: "Play video" }).click();
  const player = page.locator("iframe");
  await expect(page.frameLocator("iframe").getByText("Video playing")).toBeVisible();
  assert.equal(playerLoads, 1);
  // Swapping the facade for the iframe keeps the row height the virtualized
  // transcript measured, so the following message does not move.
  assert.deepEqual(await page.locator("#next-message").boundingBox(), nextMessageBox);
  // The player's own fullscreen button only works if the embedding page
  // delegates fullscreen to the cross-origin frame.
  await expect(player).toHaveAttribute("allowfullscreen", "");
  const allow = await player.getAttribute("allow");
  assert.ok((allow ?? "").split(";").map((token) => token.trim()).includes("fullscreen"), `iframe must delegate fullscreen, got allow="${allow}"`);
  await expect(page.getByRole("button")).toHaveCount(0);
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  assert.deepEqual(errors, []);
});
