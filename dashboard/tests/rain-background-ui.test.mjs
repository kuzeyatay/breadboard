import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("Appearance rain layers behind controls, follows dock weather and syncs across tabs", {timeout: 60_000}, async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const bundle = await build({
    stdin: {resolveDir: root, loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import PageAppearance from './src/app/components/page-appearance';
      import Rain from './src/app/components/rain-background';
      import Ambient from './src/app/components/spotify-ambient-background';
      import {usePageAppearance} from './src/app/components/use-page-appearance';
      import {useDockWeather} from './src/app/browser/browser-home-widgets';
      import home from './src/app/new-tab/combined-home.module.css';
      function App() {
        const appearance=usePageAppearance('rain-test','new-tab');
        const weather=useDockWeather(!location.pathname.includes('peer'));
        window.refreshWeather=weather.retry;
        return <div className={home.surface} style={{minHeight:'160vh'}}>
          <div id="backdrop" className={'browser-start-page '+home.backdrop} data-spotify-ambient="true">
            <Ambient theme={appearance.theme} spotifyColors={false} randomColors/>
            <Rain mode={appearance.rainMode} theme={appearance.theme}/>
          </div>
          <main style={{position:'relative',padding:'160px 60px',maxWidth:850,margin:'auto'}}>
            <h1 style={{fontSize:46,color:'var(--ink-heading)',textAlign:'center'}}>Where to, rain watcher?</h1>
            <input aria-label="Search the web" placeholder="Search the web…" style={{width:'100%',padding:24,marginTop:48,border:'1px solid var(--line-strong)',borderRadius:16,background:'var(--paper-bg)'}}/>
            <button id="garden" onClick={()=>{window.gardenClicks=(window.gardenClicks??0)+1}} style={{display:'block',marginTop:200,width:'100%',height:180,background:'var(--paper-raised)',borderRadius:16}}>My garden</button>
          </main>
          <PageAppearance page="new-tab" ownerKey="rain-test" triggerIcon="palette"/>
        </div>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `},
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", outfile: "rain.js",
    plugins: [{name: "weather-hook", setup(builder) {
      builder.onLoad({filter: /browser-home-widgets\.tsx$/}, ({path: file}) => ({loader: "tsx", contents: fs.readFileSync(file, "utf8").replace("function useDockWeather(", "export function useDockWeather(")}));
    }}],
  });
  const script=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
  const css=fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8').replace(/^@(?:import|source).*$/gm, '')+'\n'+bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    const errors=[];
    const saved={};
    let code=0, requests=0;
    await context.addInitScript(()=>{
      localStorage.setItem('breadboard:theme','light');
      localStorage.setItem('breadboard:theme-mode','manual');
      localStorage.setItem('breadboard:current-location',JSON.stringify({useForAnswers:true,snapshot:{latitude:52,longitude:5,accuracyMeters:100,timeZone:'Europe/Amsterdam',capturedAt:new Date().toISOString()}}));
    });
    await context.route('https://rain.test/**',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:script});
      if(url.pathname==='/style.css')return route.fulfill({contentType:'text/css',body:css});
      if(url.pathname==='/api/browser/weather'){requests++;return route.fulfill({json:{temperatureC:18,code}});}
      if(url.pathname==='/api/profile/page-appearance') {
        if(route.request().method()==='PATCH'){
          const body=route.request().postDataJSON();saved[body.theme]=body.value;
          return route.fulfill({json:{value:body.value}});
        }
        return route.fulfill({json:{preferences:saved}});
      }
      return route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>'});
    });
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('https://rain.test/');
    const rain=page.locator('[data-rain-background]');
    await expect(rain).toHaveAttribute('data-active','false');
    await page.getByRole('button',{name:'Customize appearance'}).click();
    await page.getByRole('button',{name:'Rain',exact:true}).click();
    await expect(rain).toHaveAttribute('data-active','true');
    await expect(rain).toHaveAttribute('data-intensity','steady');
    await expect.poll(()=>saved.light?.rain).toBe('on');
    assert.equal(requests,1,'turning on rain must reuse dock weather, without another request');
    await page.getByRole('switch',{name:'Sync with local weather'}).click();
    await expect(rain).toHaveAttribute('data-active','false');
    await expect(page.getByRole('status')).toContainText('No rain locally');
    code=65;
    await page.evaluate(()=>window.refreshWeather());
    await expect(rain).toHaveAttribute('data-intensity','heavy');
    await expect(rain).toHaveCSS('opacity','1');
    await expect(rain.locator('span').first()).toHaveCSS('animation-play-state','running');
    const before=await rain.locator('span').first().evaluate(el=>getComputedStyle(el).transform);
    await expect.poll(()=>rain.locator('span').first().evaluate(el=>getComputedStyle(el).transform)).not.toBe(before);
    if(process.env.BB_RAIN_SCREENSHOT)await page.screenshot({path:process.env.BB_RAIN_SCREENSHOT});
    await page.getByRole('button',{name:'Close appearance'}).click();
    await page.getByRole('textbox',{name:'Search the web'}).fill('rain test');
    await page.locator('#garden').click();
    assert.equal(await page.evaluate(()=>window.gardenClicks),1,'rain cannot capture interactions');
    assert.equal(await rain.evaluate(el=>getComputedStyle(el).pointerEvents),'none');
    assert.equal(await page.evaluate(()=>document.querySelector('#backdrop').contains(document.querySelector('[data-rain-background]'))),true);

    const peer=await context.newPage();
    peer.on('pageerror',error=>errors.push(error.message));
    await peer.goto('https://rain.test/peer');
    await expect(peer.locator('[data-rain-background]')).toHaveAttribute('data-intensity','heavy');
    assert.equal(requests,2,'the receiving tab shares the current reading');
    code=3;
    await page.evaluate(()=>window.refreshWeather());
    await expect(rain).toHaveAttribute('data-active','false');
    await expect(peer.locator('[data-rain-background]')).toHaveAttribute('data-active','false');
    await peer.getByRole('button',{name:'Customize appearance'}).click();
    await peer.getByRole('switch',{name:'Sync with local weather'}).click();
    await expect(rain).toHaveAttribute('data-intensity','steady');
    await expect(peer.locator('[data-rain-background]')).toHaveAttribute('data-intensity','steady');
    await peer.emulateMedia({reducedMotion:'reduce'});
    await expect(peer.locator('[data-rain-background]')).toHaveCSS('display','none');
    await peer.getByRole('switch',{name:'Sync with local weather'}).click();
    await page.evaluate(()=>{
      localStorage.removeItem('breadboard:current-location');
      window.dispatchEvent(new Event('breadboard:current-location-change'));
    });
    await expect(rain).toHaveAttribute('data-active','false');
    await expect(peer.getByRole('status')).toContainText('Enable current location');
    await peer.getByRole('button',{name:'Rain',exact:true}).click();
    await expect.poll(()=>saved.light?.rain).toBe(undefined);
    await expect(rain).toHaveAttribute('data-active','false');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
