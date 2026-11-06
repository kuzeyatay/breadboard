// One finite maintenance run. Reconnects to the desktop model, resumes receipts,
// and signals the supervising session only after fresh coverage verification.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { inventoryGardenSourceFigures, searchGardenSourceFigures } from '../src/lib/hermes/garden-source-figures.ts';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? '' : process.argv[i + 1] ?? ''; };
const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = arg('data-dir');
const userId = Number(arg('user-id'));
const statusFile = path.resolve(arg('status-file'));
const reportFile = path.resolve(arg('report'));
const qaFile = arg('qa-file') ? path.resolve(arg('qa-file')) : path.resolve(dashboard, '../qa/garden-visual-search-20260924.md');
if (!dataDir || !Number.isSafeInteger(userId) || userId <= 0 || !arg('status-file') || !arg('report')) throw new Error('Require --data-dir, --user-id, --status-file and --report.');
const stopFile = `${statusFile}.stop`;
const lockFile = `${statusFile}.worker-lock`;
const deadline = Date.now() + 6 * 60 * 60 * 1000;
const stopped = async () => Boolean(await fs.stat(stopFile).catch(() => null));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let acquired = false;
async function update(fields) {
  const prior = JSON.parse(await fs.readFile(statusFile, 'utf8').catch(() => '{}'));
  const temporary = `${statusFile}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify({ ...prior, ...fields, supervisorPid: process.pid, updatedAt: new Date().toISOString() }, null, 2));
  await fs.rename(temporary, statusFile);
}
async function backgroundAvailable() {
  try {
    const endpoints = JSON.parse(await fs.readFile(path.join(dataDir, 'runtime/endpoints.json'), 'utf8'));
    const url = new URL(endpoints.urls.chatmock);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) return false;
    const response = await fetch(`${url.origin}/v1/providers`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const state = await response.json();
    return Boolean(state.defaultModel && state.defaultModel !== 'none');
  } catch { return false; }
}
async function runPass(singleImages) {
  await fs.writeFile(`${reportFile}.launch.json`, JSON.stringify({ startedAt: new Date().toISOString(), supervisorPid: process.pid }));
  const args = ['--experimental-strip-types', 'scripts/backfill-garden-visual-descriptions.mjs', '--background', '--apply',
    '--data-dir', dataDir, '--user-id', String(userId), '--all', '--batch-size', singleImages ? '1' : '8',
    '--concurrency', singleImages ? '2' : '4', '--report', reportFile, '--status-file', statusFile];
  const log = await fs.open(`${reportFile}.worker.log`, 'a');
  const before = await fs.stat(reportFile).catch(() => null);
  child = spawn(process.execPath, args, { cwd: dashboard, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  await update({ status: 'running', readyForSupervisor: false, pid: child.pid, message: 'Describing saved visuals with the current background model.' });
  const timer = setInterval(async () => { if (Date.now() > deadline || await stopped()) child?.kill(); }, 5000);
  try { await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
  finally { clearInterval(timer); child = undefined; await log.close(); }
  const after = await fs.stat(reportFile).catch(() => null);
  return after && after.mtimeMs !== before?.mtimeMs ? JSON.parse(await fs.readFile(reportFile, 'utf8')) : null;
}
async function verify(result) {
  const contentPath = path.join(dataDir, 'quartz/content');
  const db = new Database(path.join(dataDir, 'database/brain.db'), { readonly: true });
  const gardens = db.prepare('SELECT slug FROM clusters WHERE user_id = ? ORDER BY slug').all(userId).map(row => row.slug);
  db.close();
  const coverage = [];
  const unresolved = [];
  let telecomSample;
  for (const garden of gardens) {
    const counts = { garden, images: 0, described: 0, pending: 0, unavailable: 0 };
    for await (const { figure } of inventoryGardenSourceFigures(contentPath, garden)) {
      counts.images++;
      if (figure.availability !== 'available') { counts.unavailable++; unresolved.push({ garden, imagePath: figure.imagePath, reason: figure.availability }); }
      else if (['vision', 'visual_detection'].includes(figure.descriptionSource)) counts.described++;
      else { counts.pending++; unresolved.push({ garden, imagePath: figure.imagePath, reason: 'description_pending' }); }
      if (!telecomSample && garden === 'telecom-1' && figure.descriptionSource === 'vision') telecomSample = figure;
    }
    coverage.push(counts);
  }
  let retrievalVerified = false;
  if (telecomSample) {
    const search = await searchGardenSourceFigures(contentPath, [{ slug: 'telecom-1', name: 'Telecom 1' }],
      { query: telecomSample.caption, includePageSnapshots: true, limit: 50 });
    retrievalVerified = search.figures.some(figure => figure.availability === 'available' && figure.markdown && figure.descriptionSource === 'vision');
  }
  const verification = { checkedAt: new Date().toISOString(), model: result.model, coverage, unresolved, retrievalVerified };
  await fs.writeFile(`${reportFile}.verified.json`, JSON.stringify(verification, null, 2));
  return verification;
}
try {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  try { await fs.writeFile(lockFile, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); acquired = true; }
  catch (error) { if (error.code === 'EEXIST') throw new Error('A visual backfill supervisor lock already exists. Inspect it before starting another run.'); throw error; }
  let completedPasses = 0;
  while (Date.now() < deadline && !await stopped()) {
    if (!await backgroundAvailable()) {
      await update({ status: 'waiting_for_model', readyForSupervisor: false, message: 'Waiting for the desktop background model. Saved descriptions will be reused.' });
      await pause(30_000); continue;
    }
    const result = await runPass(completedPasses > 0);
    if (await stopped()) break;
    if (!result || result.serviceUnavailable) { await update({ status: 'waiting_for_model', readyForSupervisor: false }); await pause(60_000); continue; }
    completedPasses++;
    await update({ status: 'verifying', readyForSupervisor: false });
    const verified = await verify(result);
    const pending = verified.coverage.reduce((n, row) => n + row.pending, 0);
    if (pending && completedPasses < 3) continue;
    if (pending || !verified.retrievalVerified) {
      await update({ status: 'needs_attention', readyForSupervisor: false, verificationPath: `${reportFile}.verified.json`,
        message: `Backfill needs review: ${pending} descriptions pending; Telecom retrieval verified: ${verified.retrievalVerified}.` });
      break;
    }
    const unavailable = verified.coverage.reduce((n, row) => n + row.unavailable, 0);
    const described = verified.coverage.reduce((n, row) => n + row.described, 0);
    const handoffPath = statusFile.replace(/\.json$/i, '.md');
    await fs.writeFile(handoffPath, `# Completed visual backfill handoff\n\nVerified at ${verified.checkedAt}. Model: ${result.model}.\n\n${described} available image references have descriptions; no available images are awaiting descriptions. ${unavailable} references remain unavailable. Telecom 1 retrieval of a saved pixel description returned a usable image embed.\n\nVerification report: ${reportFile}.verified.json\n\nPreserve .breadboard/visual-descriptions during Learn promotion. Recheck the final Telecom 1 figures against this report; this notification does not request restarting Learn.\n\nRemaining references:\n${verified.unresolved.map(row => `- ${row.garden}: ${row.imagePath} (${row.reason})`).join('\n') || '- None'}\n`);
    await fs.appendFile(qaFile, `\n## Completed live backfill\n\nVerified ${verified.checkedAt} with ${result.model}: ${described} described image references, ${pending} pending, ${unavailable} unavailable. Telecom 1 retrieval verified. Full report: ${reportFile}.verified.json.\n`);
    await update({ status: unavailable ? 'complete_with_issues' : 'complete', readyForSupervisor: true,
      verificationPath: `${reportFile}.verified.json`, handoffPath, gardens: verified.coverage,
      message: `Verified backfill finished. ${unavailable} unavailable references are listed in the handoff.` });
    break;
  }
  const current = JSON.parse(await fs.readFile(statusFile, 'utf8'));
  if (!current.readyForSupervisor && (await stopped() || Date.now() >= deadline)) {
    await update({ status: await stopped() ? 'cancelled' : 'needs_attention', readyForSupervisor: false,
      message: await stopped() ? 'Backfill stopped; successful descriptions are retained.' : 'The six-hour maintenance window ended. Completed descriptions are retained; resume when the model is available.' });
  }
} catch (error) {
  if (acquired) await update({ status: 'needs_attention', readyForSupervisor: false, message: error.message });
  else console.error(error.message);
  process.exitCode = 1;
} finally {
  child?.kill();
  if (acquired) await fs.rm(lockFile, { force: true });
}
