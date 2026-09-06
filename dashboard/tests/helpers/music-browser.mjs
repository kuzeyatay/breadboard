import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import esbuild from "esbuild";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { testWav } from "./fake-acestep.mjs";

/** Execute each surface's actual card JSX; keep unrelated full-app providers outside this fixture. */
function surfaceCard(root, file) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root,file),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let found;
  function visit(node) { if(ts.isJsxSelfClosingElement(node) && node.tagName.getText(source)==="InlineMusicProducerRun") found=node.getText(source);ts.forEachChild(node,visit); }
  visit(source);if(!found)throw Error("Missing music card in "+file);return found;
}
export async function musicBrowser() {
  const root=path.resolve(import.meta.dirname,"../..");
  const terminal=surfaceCard(root,"src/app/components/hermes/agent-runtime-panel.tsx");
  const garden=surfaceCard(root,"src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const stubs={
    "@/app/components/assistant-message-actions":"export default function Actions(){return null}",
    "@/lib/task-completion-notification":"export const notifyTaskCompleted=task=>window.notifications.push(task)",
    "./artifact-viewer":"import React from 'react';export default function Viewer(p){return <aside role='dialog'>Artifact version {p.artifact.version}<button onClick={p.onClose}>Close artifact</button></aside>}",
    "./agent-settings-dialog":"import React from 'react';export default function Dialog(p){return <aside role='dialog'>Music settings<button onClick={p.onClose}>Close settings</button></aside>}",
  };
  const bundle=await esbuild.build({stdin:{resolveDir:root,loader:"tsx",contents:`
    import React from 'react';import{createRoot}from'react-dom/client';
    import InlineMusicProducerRun from './src/app/components/hermes/inline-music-producer-run';
    import Setup from './src/app/components/agents/music-producer-setup';
    const query=new URLSearchParams(location.search),surface=query.get('surface')||'terminal';
    const message=window.fixtureMessage,msg=message,index=0,i=0,lastAssistantIndex=0,activeRun=null,isStreaming=false;
    const onRetryMessage=()=>{},retryAssistantAsBranch=()=>window.retries++,onRetryAssistant=()=>window.retries++;
    const onExternalAgentTerminal=(id,result)=>window.terminals.push({id,result});
    const card=surface==='garden'?(${garden}):(${terminal});
    createRoot(document.getElementById('root')).render(query.has('setup')?<Setup/>:<section data-surface={surface}>{card}</section>);
  `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"test"'},plugins:[{name:"unrelated-shell",setup(build){
    build.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:"fixture"}:null);
    build.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:stubs[args.path],loader:"tsx",resolveDir:root}));
  }}]});
  const cssSource=fs.readFileSync(path.join(root,"src/app/globals.css"),"utf8").replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";','@source "./components/hermes/inline-music-producer-run.tsx"; @source "./components/agents/music-producer-setup.tsx";');
  const css=(await postcss([tailwindcss({base:root})]).process(cssSource,{from:path.join(root,"src/app/globals.css")})).css;
  const conversation="conv_"+"a".repeat(24), runId="music_"+"a".repeat(32);
  const summary=`[Music · version 2](/api/hermes/artifacts/art_fixture/preview?conversationId=${conversation}&version=2)\n\nRequested 60s; measured 0.20s.\n\n[Lyrics](/api/hermes/artifacts/art_lyrics/download?conversationId=${conversation}&version=1)`;
  const fixture={summary,requests:[],setupState:null,failHealth:false,stoppedGate:false,message:{role:"assistant",clientMessageId:"music-client",musicProducerRun:{runId,task:"Ambient piano without drums"},externalAgentOutcome:"completed",content:summary}};
  const server=http.createServer(async(req,res)=>{
    if(req.url==="/app.js"){res.setHeader("content-type","text/javascript");res.end(bundle.outputFiles[0].text);return;}
    if(req.url==="/style.css"){res.setHeader("content-type","text/css");res.end(css);return;}
    if(req.url.startsWith("/api/")){
      let body="";for await(const chunk of req)body+=chunk;fixture.requests.push({method:req.method,url:req.url,body:body?JSON.parse(body):null});res.setHeader("content-type","application/json");
      if(req.url.includes("/preview?")){res.setHeader("content-type","audio/wav");res.end(testWav());return;}
      if(req.url.includes("/versions?"))res.end(JSON.stringify({versions:[1,2].map(version=>({version,downloadAvailable:true}))}));
      else if(req.url.startsWith("/api/hermes/artifacts/"))res.end(JSON.stringify({artifact:{id:"art_fixture",title:"Music",conversationId:conversation,gardenId:null,renderer:"audio-file",version:2}}));
      else if(req.url==="/api/music-producer/health") {if(fixture.failHealth)res.statusCode=503;res.end(JSON.stringify(fixture.failHealth?{error:"Provider unavailable"}:{state:"stopped",message:"Prepared. Starts on generation.",stoppedGate:fixture.stoppedGate,settings:{mode:"managed",externalUrl:"",model:"acestep-v15-turbo",resonantSlug:""},resonant:"Not configured."}));}
      else if(req.url.startsWith("/api/music-producer/setup")){if(req.method==="POST")fixture.setupState="running";if(req.method==="DELETE")fixture.setupState="cancelled";res.end(JSON.stringify({jobId:fixture.setupState?"job_setup":null,state:fixture.setupState,stage:fixture.setupState}));}
      else res.end('{"ok":true}');return;
    }
    res.setHeader("content-type","text/html; charset=utf-8");res.end(`<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body style="padding:24px"><main id="root" style="max-width:720px;margin:auto"></main><script>window.fixtureMessage=${JSON.stringify(fixture.message).replaceAll("<","\\u003c")}</script><script src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const executablePath=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe","C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe","/usr/bin/chromium"].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const context=await browser.newContext({viewport:{width:1000,height:1100}});
  await context.addInitScript(()=>{
    window.streams=[];window.terminals=[];window.notifications=[];window.retries=0;window.edits=[];
    window.addEventListener("breadboard:artifact-ai-edit",event=>window.edits.push(event.detail));
    window.EventSource=class extends EventTarget{constructor(url){super();this.url=url;this.closed=false;window.streams.push(this);}close(){this.closed=true;}emit(event){this.dispatchEvent(new MessageEvent(event.type,{data:JSON.stringify(event)}));}};
  });
  return {fixture,context,root,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
