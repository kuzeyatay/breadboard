import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { acquireGardenLearnLease, acquireGardenContentLease, promoteStagingGarden } from '../src/lib/learn-atomic-promotion.ts';
import { acquireGardenMutationLease, assertGardenMutationWritePaths } from '../src/lib/garden-mutation-lease-core.ts';
import { createLearnBuildWorkspace, fingerprintDurableGardenState } from '../src/lib/learn-build-workspace.ts';
import { isActiveLearnerProjectionPath } from '../src/lib/learn-structure-reconciliation.ts';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garden-concurrent-learning-'));
  const garden = path.join(root, 'physics');
  fs.mkdirSync(garden);
  const leases = [];
  t.after(() => { leases.forEach(lease => lease.release()); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, garden, keep: lease => { leases.push(lease); return lease; } };
}
function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const owner = { gardenSlug: 'physics', jobId: 'learn-1', buildId: 'build-1' };
function learn(f) {
  const result = acquireGardenLearnLease(f.garden, owner, { scope: 'learn-output' });
  assert.equal(result.acquired, true);
  return f.keep(result.lease);
}
function save(f, paths, action = () => {}) {
  const lease = f.keep(acquireGardenMutationLease(f.garden, 'test-save', { paths }));
  try { action(lease); } finally { lease.release(); }
}

test('independent folders can save during Learn; source inputs and generated output remain fenced', t => {
  const f = fixture(t);
  const run = learn(f);
  save(f, ['learning-copy/lesson.md'], () => write(f.garden, 'learning-copy/lesson.md', 'My revision'));
  assert.equal(run.heartbeat(), true);
  for (const relative of ['learning/lesson.md', 'sources/paper.md', '.breadboard/source-anchors.json', '_index.md', 'legacy-source.md']) {
    assert.throws(() => acquireGardenMutationLease(f.garden, 'edit', { paths: [relative] }), { code: 'GARDEN_MUTATION_BUSY' });
  }
  save(f, ['my-notes/note.md'], lease => {
    assert.throws(() => assertGardenMutationWritePaths(lease, f.garden, ['sources/paper.md']));
  });
  assert.equal(isActiveLearnerProjectionPath('learning-copy/lesson.md', 'build-1'), false);
  assert.equal(isActiveLearnerProjectionPath('my-revision/lesson.md', 'build-1'), false);
  assert.equal(isActiveLearnerProjectionPath('learning/lesson.md', 'build-1'), true);
});

test('legacy Learn workers stay exclusive until they release their original lease', t => {
  const f = fixture(t);
  const acquired = acquireGardenLearnLease(f.garden, owner);
  assert.equal(acquired.acquired, true);
  const old = f.keep(acquired.lease);
  assert.throws(() => save(f, ['learning-copy/note.md']), { code: 'GARDEN_MUTATION_BUSY' });
  old.release();
  save(f, ['learning-copy/note.md']);
});

test('save admission serializes users, publication, and the next exclusive operation', async t => {
  const f = fixture(t);
  const run = learn(f);
  write(f.garden, 'learning/old.md', 'old');
  const stage = path.join(f.root, 'stage');
  write(stage, 'learning/new.md', 'new');
  const writer = f.keep(acquireGardenMutationLease(f.garden, 'edit', { paths: ['notes/note.md'] }));
  assert.throws(() => save(f, ['other/note.md']), { code: 'GARDEN_MUTATION_BUSY' });
  const blocked = await promoteStagingGarden({ stagingGardenDir: stage, destinationGardenDir: f.garden, learnLease: run, options: { maxAttempts: 1 } });
  assert.equal(blocked.promoted, false);
  assert.equal(fs.readFileSync(path.join(f.garden, 'learning/old.md'), 'utf8'), 'old');
  assert.equal(run.heartbeat(), true, 'A save must not prevent the existing run heartbeat');
  run.release();
  assert.equal(acquireGardenLearnLease(f.garden, owner).acquired, false, 'A new exclusive writer must wait even after Learn finishes');
  writer.release();
  const next = acquireGardenLearnLease(f.garden, owner);
  assert.equal(next.acquired, true);
  f.keep(next.lease);
});

