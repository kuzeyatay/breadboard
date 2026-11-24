// Builds Breadboard's AFFiNE page editor into dashboard/public/affine-editor.
// Run from affine/: node node_modules/vite/bin/vite.js build --config breadboard/vite.config.mjs
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  base: '/affine-editor/',
  plugins: [wasm(), vanillaExtractPlugin()],
  esbuild: { target: 'es2022' },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: { 'react/jsx-runtime': fileURLToPath(new URL('./react-jsx-shim.js', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('../../dashboard/public/affine-editor', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      maxParallelFileOps: Math.max(1, cpus().length - 1),
      onwarn(warning, handler) { if (!['EVAL', 'SOURCEMAP_ERROR'].includes(warning.code ?? '')) handler(warning); },
    },
  },
});
