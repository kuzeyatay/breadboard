import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

test('artifact publication releases the garden for folder creation while Quartz rebuilds', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-folder-lease-'));
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = dir;
  const state = { leased: false, complete: null, failIndex: false, publications: 0 };
  globalThis.__artifactFolderLease = state;
  const stubs = {
    '../db.ts': 'export default {prepare:()=>({run(){}})};',
    '../knowledge.ts': `export const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-');
      export function refreshClusterIndex(){
        if(!globalThis.__artifactFolderLease.leased)throw Error('Unprotected disk mutation');
        if(globalThis.__artifactFolderLease.failIndex)throw Error('Index failed');
      }`,
    '../garden-mutation-lease.ts': `export function acquireGardenMutationLease(){
      const s=globalThis.__artifactFolderLease;
      if(s.leased)throw Error('Garden busy');
      s.leased=true;return {release(){s.leased=false}};
    }`,
    '../quartz-publish.ts': `export async function publishQuartzAfterMutation(){
      const s=globalThis.__artifactFolderLease;
      if(s.leased)throw Error('Rebuild blocks folder creation');
      s.publications++;await new Promise(resolve=>s.complete=resolve);
    }`,
  };
  try {
    const bundle = await build({
      entryPoints: [path.resolve(import.meta.dirname, '../src/lib/hermes/artifact-garden.ts')],
      bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
      plugins: [{name:'lease-fixture',setup(b){
        b.onResolve({filter:/.*/},args=>stubs[args.path]===undefined?undefined:{path:args.path,namespace:'fixture'});
        b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'ts'}));
      }}],
    });
    const module={exports:{}};
    new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
    const {publishArtifactToGarden,unpublishArtifactFromGarden}=module.exports;
    const input={userId:1,clusterSlug:'em1',artifactId:'artifact-12345678',title:'Study notes',rendererId:'markdown',markdownSource:'Saved content'};
    const publishing=publishArtifactToGarden(input);
    assert.equal(state.leased,false,'Another garden mutation can acquire the lease before the rebuild completes');
    const note=path.join(dir,'em1/artifacts/study-notes-12345678.md');
    assert.match(fs.readFileSync(note,'utf8'),/Saved content/);
    assert.equal(state.publications,1);
    state.complete();
    const ref=await publishing;
    assert.equal(ref.documentSlug,'study-notes-12345678');
    const removing=unpublishArtifactFromGarden({userId:1,clusterId:1,clusterSlug:'em1',documentSlug:ref.documentSlug});
    assert.equal(state.leased,false,'Removing an artifact also leaves folders usable during publication');
    assert.equal(fs.existsSync(note),false);
    assert.equal(state.publications,2);
    state.complete();
    await removing;
    state.failIndex=true;
    await assert.rejects(publishArtifactToGarden(input),/Index failed/);
    assert.equal(state.leased,false,'Failed canonical writes release the lease too');
    assert.equal(state.publications,2,'Failed canonical writes are not published');
  } finally {
    if(previous===undefined)delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH=previous;
    delete globalThis.__artifactFolderLease;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
