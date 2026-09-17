import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { chromium } from "playwright";

test("attachment preview ignores a detached click but accepts a direct click", { timeout: 30_000 }, async (t) => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import AttachmentPreviewDialog from "./src/app/components/attachment-preview-dialog";

        createRoot(document.getElementById("root")).render(
          <AttachmentPreviewDialog
            source={{ kind: "pdf", name: "notes.pdf", href: "/notes.pdf" }}
          >
            notes.pdf
          </AttachmentPreviewDialog>,
        );
      `,
    },
    bundle: true,
    write: false,
    outfile: "bundle.js",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "preview-dependencies",
        setup(builder) {
          const stubs = {
            "@/app/components/link-context-menu": `
              export function ContextMenuSurface({ children }) { return children; }
              export function OpenInNewTabItem() { return null; }
              export function OpenInNewWindowItem() { return null; }
            `,
            "@/app/components/reclaiming-media":
              "export function ReclaimingVideo() { return null; }",
            "@/app/components/breadboard-audio-player":
              "export default function BreadboardAudioPlayer() { return null; }",
          };
          builder.onResolve({ filter: /.*/ }, (args) =>
            args.path in stubs
              ? { path: args.path, namespace: "fixture" }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: stubs[args.path],
            loader: "tsx",
          }));
        },
      },
    ],
  });

  const executablePath = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
  ].find(existsSync);
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(
    `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
  );

  const trigger = page.getByRole("button", { name: "Open notes.pdf preview" });
  await trigger.waitFor();
  const detachedAccepted = await trigger.evaluate((button) =>
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    ),
  );
  assert.equal(detachedAccepted, false);
  assert.equal(await page.getByRole("dialog").count(), 0);

  await trigger.click();
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.getByRole("button", { name: "Close attachment preview" }).click();
  assert.equal(await page.getByRole("dialog").count(), 0);
});
