import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runElectronFixture } from "./helpers/run-electron-fixture";

test("Terminal widgets, theme, location and appearance become ready while six Chromium connections remain occupied", {timeout:45_000}, async t => {
  const desktop=path.resolve(__dirname,"../..");
  const dashboard=path.resolve(desktop,"../dashboard");
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"bb-terminal-congestion-"));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_TEST_CONTEXT;
  try {
    const {build}=require(path.join(dashboard,"node_modules/esbuild"));
    const bundle=await build({stdin:{resolveDir:dashboard,loader:"tsx",contents:`
      import {createRoot} from 'react-dom/client';
      import Gate from './src/app/components/interaction-hydration-gate';
      import Accessories from './src/app/browser/browser-home-accessories';
      import Usage from './src/app/new-tab/provider-usage-notch';
      import Theme from './src/app/components/app-theme-runtime';
      import Location from './src/app/components/current-location-autorefresh';
      import {hydratePageAppearance} from './src/lib/page-appearance-client';
      void hydratePageAppearance('fixture', 'new-tab').then(()=>{window.appearanceReady=true});
      createRoot(document.getElementById('root')).render(<Gate><Theme /><Location /><Accessories ownerKey="fixture" /><Usage /></Gate>);
    `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",outfile:"widgets.js"});
    fs.writeFileSync(path.join(directory,"widgets.js"),bundle.outputFiles.find((file:{path:string})=>file.path.endsWith('.js')).contents);
    const result=await runElectronFixture(require("electron") as string,[path.join(desktop,"tests/fixtures/terminal-startup-congestion.cjs"),directory],desktop,env,30_000);
    assert.equal(result.error,undefined,`${result.error?.message}\n${result.output}`);assert.equal(result.status,0,result.output);
    const timing=result.output.split(/\r?\n/).find(line=>line.startsWith('{"widgetsReadyMs":'));if(timing)t.diagnostic(timing);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
