import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import Database from 'better-sqlite3';

const root=path.resolve(import.meta.dirname,'..');
async function bundle(file,mocks) {
  const built=await build({entryPoints:[path.join(root,file)],bundle:true,write:false,format:'cjs',platform:'node',
    plugins:[{name:'test-boundaries',setup(builder){
      builder.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));
    }}]});
  const module={exports:{}};
  new Function('module','exports','require',built.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
  return module.exports;
}

const sources=await bundle('src/lib/recommendations/sources.ts',{
  'server-only':'',
  '../db.ts':'export default {prepare:sql=>globalThis.recFixture.db.prepare(sql)};',
  '../composio/service.ts':'export const listComposioConnections=async(userId)=>globalThis.recFixture.connections(userId);',
  '../composio/client.ts':'export const composioClient=()=>({tools:{proxyExecute:(request,options)=>globalThis.recFixture.read(request,options)}});',
  '../nango/service.ts':'export const listStoredNangoConnections=()=>[];',
  '../nango/catalog.ts':'export const findNangoIntegration=()=>null;',
  '../connected-apps/broker.ts':'export const embeddedProviderRequest=()=>{throw Error("No embedded account connected")};',
  '../recall/settings.ts':'export const getRecallSettings=()=>globalThis.recFixture.settings;',
  '../recall/config.ts':'export const getRecallConfig=()=>({enabled:true});',
  '../recall/service.ts':'export const searchRecall=(user,args,options)=>globalThis.recFixture.recall(user,args,options);',
  '../calendar/instance.ts':'export const getCalendarStore=()=>({});',
  '../calendar/agent-query.ts':'export const agenda=()=>({occurrences:[]});',
});

function fixture(t) {
  const db=new Database(':memory:');t.after(()=>{db.close();delete globalThis.recFixture;});
  db.exec(`CREATE TABLE clusters(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,slug TEXT,last_viewed_at TEXT,created_at TEXT);
    CREATE TABLE conversations(id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT,default_garden_id INTEGER,temporary INTEGER,updated_at TEXT);
    CREATE TABLE conversation_messages(conversation_id INTEGER,content TEXT,status TEXT,order_index INTEGER);
    CREATE TABLE plan_projects(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,archived INTEGER);
    CREATE TABLE plan_tasks(id INTEGER PRIMARY KEY,user_id INTEGER,project_id INTEGER,title TEXT,description TEXT,due_date TEXT,completed_at TEXT,updated_at TEXT);
    INSERT INTO plan_projects VALUES(1,1,'Circuits',0),(2,2,'Private project',0),(3,1,'Old project',1);
    INSERT INTO plan_tasks VALUES(1,1,1,'Build circuit simulation','Check damping',NULL,NULL,datetime('now')),
      (2,2,2,'Other task secret','',NULL,NULL,datetime('now')),
      (3,1,1,'Completed task','',NULL,datetime('now'),datetime('now')),
      (4,1,3,'Archived task','',NULL,NULL,datetime('now'));
    INSERT INTO clusters VALUES(1,1,'Circuits','circuits',datetime('now'),datetime('now')),(2,2,'Private other garden','secret',datetime('now'),datetime('now'));
    INSERT INTO conversations VALUES(1,1,'My lab notes',1,0,datetime('now')),(2,2,'Other user secret',2,0,datetime('now')),(3,1,'Temporary secret',1,1,datetime('now'));
    INSERT INTO conversation_messages VALUES(1,'Review the transient result','complete',1),(2,'Private body','complete',1),(3,'Off the record','complete',1);`);
  const calls=[];
  const state={db,calls,settings:{captureEnabled:true,agentAccess:true},
    connections:async user=>['gmail','microsoft-outlook','google-calendar'].map(slug=>({slug,enabled:true,connectionId:`${user}:${slug}`})),
    read:async(request,options)=>{
      calls.push(request);assert.equal(request.method,'GET');assert.ok(options.signal);
      if(request.endpoint.endsWith('/messages')&&request.connectedAccountId.endsWith(':gmail'))return {status:200,data:{messages:[{id:'m1'}]}};
      if(request.endpoint.endsWith('/messages/m1'))return {status:200,data:{payload:{headers:[{name:'Subject',value:'Lab feedback'},{name:'From',value:'Tutor'},{name:'Date',value:'2026-11-06'}]},snippet:'Revise the measurements section.'}};
      if(request.connectedAccountId.endsWith(':microsoft-outlook'))return {status:200,data:{value:[{id:'o1',subject:'Meeting agenda',bodyPreview:'Bring your notes',from:{emailAddress:{name:'Sam'}}}]}};
      return {status:200,data:{items:[{id:'e1',summary:'Lab meeting',start:{dateTime:'2026-11-07T10:00:00Z'}}]}};
    },
    recall:async(user,args,options)=>{assert.equal(user,1);assert.equal(options.forAgent,true);assert.equal(options.config.requestTimeoutMs,3000);return {hits:[{frameId:7,window:'Transient response',app:'Breadboard',text:'Reviewing the circuit notes',timestamp:'2026-11-06'}]};},
  };
  globalThis.recFixture=state;return state;
}

