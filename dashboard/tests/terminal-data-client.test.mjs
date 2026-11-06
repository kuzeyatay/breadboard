import assert from 'node:assert/strict';
import test from 'node:test';
import {readTerminalData} from '../src/lib/terminal-data-client.ts';

test('Terminal native reads preserve errors and response status, and cancel without a duplicate HTTP request',async()=>{
  const previous={window:globalThis.window,fetch:globalThis.fetch};
  let resolveRequest;const cancelled=[];const calls=[];
  globalThis.window={breadboardDesktop:{
    readTerminalData:(id,path)=>{calls.push({id,path});return new Promise(resolve=>{resolveRequest=resolve;});},
    cancelTerminalData:id=>cancelled.push(id),
  }};
  globalThis.fetch=()=>{throw Error('Must not fall back to the congested HTTP pool')};
  try{
    const controller=new AbortController();
    const read=readTerminalData('/api/models',controller.signal);
    controller.abort();await assert.rejects(read,{name:'AbortError'});
    assert.deepEqual(cancelled,[calls[0].id]);resolveRequest({status:200,body:'{}'});
    const next=readTerminalData('/api/calendar/calendars');
    resolveRequest({status:503,body:'{"error":"unavailable"}'});
    const response=await next;assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'unavailable'});
    const before=calls.length;await assert.rejects(readTerminalData('/api/models',controller.signal),{name:'AbortError'});assert.equal(calls.length,before);
    globalThis.window.breadboardDesktop.readTerminalData=async()=>{throw Error('IPC unavailable')};
    await assert.rejects(readTerminalData('/api/models'),/IPC unavailable/);
  }finally{globalThis.window=previous.window;globalThis.fetch=previous.fetch;}
});

test('ordinary browsers and older desktop builds still use authenticated same-origin fetch',async()=>{
  const previous={window:globalThis.window,fetch:globalThis.fetch};const calls=[];
  globalThis.window={};globalThis.fetch=async(path,init)=>{calls.push({path,init});return new Response('{}')};
  try{
    const controller=new AbortController();await readTerminalData('/api/models',controller.signal);
    assert.equal(calls[0].path,'/api/models');assert.equal(calls[0].init.signal,controller.signal);assert.equal(calls[0].init.cache,'no-store');
  }finally{globalThis.window=previous.window;globalThis.fetch=previous.fetch;}
});
