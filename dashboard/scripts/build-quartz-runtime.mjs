import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '../..');
const quartzRoot = path.join(root, 'quartz');
const require = createRequire(path.join(quartzRoot, 'package.json'));
const { build } = require('esbuild');
const { sassPlugin } = require('esbuild-sass-plugin');
const { compileInlineScript } = await import('../../quartz/quartz/cli/handlers.js');
const output = path.join(root, 'dashboard/public/quartz-runtime');
const bundle = path.join(quartzRoot, `.quartz-cache/runtime-resources-${process.pid}.mjs`);
const previousDirectory = process.cwd();
try {
  process.chdir(quartzRoot);
  // Emit exactly the same shared assets as a publication, without parsing,
  // copying or rebuilding any Garden content. App updates must also update
  // retained publications, even when a background publication is deferred.
  await build({
    stdin: { contents: `import cfg from './quartz.config';
      import { ComponentResources } from './quartz/plugins/emitters/componentResources';
      export async function emit(output) {
        const ctx = { cfg, buildId: 'runtime-assets', allFiles: [], allSlugs: [], incremental: false,
          argv: { output, directory: '', serve: false, watch: false, verbose: false } };
        for await (const file of ComponentResources().emit(ctx, [], {css: [], js: []})) {}
      }`, resolveDir: quartzRoot, loader: 'ts' },
    outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    jsx: 'automatic', jsxImportSource: 'preact',
    plugins: [sassPlugin({ type: 'css-text', cssImports: true }), {
      name: 'quartz-inline-scripts', setup(builder) {
        builder.onLoad({ filter: /\.inline\.(ts|js)$/ }, async args => ({
          contents: await compileInlineScript(args.path), loader: 'text',
        }));
      },
    }],
  });
  await (await import(pathToFileURL(bundle).href)).emit(output);
  console.log('[quartz] Shared reader assets built independently of Garden publication.');
} finally {
  process.chdir(previousDirectory);
  await fs.rm(bundle, { force: true });
}