test('publication carries late edits, creation, rename and deletion, then rollback carries still newer edits', async t => {
  const f = fixture(t);
  const run = learn(f);
  write(f.garden, 'learning/lesson.md', 'old generated lesson');
  write(f.garden, 'learning-copy/lesson.md', 'original copy');
  write(f.garden, 'deleted/note.md', 'delete me');
  const stage = path.join(f.root, 'stage');
  fs.cpSync(f.garden, stage, { recursive: true });
  write(stage, 'learning/lesson.md', 'new generated lesson');
  let checkedGate = false;
  const published = await promoteStagingGarden({
    stagingGardenDir: stage, destinationGardenDir: f.garden, learnLease: run,
    retainPreviousUntilCallerCommit: true,
    verifyManifest: () => {
      save(f, ['learning-copy', 'my-revision', 'deleted', 'new-notes'], () => {
        write(f.garden, 'learning-copy/lesson.md', 'edit while model was working');
        fs.renameSync(path.join(f.garden, 'learning-copy'), path.join(f.garden, 'my-revision'));
        fs.rmSync(path.join(f.garden, 'deleted'), { recursive: true });
        write(f.garden, 'new-notes/new.md', 'created during generation');
      });
      return true;
    },
    prepareIncomingForCommit: () => {
      assert.throws(() => save(f, ['my-revision']), { code: 'GARDEN_MUTATION_BUSY' });
      checkedGate = true;
      return true;
    },
  });
  assert.equal(published.promoted, true);
  assert.equal(checkedGate, true);
  assert.equal(fs.existsSync(path.join(f.garden, 'learning-copy')), false);
  assert.equal(fs.existsSync(path.join(f.garden, 'deleted')), false);
  assert.equal(fs.readFileSync(path.join(f.garden, 'my-revision/lesson.md'), 'utf8'), 'edit while model was working');
  assert.equal(fs.readFileSync(path.join(f.garden, 'learning/lesson.md'), 'utf8'), 'new generated lesson');
  save(f, ['my-revision/lesson.md'], () => write(f.garden, 'my-revision/lesson.md', 'saved after publication'));
  // The same promotion primitive handles rollback after SQLite/Quartz failure.
  const restored = await promoteStagingGarden({ stagingGardenDir: published.previousPreservedAt, destinationGardenDir: f.garden, learnLease: run });
  assert.equal(restored.promoted, true);
  assert.equal(fs.readFileSync(path.join(f.garden, 'learning/lesson.md'), 'utf8'), 'old generated lesson');
  assert.equal(fs.readFileSync(path.join(f.garden, 'my-revision/lesson.md'), 'utf8'), 'saved after publication');
  assert.equal(fs.readFileSync(path.join(f.garden, 'new-notes/new.md'), 'utf8'), 'created during generation');
  assert.equal(fs.existsSync(path.join(f.garden, 'deleted')), false);
});

test('scoped workspace excludes user copies and their edits do not invalidate source fingerprints', t => {
  const f = fixture(t);
  write(f.garden, 'sources/paper.md', 'source');
  write(f.garden, 'learning-copy/copied.md', 'copy');
  write(f.garden, '_index.md', 'old navigation');
  const workspace = createLearnBuildWorkspace({ gardenSlug: 'physics', jobId: 'job', mode: 'generate', repositoryGardenDir: f.garden, contractFingerprint: 'contract', sourceSetFingerprint: 'source', workspaceRoot: path.join(f.root, 'build'), separateUserContent: true });
  assert.equal(fs.existsSync(path.join(workspace.stagingGardenDir, 'learning-copy')), false);
  write(f.garden, 'learning-copy/copied.md', 'edited copy');
  write(f.garden, '_index.md', 'refreshed navigation');
  write(f.garden, 'sources/_index.md', 'refreshed source navigation');
  assert.equal(fingerprintDurableGardenState(f.garden, true), workspace.durableInputFingerprint);
  write(f.garden, 'sources/paper.md', 'changed source');
  assert.notEqual(fingerprintDurableGardenState(f.garden, true), workspace.durableInputFingerprint);
});

