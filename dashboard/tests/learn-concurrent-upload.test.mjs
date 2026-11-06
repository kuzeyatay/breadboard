import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireGardenLearnLease, acquireGardenContentLease, promoteStagingGarden } from '../src/lib/learn-atomic-promotion.ts';
import { acquireGardenMutationLease } from '../src/lib/garden-mutation-lease-core.ts';
import { durableGardenFileDigests } from '../src/lib/learn-build-workspace.ts';
import { mergeConcurrentGardenChanges } from '../src/lib/learn-concurrent-merge.ts';

const DAY = 24 * 60 * 60 * 1000;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-concurrent-upload-'));
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
const read = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (root, relative) => fs.existsSync(path.join(root, relative));
function learn(f, scope = 'learn-output') {
  const result = acquireGardenLearnLease(f.garden, { gardenSlug: 'physics', jobId: 'learn_job_1', buildId: 'generation:learn_job_1' }, scope ? { scope } : {});
  assert.equal(result.acquired, true);
  return f.keep(result.lease);
}
function upload(f, ownerId = 'job_upload_1', extra = {}) {
  return f.keep(acquireGardenMutationLease(f.garden, 'document-ingestion', {
    ownerId,
    processBoundStaleMs: DAY,
    ingestionRecovery: { registryRoot: path.join(f.root, 'registry'), runtimeJobsRoot: path.join(f.root, 'jobs') },
    ...extra,
  }));
}
const contentLock = f => path.join(f.root, '.physics.learn-build.lock.json.content');

test('an upload writes beside a learn-output build instead of waiting for it', t => {
  const f = fixture(t);
  const run = learn(f);
  const lease = upload(f);
  const lock = JSON.parse(fs.readFileSync(contentLock(f), 'utf8'));
  assert.match(lock.jobId, /^mutation:document-ingestion:job_upload_1$/);
  assert.ok(lock.ingestionRecovery, 'the record names the journal that can undo it');
  assert.ok(Date.parse(lock.processBoundExpiresAt) - Date.now() > 23 * 60 * 60 * 1000, 'the lease lasts as long as an upload may run');
  assert.equal(run.heartbeat(), true, 'Learn keeps its run lease');
  assert.throws(() => upload(f, 'job_upload_2'), { code: 'GARDEN_MUTATION_BUSY' }, 'a second upload still waits for the first');
  assert.throws(() => acquireGardenMutationLease(f.garden, 'test-save', { paths: ['notes/n.md'] }), { code: 'GARDEN_MUTATION_BUSY' });
  lease.release();
  assert.equal(fs.existsSync(contentLock(f)), false);
});

test('without a Learn build an upload keeps the exclusive lock; exclusive Learn work still blocks it', t => {
  const f = fixture(t);
  const alone = upload(f);
  assert.equal(alone.lock.scope, undefined);
  assert.equal(fs.existsSync(contentLock(f)), false);
  alone.release();
  learn(f, null);
  assert.throws(() => upload(f), { code: 'GARDEN_MUTATION_BUSY' });
});

test('a dead upload beside Learn blocks every writer except its journal recovery', t => {
  const f = fixture(t);
  const run = learn(f);
  const now = Date.now();
  fs.writeFileSync(contentLock(f), JSON.stringify({
    gardenSlug: 'physics', jobId: 'mutation:document-ingestion:job_dead', buildId: 'mutation-x',
    acquiredAt: new Date(now).toISOString(), heartbeatAt: new Date(now).toISOString(), leaseId: 'dead',
    processId: 2 ** 30, hostname: os.hostname(), processBoundExpiresAt: new Date(now + DAY).toISOString(),
    ingestionRecovery: { registryRoot: path.join(f.root, 'registry'), runtimeJobsRoot: path.join(f.root, 'jobs') },
  }));
  assert.equal(acquireGardenContentLease(f.garden, { learnLease: run }).acquired, false, 'Learn must not publish over half an upload');
  assert.throws(() => acquireGardenMutationLease(f.garden, 'test-save', { paths: ['notes/n.md'] }), { code: 'GARDEN_MUTATION_BUSY' });
  assert.throws(() => upload(f, 'job_next'), { code: 'GARDEN_MUTATION_BUSY' });
  const recovery = f.keep(acquireGardenMutationLease(f.garden, 'document-ingestion-recovery', {
    ownerId: 'recovery-1', processBoundStaleMs: DAY, recoverStaleProcessBoundLease: true,
    ingestionRecovery: { registryRoot: path.join(f.root, 'registry'), runtimeJobsRoot: path.join(f.root, 'jobs') },
  }));
  assert.match(JSON.parse(fs.readFileSync(contentLock(f), 'utf8')).jobId, /^mutation:document-ingestion-recovery:/);
  recovery.release();
  assert.equal(acquireGardenContentLease(f.garden, { learnLease: run }).acquired, true);
});

