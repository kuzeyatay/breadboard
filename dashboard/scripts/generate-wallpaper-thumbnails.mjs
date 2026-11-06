import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { WALLPAPERS } from '../src/lib/page-appearance.ts';

const publicDir = new URL('../public/', import.meta.url);
for (const wallpaper of WALLPAPERS) {
  const target = new URL('.' + wallpaper.previewSrc, publicDir);
  await fs.mkdir(path.dirname(fileURLToPath(target)), {recursive: true});
  const input = await fs.readFile(new URL('.' + wallpaper.src, publicDir));
  const output = await sharp(input).resize(400, 240, {fit: 'cover', withoutEnlargement: true}).webp({quality: 65}).toBuffer();
  await fs.writeFile(target, output);
  console.log(wallpaper.id + ': ' + input.length + ' → ' + output.length + ' bytes');
}
