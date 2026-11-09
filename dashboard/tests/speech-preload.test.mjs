import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionPreloader } from '../src/lib/speech/connection-preloader.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let time = 0;
  const calls = [];
  const pool = createConnectionPreloader((mode, signal) => new Promise((resolve, reject) => {
    const call = { mode, signal, closed: false, healthy: true, resolve() { resolve(this); },
      isHealthy() { return this.healthy && !this.closed && !signal.aborted; },
      async close() { this.closed = true; } };
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    calls.push(call);
  }), () => time);
  return { pool, calls, advance: ms => { time += ms; } };
}

test('simultaneous warmups allocate only two muted slots and hand off in-flight work once', async () => {
  const { pool, calls } = fixture();
  pool.configure('account:voice', ['conversation', 'speak']);
  pool.warm(); pool.warm();
  await flush();
  assert.deepEqual(calls.map(call => call.mode), ['conversation', 'speak']);
  const handoff = pool.take('conversation');
  assert.equal(await pool.take('conversation'), undefined);
  calls.forEach(call => call.resolve());
  assert.equal(await handoff, calls[0]);
  pool.warm(); await flush();
  assert.equal(calls.length, 2, 'a leased session must not be replenished');
  await pool.release(calls[0]);
  await pool.clear();
  assert.ok(calls.every(call => call.closed));
});

test('completed notifications reuse their reader; interruption discards it', async () => {
  const { pool, calls } = fixture();
  pool.configure('account:voice', ['speak']); await flush(); calls[0].resolve();
  const first = await pool.take('speak');
  await pool.release(first, true);
  assert.equal(await pool.take('speak'), first);
  assert.equal(calls.length, 1, 'the second notification does not reconnect');
  await pool.release(first);
  pool.warm(); await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].closed, true);
  await pool.clear();
});

test('provider/account changes retire stale media before starting replacements', async () => {
  const { pool, calls } = fixture();
  pool.configure('account:old-voice', ['speak']); await flush(); calls[0].resolve();
  let finishClose;
  calls[0].close = () => new Promise(resolve => { finishClose = resolve; });
  pool.configure('account:new-voice', ['speak']); await flush();
  assert.equal(calls.length, 1);
  finishClose(); await flush();
  assert.equal(calls.length, 2);
  calls[1].resolve();
  assert.equal(await pool.take('speak'), calls[1]);
  await pool.release(calls[1]); await pool.clear();
});

test('cancel during warm handoff releases setup and rejects only the cancelled caller', async () => {
  const { pool, calls } = fixture();
  pool.configure('account:voice', ['conversation']); await flush();
  const controller = new AbortController();
  const result = pool.take('conversation', controller.signal);
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(calls[0].signal.aborted, true);
  await pool.clear();
});

test('idle connections expire, unhealthy ones retire, and failed preloads back off', async () => {
  const { pool, calls, advance } = fixture();
  pool.configure('account:voice', ['speak']); await flush(); calls[0].resolve();
  await flush(); advance(5 * 60_000);
  const replacement = pool.take('speak');
  pool.warm(); await flush();
  assert.equal(calls[0].closed, true);
  assert.equal(calls.length, 2, 'expiry replacement reserves its slot before warming');
  calls[1].resolve();
  await pool.release(await replacement, true);
  calls[1].healthy = false;
  pool.warm(); await flush();
  assert.equal(calls[1].closed, true);
  await pool.clear();

  let attempts = 0;
  const failed = createConnectionPreloader(async () => { attempts++; throw Error('Offline'); }, () => 0);
  failed.configure('account', ['speak']); await flush();
  for (let index = 0; index < 5; index++) failed.warm();
  await flush(); assert.equal(attempts, 1);
  await failed.clear();
});

test('changing settings while a caller owns a reader does not reuse the old selection', async () => {
  const { pool, calls } = fixture();
  pool.configure('old', ['speak']); await flush(); calls[0].resolve();
  const reader = await pool.take('speak');
  pool.configure('new', ['speak']); await flush();
  assert.equal(calls.length, 1, 'active playback retains its only slot');
  await pool.release(reader, true);
  assert.equal(reader.closed, true);
  pool.warm(); await flush(); assert.equal(calls.length, 2);
  await pool.clear();
});

