import { chromium } from '../../../node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({headless:true,channel:"msedge"});
try {
  const page = await browser.newPage({viewport:{width:350,height:480},deviceScaleFactor:2});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const icon = (color, mark) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="2" y="2" width="28" height="28" rx="4" fill="${color}"/><text x="16" y="23" text-anchor="middle" font-family="Arial" font-size="22" fill="white">${mark}</text></svg>`)}`;
    window.commands = [];
    window.failCommand = null;
    window.extensionState = {
      enabled:true,activeId:1,tabs:[{id:1,title:'Example page',url:'https://example.com',loading:false,browser:{address:'https://example.com',pageReady:true,private:false}}],
      extensions:[
        {id:'hkgfoiooedgoejojocmhlaklaeopbecg',name:'Screencastify Enhanced',version:'1.0',iconUrl:icon('#ed795f','×'),action:{title:'Open',badge:'',menus:[{id:'always',title:'Always show controls',checked:true}]}},
        {id:'stylus',name:'Stylus',version:'2.0',iconUrl:icon('#547b80','S')},
        {id:'hls',name:'HLS Downloader',version:'3.0',iconUrl:icon('#009be5','h')},
        {id:'video',name:'Video Download Helper',version:'4.0',iconUrl:icon('#bfc4cc','▶')}
      ]
    };
    window.publish = () => window.listener?.(structuredClone(window.extensionState));
    window.breadboardDesktop = {
      getTabsState:async()=>structuredClone(window.extensionState),
      onTabsState:listener=>{window.listener=listener;return()=>{window.listener=null}},
      tabs:async(command)=>{
        window.commands.push(command);
        if(window.failCommand === command.type) return false;
        if(command.type==='browser-extension-remove'){
          window.extensionState.extensions=window.extensionState.extensions.filter(e=>e.id!==command.id);window.publish();
        }
        return true;
      }
    };
  });
  await page.goto(pathToFileURL(path.join(dir,'index.html')).href);
  const run = page.getByRole('button',{name:'Run Screencastify Enhanced',exact:true});
  await run.waitFor();
  await page.mouse.click(174,22);
  await run.hover();
  await page.getByRole('dialog').screenshot({path:path.join(dir,'extensions-popup.png')});
  const dimensions = await page.getByRole('dialog').boundingBox();
  assert.equal(dimensions.width,350);
  assert.ok(dimensions.height >= 300 && dimensions.height <= 310, JSON.stringify(dimensions));
  assert.equal(await page.getByRole('button',{name:'Load unpacked',exact:true}).count(),0);
  await run.click();
  assert.ok(await page.evaluate(()=>window.commands.some(c=>c.type==='browser-extension-action')));
  await page.getByRole('button',{name:'More options for Screencastify Enhanced',exact:true}).click();
  await page.getByRole('checkbox',{name:'Always show controls'}).click();
  assert.ok(await page.evaluate(()=>window.commands.some(c=>c.type==='browser-extension-action'&&c.menuId==='always')));
  await page.getByRole('button',{name:'Reload Screencastify Enhanced',exact:true}).click();
  assert.ok(await page.evaluate(()=>window.commands.some(c=>c.type==='browser-extension-reload')));
  await page.getByRole('dialog').screenshot({path:path.join(dir,'extensions-options.png')});
  await page.getByRole('button',{name:'More options for Screencastify Enhanced',exact:true}).click();
  await page.getByRole('button',{name:'Manage extensions',exact:true}).click();
  await page.evaluate(()=>{window.failCommand='browser-extension-load'});
  await page.getByRole('button',{name:'Load unpacked',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/could not be loaded/);
  await page.getByRole('dialog').screenshot({path:path.join(dir,'extensions-management.png')});
  await page.evaluate(()=>{window.failCommand=null});
  await page.getByRole('button',{name:'Load unpacked',exact:true}).click();
  await page.getByRole('button',{name:'Manage extensions',exact:true}).click();
  await page.getByRole('button',{name:'More options for Stylus',exact:true}).click();
  await page.getByRole('button',{name:'Remove Stylus',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'More options for Stylus',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'Manage extensions');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Run Screencastify Enhanced');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent?.trim()),'Manage extensions');
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(()=>window.commands.some(c=>c.type==='browser-extensions-close')));
  await page.setViewportSize({width:250,height:230});
  await page.evaluate(()=>{
    window.extensionState.tabs[0].browser.private=true;
    window.extensionState.extensions[0].name='A very long extension name that should truncate without covering the menu';
    window.publish();
  });
  assert.ok(await page.getByRole('button',{name:/Run A very long/}).isDisabled());
  const overflow = await page.getByRole('dialog').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,height:el.scrollHeight,visible:el.clientHeight}));
  assert.ok(overflow.scroll<=overflow.client,JSON.stringify(overflow));
  assert.ok(overflow.height>overflow.visible,JSON.stringify(overflow));
  await page.getByRole('button',{name:'Manage extensions',exact:true}).click();
  await page.getByRole('button',{name:'Load unpacked',exact:true}).click();
  await page.setViewportSize({width:350,height:480});
  await page.evaluate(()=>{window.extensionState.extensions=[];window.publish()});
  await page.getByText('No extensions loaded yet.').waitFor();
  await page.getByRole('dialog').screenshot({path:path.join(dir,'extensions-empty.png')});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'passed',dimensions,checked:['open extension','option toggle','reload','remove and focus restoration','management and load failure/retry','Tab focus wrapping','Escape dismissal','private mode','narrow viewport scrolling','long names','empty state','no runtime errors']}));
} finally { await browser.close(); }

