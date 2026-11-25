import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';
import Database from 'better-sqlite3';
import {ensurePdfObjectSchema} from '../src/lib/storage/pdf-revisions.ts';
import {acquireGardenLearnLease,acquireGardenContentLease} from '../src/lib/learn-atomic-promotion.ts';

test('copied PDF read, save, and history use its own file and release the scoped lease before publication',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'copy-pdf-api-'));const garden=path.join(temp,'any-garden');
 const before=process.env.QUARTZ_CONTENT_PATH;process.env.QUARTZ_CONTENT_PATH=temp;
 fs.mkdirSync(path.join(garden,'sources-copy/assets/copy'),{recursive:true});fs.mkdirSync(path.join(garden,'assets'));
 fs.writeFileSync(path.join(garden,'assets/source.pdf'),'%PDF original');
 const asset='/any-garden/sources-copy/assets/copy/source.pdf';
 const pdf=path.join(temp,asset.slice(1));fs.writeFileSync(pdf,'%PDF copied');
 fs.writeFileSync(path.join(garden,'sources-copy/note-copy.md'),`---\nsource_pdf: ${asset}\n---\nCopy`);
 const run=acquireGardenLearnLease(garden,{gardenSlug:'any-garden',jobId:'learn',buildId:'build'},{scope:'learn-output'});
 assert.equal(run.acquired,true);
 const db = new Database(':memory:');
 db.exec(`CREATE TABLE pdf_document_edits(id INTEGER PRIMARY KEY, cluster_id INTEGER, document_slug TEXT,
    source_pdf_path TEXT, pdf_data BLOB, byte_length INTEGER, updated_by_user_id INTEGER, updated_at TEXT,
    UNIQUE(cluster_id, document_slug));
   CREATE TABLE pdf_document_edit_history(id INTEGER PRIMARY KEY, cluster_id INTEGER, document_slug TEXT,
    source_pdf_path TEXT, pdf_data BLOB, byte_length INTEGER, saved_by_user_id INTEGER, saved_at TEXT);`);
 ensurePdfObjectSchema(db);
 db.prepare("INSERT INTO pdf_document_edit_history VALUES(1,1,'note-copy',?,?,13,7,datetime('now'))").run(asset, Buffer.from('%PDF restored'));
 globalThis.__copyPdf={publishes:0,db};
 globalThis.__copyPdf.publish=()=>{const lease=acquireGardenContentLease(garden,{paths:['sources-copy/note-copy.md']});assert.equal(lease.acquired,true);lease.lease.release();globalThis.__copyPdf.publishes++;};
 try{
  const lib=path.resolve(import.meta.dirname,'../src/lib');
  const stubs={
   'next/server':'export const NextResponse=Response;',
   'server-auth':`export const requireOwnedClusterFromSlug=async slug=>({cluster:{slug,id:1},userId:7});export const requireReadableClusterFromSlug=requireOwnedClusterFromSlug;export const routeErrorResponse=e=>Response.json({error:e.message},{status:e.status??500});`,
   'db':'export default globalThis.__copyPdf.db;',
   'quartz-publish':'export async function publishQuartzAfterMutation(){globalThis.__copyPdf.publish();}',
  };
  const bundled=await build({stdin:{contents:`export {GET,PUT} from './app/api/documents/[slug]/source-pdf/route.ts';export {DELETE as restore} from './app/api/documents/[slug]/source-pdf/history/route.ts';`,resolveDir:path.resolve(lib,'..'),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'pdf-api',setup(builder){
   builder.onResolve({filter:/.*/},args=>{const key=stubs[args.path]?args.path:args.path.replace(/^.*\//,'').replace(/\.ts$/,'');if(stubs[key])return {path:key,namespace:'fixture'};if(args.path.startsWith('@/lib/'))return {path:path.join(lib,args.path.slice(6)+'.ts')};});
   builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'ts'}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const app=module.exports,params={params:Promise.resolve({slug:'note-copy'})};
  const request=(method,body)=>new Request('http://localhost/api/documents/note-copy/source-pdf?clusterSlug=any-garden',{method,...(body?{body}: {})});
  const read=await app.GET(request('GET'),params);assert.equal(read.status,200);assert.equal(await read.text(),'%PDF copied');
  const saved=await app.PUT(request('PUT','%PDF-1.7 edited copy'),params);assert.equal(saved.status,200,await saved.text());
  assert.equal(fs.readFileSync(pdf,'utf8'),'%PDF-1.7 edited copy');
  const rangeRequest = new Request(request('GET'), {headers:{Range:'bytes=-4'}});
  const range = await app.GET(rangeRequest, params);
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 16-19/20');
  assert.equal(await range.text(), 'copy');
  const cached = await app.GET(new Request(request('GET'), {headers:{'If-None-Match':range.headers.get('etag')}}), params);
  assert.equal(cached.status, 304);
  const restored=await app.restore(request('DELETE'),params);assert.equal(restored.status,200,await restored.text());
  assert.equal(fs.readFileSync(pdf,'utf8'),'%PDF restored');
  assert.equal(fs.readFileSync(path.join(garden,'assets/source.pdf'),'utf8'),'%PDF original');
  assert.equal(globalThis.__copyPdf.publishes,2);assert.equal(run.lease.heartbeat(),true);
 }finally{db.close();run.lease.release();fs.rmSync(temp,{recursive:true,force:true});if(before===undefined)delete process.env.QUARTZ_CONTENT_PATH;else process.env.QUARTZ_CONTENT_PATH=before;delete globalThis.__copyPdf;}
});
