import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("the dock and expanded player switch Spotify devices and keep controls on the selected device", {timeout:60_000}, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: {resolveDir:root,loader:"tsx",contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserSpotifyDock,useSpotifyDock} from './src/app/browser/browser-home-widgets';
      function App(){const [open,setOpen]=React.useState(false);return <BrowserSpotifyDock {...useSpotifyDock(true)} openConnections={()=>{}} open={open} setOpen={setOpen}/>;}
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
    `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",outfile:"devices.js",define:{"process.env.NODE_ENV":'"test"'},
    plugins:[{name:"dock-exports",setup(builder){builder.onLoad({filter:/browser-home-widgets\.tsx$/},({path:filename})=>({
      loader:"tsx",contents:fs.readFileSync(filename,"utf8").replace("function BrowserSpotifyDock(","export function BrowserSpotifyDock(").replace("function useSpotifyDock(","export function useSpotifyDock("),
    }));}}],
  });
  const css = fs.readFileSync(path.join(root,"src/app/globals.css"),"utf8").replace(/^@(?:import|source).*$/gm,"");
  const track = {id:"0123456789abcdefghijAB",uri:"spotify:track:0123456789abcdefghijAB",name:"Ocean Drive",artist:"Duke Dumont",album:"Ocean Drive",imageUrl:null,durationMs:206000};
  let engine = {ready:true,deviceId:"breadboard-device",status:"ready",error:null};
  let playback = {track,isPlaying:true,positionMs:42000,deviceId:engine.deviceId,deviceName:"Breadboard"};
  const localPlayback = structuredClone(playback);
  const available = [
    {id:engine.deviceId,name:"Breadboard",type:"computer",isActive:true,isRestricted:false},
    {id:"phone-device",name:"My iPhone",type:"smartphone",isActive:false,isRestricted:false},
    {id:"living-room-tv",name:"Living room TV",type:"tv",isActive:false,isRestricted:false},
    {id:"restricted-speaker",name:"Kitchen speaker",type:"speaker",isActive:false,isRestricted:true},
  ];
  let devices = available;
  let deviceReads = 0;
  let failDevices = false;
  let failTransfer = false;
  let staleCloud = false;
  const commands = [];
  const executablePath = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe","C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe","/usr/bin/chromium"].find(fs.existsSync);
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try {
    const page = await browser.newPage({viewport:{width:1000,height:850}});
    const errors = [];
    page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript(()=>{window.EventSource=class{constructor(){window.spotifyEvents=this;}close(){}};});
    await page.route("https://spotify.test/**",async route=>{
      const url = new URL(route.request().url());
      const body = route.request().postDataJSON();
      if(url.pathname==="/app.js")return route.fulfill({contentType:"text/javascript",body:bundle.outputFiles[0].text});
      if(url.pathname==="/style.css")return route.fulfill({contentType:"text/css",body:css});
      if(!url.pathname.startsWith("/api/"))return route.fulfill({contentType:"text/html",body:`<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/style.css"></head><body style="background:#162f29;font-family:Arial"><main id="root" style="position:fixed;right:60px;bottom:45px;width:460px;--browser-widget-font:Arial"></main><script src="/app.js"></script></body></html>`});
      if(url.pathname.endsWith("/engine"))return route.fulfill({json:engine});
      if(url.searchParams.get("view")==="devices"){
        deviceReads++;
        return route.fulfill(failDevices?{status:503,json:{message:"Could not load devices. Try again."}}:{json:{devices}});
      }
      if(body){
        commands.push(body);
        if(body.action==="transfer"){
          if(failTransfer)return route.fulfill({status:409,json:{message:"That device is no longer available. Refresh the device list."}});
          const device = available.find(item=>item.id===body.deviceId);
          if(playback)playback={...playback,deviceId:device.id,deviceName:device.name};
          return route.fulfill({json:{ok:true,device,engine,refreshPlayback:true}});
        }
        if(body.action==="pause")playback={...playback,isPlaying:false};
        if(body.action==="resume")playback={...playback,isPlaying:true};
        if(body.action==="play-track"){
          const device=available.find(item=>item.id===(body.deviceId??engine.deviceId));
          playback={track,deviceId:device.id,deviceName:device.name,...playback,isPlaying:true,positionMs:0};
        }
        return route.fulfill({json:{ok:true,engine,playback,refreshPlayback:true}});
      }
      return route.fulfill({json:{connected:true,status:"connected",engine,playback:staleCloud?localPlayback:playback,savedTrack:false,history:[track]}});
    });
    await page.goto("https://spotify.test");
    const dockLabel = page.locator(".browser-spotify-summary .browser-spotify-device");
    await expect(dockLabel).toHaveText("Playing on Breadboard");
    assert.equal(deviceReads,0,"device discovery only happens when requested");
    await dockLabel.click();
    const picker = page.getByRole("dialog",{name:"Spotify devices",exact:true});
    const player = page.getByRole("dialog",{name:"Spotify player and library",exact:true});
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button",{name:/Breadboard/})).toHaveAttribute("aria-pressed","true");
    await expect(picker.getByRole("button",{name:/Kitchen speaker/})).toBeDisabled();
    assert.equal(commands.length,0,"opening the picker cannot change playback");
    const artifacts = path.join(root,"artifacts/spotify-devices");
    fs.mkdirSync(artifacts,{recursive:true});
    await page.screenshot({path:path.join(artifacts,"desktop.png")});

    staleCloud=true;
    await picker.getByRole("button",{name:/Living room TV/}).click();
    await expect(dockLabel).toHaveText("Playing on Living room TV");
    await expect(picker.getByRole("button",{name:/Living room TV/})).toHaveAttribute("aria-pressed","true");
    assert.deepEqual(commands[0],{action:"transfer",deviceId:"living-room-tv"});
    await page.evaluate(playback=>window.spotifyEvents.onmessage({data:JSON.stringify({playback})}),{...localPlayback,isPlaying:false});
    await expect(dockLabel).toHaveText("Playing on Living room TV");
    staleCloud=false;
    await picker.getByRole("button",{name:"Back to Spotify player"}).click();
    await expect(player.locator(".browser-spotify-device")).toBeFocused();
    await page.evaluate(()=>window.dispatchEvent(new Event("breadboard:spotify-playback-changed")));
    await page.evaluate(playback=>window.spotifyEvents.onmessage({data:JSON.stringify({playback})}),localPlayback);
    await expect(dockLabel).toHaveText("Playing on Living room TV");
    await player.getByRole("button",{name:"Pause Spotify",exact:true}).click();
    await expect(dockLabel).toHaveText("Paused on Living room TV");
    engine={ready:false,deviceId:null,status:"unavailable",error:null};
    await page.evaluate(()=>window.dispatchEvent(new Event("breadboard:spotify-playback-changed")));
    await player.getByRole("button",{name:"Play Spotify on Living room TV",exact:true}).click();
    await expect(dockLabel).toHaveText("Playing on Living room TV");
    assert.deepEqual(commands.find(item=>item.action==="resume"),{action:"resume",deviceId:"living-room-tv"});
    await player.getByRole("button",{name:"Play Ocean Drive by Duke Dumont",exact:true}).click();
    assert.equal(commands.at(-1).deviceId,"living-room-tv","choosing a song stays on the TV");
    await expect(player.getByRole("button",{name:"Pause Spotify",exact:true})).toBeEnabled();

    await player.locator(".browser-spotify-device").click();
    failTransfer=true;
    await picker.getByRole("button",{name:/My iPhone/}).click();
    await expect(picker.getByRole("alert")).toContainText("no longer available");
    await expect(dockLabel).toHaveText("Playing on Living room TV");
    failTransfer=false;
    engine={ready:true,deviceId:"breadboard-device",status:"ready",error:null};
    await picker.getByRole("button",{name:/Breadboard/}).click();
    await expect(dockLabel).toHaveText("Playing on Breadboard");
    await expect(picker.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(player).toBeVisible();
    await expect(player.locator(".browser-spotify-device")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(picker).toBeVisible();

    failDevices=true;
    await picker.getByRole("button",{name:"Refresh devices",exact:true}).click();
    await expect(picker.getByRole("alert")).toContainText("Could not load devices");
    failDevices=false;devices=[];
    await picker.getByRole("button",{name:"Try again",exact:true}).click();
    await expect(picker.getByText("No devices found yet.")).toBeVisible();
    await expect(picker.getByText(/Open Spotify on your phone, TV, or speaker/)).toBeVisible();
    devices=available;
    await picker.getByRole("button",{name:"Refresh devices",exact:true}).click();
    await expect(picker.getByRole("button",{name:/My iPhone/})).toBeEnabled();
    await page.setViewportSize({width:480,height:800});
    await page.locator("#root").evaluate(element=>{element.style.right="24px";element.style.width="432px";});
    await page.screenshot({path:path.join(artifacts,"compact.png")});
    const bounds=await picker.boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=480,"device picker fits a narrow viewport");
    assert.equal(await page.locator("button button").count(),0,"device triggers are separate accessible buttons");
    await picker.getByRole("button",{name:"Close Spotify",exact:true}).click();
    await expect(picker).toBeHidden();
    await expect(page.getByRole("button",{name:"Open Spotify player",exact:true})).toBeFocused();
    await page.setViewportSize({width:1000,height:850});
    await page.locator("#root").evaluate(element=>{element.style.right="60px";element.style.width="460px";});
    playback=null;
    engine={ready:false,deviceId:null,status:"unavailable",error:null};
    await page.evaluate(()=>window.dispatchEvent(new Event("breadboard:spotify-playback-changed")));
    await expect(dockLabel).toHaveText("Choose a device");
    await dockLabel.click();
    await picker.getByRole("button",{name:/My iPhone/}).click();
    await expect(dockLabel).toHaveText("Listen on My iPhone");
    await picker.getByRole("button",{name:"Back to Spotify player"}).click();
    await player.getByRole("button",{name:"Play Ocean Drive by Duke Dumont",exact:true}).click();
    await expect(dockLabel).toHaveText("Playing on My iPhone");
    assert.equal(commands.at(-1).deviceId,"phone-device","an idle device selection applies to the first song");
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
