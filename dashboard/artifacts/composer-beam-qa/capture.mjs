import path from 'node:path';
import {chromium} from '@playwright/test';
const out=path.resolve('artifacts/composer-beam-qa');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
 const page=await browser.newPage({viewport:{width:1144,height:190}});
 await page.goto('file:///'+path.join(out,'preview.html').replaceAll('\\','/'));
 const beam=page.locator('[data-beam="composer"]');
 await beam.waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-beam] span').getAnimations().length===1);
 await page.waitForTimeout(250);
 for(const [label,time] of [['start',0],['middle',4000],['corner',10700]]) {
   await beam.evaluate((node,time)=>{node.querySelectorAll('span').forEach((light,index)=>{const a=light.getAnimations()[0];a.pause();a.currentTime=time+index*a.effect.getTiming().duration/2;});},time);
   await page.screenshot({path:path.join(out,label+'.png')});
 }
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.body.style.background='#f1f0e8';});
 await page.addStyleTag({content:'.composer,button{background:#e9e8df;color:#61685e}'});
 await page.screenshot({path:path.join(out,'light.png')});
 console.log(out);
} finally {await browser.close();}
