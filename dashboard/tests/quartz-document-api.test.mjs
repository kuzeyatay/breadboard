import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {build} from 'esbuild';

test('document revisions, no-op saves, ownership and frontmatter use the real mutation lease', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'quartz-editor-api-')), garden=path.join(root,'demo'); fs.mkdirSync(garden);
  const file=path.join(garden,'note.md'), original='---\r\ntitle: Original\r\n# hidden\r\ncustom:\r\n  title: Keep me\r\nsemanticHints: [one]\r\n---\r\n\r\n    Code\r\n'; fs.writeFileSync(file,original);
  const previous=process.env.QUARTZ_CONTENT_PATH; process.env.QUARTZ_CONTENT_PATH=root;
  let owner=true, publications=0;
  globalThis.__editorApiAuth=async(write)=>{if(write&&!owner)throw Object.assign(new Error('Read only'),{status:403});return {userId:owner?1:2,cluster:{id:1,slug:'demo',user_id:1}};};
  globalThis.__editorPublish=()=>{publications++;};
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});if(previous===undefined)delete process.env.QUARTZ_CONTENT_PATH;else process.env.QUARTZ_CONTENT_PATH=previous;delete globalThis.__editorApiAuth;delete globalThis.__editorPublish;});
  const lib=path.resolve(import.meta.dirname,'../src/lib');
  const stubs={
    'next/server':'export const NextResponse=Response;',
    '@/lib/server-auth':`export const requireOwnedClusterFromSlug=()=>globalThis.__editorApiAuth(true);export const requireReadableClusterFromSlug=()=>globalThis.__editorApiAuth(false);export const routeErrorResponse=e=>Response.json({error:e.message},{status:e.status??500});`,
    '@/lib/db':'export default {prepare:()=>({run:()=>({changes:1})})};',
    '@/lib/quartz-publish':'export async function publishQuartzAfterMutation(){globalThis.__editorPublish();}',
    '@/lib/garden-mutation-lease':`export * from ${JSON.stringify(path.join(lib,'garden-mutation-lease-core.ts'))};`,
    '@/lib/markdown-folder-title.ts':'export const markdownFolderTitle=()=>"Demo";',
    '@/lib/generated/quartz-reader.mjs':'export const renderQuartzDocument=async input=>({html:input.content});',
    '@/lib/knowledge':`import fs from 'node:fs';import path from 'node:path';export const normalizeTopicTags=tags=>tags;export const refreshClusterIndex=()=>{};
      export const walkClusterMarkdown=root=>{const files=[];const walk=(dir,folder='')=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
        const filePath=path.join(dir,entry.name),relPath=folder?folder+'/'+entry.name:entry.name;
        if(entry.isDirectory()&&!entry.name.startsWith('.'))walk(filePath,relPath);
        else if(entry.isFile()&&entry.name.endsWith('.md'))files.push({entry:entry.name,filePath,relPath,folder});
      }};walk(root);return files;};`,
  };
  const bundle=await build({stdin:{contents:`export * from './app/api/documents/[slug]/route.ts';`,resolveDir:path.resolve(lib,'..'),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'api-fixture',setup(builder){
    builder.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'fixture'}:args.path.startsWith('@/lib/')?{path:path.join(lib,args.path.slice(6).replace(/\.ts$/,'')+'.ts')}:undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'ts',resolveDir:lib}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const app=module.exports, params={params:Promise.resolve({slug:'note'})};
  const request=(method,body)=>new Request('http://localhost/api/documents/note?clusterSlug=demo',{method,...(body?{body:JSON.stringify(body)}:{})});
  const get=()=>app.GET(request('GET'),params).then(r=>r.json());
  // Imported source notes commonly share their garden's name (Circuits.pdf
  // in Circuits). Every accepted address must still identify that note.
  fs.mkdirSync(path.join(garden,'sources'));
  const sameName=path.join(garden,'sources/demo.md');
  fs.writeFileSync(sameName,'---\ntitle: Demo.pdf\n---\n\nThe saved source.');
  for(const slug of ['demo','sources/demo','demo/sources/demo','garden/demo/sources/demo.md',encodeURIComponent('sources/demo')]){
    const target={params:Promise.resolve({slug})};
    const response=await app.GET(new Request('http://localhost/api/documents/'+encodeURIComponent(slug)+'?clusterSlug=demo&render=1'),target);
    assert.equal(response.status,200,await response.clone().text());
    const source=await response.json();assert.equal(source.title,'Demo.pdf');assert.match(source.reader.html,/The saved source/);
    assert.equal((await app.PATCH(request('PATCH',{baseRevision:source.revision,body:source.body}),target)).status,200);
  }
  const first=await get();assert.equal(first.canEdit,true);assert.equal(first.body,'    Code\r\n');assert.ok(first.revision);
  assert.equal((await app.PATCH(request('PATCH',{baseRevision:first.revision,body:first.body}),params)).status,200);assert.equal(publications,0);assert.equal(fs.readFileSync(file,'utf8'),original);
  const writes=await Promise.all(['One','Two'].map(body=>app.PATCH(request('PATCH',{baseRevision:first.revision,body}),params)));
  assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);assert.equal(publications,1);
  const conflict=await writes.find(r=>r.status===409).json();assert.equal(conflict.body,'One');assert.notEqual(conflict.revision,first.revision);
  const latest=await get();assert.equal(latest.revision,conflict.revision);
  assert.equal((await app.PATCH(request('PATCH',{baseRevision:latest.revision,title:'Changed',tags:['new']}),params)).status,200);
  const final=fs.readFileSync(file,'utf8');assert.match(final,/# hidden\r\ncustom:\r\n  title: Keep me/);assert.ok(final.endsWith('\r\n\r\nOne'));
  owner=false;assert.equal((await get()).canEdit,false);
  assert.equal((await app.PATCH(request('PATCH',{body:'Forbidden'}),params)).status,403);
  assert.equal((await app.POST(request('POST',{fragments:[]}),params)).status,403);assert.equal(fs.readFileSync(file,'utf8'),final);
  assert.equal((await app.DELETE(request('DELETE'),params)).status,403);
  owner=true;
  const deleted=await app.DELETE(request('DELETE'),params);
  assert.equal(deleted.status,200);
  assert.deepEqual((await deleted.json()).deletedPaths,['note.md']);
  assert.equal(fs.existsSync(file),false);
  const sameNameDelete=await app.DELETE(request('DELETE'),{params:Promise.resolve({slug:'sources/demo'})});
  assert.equal(sameNameDelete.status,200);
  assert.deepEqual((await sameNameDelete.json()).deletedPaths,['sources/demo.md']);
  assert.equal(fs.existsSync(sameName),false);
});
