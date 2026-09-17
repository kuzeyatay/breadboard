import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { acquireGardenLearnLease, acquireGardenContentLease } from '../src/lib/learn-atomic-promotion.ts';

test('real authoring helpers and document routes save a copy while Learn runs and release before publication', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-concurrent-authoring-'));
  const garden = path.join(root, 'physics');
  fs.mkdirSync(path.join(garden, 'learning'), { recursive: true });
  const original = '---\ntitle: Lesson\nknowledge_type: learning-page\ngeneratedBy: learn_button\n---\nOriginal lesson\n';
  fs.writeFileSync(path.join(garden, 'learning/lesson.md'), original);
  const previous = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = path.toNamespacedPath(root);
  const run = acquireGardenLearnLease(garden, { gardenSlug: 'physics', jobId: 'learn', buildId: 'build' }, { scope: 'learn-output' });
  assert.equal(run.acquired, true);
  t.after(() => { run.lease.release(); fs.rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.QUARTZ_CONTENT_PATH; else process.env.QUARTZ_CONTENT_PATH = previous; delete globalThis.__concurrentPublication; });
  let publications = 0;
  globalThis.__concurrentPublication = () => {
    const save = acquireGardenContentLease(garden, { paths: ['my-notes/note.md'] });
    assert.equal(save.acquired, true, 'Publication must run after releasing the save lease');
    save.lease.release();
    publications++;
  };
  const lib = path.resolve(import.meta.dirname, '../src/lib');
  const core = JSON.stringify(path.join(lib, 'garden-mutation-lease-core.ts'));
  const stubs = {
    'next/server': 'export const NextResponse = Response;',
    '@/lib/generated/quartz-reader.mjs': 'export const renderQuartzDocument=()=>({});',
    '@/lib/server-auth': `export const requireOwnedClusterFromSlug=async slug=>({cluster:{slug,id:1},userId:7}); export const requireReadableClusterFromSlug=requireOwnedClusterFromSlug; export const routeErrorResponse=e=>Response.json({error:e.message},{status:e.status??500});`,
    'db': 'export default {prepare:()=>({run:()=>({changes:1})})};',
    'runtime-paths': 'export const dashboardDataDir=()=>"";',
    'garden-mutation-lease': `export * from ${core};`,
    'garden-mutation-recovery': `import path from 'node:path'; import {acquireGardenMutationLease} from ${core}; export const acquireGardenMutationLeaseWithIngestionRecovery=input=>acquireGardenMutationLease(path.join(input.contentPath,input.clusterSlug),input.operation,input.options);`,
    'quartz-publish': 'export async function publishQuartzAfterMutation(){globalThis.__concurrentPublication();}',
    'knowledge': `import fs from 'node:fs'; import path from 'node:path';
      export const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      export const normalizeTopicTags=tags=>tags;
      export const refreshClusterIndex=(root,slug,options)=>{if(options?.migrateSources!==false)throw Error('Save may not migrate sources');fs.writeFileSync(path.join(root,slug,'_index.md'),'Refreshed navigation');};
      export const walkClusterMarkdown=root=>{
        const pages=[];const walk=(dir,folder='')=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
          if(entry.name.startsWith('.'))continue;
          const filePath=path.join(dir,entry.name),relPath=folder?folder+'/'+entry.name:entry.name;
          if(entry.isDirectory())walk(filePath,relPath);else if(entry.name.endsWith('.md'))pages.push({filePath,relPath,folder,entry:entry.name});
        }};walk(root);return pages;};`,
  };
  const bundle = await build({
    stdin: { contents: `export * from './lib/garden-filesystem.ts'; export * from './lib/garden-documents.ts'; export {PATCH,DELETE} from './app/api/documents/[slug]/route.ts';`, resolveDir: path.resolve(lib, '..'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
    plugins: [{ name: 'authoring-fixture', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        const key = stubs[args.path] !== undefined ? args.path : args.path.replace(/^.*\//, '').replace(/\.ts$/, '');
        if (stubs[key] !== undefined) return { path: key, namespace: 'fixture' };
        if (args.path.startsWith('@/lib/')) return { path: path.join(lib, args.path.slice(6) + '.ts') };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'ts', resolveDir: lib }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const app = module.exports;
  const input = { userId: 7, clusterSlug: 'physics', clusterId: 1 };
  fs.mkdirSync(path.join(garden, 'learning/section'));
  fs.writeFileSync(path.join(garden, 'learning/section/nested.md'), original);
  const sectionCopy = await app.copyGardenFolder({ ...input, folder: 'learning/section' });
  assert.equal(sectionCopy.newFolder, 'section-copy');
  assert.ok(fs.existsSync(path.join(garden, 'section-copy/nested-copy.md')));
  assert.equal(fs.existsSync(path.join(garden, 'learning/section-copy')), false);
  await app.copyGardenFolder({ ...input, folder: 'learning' });
  assert.equal(fs.readFileSync(path.join(garden, 'learning/lesson.md'), 'utf8'), original);
  assert.match(fs.readFileSync(path.join(garden, 'learning-copy/lesson-copy.md'), 'utf8'), /garden_copy: true/);
  await app.renameGardenFolder({ ...input, folder: 'learning-copy', name: 'My Revision' });
  await app.createGardenFolder({ ...input, folder: 'my-notes' });
  const note = await app.createGardenDocument({ ...input, folder: 'my-notes', title: 'Question', content: 'My question' });
  await app.reviseGardenDocument({ ...input, pageSlug: note.slug, patchOrReplacement: 'My revised question' });
  await app.moveGardenDocument({ ...input, slug: note.slug, toFolder: 'my-revision' });
  const params = { params: Promise.resolve({ slug: 'lesson-copy' }) };
  const request = (method, body) => new Request('http://localhost/api/documents/lesson-copy?clusterSlug=physics', { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const saved = await app.PATCH(request('PATCH', { body: 'My own lesson edit' }), params);
  assert.equal(saved.status, 200);
  assert.match(fs.readFileSync(path.join(garden, 'my-revision/lesson-copy.md'), 'utf8'), /My own lesson edit/);
  const protectedSave = await app.PATCH(request('PATCH', { body: 'Should be blocked' }), { params: Promise.resolve({ slug: 'lesson' }) });
  assert.equal(protectedSave.status, 409);
  assert.equal((await app.DELETE(request('DELETE'), params)).status, 200);
  assert.equal(fs.existsSync(path.join(garden, 'my-revision/lesson-copy.md')), false);
  await app.deleteGardenFolder({ ...input, folder: 'my-revision' });
  assert.equal(fs.existsSync(path.join(garden, 'my-revision')), false);
  assert.equal(fs.readFileSync(path.join(garden, 'learning/lesson.md'), 'utf8'), original);
  assert.ok(publications >= 8);
  assert.equal(run.lease.heartbeat(), true);
  run.lease.release();
  fs.mkdirSync(path.join(garden, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(garden, 'Concepts'), { recursive: true });
  fs.writeFileSync(path.join(garden, 'sources/upload.md'), '---\ntitle: Upload\nknowledge_type: source-document\nlearning_pages: [concept]\n---\nSource material');
  fs.writeFileSync(path.join(garden, 'Concepts/concept.md'), '---\ntitle: Concept\nknowledge_type: learning-page\nsource_document: upload\n---\nConcept material');
  await app.copyGardenFolder({ ...input, folder: 'sources' });
  await app.copyGardenFolder({ ...input, folder: 'Concepts' });
  const deletedSource = await app.DELETE(request('DELETE'), { params: Promise.resolve({ slug: 'upload' }) });
  assert.equal(deletedSource.status, 200);
  assert.equal(fs.existsSync(path.join(garden, 'sources/upload.md')), false);
  assert.ok(fs.existsSync(path.join(garden, 'sources-copy/upload-copy.md')));
  assert.ok(fs.existsSync(path.join(garden, 'Concepts-copy/concept-copy.md')), 'Source deletion must not cascade into copied Concepts');
});
