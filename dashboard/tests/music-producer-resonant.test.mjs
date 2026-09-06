import test from "node:test";
import assert from "node:assert/strict";
import { ARRANGEMENT_TOOLS, ResonantSession, resonantResult } from "../src/lib/music-producer/resonant-contract.ts";
import { musicRequestSchema } from "../src/lib/music-producer/request.ts";

const project="breadboard-music/conv_"+"a".repeat(24)+"/music_"+"b".repeat(32)+"/project.resonant";
function fixture() {
  const calls=[], tools=[{name:"get_capabilities",inputSchema:{type:"object",properties:{}}},{name:"inspect_project",inputSchema:{type:"object",properties:{path:{}},required:["path"]}}];
  for(const [name,schema] of Object.entries(ARRANGEMENT_TOOLS)) tools.push({name,inputSchema:{type:"object",properties:{...Object.fromEntries(Object.keys(schema.shape).map(key=>[key,{}])),path:{},expectedRevision:{}},required:["path","expectedRevision"]}});
  let revision="1".repeat(64), conflict=false;
  const session=new ResonantSession({tools,call:async(name,args)=>{
    calls.push({name,args});assert.equal(name==="get_capabilities"?calls.length===1:args.path===project,true);
    if(name==="get_capabilities")return{content:[{type:"text",text:JSON.stringify({ok:true,capabilities:{}})}]};
    if(name!=="inspect_project"){assert.equal(args.expectedRevision,revision);revision="2".repeat(64);if(conflict)return{isError:true,content:[{type:"text",text:"REVISION_CONFLICT"}]};}
    return{structuredContent:{ok:true,project:{revision,tracks:[],clips:{},arrangement:[]}}};
  }},project,new AbortController().signal);
  return{calls,session,setConflict:()=>{conflict=true;}};
}
test("scoped MCP contract discovers capabilities, inspects revision and keeps mutation authority host-owned",async()=>{
  const f=fixture();await f.session.call("get_capabilities",{});await f.session.inspect();
  await f.session.mutate("set_clip_notes",{clip:"Prism A",notes:[{step:0,pitch:60,velocity:.8,durationSteps:4}]});
  assert.deepEqual(f.calls.map(c=>c.name),["get_capabilities","inspect_project","set_clip_notes","inspect_project"]);
  assert.equal(f.session.revision,"2".repeat(64));
  await assert.rejects(()=>f.session.mutate("set_track_mix",{track:"Prism",volume:.8,path:"other.resonant"}));
  await assert.rejects(()=>f.session.call("provider_start",{}));
  await assert.rejects(()=>f.session.call("generate_music",{}));
  await assert.rejects(()=>f.session.call("voice_clone",{}));
  assert.throws(()=>new ResonantSession({tools:[],call:async()=>({})},"../../other.resonant",new AbortController().signal));
});
test("revision conflict re-inspects once and never blindly overwrites",async()=>{
  const f=fixture();await f.session.call("get_capabilities",{});await f.session.inspect();f.setConflict();
  await assert.rejects(()=>f.session.mutate("set_arrangement",{blocks:[]}),/re-inspected/);
  assert.equal(f.calls.filter(c=>c.name==="set_arrangement").length,1);assert.equal(f.calls.at(-1).name,"inspect_project");
  assert.equal(f.session.revision,"2".repeat(64));
});
test("MCP output, actual schema and call budgets fail closed",async()=>{
  for(const value of [{structuredContent:{ok:false}},{isError:true},{content:[{type:"text",text:"x".repeat(600000)}]}])assert.throws(()=>resonantResult(value));
  const f=fixture();await assert.rejects(()=>f.session.call("inspect_project",{path:project,extra:1}),/schema/);
  const empty=new ResonantSession({tools:[],call:async()=>{throw Error("must not call")}},project,new AbortController().signal);
  await assert.rejects(()=>empty.call("get_capabilities",{}),/schema/);
  const budget=fixture();await budget.session.call("get_capabilities",{});for(let i=0;i<35;i++)await budget.session.inspect();
  await assert.rejects(()=>budget.session.inspect(),/budget/);
  for(const unsupported of [{vocalMode:"vocal",lyrics:"hello",language:"en"},{timeSignature:"3/4"},{seed:42},{guidanceScale:7}])assert.throws(()=>musicRequestSchema.parse({brief:"Arrange",operation:"arrange",...unsupported}));
});
