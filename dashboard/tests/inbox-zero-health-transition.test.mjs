import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function fixture() {
  const state = { configured: true, snapshots: ["ready"], reads: 0, probes: 0, authError: null, statusError: null };
  class RouteError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const actual = {available:true,installed:true,mode:"stack",baseUrl:"http://localhost:4021",cloneRoot:"fixture",oauth:{google:false,microsoft:false,configured:false},setup:{step:"oauth_client_missing",ready:false,message:"Add your OAuth client."}};
  const modules = {
    "next/server": { NextResponse: {json:(body,options)=>Response.json(body,options)} },
    "@/lib/server-auth": {RouteError, requireUserId:async()=>{if(state.authError)throw state.authError;return 7;}},
    "@/lib/inbox-zero/runtime-service.ts": {readInboxZeroStatus:async scope=>{assert.equal(scope.userId,7);state.probes++;if(state.statusError)throw state.statusError;return actual;}},
    "@/lib/supervisor-control.ts": {
      isRuntimeV2ServiceControlConfigured:()=>state.configured,
      readSupervisedServiceSnapshot:async id=>{assert.equal(id,"inbox-zero-stack");const snapshot=state.snapshots[Math.min(state.reads++,state.snapshots.length-1)];if(snapshot instanceof Error)throw snapshot;return snapshot?{id,state:snapshot}:null;},
    },
  };
  const source=fs.readFileSync(new URL("../src/app/api/inbox-zero/health/route.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const route={};new Function("require","exports",code)(id=>{assert.ok(id in modules,id);return modules[id];},route);
  return {state,route,actual,RouteError};
}

test("normal idle shutdown reports a bounded transition without a lease or invented setup state",async()=>{
  const {state,route}=fixture();state.snapshots=["stopping"];
  const response=await route.GET(),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.available,false);
  assert.equal(body.runtimeState,"stopping");assert.equal(body.retryAfterSeconds,60);
  assert.match(body.message,/retry the status check/);
  assert.equal(body.installed,undefined);assert.equal(body.oauth,undefined);assert.equal(body.setup,undefined);
  assert.equal(state.probes,0);
});

test("shutdown between snapshot and lease acquisition is reclassified only after native confirmation",async()=>{
  const {state,route}=fixture();state.snapshots=["ready","stopping"];
  state.statusError=new Error("Supervisor control request failed (409).");
  const response=await route.GET();assert.equal(response.status,200);
  assert.equal((await response.json()).runtimeState,"stopping");assert.equal(state.probes,1);assert.equal(state.reads,2);
});

test("other service failures remain failures and authentication runs before lifecycle inspection",async()=>{
  for(const snapshot of ["ready","failed",null,new Error("Control unavailable")]){
    const {state,route}=fixture();state.snapshots=["ready",snapshot];state.statusError=new Error("Real controller failure");
    const response=await route.GET();assert.equal(response.status,500);assert.deepEqual(await response.json(),{ok:false,error:"internal_error"});
  }
  const {state,route,RouteError}=fixture();state.authError=new RouteError(401,"Unauthorized");
  assert.equal((await route.GET()).status,401);assert.equal(state.reads,0);assert.equal(state.probes,0);
});

test("running and standalone controllers retain their actual account prerequisite response",async()=>{
  for(const configured of [true,false]){
    const {state,route,actual}=fixture();state.configured=configured;
    const response=await route.GET();assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,...actual});
    assert.equal(state.probes,1);assert.equal(state.reads,configured?1:0);
  }
});
