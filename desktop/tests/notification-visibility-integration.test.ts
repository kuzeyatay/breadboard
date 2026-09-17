import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

test("response notifications paint in the native overlay, including during voice", {
  skip: process.platform !== "win32",
}, async () => {
  const desktop = path.resolve(__dirname, "../..");
  const dashboard = path.resolve(desktop, "../dashboard");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-notification-visibility-"));
  const dashboardRequire = createRequire(path.join(dashboard, "package.json"));
  const { buildSync } = dashboardRequire("esbuild");
  const postcss = dashboardRequire("postcss");
  const tailwind = dashboardRequire("@tailwindcss/postcss");
  try {
    const router = path.join(dir, "navigation.js");
    fs.writeFileSync(router, "export const useRouter=()=>({push(){}}); export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search);");
    const bundle = buildSync({
      stdin: { resolveDir: dashboard, loader: "tsx", contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import Overlay from './src/app/notification-overlay/notification-overlay-client';
        import {publishNotificationInbox, notificationRequestTime} from './src/lib/speech/notification-events';
        window.deliverInbox = messages => publishNotificationInbox({messages, requestedAt:notificationRequestTime()});
        if (location.pathname === '/notification-overlay') createRoot(document.getElementById('root')).render(<Overlay/>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      alias: { "next/navigation": router, "@": path.join(dashboard, "src") },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    fs.writeFileSync(path.join(dir, "app.js"), bundle.outputFiles[0].text);
    const cssPath = path.join(dashboard, "src/app/globals.css");
    const cssInput = fs.readFileSync(cssPath, "utf8").replace(
      '@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/toast.tsx";',
    );
    const css = await postcss([tailwind({ base: dashboard })]).process(cssInput, { from: cssPath });
    fs.writeFileSync(path.join(dir, "style.css"), css.css);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(path.join(desktop, "node_modules/electron/dist/electron.exe"), [
      path.join(desktop, "tests/fixtures/notification-visibility.cjs"), dir,
    ], { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 45_000 });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("bb-notification-visibility-"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
