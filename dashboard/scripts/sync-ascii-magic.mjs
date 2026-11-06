import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Usage: node scripts/sync-ascii-magic.mjs <unpacked ascii-magic-art@1.1.0>
// npm pack ascii-magic-art@1.1.0 --ignore-scripts, then extract the archive.
const root = process.env.ASCII_DASHBOARD_ROOT || path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] || path.join(root, 'node_modules/ascii-magic-art'));
const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
if (pkg.name !== 'ascii-magic-art' || pkg.version !== '1.1.0') throw new Error('Expected ascii-magic-art@1.1.0');
const output = path.join(root, 'public/ascii-magic-art');
await fs.mkdir(output, {recursive:true});
for (const name of ['pieces', 'runtime', 'lib', 'LICENSE', 'NOTICE', 'categories.json', 'package.json']) {
  await fs.cp(path.join(source, name), path.join(output, name), {recursive:true});
}
const categories = JSON.parse(await fs.readFile(path.join(source, 'categories.json'), 'utf8'));
const pieces = [];
for (const name of (await fs.readdir(path.join(source, 'pieces'))).filter(name=>name.endsWith('.js')).sort()) {
  const {meta} = await import(pathToFileURL(path.join(source, 'pieces', name)).href);
  if (!meta || meta.slug + '.js' !== name || !/^[a-z0-9-]+$/.test(meta.slug)) throw new Error('Invalid piece: ' + name);
  pieces.push({slug:meta.slug, name:meta.name, category:meta.category, note:meta.note, tags:meta.tags || []});
}
await fs.writeFile(path.join(output, 'catalog.json'), JSON.stringify({version:pkg.version, categories, pieces}));
await fs.mkdir(path.join(root,'src/lib'), {recursive:true});
await fs.writeFile(path.join(root,'src/lib/ascii-piece-slugs.json'), JSON.stringify(pieces.map(p=>p.slug)) + '\n');
await fs.writeFile(path.join(output,'BREADBOARD.md'), `# ASCII Magic\n\nVendored from ascii-magic-art@1.1.0 on npm.\nSource: https://github.com/kailashsr38/ascii-magic-art\nDocumentation: https://www.ascii-magic.com/ascii/docs\n\nThe runtime, lib and pieces directories are unmodified upstream code.\nKeep LICENSE and NOTICE with these files, including the two Unsplash scene notices.\nThe adjacent breadboard-player.js is Breadboard's integration adapter.\n\nTo update, unpack the pinned npm package and run scripts/sync-ascii-magic.mjs with its directory.\nNo network connection is needed to browse or play the installed library.\n`);
console.log(`Bundled ${pieces.length} pieces and ${categories.length} categories (${pkg.version}).`);
