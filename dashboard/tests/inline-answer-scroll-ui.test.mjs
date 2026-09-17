import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root=fileURLToPath(new URL('../',import.meta.url));

test('long nested answers stay below the navbar and internal scrolling does not run popup layout', {timeout:60000}, async t=>{
  const bundle=await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    alias:{'@':path.join(root,'src')},logLevel:'silent',stdin:{resolveDir:root,loader:'tsx',contents:`
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {InlineSelectionAnswerPopover,SelectableAssistantMarkdown} from '@/app/components/chat-text-selection-ui';
      const anchor={left:350,right:580,top:160,bottom:185,width:230,height:25};
      const selections=Array.from({length:4},(_,i)=>({id:'selection-'+i,mode:'inline',sourceMessageId:i?'answer-'+(i-1):'main',
        start:0,end:('Selected passage '+i+'.').length,quote:'Selected passage '+i+'.'}));
      const paragraph='Voltage describes the change in potential energy per unit charge. The system includes the charge and its electric field.';
      const answers=selections.map((_,i)=>'Selected passage '+(i+1)+'.\\n\\n'+Array.from({length:35},(_,j)=>'Paragraph '+j+'. '+paragraph).join('\\n\\n'));
      function App(){const [extra,setExtra]=useState('');window.grow=()=>setExtra('\\n\\n'+paragraph.repeat(30));
        return <><header className='breadboard-flower-navbar' style={{position:'fixed',inset:'0 0 auto',height:52,padding:12}}>Garden workspace · EM 1</header>
          <main className='bb-chat-scroller' style={{height:850,overflow:'auto',padding:'140px 350px 100px'}}>
            <SelectableAssistantMarkdown content='Selected passage 0.' sourceMessageId='main' annotations={[{...selections[0],kind:'answer'}]} onSelection={()=>{}} onOpenAnnotation={()=>{}}/>
            <div style={{height:1300}}/>
          </main>
          {selections.map((selection,i)=><InlineSelectionAnswerPopover key={selection.id} anchor={anchor} selection={selection}
            question={['Explain the circuit','Why the whole system?','How does voltage fit?','Explain it from the ground up'][i]}
            answer={answers[i]+extra} answerMessageId={'answer-'+i} pending={false}
            annotations={selections[i+1]?[{...selections[i+1],kind:'answer'}]:[]} onSelection={()=>{}} onOpenAnnotation={()=>{}}
            onClose={()=>{}} onDelete={()=>{}} onAskAgain={()=>{}}/>) }
          <div className='bb-composer-overlay' style={{position:'fixed',height:70,padding:16,background:'var(--paper-raised)'}}><textarea aria-label='Question' placeholder='Ask about your documents…'/></div>
        </>;
      }createRoot(document.getElementById('root')).render(<App/>);
    `}});
  const stylesheet=path.join(root,'src/app/globals.css');
  const css=(await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'),{from:stylesheet})).css;
  const executablePath=[chromium.executablePath(),'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1705,height:975}});page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://localhost:53146/**',route=>route.fulfill({contentType:'text/html',body:'<html data-theme="light"><body><div id="root"></div></body></html>'}));
  await page.goto('http://localhost:53146/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  const cards=page.getByRole('dialog',{name:'Answer about highlighted text'});
  const insideBounds=()=>page.waitForFunction(()=>{
    const top=document.querySelector('header').getBoundingClientRect().bottom+14;
    const bottom=document.querySelector('.bb-composer-overlay').getBoundingClientRect().top-16;
    const cards=[...document.querySelectorAll('.bb-inline-answer')];
    return cards.length===4&&cards.every(card=>{const r=card.getBoundingClientRect();return getComputedStyle(card).visibility==='visible'&&r.top>=top-1&&r.bottom<=bottom+1&&r.left>=16&&r.right<=innerWidth-16;});
  });
  await insideBounds();
  // Let ResizeObserver's initial delivery settle, then count real DOM layout reads.
  await page.waitForTimeout(200);
  const initial=await cards.evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  await page.evaluate(()=>{
    window.popupLayoutReads=0;
    const read=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(){
      if(this.matches('.bb-inline-answer, .bb-inline-answer *, .breadboard-flower-navbar, .bb-composer-overlay')) window.popupLayoutReads++;
      return read.call(this);
    };
  });
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>window.popupLayoutReads),0,'idle popups perform no repeated layout measurements');
  await page.evaluate(()=>new Promise(resolve=>{
    let step=0;
    const scroll=()=>{
      document.querySelectorAll('.bb-inline-answer').forEach(card=>{card.scrollTop=step*35;});
      if(++step<20) requestAnimationFrame(scroll);else resolve();
    };scroll();
  }));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.popupLayoutReads),0,'scrolling inside answers performs no popup layout measurements');
  assert.deepEqual(await cards.evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})),initial,'reading an answer does not move or hide its children');
  assert.ok((await cards.evaluateAll(cards=>cards.map(card=>card.scrollTop))).every(top=>top>100));
  await page.evaluate(()=>{document.querySelector('header').style.height='100px';});
  await insideBounds();
  await page.evaluate(()=>window.grow());await insideBounds();
  await cards.first().evaluate(card=>{card.scrollTop=0;});
  const handle=await cards.first().getByRole('button',{name:'Move answer',exact:true}).boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2,5,{steps:8});await page.mouse.up();
  await insideBounds();
  const artifacts=path.join(root,'.tmp-ask-here-qa');fs.mkdirSync(artifacts,{recursive:true});
  await page.screenshot({path:path.join(artifacts,'navbar-scroll-desktop.png')});
  await page.setViewportSize({width:390,height:700});await insideBounds();
  assert.deepEqual(errors,[]);
});
