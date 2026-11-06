import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('PenEcho flush waits for stored ink, saves edits during a write, and rejects foreign messages', async () => {
  const source=fs.readFileSync(new URL('../../penecho/src/client/app/breadboard-board.js',import.meta.url),'utf8');
  const messages=[],handlers=new Map(),writes=[];
  const parent={postMessage:(data,origin)=>messages.push({data,origin})};
  const context=vm.createContext({URL,Date,Promise,Math,String,location:{href:'http://board/?board=1720000000000-abcdefgh',ancestorOrigins:['http://quartz']},
    document:{referrer:'http://quartz/note'},window:{parent,addEventListener:(type,fn)=>handlers.set(type,fn)},state:{scale:1,panX:0,panY:0},
    setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,10)),clearTimeout,setInterval:()=>{},canvasIsEmpty:()=>false,
    saveSnapshot:()=>new Promise(resolve=>writes.push(resolve)),setStatus:()=>{},t:()=>'',});
  vm.runInContext(source+'\nboard.bound=true;board.id="1720000000000-abcdefgh";board.view=boardViewSignature();breadboardBoardChanged();',context);
  const receive=handlers.get('message');
  await receive({source:{},origin:'http://quartz',data:{type:'penecho:flush-board',requestId:'foreign'}});assert.equal(messages.length,0);
  await receive({source:parent,origin:'http://foreign',data:{type:'penecho:flush-board',requestId:'foreign'}});assert.equal(messages.length,0);
  const flush=receive({source:parent,origin:'http://quartz',data:{type:'penecho:flush-board',requestId:'flush'}});
  assert.equal(writes.length,1);assert.equal(messages.length,0,'no acknowledgement before persistence');
  vm.runInContext('breadboardBoardChanged()',context);writes.shift()({id:'saved'});
  const deadline=Date.now()+2000;while(writes.length===0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.equal(writes.length,1);assert.equal(messages.length,0,'new ink also must reach persistence');
  writes.shift()({id:'saved'});await flush;
  assert.equal(messages.length,1);assert.equal(messages[0].data.ok,true);assert.equal(messages[0].data.requestId,'flush');assert.equal(messages[0].origin,'http://quartz');
  vm.runInContext('clearTimeout(board.timer)',context);
});
