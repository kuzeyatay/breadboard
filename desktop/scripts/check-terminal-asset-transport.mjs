// Usage: node scripts/check-terminal-asset-transport.mjs <CDP endpoint> <dashboard origin>
// Reads the current app session into memory for an isolated hidden test window.
// Never reloads the user's tabs or writes cookies/credentials to a report.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [endpoint, origin] = process.argv.slice(2);
if (!endpoint || !origin) throw new Error('Expected CDP endpoint and dashboard origin');
const pages = await fetch(endpoint + '/json/list').then(r => r.json());
const page = pages.find(p => p.url.startsWith(origin + '/new-tab')) ?? pages.find(p => p.url.startsWith(origin + '/'));
if (!page) throw new Error('No existing dashboard page found');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
const cookies = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Cookie read timed out')), 5_000);
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timer);
    if (message.error) reject(new Error('Cookie read failed'));
    else resolve(message.result.cookies);
  });
  ws.send(JSON.stringify({ id: 1, method: 'Network.getCookies', params: { urls: [origin + '/new-tab'] } }));
}).finally(() => ws.close());
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-terminal-assets-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_TEST_CONTEXT;
const pipeName = process.platform === 'win32' ? '\\\\.\\pipe\\bb-terminal-' + randomUUID() : path.join(directory, 'config.sock');
const configServer = net.createServer(socket => { socket.end(JSON.stringify({ origin, cookies })); configServer.close(); });
await new Promise(resolve => configServer.listen(pipeName, resolve));
const child = spawn(require('electron'), [path.resolve('tests/fixtures/app-assets-terminal.cjs'), pipeName, directory],
  { env, windowsHide: true, stdio: 'ignore' });
try {
  const began = Date.now();
  while (!fs.existsSync(path.join(directory, 'passed.json'))) {
    if (child.exitCode !== null) throw new Error('Isolated Electron exited before completion');
    if (Date.now() - began > 40_000) {
      for (const name of ['progress.json', 'result.json']) {
        if (fs.existsSync(path.join(directory, name))) console.log(fs.readFileSync(path.join(directory, name), 'utf8'));
      }
      throw new Error('Isolated Terminal check timed out');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const result = JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'));
  console.log(JSON.stringify(result));
  fs.writeFileSync('../qa/terminal-home-asset-transport-20260930.json', JSON.stringify(result, null, 2));
} finally {
  configServer.close();
  if (process.platform === 'win32') {
    await new Promise(resolve => spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).once('exit', resolve));
  } else child.kill();
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected test directory');
  await new Promise(resolve => setTimeout(resolve, 400));
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
