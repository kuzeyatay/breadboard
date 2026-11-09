import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readNotificationPaintedRects } from '../src/main/notification-visible-region';

test('transparent native shell, card gaps and fixed popovers report only painted clipped geometry', {timeout:20_000}, async()=>{
  const dashboard=process.env.BREADBOARD_NOTIFICATION_TEST_DASHBOARD || path.resolve(__dirname,'../../../dashboard');
  const {chromium}=require(require.resolve('playwright',{paths:[dashboard]}));
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(file=>fs.existsSync(file));
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  try {
    const page=await browser.newPage({viewport:{width:600,height:400}});
    const rects=(selector:string)=>page.evaluate(`(${readNotificationPaintedRects.toString()})(${JSON.stringify(selector)})`);
    await page.setContent(`<style>body{margin:0;background:transparent}.desktop-title-bar{height:40px;background:#123}
      .browser-address-suggestions{position:fixed;left:300px;top:40px;width:200px;height:160px;background:white}
      .bb-tab-drag-feedback{position:fixed;inset:0;pointer-events:none}.bb-tab-drop-hint{position:absolute;left:20px;top:300px;width:100px;height:20px;background:#123}</style>
      <div class="desktop-title-bar"></div><div style="height:0;overflow:hidden"><div class="browser-address-suggestions"></div></div>
      <div class="bb-tab-drag-feedback"><span class="bb-tab-drop-hint"></span></div>`);
    assert.deepEqual(await rects('.desktop-title-bar,.browser-address-suggestions,.bb-tab-drop-hint'),[
      {x:0,y:0,width:600,height:40},{x:300,y:40,width:200,height:160},{x:20,y:300,width:100,height:20},
    ],'the full transparent shell and drag backdrop do not become covers');
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}.host{position:absolute;left:300px;top:150px;width:250px;height:140px;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:24px}.bb-toast-card{flex:none;width:200px;height:60px;background:#123}</style>
      <div class="host"><div class="bb-toast-card"></div><div class="bb-toast-card"></div></div>`);
    assert.deepEqual(await rects('.bb-toast-card'),[{x:316,y:166,width:200,height:60},{x:316,y:250,width:200,height:40}],
      'transparent card padding and inter-card gaps remain readable; scroll viewport clips the last card');
    await page.setContent(`<body style="margin:0;height:0;overflow:hidden"><div id="parent" style="height:0;overflow:hidden">
      <div class="bb-inline-answer" style="position:fixed;left:16px;top:16px;width:200px;height:60px;background:#123"></div></div></body>`);
    assert.deepEqual(await rects('.bb-inline-answer'),[{x:16,y:16,width:200,height:60}],'fixed popover escapes an unrelated overflow ancestor');
    await page.locator('#parent').evaluate((element:HTMLElement)=>{element.style.opacity='0';});
    assert.deepEqual(await rects('.bb-inline-answer'),[],'transparent ancestor hides the panel');
    await page.locator('#parent').evaluate((element:HTMLElement)=>{element.style.opacity='1';element.style.transform='translateZ(0)';});
    assert.deepEqual(await rects('.bb-inline-answer'),[],'a transformed containing block clips the fixed panel');
    await page.locator('#parent').evaluate((element:HTMLElement)=>{element.remove();});
    assert.deepEqual(await rects('.bb-inline-answer'),[],'removed elements cannot retain painted geometry');
  } finally {await browser.close();}
});
