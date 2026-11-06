import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("login errors recover, callback screens return, and browser tabs follow sign-in/out", { timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({ absWorkingDir: root, metafile: true, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "src") }, stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Login from '@/app/auth/login/page';
      import AuthenticationSync from '@/app/components/authentication-sync';
      import SignOutButton from '@/app/components/sign-out-button';
      createRoot(document.getElementById('root')).render(<><AuthenticationSync />
        {location.pathname.startsWith('/auth/') ? <Login /> : <><h1>Workspace</h1><SignOutButton>Sign out</SignOutButton></>}
      </>);` },
    plugins: [{ name: "auth-fixture", setup(builder) {
      const stubs = {
        "next/navigation": `export const useSearchParams=()=>new URLSearchParams(location.search);`,
        "next/link": `import React from 'react'; export default props=>React.createElement('a',props);`,
        "next-auth/react": `
          export async function signIn(provider, options) {
            if (window.failNetwork) throw new Error('offline');
            const response = await fetch('/fixture/signin', {method:'POST',body:JSON.stringify(options)});
            const result=await response.json();
            if(result.ok) localStorage.setItem('nextauth.message',JSON.stringify({event:'session',stamp:Date.now()}));
            return result;
          }
          export async function signOut() {
            await fetch('/fixture/signout',{method:'POST'});
            localStorage.setItem('nextauth.message',JSON.stringify({event:'session',stamp:Date.now()}));
          }`,
      };
      builder.onResolve({ filter: /./ }, args => {
        if (args.path.endsWith('desktop-browser-tabs')) return {path:'desktop',namespace:'stub'};
        if (args.path.endsWith('navigation-progress')) return {path:'progress',namespace:'stub'};
        if (stubs[args.path]) return {path:args.path,namespace:'stub'};
      });
      builder.onLoad({ filter: /.*/, namespace:'stub' }, args => ({ loader:'js', resolveDir:root,
        contents: args.path==='desktop' ? 'export const desktopTabsBridge=()=>undefined;'
          : args.path==='progress' ? 'export const startNavigationProgress=()=>{};' : stubs[args.path],
      }));
    } }],
  });
  // Match Next's dashboard-only module boundary; esbuild otherwise accepts
  // sibling desktop imports that the production Turbopack build cannot load.
  for (const input of Object.keys(bundle.metafile.inputs)) {
    if (input === "<stdin>" || input.startsWith("stub:")) continue;
    const relative = path.relative(root, path.resolve(root, input));
    assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `Authentication bundle imports a file outside the dashboard: ${input}`);
  }
  let signedIn = false;
  let callback;
  const server = http.createServer(async (req,res) => {
    if (req.url === '/bundle.js') { res.setHeader('content-type','application/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === '/api/auth/session') { res.setHeader('content-type','application/json'); res.end(JSON.stringify(signedIn ? {user:{id:'1'}} : {})); return; }
    if (req.url === '/fixture/signin') {
      let body=''; for await(const part of req) body+=part;
      const form=JSON.parse(body); signedIn=form.password==='correct'; callback=form.callbackUrl;
      res.setHeader('content-type','application/json'); res.end(JSON.stringify(signedIn ? {ok:true} : {ok:false,error:'CredentialsSignin'})); return;
    }
    if (req.url === '/fixture/signout') { signedIn=false; res.end('{}'); return; }
    res.setHeader('content-type','text/html'); res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  t.after(() => browser.close());
  const context=await browser.newContext();
  const first=await context.newPage(), second=await context.newPage();
  const origin='http://127.0.0.1:'+server.address().port;
  const errors=[]; first.on('pageerror',error=>errors.push(error.message)); second.on('pageerror',error=>errors.push(error.message));
  await first.goto(origin+'/auth/login?callbackUrl='+encodeURIComponent('/gardens/one?chat=42#reply'));
  await second.goto(origin+'/auth/login?callbackUrl=%2Fprofile');
  await first.getByLabel('Email',{exact:true}).fill('fixture@example.com');
  await first.getByLabel('Password',{exact:true}).fill('wrong');
  await first.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(first.getByText('Invalid email or password.')).toBeVisible();
  await expect(first.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
  await first.evaluate(()=>{window.failNetwork=true;});
  await first.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(first.getByText('Could not sign in. Please try again.')).toBeVisible();
  await first.evaluate(()=>{window.failNetwork=false;});
  await first.getByLabel('Password',{exact:true}).fill('correct');
  await first.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(first).toHaveURL(origin+'/gardens/one?chat=42#reply');
  await expect(second).toHaveURL(origin+'/profile');
  assert.equal(callback,'/gardens/one?chat=42#reply');
  await expect(second.getByRole('heading',{name:'Workspace'})).toBeVisible();
  await first.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(first).toHaveURL(/\/auth\/login/);
  await expect(second).toHaveURL(origin+'/auth/login?callbackUrl=%2Fprofile');
  await expect(second.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);
});
