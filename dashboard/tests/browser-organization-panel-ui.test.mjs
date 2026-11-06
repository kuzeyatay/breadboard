import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { browserAnnotationCaptureScript, browserAnnotationPaintScript } from '../../desktop/src/main/browser-annotations-dom.ts';

test('Organization panel separates audiences, posts comments and flags, and has no avatars', {timeout:60000}, async t => {
  const root=path.resolve(import.meta.dirname,'..');
  const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import Panel from './src/app/browser/browser-organization-panel';
    function App(){const [target,setTarget]=useState(); const [open,setOpen]=useState(true);
      window.navigate=()=>setTarget({kind:'page',url:'https://example.com/next',title:'Another page'});
      const send=async command=>{window.commands.push(command);if(command.type==='browser-organization-target')setTarget(command.target);return true;};
      return open?<Panel url={target?.url??'https://example.com/article'} title="A quieter internet" target={target} send={send} onClose={()=>setOpen(false)}/>:<button onClick={()=>setOpen(true)}>Open Organization</button>;
    } window.commands=[];createRoot(document.getElementById('root')).render(<App/>);
  `},outfile:'ui.js',bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'loading',setup(build){build.onResolve({filter:/use-page-loading$/},()=>({path:'loading',namespace:'test'}));build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function usePageLoading(){}'}));}}]});
  const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
  const requests=[];let failNext=false;let sequence=0;const state=new Map();
  const textTarget={kind:'text',url:'https://example.com/article',title:'A quieter internet',quote:'A more considered way to browse',prefix:'',suffix:''};
  const thread={id:'selection-1',target:textTarget,count:1,roomPublicId:'studio',rootMessageId:1,organizationHref:'/buzz?room=studio&thread=thread'};
  state.set('room:studio|https://example.com/article',{threads:[thread],thread:null,messages:[{id:'room:1',author:'Ada',body:'Worth keeping this in mind.',source:null,createdAt:'2026-11-06 10:00:00',own:false}],flags:[]});
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/ui.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);return;}
    if(url.pathname==='/ui.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
    if(url.pathname==='/api/buzz/rooms'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({organizations:[{id:10,name:'Studio'}],rooms:[{publicId:'studio',organizationId:10,name:'Research',archived:false}]}));return;}
    if(url.pathname==='/api/browser/annotations'){
      res.setHeader('Content-Type','application/json');
      if(req.method==='POST'){
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
        if(failNext){failNext=false;res.writeHead(503);res.end(JSON.stringify({error:'Please try posting again.'}));return;}
        const key=body.scope+'|'+body.target.url;let data=state.get(key)??{threads:[],thread:null,messages:[],flags:[]};
        let current=data.threads.find(item=>JSON.stringify(item.target)===JSON.stringify(body.target));
        if(!current){current={id:'new-'+(++sequence),target:body.target,count:0,roomPublicId:null,rootMessageId:null};data.threads.push(current);}
        if(body.action==='comment'){data.messages.push({id:'public:'+sequence,author:'You',body:body.body,source:body.source||null,createdAt:'2026-11-06 11:00:00',own:true});current.count++;}
        if(body.action==='flag')data.flags=[{id:1,author:'You',reason:body.body,own:true}];
        if(body.action==='withdraw-flag')data.flags=[];
        data.thread=current;state.set(key,data);res.end(JSON.stringify(data));return;
      }
      const data=state.get(url.searchParams.get('scope')+'|'+url.searchParams.get('url'))??{threads:[],thread:null,messages:[],flags:[]};
      const selected=data.threads.find(thread=>thread.id===url.searchParams.get('thread'));
      res.end(JSON.stringify({...data,thread:selected??null,messages:selected?data.messages:[],flags:selected?data.flags:[]}));return;
    }
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><link rel="stylesheet" href="/ui.css"><style>
      :root{--breadboard-navbar-height:69px;--paper:#fffefa;--paper-surface:#f7f7f3;--paper-strong:#eceee7;--ink:#292d28;--ink-muted:#71766b;--line:#e1e3db;--line-strong:#d3d7cb;--botanical:#4f6f62;--danger:#a23f32}*{box-sizing:border-box}body{margin:0;background:var(--paper);font:15px system-ui;color:var(--ink)}button{font:inherit}#root{height:100vh}article.page{margin:165px 450px 0 110px;max-width:650px}article.page h1{font:42px/1.15 Georgia}article.page p{line-height:1.8;color:#666b60}.chrome{height:103px;background:#f1f2ed;border-bottom:1px solid #e1e3db;padding:45px 30px 15px}.chrome span{display:block;text-align:center;color:#73786d;font-size:12px}
      </style></head><body><div class="chrome"><span>example.com/article</span></div><article class="page"><p>Field notes</p><h1>A quieter internet</h1><p>A more considered way to browse. A little room to reflect, share a source, and leave a thought for the people reading alongside you.</p></article><div id="root"></div><script src="/ui.js"></script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const browser=await chromium.launch({headless:true,...(process.env.BREADBOARD_BROWSER_EXECUTABLE?{executablePath:process.env.BREADBOARD_BROWSER_EXECUTABLE}:{channel:'msedge'})});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:850}});page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'A more considered way to browse 1 comment',exact:true}).click();
  await page.getByText('Worth keeping this in mind.').waitFor();
  assert.equal(await page.locator('aside img, aside [class*="avatar"]').count(),0);
  assert.equal(await page.getByRole('link',{name:'Open thread in Organization'}).getAttribute('href'),'/buzz?room=studio&thread=thread');
  if(process.env.BREADBOARD_ANNOTATIONS_SCREENSHOT){fs.mkdirSync(path.dirname(process.env.BREADBOARD_ANNOTATIONS_SCREENSHOT),{recursive:true});await page.screenshot({path:process.env.BREADBOARD_ANNOTATIONS_SCREENSHOT});}
  await page.getByRole('textbox',{name:'Comment',exact:true}).fill('Private draft');
  await page.getByRole('combobox',{name:'Discussion audience'}).selectOption('public');
  assert.equal(await page.getByRole('textbox',{name:'Comment',exact:true}).inputValue(),'');
  await page.getByRole('textbox',{name:'Comment',exact:true}).fill('A public note');
  await page.getByLabel('More comment options').click();await page.getByRole('button',{name:'Add a source',exact:true}).click();
  await page.getByRole('textbox',{name:'Source link'}).fill('https://example.org/source');
  failNext=true;await page.getByRole('button',{name:'Post comment',exact:true}).click();await page.getByText('Please try posting again.').waitFor();
  await page.getByRole('button',{name:'Post comment',exact:true}).click();await page.getByText('A public note',{exact:true}).waitFor();
  assert.equal(requests[0].operationId,requests[1].operationId);assert.equal(requests[1].scope,'public');assert.equal(requests[1].target.kind,'text');
  assert.equal(await page.getByRole('link',{name:'Source',exact:true}).getAttribute('href'),'https://example.org/source');
  await page.getByLabel('More comment options').click();await page.getByRole('button',{name:'Flag this content'}).click();
  await page.getByRole('textbox',{name:'Reason for flagging'}).fill('This claim needs a source');await page.getByRole('button',{name:'Submit flag'}).click();
  await page.getByText('1 flag',{exact:true}).click();await page.getByText('This claim needs a source',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Remove my flag'}).click();await page.getByText('1 flag',{exact:true}).waitFor({state:'hidden'});
  await page.evaluate(()=>window.navigate());await page.getByText('Another page',{exact:true}).waitFor();assert.equal(await page.getByText('A public note',{exact:true}).count(),0);
  await page.getByRole('tab',{name:'Rooms',exact:true}).click();await page.getByRole('button',{name:'Research',exact:true}).click();
  assert.equal(await page.getByRole('combobox').inputValue(),'room:studio');
  await page.setViewportSize({width:540,height:700});assert.equal(await page.evaluate(()=>document.querySelector('aside').scrollWidth<=document.querySelector('aside').clientWidth),true);
  await page.getByRole('button',{name:'Close Organization'}).click();assert.equal(await page.locator('aside').count(),0);assert.deepEqual(errors,[]);

  // Capture actual DOM selections and media timestamps; shared paint is reversible.
  await page.setContent('<p id="quote">Before <b>selected words</b> after</p><img id="image" src="https://example.com/image.png"><video id="video"></video><input id="secret" value="private">');
  await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('b'));getSelection().removeAllRanges();getSelection().addRange(range);});
  assert.equal((await page.evaluate(browserAnnotationCaptureScript(0,0,'none',''))).quote,'selected words');
  const imageTarget=await page.evaluate(browserAnnotationCaptureScript(0,0,'image','https://example.com/image.png'));assert.equal(imageTarget.selector,'#image');
  await page.evaluate(()=>Object.defineProperty(document.getElementById('video'),'currentTime',{value:81.6}));
  const bounds=await page.locator('video').boundingBox();const videoTarget=await page.evaluate(browserAnnotationCaptureScript(bounds.x+5,bounds.y+5,'video',''));assert.equal(videoTarget.time,82);
  await page.evaluate(browserAnnotationPaintScript([{id:'text',target:{...textTarget,quote:'selected words'}}]));
  assert.equal(await page.evaluate(()=>CSS.highlights.get('breadboard-community').size),1);
  await page.evaluate(browserAnnotationPaintScript([]));assert.equal(await page.locator('[data-breadboard-selection="community"]').count(),0);
});