test('settings arriving after voice has opened do not start competing speculative sessions', async () => {
  const { pool, calls } = fixture();
  pool.configure('account:voice', ['conversation', 'speak'], false);
  pool.warm(); await flush();
  assert.equal(calls.length, 0);
  // Foreground calls may still prepare their required reader while warming is paused.
  const requested = pool.take('speak'); await flush();
  assert.equal(calls.length, 1);
  calls[0].resolve(); await pool.release(await requested);
  await pool.clear();
});

test('repeated warm-up failures double the wait instead of retrying every 30 s', async () => {
  let time = 0, attempts = 0;
  const pool = createConnectionPreloader(async () => { attempts++; throw Error('Offline'); }, () => time);
  pool.configure('account', ['speak']); await flush();
  assert.equal(attempts, 1);
  time += 30_000; pool.warm(); await flush();
  assert.equal(attempts, 2, 'the first retry still waits 30 s');
  time += 30_000; pool.warm(); await flush();
  assert.equal(attempts, 2, 'the second retry waits a minute');
  time += 30_000; pool.warm(); await flush();
  assert.equal(attempts, 3);
  time += 60_000; pool.warm(); await flush();
  assert.equal(attempts, 3, 'the third retry waits two minutes');
  time += 60_000; pool.warm(); await flush();
  assert.equal(attempts, 4);
  await pool.clear();
});

test('a connection that dies within a minute of connecting backs off like a failure', async () => {
  const { pool, calls, advance } = fixture();
  pool.configure('account:voice', ['speak']); await flush(); calls[0].resolve(); await flush();
  advance(5_000); calls[0].healthy = false;
  pool.warm(); await flush();
  assert.equal(calls[0].closed, true);
  assert.equal(calls.length, 1, 'a short-lived session is not replaced at once');
  advance(30_000); pool.warm(); await flush();
  assert.equal(calls.length, 2, 'it is replaced after the first backoff');
  await pool.clear();
});

test('on-demand reuse closes after 20 idle seconds and never reconnects overnight', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { pool, calls, advance } = fixture();
  await pool.configure('account', ['speak'], false);
  assert.equal(calls.length, 0);
  const first = pool.take('speak'); await flush(); calls[0].resolve();
  await pool.release(await first, true);
  t.mock.timers.tick(19_000); advance(19_000);
  assert.equal(calls[0].closed, false);
  const active = await pool.take('speak');
  t.mock.timers.tick(1_000); advance(1_000); await flush();
  assert.equal(calls[0].closed, false, 'an old idle timer cannot close active speech');
  await pool.release(active, true);
  t.mock.timers.tick(20_000); advance(20_000); await pool.settled();
  assert.equal(calls[0].closed, true, 'cleanup does not depend on a UI polling timer');
  for (let minute = 0; minute < 9 * 60; minute++) {
    advance(60_000); await pool.configure('account', ['speak'], false);
  }
  await flush();
  assert.equal(calls.length, 1, 'expiry never opens a replacement without a caller');
  await pool.clear();
});

const bounded=async promise=>{
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Nested voice retirement did not finish')),800);})]);}
 finally{clearTimeout(timer);}
};

test('closing a conversation releases its leased reader and permits reopening',async()=>{
 let reader,pool;const connections=[];
 pool=createConnectionPreloader(async mode=>{
  const connection={mode,closed:false,isHealthy(){return !this.closed;},async close(){
   if(this.closed)return;this.closed=true;
   if(mode==='conversation'&&reader)await pool.release(reader);
  }};
  connections.push(connection);return connection;
 });
 await pool.configure('account:voice',['conversation','speak'],false);
 const conversation=await pool.take('conversation');reader=await pool.take('speak');
 await bounded(pool.release(conversation));
 await bounded(pool.settled());
 assert.equal(conversation.closed,true);assert.equal(reader.closed,true);
 reader=undefined;
 const reopened=await bounded(pool.take('conversation'));
 assert.notEqual(reopened,conversation);assert.equal(connections.length,3);
 await bounded(pool.release(reopened));await bounded(pool.clear());
});
