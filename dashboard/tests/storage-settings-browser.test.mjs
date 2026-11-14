import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

test("Storage settings display partial accounting, preserve controls and submit explicit actions",async()=>{
  const compiled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import SettingsStorage from './src/app/components/settings-storage.tsx';createRoot(document.getElementById('root')).render(<SettingsStorage/>);`,resolveDir:path.resolve(import.meta.dirname,".."),loader:"tsx"},bundle:true,write:false,platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'}});
  const status={automatic:true,freeBytes:3*1024**3,compressedPayloadBytesSaved:123456,disposables:{verifiedBytes:4096,verifiedFiles:1,complete:false},database:{reusableBytes:987654},
    inventory:{complete:false,allocatedBytes:12345678,hardlinkBytesAvoided:4096,skippedEntries:2,categories:{database:10000000,artifacts:2345678},largest:[{path:"artifacts/example.pdf",bytes:2345678}]},
    lastResult:{finishedAt:Date.now(),bytesReleased:4096,skipped:["A recovery lease protects this workspace."]},protected:["Chats and attachments"],compaction:null,
    workspaces:{files:2,workspaces:1,deduplicatedBytes:123456,compressedBytes:234567,recoveryCopies:1,archivedWorkspaces:[{key:"conversations/conv_a/conv_a",files:2}],skipped:[]}};
  const actions=[];let owner=true;
  const server=http.createServer(async(req,res)=>{
    if(req.url==="/bundle.js"){res.setHeader("Content-Type","application/javascript");res.end(compiled.outputFiles[0].text);return;}
    if(req.url?.startsWith("/api/storage")){
      res.setHeader("Content-Type","application/json");
      if(!owner){res.statusCode=403;res.end(JSON.stringify({error:"Only the installation owner can manage storage."}));return;}
      let body="";for await(const chunk of req)body+=chunk;
      if(body){const input=JSON.parse(body);actions.push(input);if(req.method==="PATCH")status.automatic=input.automatic;if(input.action==="compact")status.compaction={phase:"pending"};}
      res.end(JSON.stringify(status));return;
    }
    res.setHeader("Content-Type","text/html");res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const browser=await chromium.launch({channel:process.platform==="win32"?"msedge":undefined,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:640,height:900}});const errors=[];page.on("pageerror",error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText("3.00 GiB",{exact:true}).waitFor();
    assert.equal(await page.getByText("Verified disposable files (partial)",{exact:true}).count(),1);
    assert.equal(await page.getByText("Cold workspace input savings",{exact:true}).count(),1);
    await page.getByText("Restore archived workspace inputs",{exact:true}).click();
    await page.getByRole("button",{name:"Restore files",exact:true}).click();
    assert.ok(actions.some(action=>action.workspaceKey==="conversations/conv_a/conv_a"));
    await Promise.all([page.waitForResponse(response=>response.url().endsWith("/api/storage")&&response.request().method()==="GET"),page.getByRole("checkbox",{name:"Automatic housekeeping"}).uncheck()]);
    await page.getByRole("button",{name:"Clean disposable files now"}).click();
    await page.getByRole("button",{name:"Refresh measurements"}).waitFor({state:"visible"});
    await page.getByRole("button",{name:"Compact databases when idle"}).click();
    await page.getByRole("status").waitFor();
    assert.ok(actions.some(action=>action.automatic===false));assert.ok(actions.some(action=>action.action==="clean"));assert.ok(actions.some(action=>action.action==="compact"));
    owner=false;await page.reload();await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(),/installation owner/u);
    assert.equal(await page.getByRole("button",{name:"Retry",exact:true}).count(),1);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
