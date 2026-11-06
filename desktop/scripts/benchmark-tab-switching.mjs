// Run after `npm --prefix desktop run build`. Windows only: this test moves the
// real pointer over a foreground fixture window. Keep the desktop unobstructed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('The physical pixel probe requires Windows.');
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(desktop, '../docs/qa/tab-switching-' + new Date().toISOString().slice(0,10)));
fs.mkdirSync(output, {recursive:true});
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-tab-pixels-'));
const env = {...process.env};
const evicted = process.argv.includes('--evicted');
if (evicted) env.BB_BENCH_EVICTED = '1';
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_TEST_CONTEXT;
async function run(args) {
  const child = spawn(path.join(desktop, 'node_modules/electron/dist/electron.exe'), args, {env, stdio:'inherit', windowsHide:true});
  await new Promise((resolve,reject) => {
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`Benchmark exited ${code ?? signal}`)));
  });
}
try {
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const probe = path.join(temporary,'probe.exe');
  const compiled = spawnSync(compiler, ['/nologo','/optimize+','/target:exe',`/out:${probe}`,path.join(desktop,'tests/fixtures/tab-pixel-probe.cs')], {stdio:'inherit',windowsHide:true});
  if (compiled.error || compiled.status !== 0) throw compiled.error ?? new Error('Could not compile the native pixel probe');
  for (const mode of evicted ? ['candidate'] : ['candidate','baseline']) {
    const profile = path.join(temporary,mode);fs.mkdirSync(profile);
    const report = path.join(output,evicted ? 'evicted.json' : mode === 'baseline' ? 'legacy-comparison.json' : 'candidate.json');
    await run([path.join(desktop,'tests/fixtures/tab-switch-benchmark.cjs'),profile,mode,probe,report]);
    const result = JSON.parse(fs.readFileSync(report,'utf8'));
    console.log(JSON.stringify({mode,electron:result.electron,rows:result.rows.map(row=>({tabs:row.tabs,summary:row.summary,workingSetMiB:row.workingSetKiB/1024,idleCpuPercent:row.idleCpuPercent,unexpectedPixelSamples:row.unexpectedPixelSamples}))},null,2));
  }
} finally {
  if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('bb-tab-pixels-')) throw new Error('Unexpected temporary directory');
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
