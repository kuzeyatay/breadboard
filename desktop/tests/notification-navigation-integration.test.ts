import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

test("notification Open reuses live chats and opens missing chats in the foreground", {
  skip: process.platform !== "win32",
}, () => {
  const desktop = path.resolve(__dirname, "../..");
  const dashboard = path.resolve(desktop, "../dashboard");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-notification-navigation-"));
  const { buildSync } = require(path.join(dashboard, "node_modules/esbuild"));
  try {
    const routerStub = path.join(dir, "navigation.js");
    fs.writeFileSync(routerStub, "export const useRouter=()=>({push(){throw Error('Unexpected page navigation')}}); export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search);");
    const bundle = buildSync({
      stdin: { resolveDir: dashboard, loader: "tsx", contents: `
        import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {Toaster} from './src/app/components/toast';
        import {setActiveChatNotificationTarget, setActiveLearnNotificationGarden} from './src/lib/chat-notification-inbox';
        window.setChat = setActiveChatNotificationTarget;
        window.setLearn = setActiveLearnNotificationGarden;
        function App() {
          const [toasts, setToasts] = useState([]);
          window.showNotice = target => setToasts([{id:'notice', type:'success', message:'Ready', target}]);
          return <Toaster toasts={toasts} onDismiss={()=>setToasts([])}/>;
        }
        createRoot(document.getElementById('root')).render(<App/>);
      ` },
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      alias: { "next/navigation": routerStub, "@": path.join(dashboard, "src") },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    fs.writeFileSync(path.join(dir, "app.js"), bundle.outputFiles[0].text);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(path.join(desktop, "node_modules/electron/dist/electron.exe"), [
      path.join(desktop, "tests/fixtures/notification-navigation.cjs"), dir,
    ], { cwd: desktop, env, encoding: "utf8", windowsHide: true, timeout: 45_000 });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  } finally {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("bb-notification-navigation-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
