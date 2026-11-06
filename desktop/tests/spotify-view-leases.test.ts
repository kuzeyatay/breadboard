import { test } from "node:test";
import assert from "node:assert/strict";
import { SpotifyViewLeases } from "../src/main/spotify-view-leases";
import type { SpotifyRequest, SpotifyResponse } from "../src/main/spotify-control";
const viewId="a7a459f4-49a9-4c96-b45b-bff8b501297b";
const renewal={resource:"engine",method:"POST",body:{viewId}};
const ok=():SpotifyResponse=>({status:200,body:'{"ready":true}'});
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

test("native heartbeats outlive renderer throttling and stop on disposal",async t=>{
  t.mock.timers.enable({apis:["Date","setTimeout"]});
  const requests:SpotifyRequest[]=[];
  const client=new SpotifyViewLeases(async request=>{requests.push(request);return ok();});
  await client.request(renewal);
  for(let i=0;i<5;i++){t.mock.timers.tick(20_000);await settle();}
  assert.equal(requests.length,6,"no additional IPC from the renderer is needed over 100 seconds");
  await client.dispose();assert.equal(requests.at(-1)?.method,"DELETE");
  t.mock.timers.tick(120_000);await settle();assert.equal(requests.length,7);
});

test("temporary failures retry quickly, but sign-out stops background renewal",async t=>{
  t.mock.timers.enable({apis:["Date","setTimeout"]});
  let calls=0;
  const client=new SpotifyViewLeases(async()=>({status:++calls===1?503:401,body:'{}'}));
  await client.request(renewal);
  t.mock.timers.tick(5_000);await settle();assert.equal(calls,2);
  t.mock.timers.tick(120_000);await settle();assert.equal(calls,2);
  await client.dispose();
});

test("renewals join an in-flight request and cleanup follows its late acknowledgement",async t=>{
  t.mock.timers.enable({apis:["Date","setTimeout"]});
  const requests:SpotifyRequest[]=[];let resolve!:(response:SpotifyResponse)=>void;
  const client=new SpotifyViewLeases(request=>{requests.push(request);return request.method==="POST"?new Promise(done=>{resolve=done;}):Promise.resolve(ok());});
  const first=client.request(renewal);const second=client.request(renewal);
  assert.equal(first,second);assert.equal(requests.length,1);
  const disposing=client.dispose();t.mock.timers.tick(60_000);await settle();assert.equal(requests.length,1);
  resolve(ok());await disposing;
  assert.deepEqual(requests.map(r=>r.method),["POST","DELETE"]);
  t.mock.timers.tick(60_000);await settle();assert.equal(requests.length,2);
});

test("controls are never serialized behind lease renewal; invalid holds are rejected",async()=>{
  let finish!:(response:SpotifyResponse)=>void;
  const client=new SpotifyViewLeases(request=>request.resource==="engine"&&request.method==="POST"?new Promise(done=>{finish=done;}):Promise.resolve(ok()));
  const pending=client.request(renewal);
  assert.equal((await client.request({resource:"player",method:"POST",body:{action:"pause"}})).status,200);
  assert.throws(()=>client.request({...renewal,body:{viewId:"invalid"}}));
  finish(ok());await pending;await client.dispose();
});
