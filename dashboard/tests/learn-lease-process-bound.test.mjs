import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireGardenLearnLease, MAX_PROCESS_BOUND_STALE_MS } from '../src/lib/learn-atomic-promotion.ts';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-lease-process-bound-'));
  const garden = path.join(root, 'physics');
  fs.mkdirSync(garden);
  const leases = [];
  t.after(() => { leases.forEach(lease => lease.release()); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, garden, lockFile: path.join(root, '.physics.learn-build.lock.json'), keep: lease => { leases.push(lease); return lease; } };
}
const learnOwner = { gardenSlug: 'physics', jobId: 'learn_job_1', buildId: 'planning:learn_job_1' };
const sweepOwner = { gardenSlug: 'physics', jobId: 'learn_job_1', buildId: 'recovery:learn_job_1' };
const ageHeartbeat = (f, patch = {}) => {
  const lock = JSON.parse(fs.readFileSync(f.lockFile, 'utf8'));
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  fs.writeFileSync(f.lockFile, JSON.stringify({ ...lock, heartbeatAt: old, ...patch }));
};

test('a live Learn worker keeps its garden through a long synchronous stall', t => {
  // Live 2026-09-23: minutes of synchronous hashing during rollback publication
  // starved the heartbeat timer; the recovery sweep took the lease from a live
  // worker and every later lock operation of that worker was refused.
  const f = fixture(t);
  const run = acquireGardenLearnLease(f.garden, learnOwner, { scope: 'learn-output', processBoundStaleMs: MAX_PROCESS_BOUND_STALE_MS });
  assert.equal(run.acquired, true);
  f.keep(run.lease);
  ageHeartbeat(f);
  const sweep = acquireGardenLearnLease(f.garden, sweepOwner, { refuseStaleProcessBoundTakeover: false });
  assert.equal(sweep.acquired, false, 'the sweep must not take a live worker\'s garden');
  assert.equal(run.lease.heartbeat(), true);
});

test('only the recovery sweep takes over once the Learn worker process is gone', t => {
  const f = fixture(t);
  const run = acquireGardenLearnLease(f.garden, learnOwner, { scope: 'learn-output', processBoundStaleMs: MAX_PROCESS_BOUND_STALE_MS });
  assert.equal(run.acquired, true);
  run.lease.abandon();
  ageHeartbeat(f, { processId: 2 ** 30 });
  assert.equal(
    acquireGardenLearnLease(f.garden, { ...learnOwner, jobId: 'learn_job_2', buildId: 'planning:learn_job_2' }, { scope: 'learn-output' }).acquired,
    false,
    'a new run waits for the sweep to roll the dead run back',
  );
  const sweep = acquireGardenLearnLease(f.garden, sweepOwner, { refuseStaleProcessBoundTakeover: false });
  assert.equal(sweep.acquired, true);
  f.keep(sweep.lease);
});
