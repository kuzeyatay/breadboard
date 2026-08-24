import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(dashboardRoot, 'src', 'genoffice-static')
const outputRoot = path.join(dashboardRoot, 'public', 'genoffice-editor')

await build({
  absWorkingDir: dashboardRoot,
  entryPoints: { app: path.join(sourceRoot, 'main.tsx') },
  outdir: outputRoot,
  bundle: true,
  minify: true,
  sourcemap: false,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  tsconfig: path.join(dashboardRoot, 'tsconfig.json'),
  entryNames: '[name]',
  assetNames: 'assets/[name]-[hash]',
  loader: {
    '.png': 'file',
    '.jpg': 'file',
    '.jpeg': 'file',
    '.gif': 'file',
    '.svg': 'file',
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
})

await mkdir(outputRoot, { recursive: true })
await copyFile(path.join(sourceRoot, 'index.html'), path.join(outputRoot, 'index.html'))
