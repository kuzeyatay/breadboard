// Read-only coverage report by default. --apply generates resumable descriptions
// for every visible source/note image using the explicitly selected model.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gardenReadEntries, readGardenPage } from '../src/lib/hermes/garden-reader.ts';
import { gardenSourceFigures } from '../src/lib/hermes/garden-source-figures.ts';
import { enrichGardenSourceVisuals } from '../src/lib/garden-visual-enrichment.ts';
import { createChatmockClient } from '../src/lib/chatmock-client.ts';

const argument = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 || process.argv[index + 1]?.startsWith('--') ? '' : process.argv[index + 1] ?? '';
};
const apply = process.argv.includes('--apply');
const configuredRoot = argument('content-path') || process.env.QUARTZ_CONTENT_PATH;
const garden = argument('garden');
const all = process.argv.includes('--all');
const model = argument('model');
if (process.argv.includes('--background')) {
  // The desktop's live endpoint/data root override old checkout .env defaults.
  // Requiring an explicit user keeps an all-Garden backfill inside ownership.
  const dataDir = argument('data-dir') || process.env.BREADBOARD_DATA_DIR;
  const userId = Number(argument('user-id'));
  if (!apply || !dataDir || !Number.isSafeInteger(userId) || userId <= 0 || (!garden && !all) || (garden && all)) {
    throw new Error('--background requires --apply --data-dir <desktop Data directory> --user-id <id> and --all or --garden <slug>.');
  }
  const dataRoot = fs.realpathSync(dataDir);
  const root = fs.realpathSync(path.join(dataRoot, 'quartz/content'));
  const endpoints = JSON.parse(fs.readFileSync(path.join(dataRoot, 'runtime/endpoints.json'), 'utf8'));
  const endpoint = new URL(endpoints.urls.chatmock);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username || endpoint.password) throw new Error('Expected the desktop loopback model endpoint.');
  const baseURL = `${endpoint.origin}/v1`;
  const response = await fetch(`${baseURL}/providers`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Background model settings returned HTTP ${response.status}.`);
  const state = await response.json();
  if (!state.defaultModel || state.defaultModel === 'none') throw new Error('No background model is selected.');
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path.join(dataRoot, 'database/brain.db'), { readonly: true });
  const gardens = db.prepare('SELECT slug FROM clusters WHERE user_id = ? ORDER BY slug').all(userId)
    .map(row => row.slug).filter(slug => !garden || slug === garden);
  db.close();
  if (!gardens.length) throw new Error('No owned Gardens match this request.');
  const { default: OpenAI } = await import('openai');
  const { backfillGardenVisualDescriptions } = await import('../src/lib/garden-visual-backfill.ts');
  const reportPath = path.resolve(argument('report') || path.join(dataRoot, 'runtime', `garden-visual-backfill-${Date.now()}.json`));
  const progressPath = `${reportPath}.jsonl`;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const statusPath = argument('status-file') ? path.resolve(argument('status-file')) : null;
  const previousStatus = statusPath && fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : {};
  const previouslySaved = Number(previousStatus.savedByThisTask) || 0;
  let added = 0;
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const progress = event => {
    const record = { at: new Date().toISOString(), ...event };
    fs.appendFileSync(progressPath, `${JSON.stringify(record)}\n`);
    if (typeof event.added === 'number' && event.event === 'batch') added = event.added;
    if (statusPath) {
      const temporary = `${statusPath}.${randomUUID()}.tmp`;
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify({ ...previousStatus, schemaVersion: 1, task: 'garden-visual-backfill',
        status: event.event === 'complete' ? event.serviceUnavailable ? 'waiting_for_model' : 'verifying' : 'running',
        readyForSupervisor: false, updatedAt: record.at, pid: process.pid, model: state.defaultModel,
        savedByThisTask: previouslySaved + added, reportPath, progressPath,
        message: event.event === 'complete' && event.serviceUnavailable ? 'Model service interrupted; saved descriptions are retained.' : 'Backfill in progress; completion has not been verified.',
        ...(event.gardens ? { gardens: event.gardens } : {}),
      }, null, 2));
      fs.renameSync(temporary, statusPath);
    }
    console.log(JSON.stringify(record));
  };
  progress({ event: 'configuration', model: state.defaultModel, contentPath: root, gardens, reportPath });
  const result = await backfillGardenVisualDescriptions({ contentPath: root, gardens,
    client: new OpenAI({ baseURL, apiKey: 'local', maxRetries: 0 }), model: state.defaultModel,
    batchSize: Number(argument('batch-size')) || 6, concurrency: Number(argument('concurrency')) || 3,
    signal: controller.signal, onProgress: progress });
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  if (result.gardens.some(row => row.pending || row.unavailable)) process.exitCode = 1;
} else if (!configuredRoot || (!garden && !all) || (garden && all) ||
    (apply && (!model || !process.env.OPENAI_BASE_URL || !process.env.OPENAI_API_KEY))) {
  console.error('Usage: node --experimental-strip-types scripts/backfill-garden-visual-descriptions.mjs --content-path <root> (--garden <slug> | --all) [--apply --model <model>]. Apply requires OPENAI_BASE_URL and OPENAI_API_KEY.');
  process.exitCode = 2;
} else {
  const root = fs.realpathSync(configuredRoot);
  const gardens = garden ? [garden] : fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')).map(entry => entry.name);
  const client = apply ? createChatmockClient() : null;
  let serviceUnavailable = false;
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  for (const slug of gardens) {
    const directory = path.resolve(root, slug);
    if (!directory.startsWith(root + path.sep) || !fs.realpathSync(directory).startsWith(root + path.sep)) throw new Error('Garden must stay within the specified content root.');
    const totals = { garden: slug, pages: 0, images: 0, described: 0, pending: 0, unavailable: 0 };
    const seen = new Set();
    for (const entry of await gardenReadEntries(root, slug, undefined, { includeIndexes: true })) {
      controller.signal.throwIfAborted();
      const { node } = await readGardenPage(root, slug, entry.relPath);
      if (!node || node.internal === 'true' || node.draft === 'true') continue;
      if (apply && !serviceUnavailable) {
        const result = await enrichGardenSourceVisuals({ contentPath: root, gardenSlug: slug, sourceRelPath: entry.relPath,
          client, model, signal: controller.signal, onProgress: message => console.error(`${slug}: ${message}`) });
        if (result.warnings.length) console.error(result.warnings.join(' '));
        serviceUnavailable = result.serviceUnavailable;
      }
      let offset = 0;
      do {
        const batch = await gardenSourceFigures(root, slug, node, { includePageSnapshots: true, limit: 50, offset });
        for (const figure of batch.figures) {
          if (!figure.imagePath || seen.has(figure.imagePath)) continue;
          seen.add(figure.imagePath);
          totals.images++;
          if (figure.availability !== 'available') totals.unavailable++;
          else if (['vision', 'visual_detection'].includes(figure.descriptionSource)) totals.described++;
          else totals.pending++;
        }
        if (batch.nextOffset === null) break;
        offset = batch.nextOffset;
      } while (true);
      totals.pages++;
    }
    console.log(JSON.stringify(totals));
    if (apply && (totals.pending || totals.unavailable)) process.exitCode = 1;
  }
}
