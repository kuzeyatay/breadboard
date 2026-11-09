const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const { createCipheriv } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow, ipcMain, session, webContents, dialog } = require('electron');
process.on('uncaughtException', error => { console.error(error.stack || error); app.exit(1); });
const repo = process.env.BREADBOARD_HLS_TEST_REPO || path.resolve(__dirname, '../../..');
const build = process.env.BREADBOARD_HLS_TEST_BUILD || path.resolve(__dirname, '../../dist');
const ui = process.env.BREADBOARD_HLS_TEST_UI || path.join(repo, 'dashboard/src/app/browser');
const { TabManager, BROWSER_SESSION_PARTITION } = require(path.join(build, 'main/tab-manager.js'));
const { BrowserDownloads } = require(path.join(build, 'main/browser-downloads.js'));
const { DownloadSettings } = require(path.join(build, 'main/download-settings.js'));
const { IPC_CHANNELS, isTabsCommand, isBrowserDownloadCommand } = require(path.join(build, 'shared/ipc-contract.js'));
const [dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('Renderer:', message); });
});
const until = async (probe, label) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await probe(); if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out: ${label}`);
};
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

app.whenReady().then(async () => {
  // Generate actual playable transport-stream segments, entirely offline.
  const ffmpeg = path.join(repo, 'desktop/resources/bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const ffprobe = path.join(repo, 'desktop/resources/bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-g', '10', '-c:a', 'aac', '-hls_time', '1', '-hls_playlist_type', 'vod', path.join(dir, 'fixture.m3u8')],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(generated.status, 0, generated.stderr);
  const fragmented = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path.join(dir, 'fixture.m3u8'),
    '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_flags', 'single_file', path.join(dir, 'fragmented.m3u8')],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(fragmented.status, 0, fragmented.stderr);
  const fragmentedBytes = fs.readFileSync(path.join(dir, 'fragmented.m4s'));
  const fragmentedPlaylist = fs.readFileSync(path.join(dir, 'fragmented.m3u8'), 'utf8');
  const segments = [0, 1].map(index => fs.readFileSync(path.join(dir, `fixture${index}.ts`)));
  const key = Buffer.alloc(16, 42);
  const encrypted = segments.map((bytes, index) => {
    const iv = Buffer.alloc(16); iv.writeBigUInt64BE(BigInt(index + 7), 8);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([cipher.update(bytes), cipher.final()]);
  });
  const dashboard = path.join(repo, 'dashboard');
  const requireDashboard = createRequire(path.join(dashboard, 'package.json'));
  const bundle = requireDashboard('esbuild').buildSync({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import Extensions from ${JSON.stringify(path.join(ui, 'browser-extensions-popover.tsx'))};
      import Downloads from ${JSON.stringify(path.join(ui, 'browser-downloads-popover.tsx'))};
      import DownloadButton from ${JSON.stringify(path.join(ui, 'browser-downloads-button.tsx'))};
      import { useDesktopTabs } from '@/app/components/use-desktop-tabs';
      function Chrome() { const state = useDesktopTabs(); const tab = state?.tabs.find(t => t.id === state.activeId);
        return <div style={{display:'flex',justifyContent:'flex-end',padding:40}}>Browser toolbar<DownloadButton active={Boolean(tab?.browser)} open={tab?.browser?.downloadsOpen ?? false}/></div>; }
      createRoot(document.getElementById('root')).render(location.pathname.includes('extensions-popover') ? <Extensions/> : location.pathname.includes('downloads-popover') ? <Downloads/> : <Chrome/>);`,
      resolveDir: dashboard, loader: 'tsx' },
    alias: { '@': path.join(dashboard, 'src') }, nodePaths: [path.join(dashboard, 'node_modules')],
    bundle: true, write: false, outdir: 'out', format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles;
  const shellServer = http.createServer((req, res) => {
    if (req.url === '/app.js' || req.url === '/app.css') {
      const ext = req.url.endsWith('css') ? '.css' : '.js';
      res.setHeader('Content-Type', ext === '.css' ? 'text/css' : 'text/javascript');
      return res.end(bundle.find(file => file.path.endsWith(ext)).text);
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  let retries = 0, authenticated = 0, slowRequested = false, rangeRequests = 0;
  const mediaServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/watch' || url.pathname === '/other') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Native HLS fixture</title><h1>Video page</h1>');
    }
    if (!req.headers.cookie?.includes('media=allowed') || req.headers.authorization !== 'Bearer fixture' || !req.headers.referer?.endsWith('/watch')) {
      res.writeHead(403); return res.end('Access denied');
    }
    authenticated++;
    if (url.pathname === '/fragmented.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); return res.end(fragmentedPlaylist);
    }
    if (url.pathname === '/fragmented.m4s') {
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      if (!range) { res.writeHead(400); return res.end('Range required'); }
      const start = Number(range[1]), end = Number(range[2]); rangeRequests++;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fragmentedBytes.length}` });
      return res.end(fragmentedBytes.subarray(start, end + 1));
    }
    if (url.pathname === '/redirect.m3u8') { res.writeHead(302, { location: '/media/master' }); return res.end(); }
    if (url.pathname === '/media/master') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200\nvideo.m3u8');
    }
    if (url.pathname === '/media/low.m3u8') { res.writeHead(500); return res.end('Wrong quality'); }
    if (['/media/video.m3u8', '/slow.m3u8', '/bad.m3u8'].includes(url.pathname)) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      const second = url.pathname === '/slow.m3u8' ? '/slow.ts' : url.pathname === '/bad.m3u8' ? '/denied.ts' : '/1.ts';
      return res.end(`#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-KEY:METHOD=AES-128,URI="/key"\n#EXTINF:1,\n/0.ts\n#EXTINF:1,\n${second}\n#EXT-X-ENDLIST`);
    }
    if (url.pathname === '/key') return res.end(key);
    if (url.pathname === '/0.ts' || url.pathname === '/1.ts') {
      if (url.pathname === '/1.ts' && retries++ === 0) { res.writeHead(503); return res.end('Try again'); }
      return res.end(encrypted[url.pathname === '/0.ts' ? 0 : 1]);
    }
    if (url.pathname === '/slow.ts') { slowRequested = true; res.write(encrypted[1].subarray(0, 8)); return; }
    res.writeHead(403); res.end('Denied');
  });
  const origin = await listen(shellServer), web = await listen(mediaServer);
  const downloads = new BrowserDownloads(path.join(dir, 'history'), { openPath: async () => '', showItemInFolder: () => {} });
  const settings = new DownloadSettings(path.join(dir, 'settings'), path.join(dir, 'saved'));
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
  await browserSession.cookies.set({ url: web, name: 'media', value: 'allowed', httpOnly: true });
  const loading = path.join(dir, 'loading.html'); fs.writeFileSync(loading, '<!doctype html><body>Loading</body>');
  const preload = path.join(build, 'preload/preload.js');
  const manager = new TabManager({ allowed: { origins: new Set([origin]) }, preloadPath: preload,
    loadingHtmlPath: () => loading, recoveryHtmlPath: () => loading, theme: () => 'dark', openWindow: () => {},
    browserDownloads: downloads, downloadSettings: settings, browserExtensionsConfigDir: path.join(dir, 'settings') });
  manager.setEnabled(true); manager.setBrowserUrl(origin + '/browser');
  const window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: { preload, contextIsolation: true, sandbox: true } });
  manager.attach(window);
  ipcMain.handle(IPC_CHANNELS.getTabsState, event => manager.stateFor(event.sender));
  ipcMain.handle(IPC_CHANNELS.tabsCommand, (event, command) => isTabsCommand(command) && manager.handleCommand(event.sender, command));
  ipcMain.handle(IPC_CHANNELS.getBrowserDownloads, () => downloads.snapshot());
  ipcMain.handle(IPC_CHANNELS.browserDownloadCommand, (_event, command) => isBrowserDownloadCommand(command) && downloads.command(command));
  await window.loadURL(origin + '/dashboard');
  window.setOpacity(0); window.showInactive();
  await manager.handleCommand(window.webContents, { type: 'browser', url: web + '/watch' });
  const chrome = await until(() => webContents.getAllWebContents().find(c => c.getURL() === origin + '/browser' && !c.isLoading()), 'browser toolbar');
  const page = await until(() => webContents.getAllWebContents().find(c => c.getURL() === web + '/watch' && !c.isLoading()), 'media page');
  await until(() => !manager.stateFor(chrome).navigationPending, 'navigation settles');
  const streams = () => manager.stateFor(chrome).tabs.find(tab => tab.id === manager.stateFor(chrome).activeId).browser.hls.streams;
  const detect = async url => {
    await page.executeJavaScript(`fetch(${JSON.stringify(web + url)}, {headers:{Authorization:'Bearer fixture'}}).then(r=>r.text())`);
    return until(() => streams().find(stream => stream.label === (url.includes('redirect') ? 'master' : url.slice(1))), `detect ${url}`);
  };
  const stream = await detect('/redirect.m3u8');
  assert.equal(JSON.stringify(streams()).includes('Bearer'), false);
  assert.equal(JSON.stringify(streams()).includes('headers'), false);
  await detect('/redirect.m3u8'); assert.equal(streams().length, 1, 'deduplicate manifests');
  assert.equal(manager.handleCommand(page, { type: 'browser-hls-download', id: stream.id }), false, 'untrusted page cannot start downloads');
  assert.equal(manager.handleCommand(chrome, { type: 'browser-hls-download', id: stream.id }), false, 'only the extension popup starts downloads');
  const open = async kind => {
    await manager.handleCommand(chrome, { type: `browser-${kind}-popover`, x: 980, y: 80 });
    return until(() => webContents.getAllWebContents().find(c => c.getURL().startsWith(`${origin}/browser/${kind}-popover`) && !c.isLoading()), `${kind} popup`);
  };
  let popup = await open('extensions');
  await until(() => popup.executeJavaScript("Boolean(document.querySelector('[aria-label=\"HLS Downloader\"]'))"), 'HLS row');
  await popup.executeJavaScript("document.querySelector('[aria-label=\"HLS Downloader\"]').click()");
  await until(() => popup.executeJavaScript("Boolean(document.querySelector('[aria-label=\"Download master\"]'))"), 'stream action');
  await popup.executeJavaScript("document.querySelector('[aria-label=\"Download master\"]').click()");
  const complete = await until(() => downloads.snapshot().items.find(item => item.state === 'completed'), 'authenticated video saved');
  assert.deepEqual(fs.readFileSync(complete.savePath), Buffer.concat(segments));
  assert.ok(authenticated >= 6); assert.equal(retries, 2, 'transient server failures retry');
  const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', complete.savePath], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout).streams.map(item => item.codec_type).sort(), ['audio', 'video']);
  await until(() => popup.executeJavaScript("document.body.innerText.includes('Saved · open from Downloads')"), 'success in extensions');
  if (process.env.BREADBOARD_HLS_TEST_SCREENSHOT) fs.writeFileSync(process.env.BREADBOARD_HLS_TEST_SCREENSHOT, (await popup.capturePage()).toPNG());
  assert.equal(await manager.handleCommand(popup, { type: 'browser-hls-download', id: stream.id }), true);
  await until(() => downloads.snapshot().items.filter(item => item.state === 'completed').length === 2, 'second save');
  assert.notEqual(downloads.snapshot().items[0].savePath, complete.savePath, 'never overwrite an existing download');
  const mp4 = await detect('/fragmented.m3u8');
  await manager.handleCommand(popup, { type: 'browser-hls-download', id: mp4.id });
  const savedMp4 = await until(() => downloads.snapshot().items.find(item => item.state === 'completed' && item.filename.endsWith('.mp4')), 'fragmented MP4 saved');
  const mp4Probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', savedMp4.savePath], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert.equal(mp4Probe.status, 0, mp4Probe.stderr);
  assert.deepEqual(JSON.parse(mp4Probe.stdout).streams.map(item => item.codec_type).sort(), ['audio', 'video']);
  assert.ok(rangeRequests >= 3, 'initialization and media byte ranges fetched');
  settings.setAskWhereToSave(true);
  dialog.showSaveDialog = async () => ({ canceled: true });
  await manager.handleCommand(popup, { type: 'browser-hls-download', id: stream.id });
  assert.equal(downloads.snapshot().items[0].state, 'cancelled', 'native picker cancellation');
  settings.setAskWhereToSave(false);
  const slow = await detect('/slow.m3u8');
  await manager.handleCommand(popup, { type: 'browser-hls-download', id: slow.id });
  await until(() => slowRequested, 'second segment pending');
  const active = downloads.snapshot().items.find(item => item.active);
  assert.equal(active.progress.completed, 1); assert.equal(active.progress.total, 2);
  popup = await open('downloads');
  await until(() => popup.executeJavaScript("Boolean(document.querySelector('progress[value=\"50\"]'))"), 'segment progress in downloads');
  await popup.executeJavaScript("document.querySelector('[title=\"Cancel download\"]').click()");
  await until(() => downloads.snapshot().items.find(item => item.id === active.id).state === 'cancelled', 'download cancelled from UI');
  await until(() => !fs.readdirSync(settings.read().directory).some(name => name.endsWith('.part')), 'partial file cleanup');
  const bad = await detect('/bad.m3u8');
  popup = await open('extensions');
  await manager.handleCommand(popup, { type: 'browser-hls-download', id: bad.id });
  await until(() => downloads.snapshot().items[0].state === 'interrupted', 'failed segment is not completed');
  assert.match(downloads.snapshot().items[0].error, /403/);
  await until(() => popup.executeJavaScript("Boolean(document.querySelector('[aria-label=\"HLS Downloader\"]'))"), 'failed stream menu ready');
  await popup.executeJavaScript("document.querySelector('[aria-label=\"HLS Downloader\"]').click()");
  await until(() => popup.executeJavaScript("Array.from(document.querySelectorAll('[role=alert]')).some(node => node.textContent.includes('403'))"), 'download failure remains visible in the extensions menu');
  assert.equal(await popup.executeJavaScript("document.querySelector('[aria-label=\"Download bad.m3u8\"]').disabled"), false, 'failed stream can be retried');
  await page.loadURL(web + '/other');
  await until(() => streams().length === 0, 'navigation clears detection');
  assert.equal(await manager.handleCommand(popup, { type: 'browser-hls-download', id: stream.id }), false, 'stale IDs rejected');
  downloads.prepareForQuit();
  const restored = new BrowserDownloads(path.join(dir, 'history'), { openPath: async () => '', showItemInFolder: () => {} });
  assert.equal(restored.snapshot().items.filter(item => item.state === 'completed').length, 3);
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
}).catch(error => { console.error(error.stack || error); app.exit(1); });
