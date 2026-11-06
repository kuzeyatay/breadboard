import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');

test('the real composer waits for uploads before sending or queueing a complete message', { timeout: 90_000 }, async t => {
  const bundle = await build({
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: 'app.js',
    alias: { '@': path.join(root, 'src') }, loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import AssistantComposer from '@/app/components/assistant-composer';
      import {useAttachmentPreparation} from '@/app/components/use-attachment-preparation';
      window.sent=[]; window.followUps=[]; window.uploads={};
      function App() {
        const [input,setInput]=useState(''), [attachments,setAttachments]=useState([]);
        const [scope,setScope]=useState('chat-a'), [active,setActive]=useState(false);
        const uploads=useAttachmentPreparation(scope);
        window.beginUpload=name=>{window.uploads[name]=uploads.begin()};
        window.finishUpload=(name,fail=false)=>{
          const job=window.uploads[name];
          if(job.isCurrent()&&!fail)setAttachments(current=>[...current,{type:'text',name,text:'ready file'}]);
          job.finish(fail?[name+': upload failed']:[]);
        };
        window.switchChat=()=>{setScope('chat-b');setInput('');setAttachments([])};
        window.setActive=setActive;
        return <AssistantComposer value={input} onChange={setInput} placeholder="Draft"
          capabilitySessionId={scope} model="test" models={[]} onModelChange={()=>{}}
          reasoningEffort="medium" onReasoningEffortChange={()=>{}}
          canSubmit={Boolean(input.trim()||attachments.length)} isAddingDocuments={uploads.busy}
          attachmentUploadError={uploads.error} attachments={attachments}
          onRemoveAttachment={index=>setAttachments(current=>current.filter((_,i)=>i!==index))}
          runState={active?'running':'idle'} isSending={active} onStop={()=>setActive(false)}
          onQueueSteer={(text,files)=>window.followUps.push({text,files,scope})}
          onSubmit={()=>{window.sent.push({text:input,files:attachments,scope});setInput('');setAttachments([])}}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    plugins: [{ name: 'unrelated-services', setup(b) {
      b.onResolve({ filter: /^(next\/dynamic|next\/navigation)$|\/(settings-dialog|voice-conversation-overlay|speech-dictation-button|slash-command-menu|command-hub)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path: name}) => ({ loader: 'tsx', resolveDir: root, contents:
        name === 'next/navigation' ? "export const useRouter=()=>({push(){},replace(){}});export const usePathname=()=>'/';export const useSearchParams=()=>new URLSearchParams();"
        : name === 'next/dynamic' ? 'export default function dynamic(){return ()=>null;}'
        : name.endsWith('command-hub') ? 'export const CommandHub=()=>null;'
        : 'export default function Leaf(){return null;}'
      }));
    } }],
  });
  const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', chromium.executablePath()].find(fs.existsSync);
  const browser = await chromium.launch({headless:true, executablePath});
  t.after(()=>browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('https://uploads.test/**', route => route.fulfill({json:{settings:{},models:[],sessions:[],messages:[],entries:[]}}));
  const reset = async () => {
    await page.goto('https://uploads.test/');
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
    await page.getByPlaceholder('Draft').waitFor();
  };
  const draft=page.getByPlaceholder('Draft');
  const begin = name => page.evaluate(name=>window.beginUpload(name),name);
  const finish = (name,fail=false) => page.evaluate(([name,fail])=>window.finishUpload(name,fail),[name,fail]);
  const sent = () => page.evaluate(()=>window.sent);

  await reset();
  await begin('first.txt'); await begin('second.txt');
  await draft.fill('Read both files');
  await page.getByRole('button',{name:'Queue message',exact:true}).click();
  await page.getByText('Message queued — waiting for files…',{exact:true}).waitFor();
  await draft.press('Enter'); await draft.press('Enter');
  await finish('first.txt');
  assert.deepEqual(await sent(),[],'finishing one overlapping upload must not send');
  await finish('second.txt');
  await page.waitForFunction(()=>window.sent.length===1);
  assert.deepEqual((await sent())[0],{text:'Read both files',files:[
    {type:'text',name:'first.txt',text:'ready file'}, {type:'text',name:'second.txt',text:'ready file'},
  ],scope:'chat-a'});
  await page.waitForTimeout(100);
  assert.equal((await sent()).length,1);

  await reset(); await begin('only.txt');
  await draft.press('Enter');
  await finish('only.txt');
  await page.waitForFunction(()=>window.sent.length===1);
  assert.equal((await sent())[0].files[0].name,'only.txt','attachment-only Enter queues too');

  await reset(); await begin('bad.txt'); await begin('good.txt');
  await draft.fill('Keep my message'); await draft.press('Enter');
  await finish('bad.txt',true); await finish('good.txt');
  await page.getByRole('alert').waitFor();
  assert.deepEqual(await sent(),[]);
  assert.equal(await draft.inputValue(),'Keep my message');
  assert.equal(await draft.getAttribute('readonly'),null);
  await begin('retry.txt'); await draft.press('Enter'); await finish('retry.txt');
  await page.waitForFunction(()=>window.sent.length===1);

  await reset(); await begin('cancel.txt'); await draft.fill('Edit later'); await draft.press('Enter');
  await page.getByRole('button',{name:'Cancel queued send'}).click();
  await draft.fill('Edited draft'); await finish('cancel.txt');
  assert.deepEqual(await sent(),[]);
  assert.equal(await draft.inputValue(),'Edited draft');

  await reset(); await begin('old.txt'); await draft.fill('Old chat'); await draft.press('Enter');
  await page.evaluate(()=>window.switchChat());
  await page.waitForFunction(()=>document.querySelector('textarea').value==='');
  await finish('old.txt');
  assert.deepEqual(await sent(),[]);
  assert.equal(await draft.inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'Remove old.txt'}).count(),0);

  await reset(); await page.evaluate(()=>window.setActive(true)); await begin('followup.txt');
  await page.getByRole('button',{name:'Queue message',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.followUps),[]);
  await finish('followup.txt');
  await page.waitForFunction(()=>window.followUps.length===1);
  assert.equal(await page.evaluate(()=>window.followUps[0].files[0].name),'followup.txt');
  assert.deepEqual(await sent(),[],'an active response keeps ownership after upload completion');
  assert.deepEqual(errors,[]);
});
