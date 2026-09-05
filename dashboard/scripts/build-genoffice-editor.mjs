import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(dashboardRoot, 'src', 'genoffice-static')
const outputRoot = path.join(dashboardRoot, 'public', 'genoffice-editor')

const result = await build({
  absWorkingDir: dashboardRoot,
  entryPoints: { app: path.join(sourceRoot, 'main.tsx') },
  outdir: outputRoot,
  write: false,
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

async function writeChangedFile(filePath, contents) {
  const bytes = Buffer.from(contents)
  try {
    // Windows can keep fonts memory-mapped while Breadboard is open. Identical
    // build assets need no write, and must not block a development restart.
    if ((await readFile(filePath)).equals(bytes)) return
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, bytes)
}

for (const output of result.outputFiles) {
  await writeChangedFile(output.path, output.contents)
}
await writeChangedFile(path.join(outputRoot, 'index.html'), await readFile(path.join(sourceRoot, 'index.html')))
