const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, session, safeStorage } = require('electron');
const { restoreBrowserSession, flushBrowserSession, BROWSER_SESSION_COOKIES_FILE } = require('../../dist/main/browser-session-persistence.js');
const [phase, dir] = process.argv.slice(2);
app.setPath('userData', path.join(dir, 'profile'));
app.on('window-all-closed', () => {});
const until = async probe => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Cookie checkpoint was not updated automatically');
};
app.whenReady().then(async () => {
  if (phase === 'initialize') {
    // Electron commits a new Windows OSCrypt key to Local State during clean quit.
    // Later crash tests must start with that key on disk, like an existing profile.
    safeStorage.encryptString('fixture-initialize');
    app.quit();
    return;
  }
  const browser = session.fromPartition('persist:cookie-restart-test');
  const privateBrowser = session.fromPartition('private-cookie-restart-test');
  const file = path.join(browser.storagePath, BROWSER_SESSION_COOKIES_FILE);
  const logs = [];
  await restoreBrowserSession(browser, message => logs.push(message));
  await restoreBrowserSession(privateBrowser, message => logs.push(message));
  assert.equal(privateBrowser.storagePath, null, 'private browser has no on-disk checkpoint');
  const read = () => browser.cookies.get({});
  const decoded = () => JSON.parse(safeStorage.decryptString(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64')));
  const base = { url: 'https://login.example.test', value: 'fixture-secret-session', path: '/', secure: true, httpOnly: true, sameSite: 'lax' };
  if (phase === 'save') {
    assert.equal(safeStorage.isEncryptionAvailable(), true);
    await browser.cookies.set({ ...base, name: '__Host-login' });
    await browser.cookies.set({ ...base, name: 'shared', domain: '.example.test', path: '/account', sameSite: 'strict' });
    await browser.cookies.set({ ...base, name: 'shared', path: '/', sameSite: 'no_restriction' });
    await browser.cookies.set({ ...base, name: 'unspecified', sameSite: 'unspecified' });
    await browser.cookies.set({ ...base, name: 'remember', value: 'fixture-persistent-value', expirationDate: Date.now() / 1000 + 86400 });
    await browser.cookies.set({ ...base, name: 'expiring', expirationDate: Date.now() / 1000 + 1 });
    await browser.cookies.set({ ...base, name: 'replace-with-persistent' });
    await browser.cookies.set({ ...base, name: 'delete-me' });
    await browser.cookies.remove(base.url, 'delete-me');
    await privateBrowser.cookies.set({ ...base, name: 'private-login', value: 'fixture-private-value' });
    await session.defaultSession.cookies.set({ ...base, name: 'shell-login', value: 'fixture-shell-value' });
    // Observe the automatic checkpoint before any explicit quit/flush request.
    await until(() => fs.existsSync(file) && decoded().cookies.some(c => c.name === '__Host-login') &&
      !decoded().cookies.some(c => c.name === 'delete-me'));
    const encrypted = fs.readFileSync(file, 'utf8');
    assert.ok(!encrypted.includes(base.value));
    assert.ok(!Buffer.from(encrypted, 'base64').includes(Buffer.from(base.value)));
    assert.ok(!JSON.stringify(decoded()).includes('fixture-persistent-value'));
    assert.ok(!JSON.stringify(decoded()).includes('fixture-private-value'));
    assert.ok(!JSON.stringify(decoded()).includes('fixture-shell-value'));
    await until(async () => !(await read()).some(c => c.name === 'expiring'));
    await flushBrowserSession(browser);
    assert.ok(!decoded().cookies.some(c => c.name === 'expiring'));
  } else if (phase === 'restore') {
    const cookies = await read();
    const host = cookies.find(c => c.name === '__Host-login');
    assert.ok(host, 'session login restored after the previous process was killed');
    assert.equal(host.session, true);
    assert.equal(host.expirationDate, undefined, 'session cookies are not rewritten with artificial expiry');
    assert.equal(host.hostOnly, true);
    assert.equal(host.secure, true);
    assert.equal(host.httpOnly, true);
    assert.equal(host.sameSite, 'lax');
    assert.equal(cookies.find(c => c.name === 'remember').value, 'fixture-persistent-value');
    assert.equal(cookies.find(c => c.name === 'unspecified').sameSite, 'unspecified');
    assert.ok(!cookies.some(c => ['private-login', 'shell-login', 'delete-me', 'expiring'].includes(c.name)));
    assert.equal((await privateBrowser.cookies.get({})).length, 0);
    assert.equal((await session.defaultSession.cookies.get({})).length, 0);
    const subdomain = await browser.cookies.get({ url: 'https://child.example.test/account/details' });
    assert.deepEqual(subdomain.map(c => c.name), ['shared']);
    assert.equal(subdomain[0].hostOnly, false);
    assert.equal(subdomain[0].path, '/account');
    assert.equal(subdomain[0].sameSite, 'strict');
    assert.equal((await browser.cookies.get({ url: 'https://child.example.test/elsewhere' })).length, 0);
    assert.equal((await browser.cookies.get({ url: 'http://login.example.test/' })).length, 0);
    assert.equal(cookies.find(c => c.name === 'shared' && c.hostOnly).sameSite, 'no_restriction');
    await browser.cookies.remove(base.url, '__Host-login');
    await browser.cookies.set({ ...base, name: 'replace-with-persistent', value: 'replacement', expirationDate: Date.now() / 1000 + 86400 });
    await until(() => !decoded().cookies.some(c => ['__Host-login', 'replace-with-persistent'].includes(c.name)));
    await flushBrowserSession(browser);
  } else if (phase === 'signed-out') {
    const cookies = await read();
    assert.ok(!cookies.some(c => c.name === '__Host-login'), 'logout survives restart');
    const replacement = cookies.find(c => c.name === 'replace-with-persistent');
    assert.equal(replacement.value, 'replacement');
    assert.equal(replacement.session, false, 'old session snapshot cannot overwrite persistent replacement');
    // Reset while an automatic save is pending must leave no restorable login.
    await browser.cookies.set({ ...base, name: 'pending-before-clear' });
    await browser.clearStorageData();
    await flushBrowserSession(browser);
    assert.equal(fs.existsSync(file), false);
  } else if (phase === 'cleared') {
    assert.deepEqual(await read(), []);
    assert.equal(fs.existsSync(file), false);
    fs.writeFileSync(file, 'corrupt-checkpoint');
  } else if (phase === 'corrupt') {
    assert.deepEqual(await read(), []);
    assert.equal(fs.existsSync(file), false);
    assert.ok(logs.some(line => line.includes('could not be read')));
  }
  assert.ok(!logs.some(line => line.includes(base.value)));
  fs.writeFileSync(path.join(dir, 'passed.json'), JSON.stringify({ passed: true }));
  console.log('Session-cookie restart checks passed:', phase);
  if (phase === 'save') app.quit();
}).catch(error => { console.error(error.stack || error); app.exit(1); });
