import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { terminalDataUrl, readTerminalData, registerTerminalDataHandlers } from "../src/main/terminal-data-transport";
import { IPC_CHANNELS } from "../src/shared/ipc-contract";

const origin = "http://127.0.0.1:32123";
test("Terminal startup transport permits only its read routes on the current local server", () => {
  assert.equal(terminalDataUrl('/api/browser/weather?latitude=52&longitude=5', origin).origin, origin);
  for (const path of ['https://example.com/api/models','//evil/api/models','/api/auth/session','/api/models/../usage-limits','/api/%6dodels','/api/models#x','/api/models\\x','/_next/static/a.js']) {
    assert.throws(()=>terminalDataUrl(path,origin),/Invalid Terminal data route/);
  }
  assert.throws(()=>terminalDataUrl('/api/models','https://example.com'),/Invalid/);
});

test("Terminal reads authenticate each request, never follow redirects, cache account data, or allow writes", async () => {
  let cookie = 'first'; const seen: string[] = [];
  const input = {dashboardUrl:origin,path:'/api/calendar/calendars',signal:new AbortController().signal,
    readCookies:async()=>[{name:'session',value:cookie}],
    fetch:(async (_url,init)=>{
      assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
      seen.push(new Headers(init?.headers).get('Cookie')!);
      return new Response('{"calendars":[]}',{status:200});
    }) as typeof fetch};
  assert.deepEqual(await readTerminalData(input),{status:200,body:'{"calendars":[]}'});
  cookie='second';await readTerminalData(input);
  assert.deepEqual(seen,['session=first','session=second']);
});

test("Terminal response reads are bounded and pass aborts to the network", async () => {
  const controller=new AbortController();
  const input={dashboardUrl:origin,path:'/api/models',signal:controller.signal,readCookies:async()=>[],fetch:(async(_url,init)=>{
    controller.abort();assert.equal(init?.signal?.aborted,true);throw new DOMException('Aborted','AbortError');
  }) as typeof fetch};
  await assert.rejects(readTerminalData(input),{name:'AbortError'});
  await assert.rejects(readTerminalData({...input,signal:new AbortController().signal,fetch:(async()=>new Response(new Uint8Array(8*1024*1024+1))) as typeof fetch}),/too large/);
});

test("unowned renderers and subframes cannot access authenticated Terminal reads", async () => {
  const handlers=new Map<string, (...args: any[])=>any>();
  registerTerminalDataHandlers({handle:(channel,listener)=>{handlers.set(channel,listener);},on:(channel,listener)=>{handlers.set(channel,listener);return {} as any;}},
    {ownsSender:()=>false,dashboardUrl:()=>origin});
  const sender=Object.assign(new EventEmitter(),{mainFrame:{url:origin+'/new-tab'}});
  const read=handlers.get(IPC_CHANNELS.readTerminalData)!;
  await assert.rejects(read({sender,senderFrame:sender.mainFrame},{id:'test',path:'/api/models'}),/only available in Breadboard/);
  registerTerminalDataHandlers({handle:(channel,listener)=>{handlers.set(channel,listener);},on:()=>({} as any)},
    {ownsSender:()=>true,dashboardUrl:()=>origin});
  await assert.rejects(handlers.get(IPC_CHANNELS.readTerminalData)!({sender,senderFrame:{url:origin+'/new-tab'}},{id:'test',path:'/api/models'}),/only available/);
  await assert.rejects(handlers.get(IPC_CHANNELS.readTerminalData)!({sender,senderFrame:sender.mainFrame},{id:'test',path:'/api/models',method:'POST'}),/Invalid Terminal/);
});
