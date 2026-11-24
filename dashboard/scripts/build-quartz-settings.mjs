import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(dashboard, '../quartz/quartz/static/handwrite/worker.js');
const { outputFiles } = await build({
  entryPoints: [path.join(dashboard, 'src/lib/quartz-settings/handwrite.worker.ts')],
  outfile, write: false,
  bundle: true, platform: 'browser', format: 'iife', minify: true,
  alias: { jimp: path.join(dashboard, 'src/lib/quartz-settings/bitmap-adapter.cjs') },
});
// A scanner or indexer can briefly map the old file ("user-mapped section open"); retry instead of failing the rebuild.
for (let attempt = 1; ; attempt++) {
  try { await fs.writeFile(outfile, outputFiles[0].contents); break; }
  catch (error) {
    if (attempt >= 20) throw error;
    await new Promise(resolve => setTimeout(resolve, 250 * attempt));
  }
}
console.log('[quartz] Offline Handwrite worker built.');
