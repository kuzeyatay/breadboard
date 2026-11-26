// Google Drive as the carrier for organization files, against a stand-in for
// Google's OAuth and Drive endpoints. What matters: Breadboard asks only for
// drive.file, keeps the refresh token, and Drive only ever holds ciphertext.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createDrive, decryptFile, DRIVE_SCOPE, encryptFile } from '../src/lib/drive/drive-client.ts';

function fakeGoogle({ sharingBlocked = false } = {}) {
  const state = { files: new Map(), permissions: new Map(), tokens: 0, refreshes: 0, revoked: [], revokeGrant: false, deleted: [] };
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const authed = init => String(init?.headers?.authorization ?? '').startsWith('Bearer access-');
  async function fetcher(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init.body));
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'good-code' || !form.get('code_verifier')) return json(400, { error: 'invalid_grant', error_description: 'Bad code.' });
        return json(200, { access_token: `access-${++state.tokens}`, refresh_token: 'refresh-1', expires_in: 3600, scope: DRIVE_SCOPE });
      }
      if (state.revokeGrant) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      state.refreshes++;
      return json(200, { access_token: `access-${++state.tokens}`, expires_in: 3600 });
    }
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/revoke') { state.revoked.push(url.searchParams.get('token')); return new Response('', { status: 200 }); }
    if (url.origin === 'https://www.googleapis.com') {
      if (!authed(init) && !url.searchParams.get('key')) return json(401, { error: { message: 'Login required.' } });
      if (url.pathname === '/drive/v3/about') return json(200, { user: { emailAddress: 'eve@example.com' } });
      if (url.pathname === '/drive/v3/files' && method === 'GET') return json(200, { files: [] });
      if (url.pathname === '/drive/v3/files' && method === 'POST') return json(200, { id: 'folder-0000001' });
      if (url.pathname === '/upload/drive/v3/files' && method === 'POST') return new Response('', { status: 200, headers: { location: 'https://upload.test/session-1' } });
      const permission = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(url.pathname);
      if (permission) {
        if (sharingBlocked) return json(403, { error: { message: 'Sharing is restricted by your administrator.', errors: [{ reason: 'cannotShareTeamDriveWithNonGoogleAccounts' }] } });
        state.permissions.set(permission[1], JSON.parse(String(init.body)));
        return json(200, { id: 'anyone' });
      }
      const file = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (file && method === 'DELETE') { state.files.delete(file[1]); state.deleted.push(file[1]); return new Response(null, { status: 204 }); }
    }
    if (url.href === 'https://upload.test/session-1' && method === 'PUT') {
      const id = `file-${state.files.size + 1}-abcdefgh`;
      state.files.set(id, Buffer.from(init.body));
      return json(200, { id });
    }
    if (url.origin === 'https://drive.usercontent.google.com') {
      const bytes = state.files.get(url.searchParams.get('id'));
      if (!bytes || !state.permissions.has(url.searchParams.get('id'))) return new Response('<html>Sign in</html>', { status: bytes ? 200 : 404, headers: { 'content-type': 'text/html' } });
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    }
    return json(404, { error: { message: `unexpected ${method} ${url.href}` } });
  }
  return { state, fetcher };
}

const config = { clientId: 'client.apps.googleusercontent.com', clientSecret: 'desktop-secret', apiKey: null };

async function connected(google) {
  const db = new Database(':memory:');
  const drive = createDrive({ db, config, fetcher: google.fetcher });
  const url = new URL(drive.authUrl(1, 'http://localhost:3000'));
  await drive.finish(new URLSearchParams({ state: url.searchParams.get('state'), code: 'good-code' }));
  return { db, drive };
}

test('consent asks only for drive.file, with PKCE, returning to this machine', () => {
  const drive = createDrive({ db: new Database(':memory:'), config, fetcher: fakeGoogle().fetcher });
  const url = new URL(drive.authUrl(1, 'http://localhost:3000'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), DRIVE_SCOPE);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/drive/oauth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.throws(() => drive.authUrl(1, 'https://breadboard.example.com'), { code: 'drive_loopback' }, 'only from the app on this computer');
  const unset = createDrive({ db: new Database(':memory:'), config: { clientId: null, clientSecret: null, apiKey: null } });
  assert.deepEqual(unset.status(1), { configured: false, connected: false, email: null });
  assert.throws(() => unset.authUrl(1, 'http://localhost:3000'), { code: 'drive_not_configured' });
});

