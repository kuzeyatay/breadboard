// Read-only source sampling; all compression and writes occur in RAM.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { build } from "esbuild";

const bundle=await build({entryPoints:[path.resolve(import.meta.dirname,"../src/lib/storage/chat-payloads.ts")],bundle:true,platform:"node",format:"cjs",packages:"external",write:false});
const module={exports:{}};
new Function("require","module","exports",bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const chat=module.exports,db=new Database(":memory:");
db.pragma("foreign_keys=ON");
db.exec(`CREATE TABLE conversations(id INTEGER PRIMARY KEY,updated_at TEXT);
  CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,conversation_id INTEGER REFERENCES conversations(id),metadata TEXT,sources TEXT,content TEXT,status TEXT,updated_at TEXT,order_index INTEGER,token_usage TEXT);
  CREATE INDEX messages_order ON conversation_messages(conversation_id,order_index);
  CREATE VIRTUAL TABLE search USING fts5(content,content='conversation_messages',content_rowid='id');`);
const sourcePath=process.argv[2];
let samples;
if(sourcePath) {
  const source=new Database(path.resolve(sourcePath),{readonly:true,fileMustExist:true});
  try {samples=source.prepare(`SELECT m.id,m.conversation_id,m.metadata,m.sources,m.content,m.status,m.updated_at,m.order_index,m.token_usage
    FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
    WHERE c.updated_at<datetime('now','-7 days') AND octet_length(m.metadata) BETWEEN 16384 AND 4194304
    ORDER BY m.id LIMIT 96`).all();} finally {source.close();}
} else samples=Array.from({length:96},(_,id)=>({id:id+1,conversation_id:1,metadata:JSON.stringify({model:"model",toolResults:[{id,text:"Exact tool output. ".repeat(13000)}]}),sources:null,content:"Searchable conversation message",status:"complete",updated_at:"2025-01-01",order_index:id,token_usage:"{}"}));
assert.ok(samples.length,"No suitable cold samples");
const insert=db.prepare("INSERT INTO conversation_messages VALUES(@id,@conversation_id,@metadata,@sources,@content,@status,@updated_at,@order_index,@token_usage)");
db.transaction(()=>{for(const row of samples){db.prepare("INSERT OR IGNORE INTO conversations VALUES(?,'2025-01-01')").run(row.conversation_id);insert.run(row);}})();
db.exec("INSERT INTO search(search) VALUES('rebuild')");
const sql="SELECT id,metadata,sources,content,order_index,token_usage FROM conversation_messages WHERE id=?";
const raw=db.prepare(sql),baseline=new Map(),before=[];
for(const row of samples){const start=performance.now();baseline.set(row.id,raw.get(row.id));before.push(performance.now()-start);}
const search=db.prepare("SELECT rowid FROM search WHERE search MATCH 'the' ORDER BY rowid");
const searchBefore=search.all();
const start=performance.now();chat.ensureChatPayloadSchema(db);const adapterInitializationMs=performance.now()-start;
let saved=0;for(const row of samples)for(const field of ["metadata","sources"])saved+=chat.compressMessageField(db,row.id,field);
const restored=db.prepare(sql.replace("conversation_messages","conversation_message_reads")),after=[];
for(const row of samples){const start=performance.now();const value=restored.get(row.id);after.push(performance.now()-start);assert.deepEqual(value,baseline.get(row.id));}
assert.deepEqual(search.all(),searchBefore);
const p95=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];
const pageBefore=[],pageAfter=[],pageSize=50;
for(let repeat=0;repeat<20;repeat++)for(let offset=0;offset<samples.length;offset+=pageSize){
  const rows=samples.slice(offset,offset+pageSize),ids=rows.map(row=>row.id),marks=ids.map(()=>"?").join(",");
  // Baseline bytes are retained separately because the raw SQL columns now
  // contain hot projections. Include the same JSON parsing on both sides.
  const baselineStart=performance.now();
  const original=ids.map(id=>({...baseline.get(id),metadata:JSON.parse(baseline.get(id).metadata)}));
  const baselineMs=performance.now()-baselineStart;
  chat.evictConversationPayloadCache(db);
  const statement=db.prepare(`SELECT id,metadata,sources,content,order_index,token_usage FROM conversation_message_reads WHERE id IN (${marks}) ORDER BY id`);
  const pageStart=performance.now();const values=statement.all(...ids).map(row=>({...row,metadata:JSON.parse(row.metadata)}));
  pageBefore.push(baselineMs);pageAfter.push(performance.now()-pageStart);assert.deepEqual(values,original);
}
const rawBytes=samples.reduce((sum,row)=>sum+Buffer.byteLength(row.metadata??"")+Buffer.byteLength(row.sources??""),0);
function streamingWriteProbe() {
  const connections=[new Database(":memory:"),new Database(":memory:")];
  try {
    for(const connection of connections)connection.exec(`CREATE TABLE conversations(id INTEGER PRIMARY KEY);
      INSERT INTO conversations VALUES(1);
      CREATE TABLE conversation_messages(id INTEGER PRIMARY KEY,conversation_id INTEGER,metadata TEXT,sources TEXT);
      INSERT INTO conversation_messages VALUES(1,1,'{}',NULL)`);
    chat.ensureChatPayloadSchema(connections[1]);
    const statements=connections.map(connection=>connection.prepare("UPDATE conversation_messages SET metadata=? WHERE id=1"));
    const payloads=Array.from({length:200},(_,sequence)=>JSON.stringify({toolResults:["tool output ".repeat(15000)],sequence}));
    const timings=[[],[]];
    for(let round=0;round<8;round++)for(const index of round%2?[1,0]:[0,1]) {
      const start=performance.now();for(const payload of payloads)statements[index].run(payload);
      if(round>1)timings[index].push((performance.now()-start)/payloads.length);
    }
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const baselineMs=median(timings[0]),adapterMs=median(timings[1]);
    return {baselineMs,adapterMs,changePercent:100*(adapterMs/baselineMs-1),note:"In-memory write CPU probe; not the full desktop streaming gate."};
  } finally {for(const connection of connections)connection.close();}
}
const report={sampleCount:samples.length,source:sourcePath?"read-only local sample":"synthetic",rawBytes,bytesSaved:saved,savingPercent:100*saved/rawBytes,
  exactRecovery:true,searchUnchanged:true,adapterInitializationMs,coldReadP95Ms:p95(after),additionalColdReadP95Ms:p95(after.map((value,i)=>value-before[i])),
  coldPageSize:pageSize,coldPageMeasurements:pageAfter.length,coldPageP95Ms:p95(pageAfter),additionalColdPageP95Ms:p95(pageAfter.map((value,i)=>value-pageBefore[i])),
  streamingWriteProbe:streamingWriteProbe(),
  note:"SQL payload adapter measurement. Complete desktop startup/streaming baselines must be measured on the packaged release."};
console.log(JSON.stringify(report,null,2));
if(process.env.STORAGE_BENCHMARK_REPORT)fs.writeFileSync(process.env.STORAGE_BENCHMARK_REPORT,JSON.stringify(report,null,2)+"\n");
db.close();
assert.ok(report.additionalColdReadP95Ms<=100,"Cold message overhead exceeds 100 ms");
assert.ok(report.additionalColdPageP95Ms<=100,"Cold page overhead exceeds 100 ms");
