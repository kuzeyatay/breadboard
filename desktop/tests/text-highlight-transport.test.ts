import { test } from "node:test";
import assert from "node:assert/strict";
import { sendTextHighlightRequest, registerTextHighlightHandler } from "../src/main/text-highlight-transport";

const dashboardUrl = "http://127.0.0.1:12345/garden/example";
const body = JSON.stringify({ key: "breadboard:garden-highlights:v1:example/lesson", mutations: [{operationId:"one",id:"mark",value:{id:"mark"}}] });

test("highlight saves use a fixed authenticated route and preserve commit acknowledgements", async () => {
  const result = await sendTextHighlightRequest({dashboardUrl,body,
    readCookies:async url=>{assert.equal(url,"http://127.0.0.1:12345/api/text-highlights");return [{name:"session",value:"fixture"}];},
    fetch:async(url,init)=>{
      assert.equal(String(url),"http://127.0.0.1:12345/api/text-highlights");
      assert.equal(init?.body,body); assert.equal(init?.method,"POST"); assert.equal(init?.redirect,"error");
      assert.equal(new Headers(init?.headers).get("Cookie"),"session=fixture");
      return Response.json({entries:[{id:"mark"}],acknowledged:["one"]});
    }});
  assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.body).acknowledged,["one"]);
});

test("highlight transport rejects arbitrary endpoints, credentials and oversized requests before reading cookies", async () => {
  let calls=0;
  const options={dashboardUrl,body,readCookies:async()=>{calls++;return [];}};
  for(const body of [null,{},"null","[]","broken",JSON.stringify({url:"https://example.com"}),"x".repeat(8*1024*1024+1)]) {
    await assert.rejects(sendTextHighlightRequest({...options,body}));
  }
  for(const dashboardUrl of ["https://example.com","http://user:pass@127.0.0.1:12345","https://127.0.0.1:12345"]) {
    await assert.rejects(sendTextHighlightRequest({...options,dashboardUrl}));
  }
  assert.equal(calls,0);
});

test("save failures never fabricate acknowledgements or replay a request inside the transport", async () => {
  let calls=0;
  const options={dashboardUrl,body,readCookies:async()=>[]};
  await assert.rejects(sendTextHighlightRequest({...options,fetch:async()=>{calls++;throw Error("lost response");}}));
  assert.equal(calls,1);
  for(const status of [401,403,429,500]) {
    const response=await sendTextHighlightRequest({...options,fetch:async()=>Response.json({error:"failed"},{status})});
    assert.equal(response.status,status);assert.equal(JSON.parse(response.body).acknowledged,undefined);
  }
});

test("the IPC handler rejects foreign windows, child frames and navigated pages", async () => {
  let handler: Function | undefined;
  registerTextHighlightHandler({handle:(_channel,fn)=>{handler=fn;}},{dashboardUrl:()=>dashboardUrl,ownsSender:sender=>sender.id===1});
  const mainFrame={url:dashboardUrl};
  const sender={id:1,mainFrame};
  for(const event of [{sender:{...sender,id:2},senderFrame:mainFrame}, {sender,senderFrame:{url:dashboardUrl}},
    {sender:{...sender,mainFrame:{url:"https://external.test"}},senderFrame:{url:"https://external.test"}}, {sender,senderFrame:null}]) {
    await assert.rejects(handler!(event,body),/Breadboard/);
  }
});