test('the callback is good once, for the account that started it', async () => {
  const google = fakeGoogle();
  const db = new Database(':memory:');
  const drive = createDrive({ db, config, fetcher: google.fetcher });
  await assert.rejects(drive.finish(new URLSearchParams({ state: 'made-up', code: 'good-code' })), { code: 'drive_state' });
  const state = new URL(drive.authUrl(7, 'http://127.0.0.1:3000')).searchParams.get('state');
  assert.deepEqual(await drive.finish(new URLSearchParams({ state, code: 'good-code' })), { userId: 7, email: 'eve@example.com' });
  assert.deepEqual(drive.status(7), { configured: true, connected: true, email: 'eve@example.com' });
  await assert.rejects(drive.finish(new URLSearchParams({ state, code: 'good-code' })), { code: 'drive_state' }, 'used up');
  const denied = new URL(drive.authUrl(8, 'http://127.0.0.1:3000')).searchParams.get('state');
  await assert.rejects(drive.finish(new URLSearchParams({ state: denied, error: 'access_denied' })), { code: 'drive_denied' });
  assert.equal(drive.status(8).connected, false);
});

test('a shared file is encrypted before upload, link-shared, and opens for anyone with its key', async () => {
  const google = fakeGoogle();
  const { drive } = await connected(google);
  const plain = Buffer.from('The quarterly plan, with figures.');
  const ref = await drive.uploadEncrypted(1, plain, 'plan.txt');
  assert.deepEqual([ref.name, ref.size], ['plan.txt', plain.length]);
  const stored = google.state.files.get(ref.drive);
  assert.ok(stored && !stored.includes(plain), 'Drive holds ciphertext only');
  assert.deepEqual(google.state.permissions.get(ref.drive), { role: 'reader', type: 'anyone' });
  // A reader on another machine needs no Google account of their own.
  const reader = createDrive({ db: new Database(':memory:'), config, fetcher: google.fetcher });
  assert.deepEqual(await reader.downloadDecrypted(ref), plain);
  await assert.rejects(reader.downloadDecrypted({ ...ref, key: encryptFile(Buffer.from('x')).key }), { code: 'drive_file_tampered' }, 'the wrong key opens nothing');
  google.state.files.delete(ref.drive);
  await assert.rejects(reader.downloadDecrypted(ref), { code: 'drive_gone' });
});

test('the access token is refreshed when it expires, and a revoked grant disconnects', async () => {
  const google = fakeGoogle();
  const { db, drive } = await connected(google);
  db.prepare('UPDATE drive_accounts SET expires_at=0').run();
  await drive.uploadEncrypted(1, Buffer.from('a'), 'a.txt');
  assert.equal(google.state.refreshes, 1);
  db.prepare('UPDATE drive_accounts SET expires_at=0').run();
  google.state.revokeGrant = true;
  await assert.rejects(drive.uploadEncrypted(1, Buffer.from('b'), 'b.txt'), { code: 'drive_required' });
  assert.equal(drive.status(1).connected, false, 'revoked from the Google account page');
});

test('an account that forbids link sharing is told so, and the upload is removed', async () => {
  const google = fakeGoogle({ sharingBlocked: true });
  const { drive } = await connected(google);
  await assert.rejects(drive.uploadEncrypted(1, Buffer.from('secret'), 's.txt'), { code: 'drive_sharing_blocked' });
  assert.equal(google.state.files.size, 0);
  assert.equal(google.state.deleted.length, 1);
});

test('disconnecting forgets and revokes the access', async () => {
  const google = fakeGoogle();
  const { drive } = await connected(google);
  await drive.disconnect(1);
  assert.deepEqual(google.state.revoked, ['refresh-1']);
  assert.equal(drive.status(1).connected, false);
});

test('file encryption round-trips and detects tampering', () => {
  const { ciphertext, key } = encryptFile(Buffer.from('hello'));
  assert.deepEqual(decryptFile(ciphertext, key), Buffer.from('hello'));
  ciphertext[14] ^= 1;
  assert.throws(() => decryptFile(ciphertext, key), { code: 'drive_file_tampered' });
});