test('a dead upload is retired only by recovery once Learn has finished', t => {
  const f = fixture(t);
  const now = Date.now();
  fs.writeFileSync(contentLock(f), JSON.stringify({
    gardenSlug: 'physics', jobId: 'mutation:document-ingestion:job_dead', buildId: 'mutation-x',
    acquiredAt: new Date(now).toISOString(), heartbeatAt: new Date(now).toISOString(), leaseId: 'dead',
    processId: 2 ** 30, hostname: os.hostname(), processBoundExpiresAt: new Date(now + DAY).toISOString(),
    ingestionRecovery: { registryRoot: path.join(f.root, 'registry'), runtimeJobsRoot: path.join(f.root, 'jobs') },
  }));
  assert.equal(acquireGardenLearnLease(f.garden, { gardenSlug: 'physics', jobId: 'learn_job_2', buildId: 'b' }, { scope: 'learn-output' }).acquired, false);
  const recovery = f.keep(acquireGardenMutationLease(f.garden, 'document-ingestion-recovery', {
    ownerId: 'recovery-1', processBoundStaleMs: DAY, recoverStaleProcessBoundLease: true,
  }));
  assert.equal(fs.existsSync(contentLock(f)), false, 'recovery owns the rollback under the exclusive lock');
  recovery.release();
});

test('a Learn run resuming its own lease continues past a dead upload and leaves its record for recovery', t => {
  const f = fixture(t);
  const run = learn(f);
  const now = Date.now();
  const record = {
    gardenSlug: 'physics', jobId: 'mutation:document-ingestion:job_dead', buildId: 'mutation-x',
    acquiredAt: new Date(now).toISOString(), heartbeatAt: new Date(now).toISOString(), leaseId: 'dead',
    processId: 2 ** 30, hostname: os.hostname(), processBoundExpiresAt: new Date(now + DAY).toISOString(),
    ingestionRecovery: { registryRoot: path.join(f.root, 'registry'), runtimeJobsRoot: path.join(f.root, 'jobs') },
  };
  fs.writeFileSync(contentLock(f), JSON.stringify(record));
  const resumed = acquireGardenLearnLease(
    f.garden,
    { gardenSlug: 'physics', jobId: 'learn_job_1', buildId: 'generation:learn_job_1' },
    { scope: 'learn-output', resumeLeaseId: run.lock.leaseId },
  );
  assert.equal(resumed.acquired, true);
  f.keep(resumed.lease);
  assert.equal(JSON.parse(fs.readFileSync(contentLock(f), 'utf8')).jobId, record.jobId);
});

test('a transition guard leaked by this process is recovered instead of locking the garden until exit', t => {
  const f = fixture(t);
  const guardDir = path.join(f.root, '.physics.learn-build.lock.json.guard');
  const leak = (ageMs) => {
    fs.rmSync(guardDir, { recursive: true, force: true });
    fs.mkdirSync(guardDir);
    fs.writeFileSync(path.join(guardDir, 'owner.json'), JSON.stringify({
      token: 'leaked-token', owner: { gardenSlug: 'physics', jobId: 'learn_job_1', buildId: 'b' },
      acquiredAt: new Date(Date.now() - ageMs).toISOString(), processId: process.pid, hostname: os.hostname(),
    }));
  };
  // Live 2026-09-23: a release that could not read or remove its guard left it
  // naming the (live) worker, so every lease operation failed for 10 minutes.
  leak(5_000);
  assert.equal(acquireGardenLearnLease(f.garden, { gardenSlug: 'physics', jobId: 'learn_job_1', buildId: 'b' }, { scope: 'learn-output' }).acquired, false,
    'a fresh guard may still be held by another thread of this process');
  leak(60_000);
  const run = acquireGardenLearnLease(f.garden, { gardenSlug: 'physics', jobId: 'learn_job_1', buildId: 'b' }, { scope: 'learn-output' });
  assert.equal(run.acquired, true);
  f.keep(run.lease);
  assert.equal(fs.existsSync(guardDir), false);
  assert.equal(run.lease.heartbeat(), true);
});

