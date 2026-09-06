import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const license = await readFile(path.join(root, 'src/lib/speech/clap/upstream/LICENSE.txt'), 'utf8');
await build({ entryPoints: [path.join(root, 'src/lib/speech/clap/worklet.ts')],
  outfile: path.join(root, 'public/audio/clap-controls.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2020',
  banner: { js: `/* Clap controls — adapted from Tzur Soffer, revision 4464865ba69dbe96462ccc678fb3c75b5515f647.\n${license}\n*/` } });
