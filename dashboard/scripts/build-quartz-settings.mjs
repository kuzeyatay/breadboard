import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(dashboard, 'src/lib/quartz-settings/handwrite.worker.ts')],
  outfile: path.join(dashboard, '../quartz/quartz/static/handwrite/worker.js'),
  bundle: true, platform: 'browser', format: 'iife', minify: true,
  alias: { jimp: path.join(dashboard, 'src/lib/quartz-settings/bitmap-adapter.cjs') },
});
console.log('[quartz] Offline Handwrite worker built.');
