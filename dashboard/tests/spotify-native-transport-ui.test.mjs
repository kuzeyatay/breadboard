import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';

const root=path.resolve(import.meta.dirname,'..');
const nativeBundle=await build({entryPoints:[path.join(root,'../desktop/src/main/spotify-control.ts')],bundle:true,write:false,platform:'node',format:'esm'});
const {sendSpotifyRequest}=await import(`data:text/javascript;base64,${Buffer.from(nativeBundle.outputFiles[0].text).toString('base64')}`);
const bundle=await build({
  stdin:{resolveDir:root,loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {BrowserSpotifyDock,useSpotifyDock} from './src/app/browser/browser-home-widgets';
    import {spotifyPlayerRequest,spotifyControlRequest} from './src/lib/spotify/control-request';
    window.playerRequest=spotifyPlayerRequest;window.controlRequest=spotifyControlRequest;
    function App(){return <BrowserSpotifyDock {...useSpotifyDock(true)} openConnections={()=>{}} open={false} setOpen={()=>{}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);`},
  bundle:true,write:false,outfile:'spotify-native.js',platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},
  plugins:[{name:'dock-test-exports',setup(builder){builder.onLoad({filter:/browser-home-widgets\.tsx$/},({path:filename})=>({loader:'tsx',contents:fs.readFileSync(filename,'utf8').replace('function BrowserSpotifyDock(','export function BrowserSpotifyDock(').replace('function useSpotifyDock(','export function useSpotifyDock(')}));}}],
});

test('Spotify controls, status and keep-alives bypass saturated Chromium connections', {timeout:45000},async()=>{
  const track={id:'0123456789abcdefghijAB',uri:'spotify:track:0123456789abcdefghijAB',name:'Transport fixture',artist:'Fixture',album:'Fixture',durationMs:180000,imageUrl:null};
  const engine={ready:true,deviceId:'breadboard-test',status:'ready',error:null};
  let playback={track,isPlaying:true,positionMs:1000,deviceId:engine.deviceId,deviceName:'Breadboard'};
  const status=()=>({connected:true,status:'connected',engine,playback,history:[],savedTrack:false});
  const held=new Set();const commands=[];const nativeTimes=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(url.pathname.includes('/events')||url.pathname==='/hold'){
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': connected\n\n');
      held.add(res);res.on('close',()=>held.delete(res));return;
    }
    if(url.pathname.startsWith('/api/')){
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=raw?JSON.parse(raw):null;
      assert.equal(req.headers.cookie,'fixture-session=test','native request carries only the sender session');
      let result=status();
      if(url.pathname.endsWith('/engine'))result=engine;
      else if(body){
        commands.push(body.action);
        if(body.action==='pause')playback={...playback,isPlaying:false};
        if(body.action==='resume')playback={...playback,isPlaying:true};
        result={ok:true,localPlayback:{trackUri:track.uri,isPlaying:playback.isPlaying,positionMs:playback.positionMs}};
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
    }
    if(url.pathname==='/probe'){res.end('unblocked');return;}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const executablePath=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','/usr/bin/chromium'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.exposeBinding('nativeSpotifyRequest',async(_source,request)=>{
      const start=performance.now();
      const result=await sendSpotifyRequest({dashboardUrl:origin,request,readCookies:async()=>[{name:'fixture-session',value:'test'}]});
      nativeTimes.push({method:request.method,resource:request.resource,ms:performance.now()-start});return result;
    });
    await page.addInitScript(()=>{window.breadboardDesktop={spotifyRequest:request=>window.nativeSpotifyRequest(request)};});
    await page.goto(origin);
    await expect(page.getByRole('button',{name:'Pause Spotify',exact:true})).toBeEnabled();
    await page.evaluate(()=>{window.heldStreams=Array.from({length:6},(_,i)=>new EventSource('/hold?i='+i));});
    await expect.poll(()=>held.size).toBe(6);
    await page.evaluate(()=>{window.probeCompleted=false;void fetch('/probe').then(()=>{window.probeCompleted=true;});});
    await new Promise(resolve=>setTimeout(resolve,350));
    assert.equal(await page.evaluate(()=>window.probeCompleted),false,'ordinary browser traffic really is queued behind six streams');

    for(const [from,to] of [['Pause Spotify','Play Spotify in Breadboard'],['Play Spotify in Breadboard','Pause Spotify'],['Pause Spotify','Play Spotify in Breadboard']]){
      const start=performance.now();await page.getByRole('button',{name:from,exact:true}).click();
      await expect(page.getByRole('button',{name:to,exact:true})).toBeEnabled({timeout:1500});
      assert.ok(performance.now()-start<1500,'controls cannot wait for a Chromium connection');
    }
    assert.deepEqual(commands,['pause','resume','pause']);
    const viewId='a7a459f4-49a9-4c96-b45b-bff8b501297b';
    const checks=await page.evaluate(async viewId=>Promise.all([
      window.playerRequest().then(r=>r.json()),
      window.playerRequest('engine','POST',{viewId}).then(r=>r.json()),
      window.playerRequest('engine','DELETE',{viewId}).then(r=>r.json()),
    ]),viewId);
    assert.equal(checks[0].playback.isPlaying,false);assert.equal(checks[1].ready,true);assert.equal(checks[2].ready,true);
    assert.ok(nativeTimes.every(t=>t.ms<1000),JSON.stringify(nativeTimes));
    assert.equal(await page.evaluate(()=>window.probeCompleted),false,'all native work finished while browser traffic remained blocked');
    assert.deepEqual(errors,[]);
    console.log('Native Spotify request maximum under connection saturation:',Math.round(Math.max(...nativeTimes.map(t=>t.ms))),'ms');

    // A lost IPC reply may follow an applied command. Never send it again over HTTP.
    assert.equal(await page.evaluate(async()=>{
      let httpCalls=0;const previous=window.fetch;window.fetch=async()=>{httpCalls++;throw Error('unexpected retry');};
      window.breadboardDesktop.spotifyRequest=async()=>{throw Error('Lost acknowledgement');};
      try{await window.controlRequest({action:'next'});}catch(error){if(error.message!=='Lost acknowledgement')throw error;}
      finally{window.fetch=previous;}
      return httpCalls;
    }),0);
    await page.evaluate(()=>window.heldStreams.forEach(stream=>stream.close()));
  }finally{
    await browser.close();for(const res of held)res.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
