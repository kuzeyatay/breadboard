import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = path.resolve(import.meta.dirname, '..');
const previewImage = 'data:image/webp;base64,' + fs.readFileSync(path.join(root, 'public/browser-wallpapers/thumbnails/alpine-dawn.webp')).toString('base64');

test('Ask here retains drafts, image-only questions, image preview, stop/retry and overflow deletion in both themes', {timeout:90_000}, async t => {
  const bundle = await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    alias:{'@':path.join(root,'src')},logLevel:'silent',stdin:{resolveDir:root,loader:'tsx',contents:`
      import React,{useState} from 'react';import{createRoot}from'react-dom/client';
      import{InlineSelectionAnswerPopover}from'./src/app/components/chat-text-selection-ui';
      function App(){
        const[open,setOpen]=useState(true),[question,setQuestion]=useState(''),[answer,setAnswer]=useState('');
        const[pending,setPending]=useState(false),[attachments,setAttachments]=useState([]);
        window.finish=()=>{setPending(false);setAnswer('A **formatted answer** about the highlighted passage.');};
        return <><button id='reopen' onClick={()=>setOpen(true)}>Reopen</button>
          {open&&<InlineSelectionAnswerPopover draftId='design-draft' anchor={{left:140,right:400,top:60,bottom:85,width:260,height:25}}
            question={question} answer={answer} questionAttachments={attachments} pending={pending} canStar={false}
            onAskAgain={(question,files)=>{window.sent={question,files};setAttachments([...files]);setQuestion(question);setPending(true);}}
            onStop={()=>{window.stopped=true;setPending(false);setAnswer('Stopped answer.');}}
            onClose={()=>setOpen(false)} onDelete={()=>{window.deleted=true;setOpen(false);}}/>}</>;
      }createRoot(document.getElementById('root')).render(<App/>);
    `}});
  const stylesheet=path.join(root,'src/app/globals.css');
  const css=(await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'),{from:stylesheet})).css;
  const executablePath=[chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  t.after(()=>browser.close());
  for(const theme of ['light','dark']){
    const page=await browser.newPage({viewport:{width:1000,height:850}});
    page.setDefaultTimeout(7000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://localhost:53191/**',route=>{
      if(route.request().url().includes('/api/extract-text')) return route.fulfill({json:{type:'image',dataUrl:previewImage}});
      return route.request().url().includes('/api/')?route.fulfill({json:{}})
        :route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="'+theme+'"><body><div id="root"></div></body></html>'});
    });
    await page.goto('http://localhost:53191/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
    const card=page.getByRole('dialog',{name:'Answer about highlighted text'});
    const editor=card.getByRole('textbox');
    await expect(editor).toBeFocused();
    await expect.poll(()=>card.evaluate(el=>el.getBoundingClientRect().width)).toBe(400);
    await expect(card.getByRole('button',{name:'Delete highlight',exact:true})).toHaveCount(0);
    await expect(card.getByText('Ask here',{exact:true})).toHaveCount(0);
    await expect(card.getByText('Paste images',{exact:true})).toHaveCount(0);
    const colors=await card.evaluate(el=>{
      const probe=document.createElement('span');el.append(probe);
      probe.style.backgroundColor='var(--paper-raised)';const background=getComputedStyle(probe).backgroundColor;
      probe.style.color='var(--selection-yellow-line)';const edge=getComputedStyle(probe).color;probe.remove();
      return {background,edge,actualBackground:getComputedStyle(el).backgroundColor,actualEdge:getComputedStyle(el).borderTopColor};
    });
    assert.equal(colors.actualBackground,colors.background);assert.equal(colors.actualEdge,colors.edge);
    await editor.fill('Keep this draft');await editor.press('Shift+Enter');await editor.type('Second line');
    await editor.evaluate(el=>{
      const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#6688aa';ctx.fillRect(0,0,240,160);
      const bytes=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0));
      const clipboardData=new DataTransfer();
      clipboardData.items.add(new File([bytes],'first.png',{type:'image/png'}));
      clipboardData.items.add(new File([bytes],'second.png',{type:'image/png'}));
      el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
    });
    await expect(card.getByRole('button',{name:'Zoom first.png'})).toBeVisible();
    await expect(card.getByRole('button',{name:'Zoom second.png'})).toBeVisible();
    await expect(card.getByRole('img',{name:'first.png'})).toHaveCSS('object-fit','cover');
    await card.getByRole('button',{name:'Zoom first.png'}).click();
    const preview=page.getByRole('dialog',{name:'first.png',exact:true});await expect(preview).toBeVisible();
    await page.keyboard.press('ArrowRight');await expect(page.getByRole('dialog',{name:'second.png',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await expect(card).toBeVisible();
    await expect(card.getByRole('button',{name:'Zoom first.png'})).toBeFocused();
    await card.getByRole('button',{name:'Remove second.png'}).click();
    await card.getByRole('button',{name:'Close answer',exact:true}).click();
    await page.locator('#reopen').click();
    await expect(editor).toHaveValue('Keep this draft\nSecond line');
    await expect(card.getByRole('button',{name:'Zoom first.png'})).toBeVisible();
    await expect(card.getByRole('button',{name:'Zoom second.png'})).toHaveCount(0);
    if(process.env.BREADBOARD_INLINE_DESIGN_QA_DIR){
      fs.mkdirSync(process.env.BREADBOARD_INLINE_DESIGN_QA_DIR,{recursive:true});
      await page.screenshot({path:path.join(process.env.BREADBOARD_INLINE_DESIGN_QA_DIR,theme+'-typing.png')});
    }
    await editor.fill('');
    const ask=card.getByRole('button',{name:'Ask',exact:true});
    await expect(ask).toBeEnabled();
    assert.ok(await ask.evaluate(el=>Boolean(el.closest('.bb-metal-send'))),'the existing metal Ask button wraps the real send action');
    await card.hover();await page.mouse.wheel(150,0);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await card.evaluate(el=>el.scrollLeft),0,'the Ask button glow cannot scroll the card sideways');
    await ask.click();
    await expect(card.getByRole('button',{name:'Stop this answer',exact:true})).toBeVisible();
    assert.equal((await page.evaluate(()=>window.sent.files)).length,1);
    await card.getByRole('button',{name:'Stop this answer',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.stopped),true);
    await card.getByRole('button',{name:'Ask this question again',exact:true}).click();
    await page.evaluate(()=>window.finish());
    await expect(card.getByText('formatted answer',{exact:true})).toBeVisible();
    for(const name of ['Copy response','Read response aloud','Mark response as helpful','Mark response as not helpful','More response actions']){
      await expect(card.getByRole('button',{name,exact:true})).toBeVisible();
    }
    await card.getByRole('button',{name:'More highlight actions',exact:true}).click();
    await expect(card.getByRole('menuitem',{name:'Delete highlight',exact:true})).toBeFocused();
    await page.keyboard.press('Escape');await expect(card).toBeVisible();
    await expect(card.getByRole('menuitem',{name:'Delete highlight',exact:true})).toHaveCount(0);
    await page.setViewportSize({width:390,height:700});
    await expect.poll(()=>card.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=16&&r.right<=innerWidth-16&&r.bottom<=innerHeight;})).toBe(true);
    assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth),'the small layout has no horizontal scrolling');
    await card.getByRole('button',{name:'More highlight actions',exact:true}).click();
    await card.getByRole('menuitem',{name:'Delete highlight',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.deleted),true);await expect(card).toHaveCount(0);
    assert.deepEqual(errors,[]);await page.close();
  }
});
