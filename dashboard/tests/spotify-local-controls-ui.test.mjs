import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const bundle = await build({
  stdin: {resolveDir:root,loader:"js",contents:'export {createPlayerBridge,controlSession,sessions} from "./scripts/runtime-v2-spotify-playback-service.mjs"; export {controlSpotifyPlaybackRuntime} from "./src/lib/spotify/runtime-service.ts"; export {publishSpotifyPlayback,spotifyPlaybackEventStream} from "./src/lib/spotify/playback-events.ts";'},
  bundle:true,write:false,platform:"node",format:"esm",
  plugins:[{name:"local-player-boundaries",setup(builder){
    builder.onResolve({filter:/hermes\/route-core\.ts$/},args=>({path:args.path,namespace:'route-error'}));
    builder.onLoad({filter:/.*/,namespace:'route-error'},()=>({loader:'js',contents:'export class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}'}));
    builder.onLoad({filter:/runtime-v2-spotify-playback-service\.mjs$/},({path:filename})=>{
      const source=fs.readFileSync(filename,"utf8");
      return {loader:"js",contents:source.slice(0,source.lastIndexOf("void main().catch"))+"\nexport {createPlayerBridge,controlSession,reconnectSession,sessions};"};
    });
    builder.onResolve({filter:/^(server-only|\.\.\/supervisor-control\.ts)$/},args=>({path:args.path,namespace:"fixture"}));
    builder.onLoad({filter:/.*/,namespace:"fixture"},()=>({loader:"js",contents:"export const isRuntimeV2ServiceControlConfigured=()=>true; export const readSupervisedServiceSnapshot=async()=>null;"}));
  }}],
});
const runtime=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("local transport controls reach the SDK over the live bridge, with bounded failures and user isolation", {timeout:30_000}, async () => {
  const commands=[], registrations=[];
  const service=http.createServer(async(req,res)=>{
    let bytes="";for await(const chunk of req)bytes+=chunk;
    const body=bytes?JSON.parse(bytes):null;
    res.setHeader("Content-Type","application/json");
    if(req.url==="/api/hermes/connections/spotify/engine"){
      registrations.push(body);
      if(Object.hasOwn(body,'playback'))runtime.publishSpotifyPlayback(7,body.deviceId,body.playback);
      res.end('{"ok":true}');return;
    }
    commands.push(body);
    try { res.end(JSON.stringify({ok:true,result:await runtime.controlSession(body)})); }
    catch(error){res.statusCode=error.status??500;res.end(JSON.stringify({ok:false,error:{code:error.code,message:error.message}}));}
  });
  await new Promise(resolve=>service.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${service.address().port}`;
  const session={userId:7,ticket:"test-ticket",stopping:false};
  const bridge=await runtime.createPlayerBridge({dashboardOrigin:origin},session);
  runtime.sessions.set(7,{...session,bridge});
  const env={BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED:"1",BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_URL:origin,BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN:"fixture-token-".repeat(4)};
  const control=(action,positionMs,deviceId="breadboard-device-001",userId=7)=>runtime.controlSpotifyPlaybackRuntime({userId,deviceId,action,positionMs,env});
  const executablePath=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe","C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe","/usr/bin/chromium"].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try {
    assert.deepEqual(await control("pause"),{handled:false},"an unconnected bridge fails fast without waiting for a timeout");
    const page=await browser.newPage();
    await page.addInitScript(()=>{
      window.calls=[];
      window.failControl=false;
      window.stallControl=false;
      window.playerState={paused:false,position:12000,duration:180000,track_window:{current_track:{uri:"spotify:track:0123456789abcdefghijAB"}}};
      const NativeEventSource=window.EventSource;
      window.EventSource=class extends NativeEventSource{constructor(url){super(url);this.addEventListener("open",()=>{window.commandsReady=true;});}};
      window.Spotify={Player:class {
        constructor(){window.sdkPlayer=this;}
        listeners={};
        addListener(name,listener){this.listeners[name]=listener;}
        connect(){
          const ready=()=>this.listeners.ready({device_id:window.replacementId??"breadboard-device-001"});
          if(window.delayConnect)window.finishConnect=ready;else ready();
          return Promise.resolve(true);
        }
        disconnect(){window.disconnects=(window.disconnects??0)+1;}
        async getCurrentState(){
          if(window.stallState)await new Promise(resolve=>{window.finishState=resolve;});
          return window.playerState;
        }
        async run(name,value){
          window.calls.push({name,value});
          if(window.failControl)throw Error("SDK rejected control");
          if(window.stallControl)await new Promise(()=>{});
        }
        async pause(){await this.run("pause");window.playerState.paused=true;}
        async resume(){await this.run("resume");window.playerState.paused=false;}
        async seek(value){await this.run("seek",value);window.playerState.position=value;}
        async nextTrack(){await this.run("next");window.playerState.track_window.current_track.uri="spotify:track:next0123456789abcdefAB";window.playerState.position=0;}
        async previousTrack(){await this.run("previous");window.playerState.track_window.current_track.uri="spotify:track:0123456789abcdefghijAB";window.playerState.position=0;}
      }};
    });
    await page.route("https://sdk.scdn.co/spotify-player.js",route=>route.fulfill({contentType:"text/javascript",body:"window.onSpotifyWebPlaybackSDKReady();"}));
    await page.goto(`${bridge.origin}/player`);
    await page.waitForFunction(()=>window.commandsReady);
    const streamAbort=new AbortController();
    const reader=runtime.spotifyPlaybackEventStream(7,streamAbort.signal).getReader();
    await reader.read(); // Connected comment; no local playback sample yet.
    const changedAt=performance.now();
    await page.evaluate(()=>window.sdkPlayer.listeners.player_state_changed({
      paused:false,position:250,duration:200000,shuffle:true,repeat_mode:0,
      track_window:{next_tracks:[],current_track:{uri:'spotify:track:live0123456789abcdefgh',name:'Immediate song',artists:[{name:'Artist'}],album:{name:'Album',images:[{url:'https://i.scdn.co/image/art'}]}}},
    }));
    const update=new TextDecoder().decode((await reader.read()).value);
    assert.ok(performance.now()-changedAt<1000,'SDK song changes reach the UI stream before the heartbeat/poll');
    const sample=JSON.parse(update.slice(6));
    assert.equal(sample.playback.track.name,'Immediate song');
    assert.equal(sample.playback.track.artist,'Artist');
    assert.equal(sample.playback.deviceId,'breadboard-device-001');
    assert.equal(sample.playback.positionMs,250);
    assert.equal(sample.playback.hasNextTrack,false,'SDK empty queue is sent by the real player bridge');
    assert.equal(sample.playback.repeatMode,0);
    await page.evaluate(()=>window.sdkPlayer.listeners.player_state_changed(null));
    assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6)).playback,null);
    streamAbort.abort();
    assert.equal((await reader.read()).done,true);
    const elapsed=[];
    for(const action of ["pause","resume","seek","next","previous"]){
      const started=performance.now();
      const result=await control(action,action==="seek"?60000:undefined);
      elapsed.push(performance.now()-started);
      assert.equal(result.handled,true);
      if(action==="pause")assert.equal(result.isPlaying,false);
      if(action==="resume")assert.equal(result.isPlaying,true);
      if(action==="seek")assert.equal(result.positionMs,60000);
    }
    assert.deepEqual((await page.evaluate(()=>window.calls)).map(call=>call.name),["pause","resume","seek","next","previous"]);
    // A recent SDK event lets controls run immediately even if status reads
    // are stalled. Skip acknowledgement also does not wait for new metadata.
    await page.evaluate(()=>{window.sdkPlayer.listeners.player_state_changed(window.playerState);window.stallState=true;});
    const fastPause=performance.now();
    assert.equal((await control('pause')).handled,true);
    assert.ok(performance.now()-fastPause<700,'pause bypasses a stalled SDK status read');
    assert.equal((await control('next')).handled,true);
    await page.evaluate(()=>{window.stallState=false;window.finishState?.();});
    // No cloud service is available to the fake SDK. All observed controls
    // travel through the same client, gateway, SSE and SDK path as production.
    const artifacts=path.join(root,".tmp-spotify-seek-qa");
    fs.mkdirSync(artifacts,{recursive:true});
    fs.writeFileSync(path.join(artifacts,"local-control-timings.json"),JSON.stringify({environment:"headless Chromium with mocked Spotify SDK; excludes audio/network latency",milliseconds:elapsed},null,2));
    assert.deepEqual(await control("pause",undefined,"other-device-001"),{handled:false});
    assert.deepEqual(await control("pause",undefined,"breadboard-device-001",8),{handled:false});
    assert.equal((await page.evaluate(()=>window.calls)).length,7);
    await page.evaluate(()=>{window.delayConnect=true;window.sdkPlayer.listeners.not_ready({device_id:'breadboard-device-001'});});
    await expect.poll(()=>registrations.at(-1)).toEqual({ticket:'test-ticket',deviceId:'breadboard-device-001',ready:false});
    assert.deepEqual(await control('pause'),{handled:false},'offline IDs cannot dispatch local controls');
    await page.evaluate(()=>{window.replacementId='breadboard-device-002';});
    const reconnect = bridge.control({action:'reconnect',deviceId:'breadboard-device-001',positionMs:null});
    await page.waitForFunction(()=>window.finishConnect);
    await page.evaluate(()=>{window.finishConnect();window.delayConnect=false;});
    assert.deepEqual(await reconnect,{reconnected:true,deviceId:'breadboard-device-002'});
    await expect.poll(()=>registrations.at(-1)?.deviceId).toBe('breadboard-device-002');
    assert.equal(await page.evaluate(()=>window.disconnects),1);
    await page.evaluate(()=>window.sdkPlayer.listeners.not_ready({device_id:'breadboard-device-001'}));
    assert.equal((await control('pause',undefined,'breadboard-device-002')).handled,true,'a late old disconnect does not clear the replacement');
    await page.evaluate(()=>{window.replacementId='breadboard-device-001';});
    await bridge.control({action:'reconnect',deviceId:'breadboard-device-002',positionMs:null});
    await page.evaluate(()=>{window.playerState=null;});
    assert.deepEqual(await control("resume"),{handled:false},"a player with no local playback must fall back without issuing a command");
    await page.evaluate(()=>{window.playerState={paused:false,position:10000,duration:180000,track_window:{current_track:{uri:"spotify:track:0123456789abcdefghijAB"}}};window.failControl=true;});
    await assert.rejects(control("pause"),error=>error.code==="spotify_control_unconfirmed");
    assert.equal((await page.evaluate(()=>window.calls)).filter(call=>call.name==="pause").length,4);
    await page.evaluate(()=>{window.failControl=false;window.stallControl=true;});
    await assert.rejects(control("next"),error=>error.code==="spotify_control_unconfirmed");
    assert.equal((await page.evaluate(()=>window.calls)).filter(call=>call.name==="next").length,3,"a missing acknowledgement does not duplicate the skip");
    await page.evaluate(()=>{window.stallControl=false;});
    assert.equal((await control('pause')).handled,true,'a timed-out SDK command cannot poison the queue for every subsequent control');
    await page.close();
    await expect.poll(async()=>await control("pause")).toEqual({handled:false});
    assert.throws(()=>runtime.controlSession({userId:7,deviceId:"breadboard-device-001",action:"seek",positionMs:-1}),/invalid/);
    assert.throws(()=>runtime.controlSession({userId:7,deviceId:"breadboard-device-001",action:"pause",positionMs:null,extra:true}),/invalid/);
    const crossOrigin=await fetch(`${bridge.origin}/commands`);
    assert.equal(crossOrigin.status,403);
  } finally {
    runtime.sessions.delete(7);
    await browser.close();
    bridge.server.closeAllConnections();
    await new Promise(resolve=>bridge.server.close(resolve));
    service.closeAllConnections();
    await new Promise(resolve=>service.close(resolve));
  }
});
