import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {acquireDetachedEventPump,captureEventPumpRetirement,waitForDetachedEventPumps} from '../src/lib/hermes/detached-event-pump.ts';

test('durable completion retires replay even before an upstream terminal frame',async()=>{
  let active='old',finishOld,finishNext;
  const oldWait=new Promise(r=>{finishOld=r;}),nextWait=new Promise(r=>{finishNext=r;});
  const key='voice-persisted-'+crypto.randomUUID();
  const old=acquireDetachedEventPump(key,async sink=>{
    sink.reuseWhile(()=>active==='old');sink.markConnected();
    sink.emit(new TextEncoder().encode('data: previous answer\n\n'));await oldWait;
  });
  assert.equal(acquireDetachedEventPump(key,async()=>{}),old,'active reconnect still shares the producer');
  active=''; // durable finish has happened; upstream done has not
  const next=acquireDetachedEventPump(key,async sink=>{sink.markConnected();await nextWait;});
  try{
    assert.notEqual(next,old);assert.equal(old.isClosed,true);
    const reader=next.response(new AbortController().signal,{}).body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value),': connected\n\n');
    finishNext();await next.settled();assert.equal((await reader.read()).done,true,'no old words were replayed');
  }finally{finishOld();finishNext();await waitForDetachedEventPumps();}
});

test('Stop retires replay before a delayed upstream abort and keeps cleanup owned',async()=>{
  let finishOld,finishNew,oldSink;
  const cleanup=new Promise(resolve=>{finishOld=resolve;});
  const work=new Promise(resolve=>{finishNew=resolve;});
  const key='voice-cancel-'+crypto.randomUUID();
  const bytes=text=>new TextEncoder().encode(text);
  const old=acquireDetachedEventPump(key,async sink=>{oldSink=sink;sink.markConnected();sink.emit(bytes('data: old words\n\n'));await cleanup;});
  const retire=captureEventPumpRetirement(key);
  retire(bytes('data: {"type":"cancelled"}\n\n'));
  const next=acquireDetachedEventPump(key,async sink=>{sink.markConnected();sink.emit(bytes('data: next answer\n\n'));await work;});
  try{
    assert.notEqual(next,old);
    oldSink.emit(bytes('data: late old words\n\n'));
    retire(); // a delayed duplicate cleanup cannot retire the new producer
    assert.equal(next.isClosed,false);
    const reader=next.response(new AbortController().signal,{}).body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value),': connected\n\n');
    assert.equal(new TextDecoder().decode((await reader.read()).value),'data: next answer\n\n');
    await reader.cancel();
    let settled=false;const joining=waitForDetachedEventPumps().then(()=>{settled=true;});
    finishNew();await next.settled();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(settled,false,'cancelled upstream cleanup is still owned');
    finishOld();await joining;
  }finally{finishOld();finishNew();await waitForDetachedEventPumps();}
});

test('a follow-up gets a fresh stream while the previous turn finishes cleanup',async()=>{
  let releaseOld,releaseNew,drives=0;
  const oldCleanup=new Promise(resolve=>{releaseOld=resolve;});
  const newTurn=new Promise(resolve=>{releaseNew=resolve;});
  const key='voice-follow-up-'+crypto.randomUUID();
  const bytes=text=>new TextEncoder().encode(text);
  const old=acquireDetachedEventPump(key,async sink=>{
    drives++;sink.markConnected();sink.emit(bytes('data: previous answer\n\n'));sink.close();
    await oldCleanup;
  });
  const next=acquireDetachedEventPump(key,async sink=>{
    drives++;sink.markConnected();sink.emit(bytes('data: fresh answer\n\n'));
    await newTurn;sink.close();
  });
  try {
    assert.notEqual(next,old,'a finished answer must never be replayed into the next turn');
    const reader=next.response(new AbortController().signal,{}).body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value),': connected\n\n');
    assert.equal(new TextDecoder().decode((await reader.read()).value),'data: fresh answer\n\n');
    releaseOld();await old.settled();
    assert.equal(acquireDetachedEventPump(key,async()=>{drives++;}),next,'old cleanup must not evict the new active pump');
    assert.equal(drives,2);
    await reader.cancel();
  } finally {releaseOld();releaseNew();await waitForDetachedEventPumps();}
});

test('finite workers still wait for cleanup of a replaced terminal voice stream',async()=>{
  let releaseOld,joined=false;
  const cleanup=new Promise(resolve=>{releaseOld=resolve;});
  const key='voice-cleanup-'+crypto.randomUUID();
  acquireDetachedEventPump(key,async sink=>{sink.close();await cleanup;});
  const next=acquireDetachedEventPump(key,async sink=>{sink.close();});
  await next.settled();
  const joining=waitForDetachedEventPumps().then(()=>{joined=true;});
  await new Promise(resolve=>setImmediate(resolve));
  try {assert.equal(joined,false,'closing viewers must not detach worker cleanup');}
  finally {releaseOld();await joining;}
  assert.equal(joined,true);
});

test('terminal API frames retire the viewer immediately while normal speech stays open',()=>{
  const text=fs.readFileSync(new URL('../src/lib/hermes/event-stream.ts',import.meta.url),'utf8');
  const source=ts.createSourceFile('events.ts',text,ts.ScriptTarget.Latest,true);
  let initializer;
  const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='emit')initializer=node.initializer.getText(source);ts.forEachChild(node,visit);};
  visit(source);assert.ok(initializer);
  const compiled=ts.transpileModule('const emit='+initializer+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  for(const type of ['assistant.voice.delta','done','cancelled']){
    const calls=[];
    const invoke=new Function('sink','encoder','encodeSseEvent',`let failure;${compiled};return emit;`)({emit:()=>calls.push('emit'),close:()=>calls.push('close')},new TextEncoder(),JSON.stringify);
    invoke({type});
    assert.deepEqual(calls,type==='assistant.voice.delta'?['emit']:['emit','close']);
  }
});