test('merge carries live-only changes and refuses real conflicts without writing', t => {
  const f = fixture(t);
  const live = f.garden;
  write(live, 'sources/paper.md', 'paper');
  write(live, 'Concepts/1. waves/wave.md', 'wave');
  write(live, 'Concepts/1. waves/old.md', 'old');
  write(live, '.breadboard/source-visuals.json', '{}');
  const base = durableGardenFileDigests(live, true);
  const incoming = path.join(f.root, 'incoming', 'physics');
  fs.cpSync(live, incoming, { recursive: true });
  write(incoming, 'learning/lesson.md', 'lesson');
  write(incoming, '.breadboard/source-visuals.json', '{"learn":1}');
  // An upload beside the run.
  write(live, 'sources/new-lab.md', 'lab');
  write(live, 'Concepts/2. labs/setup.md', 'setup');
  write(live, 'Concepts/1. waves/wave.md', 'wave, merged with the lab');
  fs.rmSync(path.join(live, 'Concepts/1. waves/old.md'));

  const merged = mergeConcurrentGardenChanges({ currentDir: live, incomingDir: incoming, base, separateUserContent: true });
  assert.deepEqual(merged.conflicts, []);
  assert.equal(read(incoming, 'sources/new-lab.md'), 'lab');
  assert.equal(read(incoming, 'Concepts/2. labs/setup.md'), 'setup');
  assert.equal(read(incoming, 'Concepts/1. waves/wave.md'), 'wave, merged with the lab');
  assert.equal(exists(incoming, 'Concepts/1. waves/old.md'), false);
  assert.equal(read(incoming, '.breadboard/source-visuals.json'), '{"learn":1}', "Learn's own change is kept");
  assert.equal(read(incoming, 'learning/lesson.md'), 'lesson');

  write(live, '.breadboard/source-visuals.json', '{"upload":1}');
  write(live, 'sources/paper.md', 'paper, re-uploaded');
  write(live, 'Concepts/3. more/extra.md', 'extra');
  const refused = mergeConcurrentGardenChanges({ currentDir: live, incomingDir: incoming, base, separateUserContent: true });
  assert.equal(refused.conflicts.length, 2);
  assert.match(refused.conflicts.join('\n'), /source-visuals\.json \(changed by both/);
  assert.match(refused.conflicts.join('\n'), /sources\/paper\.md \(source changed/);
  assert.equal(exists(incoming, 'Concepts/3. more/extra.md'), false, 'a refused merge writes nothing');
});

test('publication waits for an upload beside it, then carries the upload into the new garden', async t => {
  const f = fixture(t);
  write(f.garden, 'sources/paper.md', 'paper');
  write(f.garden, 'learning/old.md', 'old lesson');
  const run = learn(f);
  const base = durableGardenFileDigests(f.garden, true);
  const stage = path.join(f.root, 'stage', 'physics');
  fs.cpSync(f.garden, stage, { recursive: true });
  fs.rmSync(path.join(stage, 'learning/old.md'));
  write(stage, 'learning/new.md', 'new lesson');

  const writer = upload(f);
  write(f.garden, 'sources/lab.md', 'lab slides');
  write(f.garden, 'Concepts/1. labs/setup.md', 'setup');
  let waits = 0;
  const promotion = await promoteStagingGarden({
    stagingGardenDir: stage,
    destinationGardenDir: f.garden,
    learnLease: run,
    concurrentMergeBase: base,
    waitForContentWriter: async conflict => {
      waits += 1;
      assert.match(conflict.jobId, /^mutation:document-ingestion:/);
      writer.release();
      return true;
    },
    options: { maxAttempts: 1 },
  });
  assert.equal(promotion.promoted, true, promotion.reason);
  assert.equal(waits, 1);
  assert.equal(read(f.garden, 'learning/new.md'), 'new lesson');
  assert.equal(exists(f.garden, 'learning/old.md'), false);
  assert.equal(read(f.garden, 'sources/lab.md'), 'lab slides');
  assert.equal(read(f.garden, 'Concepts/1. labs/setup.md'), 'setup');
  assert.ok(promotion.publishedDigests?.has('sources/lab.md'), 'what went live is recorded for a later restore');
  assert.equal(run.heartbeat(), true);
});

test('publication refuses a build whose source was rewritten mid-run and leaves the garden untouched', async t => {
  const f = fixture(t);
  write(f.garden, 'sources/paper.md', 'paper');
  const run = learn(f);
  const base = durableGardenFileDigests(f.garden, true);
  const stage = path.join(f.root, 'stage', 'physics');
  fs.cpSync(f.garden, stage, { recursive: true });
  write(stage, 'learning/new.md', 'new lesson');
  write(f.garden, 'sources/paper.md', 'paper v2');
  const promotion = await promoteStagingGarden({
    stagingGardenDir: stage, destinationGardenDir: f.garden, learnLease: run, concurrentMergeBase: base, options: { maxAttempts: 1 },
  });
  assert.equal(promotion.promoted, false);
  assert.match(promotion.reason, /sources\/paper\.md/);
  assert.equal(exists(f.garden, 'learning/new.md'), false);
  assert.equal(read(f.garden, 'sources/paper.md'), 'paper v2');
});
