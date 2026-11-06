import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(import.meta.dirname, "..");
const ffmpeg = process.env.FFMPEG_PATH || path.join(root, "../desktop/build-resources/bin/ffmpeg.exe");

test("video controls stay readable and work; generated videos play above their own artifact cards", {
  timeout: 60_000,
  skip: !fs.existsSync(ffmpeg) && "Set FFMPEG_PATH to generate the playback fixture",
}, async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-video-controls-"));
  const fixturePath = path.join(temporary, "sample.webm");
  const fixture = spawnSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=10", "-t", "15", "-c:v", "libvpx-vp9", "-deadline", "realtime", fixturePath], { windowsHide: true });
  assert.equal(fixture.status, 0, fixture.stderr?.toString());
  const videoBytes = fs.readFileSync(fixturePath);
  const bundle = await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Player from './src/app/components/video-player-client';
      import Cards from './src/app/components/hermes/inline-artifact-cards';
      const root=createRoot(document.getElementById('root'));
      window.renderPlayer=(props={})=>root.render(<Player key={JSON.stringify(props)} title="Player check" sourceUrl="/sample.webm" showNavbarFlowers={false} {...props}/>);
      window.renderCards=(thinking=false)=>root.render(<Cards conversationId="chat-1" ownerMessageId="reply-1" thinking={thinking}/>);
      if(location.pathname==='/cards')window.renderCards();else window.renderPlayer();
    ` }, outfile: "fixture.js", bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.join(root, "src") },
    plugins: [{ name: "test-boundaries", setup(builder) {
      builder.onResolve({ filter: /(^|\/)(artifact-viewer|artifact-image-studio|artifact-image-preview|artifact-video-studio|inline-interactive-visualizer|use-desktop-tabs|desktop-browser-tabs)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root, contents:
        args.path.endsWith("use-desktop-tabs") ? "export const useDesktopTabs=()=>window.testTabs||null;" :
        args.path.endsWith("desktop-browser-tabs") ? "export const sendDesktopTabsCommand=async command=>{window.tabCommand=command;return true;};" :
        args.path.endsWith("artifact-viewer") ? `
          export default function Viewer(){return null;}
          export const ARTIFACT_BROWSER_EVENT='artifact-event', artifactDescription=artifact=>artifact.kind;
          export const artifactPdfHref=()=>null, useFileExplorerAvailable=()=>false;
          export const artifactUrl=(a,p)=>'/api/hermes/artifacts/'+a.id+'/'+p+'?conversationId='+a.conversationId+'&version='+a.version;
          export const artifactVideoHref=a=>a.kind==='video'?'/artifacts/'+a.id+'/video?conversationId='+a.conversationId+'&version='+a.version:null;
          export const ArtifactFileIcon=()=> <svg aria-hidden="true"/>;
        ` : "export default function Stub(){return null;}"
      }));
    } }],
  });
  const sourceCss = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8")
    .replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/hermes/inline-artifact-cards.tsx"; @source "./components/hermes/artifact-video-preview.tsx"; @source "./components/hermes/artifact-card-content.tsx";');
  const compiledCss = await postcss([tailwind()]).process(sourceCss, { from: path.join(root, "src/app/globals.css") });
  const css = compiledCss.css + bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(candidate => candidate && fs.existsSync(candidate));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const baseArtifact = {kind:"video", renderer:"video-file", title:"Generated film", filename:"film.webm", status:"ready", version:2, conversationId:"chat-1", assistantMessageId:"reply-1", previewAvailable:true, downloadAvailable:true, metadata:{}};
    await page.route("http://localhost:53149/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/hermes/artifacts") return route.fulfill({json:{artifacts:[
        {...baseArtifact,id:"film"}, {...baseArtifact,id:"other",assistantMessageId:"reply-2"},
        {...baseArtifact,id:"pending",status:"pending"}, {...baseArtifact,id:"download-only",previewAvailable:false},
      ]}});
      if (url.pathname === "/broken.webm") return route.fulfill({status:404, body:"Missing video"});
      if (url.pathname === "/sample.webm" || url.pathname.endsWith("/preview")) {
        const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
        if (!range) return route.fulfill({contentType:"video/webm",headers:{"Accept-Ranges":"bytes"},body:videoBytes});
        const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),videoBytes.length-1):videoBytes.length-1;
        return route.fulfill({status:206,contentType:"video/webm",headers:{"Accept-Ranges":"bytes","Content-Range":`bytes ${start}-${end}/${videoBytes.length}`},body:videoBytes.subarray(start,end+1)});
      }
      return route.fulfill({contentType:"text/html",body:`<html><head><style>${css}</style></head><body style="margin:0"><div id="root"></div><script>${js}</script></body></html>`});
    });
    await page.goto("http://localhost:53149/player");
    const video = page.locator("video");
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
    const button = name => page.getByRole("button", { name, exact:true });
    // These assertions use the real global theme CSS that caused the regression.
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const name of ["Play", "Stop", "Exit player", "Fullscreen"]) {
        const contrast = await button(name).evaluate(element => {
          const style = getComputedStyle(element);
          const luminance = value => value.match(/[\d.]+/g).slice(0,3).map(Number).map(v => {v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
          const a=luminance(style.color),b=luminance(style.backgroundColor);
          return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        });
        assert.ok(contrast >= 4.5, `${theme} ${name} contrast ${contrast}`);
      }
    }
    await button("Play").click();
    await page.waitForFunction(() => document.querySelector("video").currentTime > .1);
    await button("Pause").click();
    assert.equal(await video.evaluate(v=>v.paused),true);
    await page.getByRole("slider",{name:"Seek",exact:true}).fill("5");
    await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime-5)<.1);
    await button("Forward 10 seconds").click();
    await page.waitForFunction(() => document.querySelector("video").currentTime > 14);
    await button("Rewind 10 seconds").click();
    await page.waitForFunction(() => document.querySelector("video").currentTime < 6);
    await button("Stop").click();
    assert.equal(await video.evaluate(v=>v.paused && v.currentTime===0),true);
    await button("Play").click();
    await button("Mute").click();
    await button("Unmute").waitFor();
    assert.equal(await video.evaluate(v=>v.muted),true);
    await page.getByRole("slider",{name:"Volume",exact:true}).fill("0.4");
    assert.equal(await video.evaluate(v=>v.volume===.4&&!v.muted),true);
    await button("Fullscreen").click();
    await button("Exit fullscreen").waitFor();
    assert.equal(await page.evaluate(()=>document.fullscreenElement?.getAttribute("aria-label")),"Video player");
    await button("Exit fullscreen").click();
    await button("Fullscreen").waitFor();
    // Space on Stop must activate Stop, rather than toggling playback globally.
    await button("Stop").focus();
    await page.keyboard.press("Space");
    assert.equal(await video.evaluate(v=>v.paused && v.currentTime===0),true);
    await page.evaluate(()=>document.activeElement.blur());
    await page.keyboard.press("k");
    await button("Pause").waitFor();
    await page.keyboard.press("k");
    await button("Play").waitFor();
    for (const width of [1280,375,280]) {
      await page.setViewportSize({width,height:700});
      for (const name of ["Play","Stop","Fullscreen","Exit player"]) {
        const bounds = await button(name).boundingBox();
        assert.ok(bounds && bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=width+1 && bounds.y+bounds.height<=700, `${name} fits ${width}px`);
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    if (process.env.BREADBOARD_VIDEO_QA_OUTPUT) {
      fs.mkdirSync(process.env.BREADBOARD_VIDEO_QA_OUTPUT,{recursive:true});
      await page.setViewportSize({width:1280,height:800});
      await page.screenshot({path:path.join(process.env.BREADBOARD_VIDEO_QA_OUTPUT,"video-player.png")});
    }
    await page.evaluate(()=>{window.testTabs={enabled:true,selfId:42,activeId:99};window.renderPlayer({title:"Desktop player"});});
    await page.getByRole("heading",{name:"Desktop player"}).waitFor();
    await button("Exit player").click();
    await page.waitForFunction(()=>window.tabCommand?.id===42);
    assert.deepEqual(await page.evaluate(()=>window.tabCommand),{type:"close",id:42});
    await page.evaluate(()=>{window.testTabs=null;window.renderPlayer({sourceUrl:"/broken.webm",backHref:"/"});});
    await page.getByRole("alert").waitFor();
    assert.equal(await button("Play").isDisabled(),true);
    await button("Exit player").click();
    await page.waitForURL("http://localhost:53149/");
    await page.goto("http://localhost:53149/player");
    await button("Exit player").click();
    await page.waitForURL("http://localhost:53149/");
    await page.goto("http://localhost:53149/cards");
    const card = page.getByRole("article",{name:"Video artifact: Generated film"});
    await card.waitFor();
    assert.equal(await page.locator("video").count(),1,"only previewable videos owned by this response get players");
    const preview = card.locator("video");
    assert.equal(await preview.getAttribute("controls"),"");
    assert.equal(await preview.getAttribute("preload"),"metadata");
    assert.equal(await preview.evaluate(v=>v.autoplay),false);
    assert.match(await preview.getAttribute("src"),/film\/preview\?conversationId=chat-1&version=2/);
    const link = card.getByRole("link");
    assert.match(await link.getAttribute("href"),/film\/video\?conversationId=chat-1&version=2/);
    await page.waitForFunction(()=>document.querySelector("video")?.readyState>=2);
    const vb=await preview.boundingBox(),lb=await link.boundingBox();
    assert.ok(vb.y+vb.height<=lb.y+1 && vb.width<=576 && vb.height<=320);
    assert.equal(await preview.evaluate(v=>{const r=v.getBoundingClientRect();return document.elementFromPoint(r.x+20,r.bottom-20)===v;}),true,"card does not cover video controls");
    // Native controls remain browser-owned; exercise the actual media decoder.
    await preview.evaluate(v=>v.play());
    await page.waitForFunction(()=>document.querySelector("video").currentTime>.1);
    await preview.evaluate(v=>{v.pause();v.currentTime=4;});
    await page.waitForFunction(()=>Math.abs(document.querySelector("video").currentTime-4)<.1);
    if (process.env.BREADBOARD_VIDEO_QA_OUTPUT) await page.screenshot({path:path.join(process.env.BREADBOARD_VIDEO_QA_OUTPUT,"video-artifact-card.png")});
    // Removing a virtualized reply must stop playback and release the source.
    await page.evaluate(()=>{window.previousVideo=document.querySelector("video");window.renderCards(true);});
    await page.waitForFunction(()=>!document.querySelector("video"));
    assert.equal(await page.evaluate(()=>window.previousVideo.paused&&!window.previousVideo.hasAttribute("src")),true);
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();
    fs.rmSync(temporary,{recursive:true,force:true});
  }
});