test('copied visual dependencies survive rebuild without overwriting new validated visual versions', async t => {
  const f = fixture(t);
  const run = learn(f);
  write(f.garden, 'learning-copy/lesson.md', '---\nvisualIds: ["older", "shared"]\n---\n```breadboard-visual\n{"id":"block-only"}\n```');
  write(f.garden, '.breadboard/visual-index.json', JSON.stringify({ schemaVersion: 1, visuals: [{ id: 'older', version: 1 }, { id: 'shared', version: 1 }] }));
  write(f.garden, '.breadboard/visuals/older.json', 'older visual');
  write(f.garden, '.breadboard/visuals/block-only.json', 'block visual');
  write(f.garden, '.breadboard/visuals/shared/versions/1/source.js', 'v1');
  const stage = path.join(f.root, 'stage');
  write(stage, '.breadboard/visual-index.json', JSON.stringify({ schemaVersion: 1, visuals: [{ id: 'shared', version: 2 }] }));
  write(stage, '.breadboard/visuals/shared/versions/2/source.js', 'v2');
  const published = await promoteStagingGarden({ stagingGardenDir: stage, destinationGardenDir: f.garden, learnLease: run });
  assert.equal(published.promoted, true);
  assert.equal(fs.readFileSync(path.join(f.garden, '.breadboard/visuals/older.json'), 'utf8'), 'older visual');
  assert.equal(fs.readFileSync(path.join(f.garden, '.breadboard/visuals/block-only.json'), 'utf8'), 'block visual');
  assert.equal(fs.readFileSync(path.join(f.garden, '.breadboard/visuals/shared/versions/1/source.js'), 'utf8'), 'v1');
  const index = JSON.parse(fs.readFileSync(path.join(f.garden, '.breadboard/visual-index.json'), 'utf8'));
  assert.deepEqual(index.visuals, [{ id: 'shared', version: 2 }, { id: 'older', version: 1 }]);
});

test('path traversal, aliases into sources, and an absent live tree cannot gain user-save admission', t => {
  const f = fixture(t);
  learn(f);
  for (const relative of ['notes/../sources/x.md', '/notes/x.md', 'notes//x.md', 'notes/C:/x.md', 'Learning/x.md']) {
    assert.equal(acquireGardenContentLease(f.garden, { paths: [relative] }).acquired, false);
  }
  fs.mkdirSync(path.join(f.garden, 'sources'));
  fs.symlinkSync(path.join(f.garden, 'sources'), path.join(f.garden, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(acquireGardenContentLease(f.garden, { paths: ['alias/source.md'] }).acquired, false);
  fs.renameSync(f.garden, path.join(f.root, 'displaced'));
  assert.equal(acquireGardenContentLease(f.garden, { paths: ['notes/note.md'] }).acquired, false);
});

test('a process crash releases only the short save fence, while the Learn run keeps ownership', async t => {
  const f = fixture(t);
  const run = learn(f);
  const moduleUrl = new URL('../src/lib/garden-mutation-lease-core.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    `import {acquireGardenMutationLease} from ${JSON.stringify(moduleUrl)}; acquireGardenMutationLease(process.argv[1], 'child-save', {paths:['notes/note.md']}); console.log('ready'); setInterval(()=>{},1000);`, f.garden], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw Error('Child failed before acquiring save lease'); })]);
  assert.throws(() => save(f, ['notes/note.md']), { code: 'GARDEN_MUTATION_BUSY' });
  const exited = once(child, 'exit');
  child.kill();
  await exited;
  save(f, ['notes/note.md']);
  assert.equal(run.heartbeat(), true);
});
