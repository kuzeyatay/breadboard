import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'public/assistant-widgets');
await fs.mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/embeds/assistant-widgets.tsx'],
  outfile: path.join(output, 'renderer.js'),
  bundle: true, minify: true, platform: 'browser', format: 'iife', target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const cssPath = path.join(root, 'src/app/globals.css');
const bundledCss = await fs.readFile(path.join(output, 'renderer.css'), 'utf8');
const cssInput = (await fs.readFile(cssPath, 'utf8')).replace(
  '@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";',
  '@source "./components/assistant-rich-response.tsx"; @source "./components/chat*.tsx"; @source "./components/hermes/*.tsx"; @source "./components/link-context-menu.tsx";',
);
const css = (await postcss([tailwind({ base: root })]).process(cssInput, { from: cssPath })).css;
const katex = await fs.readFile(path.join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8');
await fs.cp(path.join(root, 'node_modules/katex/dist/fonts'), path.join(output, 'fonts'), { recursive: true });
await fs.writeFile(path.join(output, 'renderer.css'), css + '\n' + katex + '\n' + bundledCss + '\nhtml, body { height: auto; min-height: 0; margin: 0; background: transparent; } body { display: block; padding: 4px; } #root { min-width: 0; display: flow-root; }');
await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><title>Assistant widgets</title><link rel="stylesheet" href="renderer.css"></head><body><main id="root"></main><script src="renderer.js"></script></body></html>');
