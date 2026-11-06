import { test } from "node:test";
import assert from "node:assert/strict";
import { sendSpotifyRequest } from "../src/main/spotify-control";

const dashboardUrl = "http://127.0.0.1:12345/new-tab";
const request = {resource:"player",method:"POST",body:{action:"pause",local:true}};
test("Spotify transport uses the sender's authenticated session and fixed local endpoint", async () => {
  let calls=0;
  const response=await sendSpotifyRequest({dashboardUrl,request,
    readCookies:async url=>{assert.equal(url,"http://127.0.0.1:12345/api/browser/spotify");return [{name:"fixture-session",value:"test"}];},
    fetch:async (url,init)=>{
      calls++;
      assert.equal(String(url),"http://127.0.0.1:12345/api/browser/spotify");
      assert.equal(new Headers(init?.headers).get("Cookie"),"fixture-session=test");
      assert.equal(init?.redirect,"error");
      assert.equal(init?.method,"POST");
      assert.deepEqual(JSON.parse(String(init?.body)),request.body);
      return Response.json({ok:true});
    }});
  assert.equal(calls,1);assert.deepEqual(response,{status:200,body:'{"ok":true}'});
});

test("Spotify IPC cannot address other URLs, credentials, endpoints, or engine registration",async()=>{
  let calls=0;
  const options={dashboardUrl,request,readCookies:async()=>{calls++;return [];}};
  for(const invalid of [null,[],{}, {...request,url:"https://example.com"},{...request,resource:"other"},{...request,method:"DELETE"},
    {...request,body:{action:"disconnect"}}, {resource:"engine",method:"POST",body:{ticket:"secret",deviceId:"device"}},
    {resource:"engine",method:"POST",body:{viewId:"invalid"}}, {resource:"player",method:"GET",body:{}},
    {...request,body:{action:"pause",huge:"a".repeat(65536)}}]) {
    await assert.rejects(sendSpotifyRequest({...options,request:invalid}));
  }
  for(const origin of ["https://127.0.0.1:12345","http://example.com","http://user:password@127.0.0.1:12345"]) {
    await assert.rejects(sendSpotifyRequest({...options,dashboardUrl:origin}));
  }
  assert.equal(calls,0);
});

test("ambiguous Spotify failures are never retried and large replies are rejected",async()=>{
  let calls=0;
  const options={dashboardUrl,request,readCookies:async()=>[]};
  const failure=await sendSpotifyRequest({...options,fetch:async()=>{calls++;throw Object.assign(Error("Lost acknowledgement"),{cause:{code:"ECONNRESET"}});}});
  assert.equal(failure.status,503);assert.equal(JSON.parse(failure.body).code,"spotify_control_unconfirmed");
  assert.equal(calls,1);
  assert.equal((await sendSpotifyRequest({...options,fetch:async()=>new Response("a".repeat(128*1024+1))})).status,503);
});

test("read and lease resets retry once, including failures while reading the response body",async()=>{
  const viewId="a7a459f4-49a9-4c96-b45b-bff8b501297b";
  for(const request of [{resource:"player",method:"GET"},{resource:"engine",method:"POST",body:{viewId}},{resource:"engine",method:"DELETE",body:{viewId}}]) {
    for(const droppedBody of [false,true]) {
      let calls=0;
      const result=await sendSpotifyRequest({dashboardUrl,request,readCookies:async()=>[],fetch:async()=>{
        calls++;
        if(calls>1)return Response.json({ok:true});
        const error=Object.assign(Error("reset"),{cause:{code:"ECONNRESET"}});
        if(!droppedBody)throw error;
        return new Response(new ReadableStream({start(controller){controller.error(error);}}));
      }});
      assert.equal(result.status,200);assert.equal(calls,2);
    }
  }
});

test("repeated timeouts return a bounded structured failure; HTTP errors are not retried",async()=>{
  let calls=0;
  const options={dashboardUrl,request:{resource:"engine",method:"GET"},readCookies:async()=>[]};
  const result=await sendSpotifyRequest({...options,fetch:async()=>{calls++;throw new DOMException("timeout","TimeoutError");}});
  assert.equal(calls,2);assert.equal(result.status,503);assert.equal(JSON.parse(result.body).code,"spotify_transport_unavailable");
  for(const status of [401,403,429,503]) {
    calls=0;
    const response=await sendSpotifyRequest({...options,fetch:async()=>{calls++;return Response.json({message:"provider response"},{status});}});
    assert.equal(response.status,status);assert.equal(calls,1);
  }
});