test('real adapters read connected mail/calendar and permitted Recall using only this account',async t=>{
  const state=fixture(t);
  const evidence=await sources.readRecommendationEvidence(1,{});
  assert.ok(['gmail','outlook','calendar','recall','chat','garden','task'].every(source=>evidence.some(item=>item.source===source)));
  assert.ok(state.calls.every(call=>call.connectedAccountId.startsWith('1:')));
  assert.doesNotMatch(JSON.stringify(evidence),/Other user|Temporary secret|Off the record|Private body|Private other|Other task secret|Completed task|Archived task/);
  assert.ok(state.calls.every(call=>!call.endpoint.includes('send')&&!call.endpoint.includes('modify')));
});

test('disabled Recall access is not bypassed and a failed mail service leaves other evidence intact',async t=>{
  const state=fixture(t);state.settings.agentAccess=false;
  state.recall=()=>assert.fail('Recall must not be queried');
  const read=state.read;state.read=(request,options)=>request.connectedAccountId.endsWith(':gmail')?Promise.reject(Error('offline')):read(request,options);
  const evidence=await sources.readRecommendationEvidence(1,{gardenSlug:'circuits'});
  assert.equal(evidence.some(item=>item.source==='recall'||item.source==='gmail'),false);
  assert.ok(evidence.some(item=>item.source==='outlook'));
  assert.ok(evidence.some(item=>item.gardenSlug==='circuits'));
});

const route=await bundle('src/app/api/recommendations/route.ts',{
  '@/lib/server-auth':'export const requireUserId=async()=>{if(globalThis.recRoute.denied)throw Object.assign(Error("Unauthorized"),{status:401});return 7};',
  '@/lib/hermes/route-helpers':'export const readJsonBody=request=>request.json(); export const apiErrorResponse=error=>Response.json({}, {status:error.status||500});',
  '@/lib/chatmock-server':'export const resolveChatmockBaseUrl=()=>({baseURL:"http://model.test/v1"});',
  '@/lib/recommendations/service':'export const recommendationsForUser=async(...args)=>{globalThis.recRoute.calls.push(args);return []};',
  '@/lib/recommendations/types':'export const cleanRecommendationText=(value,max)=>typeof value==="string"?value.trim().slice(0,max):"";',
});

test('recommendation route enforces authentication and skips private context for public/temporary/unpersonalized views',async()=>{
  globalThis.recRoute={calls:[],denied:false};
  const request=body=>new Request('http://local/api/recommendations',{method:'POST',body:JSON.stringify(body)});
  for(const body of [{temporary:true},{scope:'public'},{personalize:false}])assert.equal((await route.POST(request(body))).status,200);
  assert.equal(globalThis.recRoute.calls.length,0);
  await route.POST(request({userId:999,gardenSlug:'circuits'}));
  assert.equal(globalThis.recRoute.calls[0][0],7,'the request cannot select another account');
  globalThis.recRoute.denied=true;
  assert.equal((await route.POST(request({}))).status,401);
  assert.equal(globalThis.recRoute.calls.length,1);
  delete globalThis.recRoute;
});
