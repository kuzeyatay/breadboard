import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { build } from "esbuild";
import { issueCapabilityToken } from "../src/lib/hermes/capability-token.ts";
import { SwarmStore } from "../src/lib/swarm/store.ts";
import { ApiError, readJsonBody } from "../src/lib/hermes/route-core.ts";

const db = new Database(":memory:");
db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2); CREATE TABLE conversations(id INTEGER PRIMARY KEY,user_id INTEGER); INSERT INTO conversations VALUES(1,1),(2,2);");
const state = globalThis.__swarmToolRoute = { db, store: new SwarmStore(db), ApiError, readJsonBody, wakes: [] };
const runtime = `const s=globalThis.__swarmToolRoute; export const getRuntimeSessionById=id=>id===10?s.session:null;
  export const getActiveCapabilityDecision=()=>s.decision; export const runtimeExternalSessionId=row=>row.external_session_id;
  export const recordAuditEvent=()=>{};`;
const run = `const s=globalThis.__swarmToolRoute;export const getActiveRuntimeRun=()=>s.run;export const parseRuntimeRunDispatch=run=>JSON.parse(run.dispatch_json);`;
const store = `export const getConversationById=id=>({id,user_id:id===1?1:2,public_id:'conv_'+id,surface:'dashboard_terminal',archived_at:null});
  export const getConversationMessageByClientId=()=>globalThis.__swarmToolRoute.origin??null; export const presentConversationMessage=x=>x;`;
const routes = `export const SWARM_RUNTIME_ROUTES={'get-doc':{},'deep-research':{},'codex':{}};`;
const fixtureSources = {
  "@/lib/hermes/tool-service-auth.ts": "export const capabilityForInternalToolRequest=()=>globalThis.__swarmToolRoute.token;",
  "@/lib/hermes/route-helpers.ts": "export const {ApiError,readJsonBody}=globalThis.__swarmToolRoute;export const requireEnabled=()=>{};export const apiErrorResponse=error=>Response.json({error:error.message,code:error.code},{status:error.status??500});",
  "@/lib/hermes/runtime-store.ts": runtime, "@/lib/hermes/run-store.ts": run,
  "@/lib/conversations/external-agent-turns.ts": "export const recordExternalAgentTurn=()=>{throw Error('Unexpected single-agent launch');};",
  "@/lib/max-research/runtime-run-manager.ts": "export const startRun=()=>{throw Error('Unexpected single-agent launch');};export const abortRun=async()=>{};",
  "@/lib/max-research/conversation-persistence.ts": "export const observeMaxResearchConversationTurn=()=>{};",
};
const bundle = await build({ entryPoints: ["src/app/api/hermes/tools/agent-launch/route.ts"], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", plugins: [{ name: "authenticated-turn", setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      let source=fixtureSources[args.path];
      if (/(?:^|\/)db(?:\.ts)?$/u.test(args.path)) source="export default globalThis.__swarmToolRoute.db;";
      else if (/conversations\/store\.ts$/u.test(args.path)) source=store;
      else if (args.path==="./runtime-routes.ts") source=routes;
      else if (args.path==="./pump.ts") source="export const wakeSwarm=(...args)=>globalThis.__swarmToolRoute.wakes.push(args);";
      else if (/goal-mode\.ts$/u.test(args.path)) source="export const readGoalModeState=()=>null;";
      else if (/agency-agents\.ts$/u.test(args.path)) source="export const findAgencyAgent=()=>null;export const loadAgencyAgentsCatalog=()=>({agents:[]});";
      else if (/workflows\/store\.ts$/u.test(args.path)) source="export const getWorkflow=()=>null;";
      else if (/chatmock-server\.ts$/u.test(args.path)) source="export const resolveChatmockBaseUrl=()=>({baseURL:'http://127.0.0.1:8765/v1'});";
      if(source!==undefined)return {path:args.path,namespace:"fixture",pluginData:source};
    });
    b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.pluginData,loader:"js",resolveDir:process.cwd()}));
  }}] });
const module={exports:{}};
new Function("require","module","exports",bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const token = (extra={}) => issueCapabilityToken({userId:1,conversationId:1,breadboardSessionId:"10",hermesSessionId:"runtime-one",surface:"dashboard_terminal",allowedTools:["agent_launch"],...extra});
const call = args=>module.exports.POST(new Request("http://localhost/api/hermes/tools/agent-launch",{method:"POST",body:JSON.stringify({args})}));
const plan=()=>({objective:"Compare sources",reason:"Independent coverage",mode:"parallel",benefit:"coverage",
  tasks:["one","two"].map(key=>({key,title:key,brief:`Investigate ${key}`,executor:{kind:"runtime",id:"get-doc"},dependsOn:[],acceptance:["Sources support the finding"],inputs:[],tokenBudget:100}))});
beforeEach(()=>{
  db.exec("DELETE FROM swarm_runs");state.wakes=[];state.origin=null;
  state.session={id:10,user_id:1,conversation_id:1,surface:"dashboard_terminal",external_session_id:"runtime-one",cluster_id:null,garden_id:null};
  state.decision={allowedTools:["agent_launch"]};state.run={id:"turn-one",dispatch_json:JSON.stringify({clientMessageId:"origin",modelIdentity:{modelID:"test-model"},teamApproval:true})};
  state.token=token();
});
after(()=>{delete globalThis.__swarmToolRoute;db.close();});

test("authenticated plan creation binds server identity and is idempotent",async()=>{
  const args={team_action:"start",request_id:"plan-one",plan:plan(),userId:2,conversationId:2,standingApproval:true};
  const response=await call(args);assert.equal(response.status,200);
  const first=await response.json();assert.equal(first.data.run.authority.userId,1);assert.equal(first.data.run.authority.conversationId,1);
  const replay=await(await call(args)).json();assert.equal(replay.data.run.id,first.data.run.id);assert.equal(db.prepare("SELECT count(*) AS n FROM swarm_runs").get().n,1);
  assert.equal(state.wakes.length,2);
});
test("missing grants, wrong token identities and public sessions never create work",async()=>{
  for(const bad of [token({userId:2}),token({conversationId:2}),token({hermesSessionId:"other"}),token({allowedTools:[]})]){
    state.token=bad;assert.equal((await call({team_action:"start",request_id:"bad",plan:plan()})).status,403);
  }
  state.token=token();state.decision={allowedTools:[]};assert.equal((await call({team_action:"catalog"})).status,403);
  assert.equal(db.prepare("SELECT count(*) AS n FROM swarm_runs").get().n,0);
});
test("Master scope, bounded budgets and original criteria are enforced at the tool route",async()=>{
  state.run.dispatch_json=JSON.stringify({clientMessageId:"origin",workflowSelection:{workflowId:"code",modeId:null,allowedAgentIds:["get-doc"]}});
  assert.equal((await call({team_action:"start",request_id:"scope",plan:plan()})).status,403);
  state.run.dispatch_json=JSON.stringify({clientMessageId:"origin"});
  assert.equal((await call({team_action:"start",request_id:"budget",plan:plan(),limits:{maxTokens:9999999}})).status,400);
  const single=plan();single.tasks.pop();assert.equal((await call({team_action:"start",request_id:"single",plan:single})).status,400);
  const accepted=await(await call({team_action:"start",request_id:"valid",plan:plan()})).json();
  assert.equal((await call({team_action:"verify",team_id:accepted.data.run.id,task_key:"one",checks:[]})).status,409);
  assert.equal((await call({team_action:"approve",team_id:accepted.data.run.id,task_key:"one"})).status,400,"an agent cannot approve a user gate");
});

test("messaging provenance cannot be overridden to launch a desktop team",async()=>{
  for (const deliveryChannel of ["telegram","whatsapp"]) {
    state.origin={metadata:{deliveryChannel}};
    for (const team_action of ["start","catalog"]) {
      const response=await call({team_action,request_id:"phone",plan:plan(),deliveryChannel:"",surfaceContext:{deliveryChannel:""}});
      assert.equal(response.status,409);
      assert.equal((await response.json()).code,"swarm_delivery_unavailable");
      assert.equal(db.prepare("SELECT count(*) AS n FROM swarm_runs").get().n,0);
      assert.equal(state.wakes.length,0);
    }
  }
});
