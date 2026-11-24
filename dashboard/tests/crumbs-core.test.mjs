// Crumbs end to end on one machine: the Breadboard client core talks to the
// real indexer and organization store (in process), and to a local stand-in
// for the AT Protocol network that checks OAuth, PKCE and DPoP the way a real
// account server does. Each "person" is a separate local database.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import Database from 'better-sqlite3';
import { createCrumbs, passageLink } from '../src/lib/crumbs/core.ts';
import { openDatabase } from '../../crumbs/lib/db.mjs';
import { serve } from '../../crumbs/lib/http.mjs';
import { createIndexer, settings as indexerSettings } from '../../crumbs/indexer.mjs';
import { createOrgStore, settings as orgSettings } from '../../crumbs/org-store.mjs';
import { did, startFakeNetwork } from '../../crumbs/test/fake-network.mjs';

process.env.NEXTAUTH_SECRET = 'crumbs-test-secret-0123456789';
const page = 'https://example.com/article';
const passage = { kind: 'text', url: page, title: 'An article', quote: 'the exact passage', prefix: 'before ', suffix: ' after' };
const A = did(21), B = did(22), C = did(23);
let net, indexerDb, orgDb, servers = [], gateBlock = '';
const people = {};

function person(name) {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT); INSERT INTO users VALUES(1, 'local')");
  const prompts = [];
  const fetcher = (url, init) => String(url).startsWith('https://example.com/') ? Promise.resolve(new Response('<html><body><nav>menu</nav><p>The launch is planned for March. before the exact passage after.</p><script>ignored()</script></body></html>', { headers: { 'content-type': 'text/html' } })) : fetch(url, init);
  const crumbs = createCrumbs({ db, fetcher, complete: async (_user, system, prompt) => { prompts.push({ system, prompt }); return 'Supported\nThe page says the launch is planned for March.'; } });
  return (people[name] = { db, crumbs, prompts });
}
async function signIn(who, handle) {
  const { url } = await who.crumbs.startSignIn(1, { handle, origin: 'http://localhost:3000', returnTo: '/crumbs?tab=account' });
  const account = [...net.state.profiles.values()].find(profile => profile.handle === handle);
  return who.crumbs.finishSignIn(net.approve(url, account.did));
}
const comment = (who, body, target = passage, scope) => (scope ? who.crumbs.writeOrg(1, scope, { target, action: 'comment', body }) : who.crumbs.writePublic(1, { target, action: 'comment', body }));

before(async () => {
  net = await startFakeNetwork();
  net.account(A, 'alice.test'); net.account(B, 'bob.test'); net.account(C, 'carol.test');
  process.env.CRUMBS_SIGNUP_SERVER = net.origin;
  indexerDb = await openDatabase({ file: ':memory:' });
  const indexer = await createIndexer({ db: indexerDb, config: { ...indexerSettings({}), reportThreshold: 1, handleDomain: 'crumbs.test' },
    gate: async text => gateBlock && text.includes(gateBlock) ? { status: gateBlock === 'holdme' ? 'pending' : 'rejected', reason: 'test rule' } : (await import('../../crumbs/lib/moderation.mjs')).localVerdict(text) });
  orgDb = await openDatabase({ file: ':memory:' });
  const orgs = await createOrgStore({ db: orgDb, config: orgSettings({}) });
  for (const [name, handler] of [['CRUMBS_INDEXER_URL', indexer.api], ['CRUMBS_ORG_STORE_URL', orgs.api]]) {
    const server = await serve({ port: 0, host: '127.0.0.1', handler, name });
    servers.push(server);
    process.env[name] = `http://127.0.0.1:${server.address().port}`;
  }
  for (const name of ['alice', 'bob', 'carol', 'guest']) person(name);
});
after(async () => {
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  for (const who of Object.values(people)) who.db.close();
  await indexerDb.close(); await orgDb.close(); await net.close();
});

test('reading needs no account; posting does', async () => {
  const { crumbs } = people.guest;
  assert.equal(crumbs.status(1).signedIn, false);
  assert.deepEqual((await crumbs.readPublic(1, page)).threads, []);
  await assert.rejects(comment(people.guest, 'hello'), { status: 401 });
  assert.equal((await crumbs.feed(1, 'following')).empty, 'Sign in to see people you follow');
});

test('sign-in: handle prefilled, loopback redirect, PKCE and DPoP verified, account confirmed', async () => {
  const { crumbs, db } = people.alice;
  await assert.rejects(crumbs.startSignIn(1, { handle: 'not a handle', origin: 'http://localhost:3000' }), { status: 400 });
  await assert.rejects(crumbs.startSignIn(1, { handle: 'nobody.test', origin: 'http://localhost:3000' }), { status: 404 });
  const result = await signIn(people.alice, 'alice.test');
  assert.deepEqual(result, { returnTo: 'http://localhost:3000/crumbs?tab=account' });
  const par = net.state.oauth.pars.at(-1);
  assert.equal(par.login_hint, 'alice.test');
  assert.equal(par.redirect_uri, 'http://127.0.0.1:3000/api/crumbs/oauth/callback');
  assert.equal(par.scope, 'atproto transition:generic');
  const status = crumbs.status(1);
  assert.deepEqual([status.signedIn, status.did, status.handle, status.displayName], [true, A, 'alice.test', 'alice']);
  // Tokens and keys are sealed at rest.
  const row = db.prepare('SELECT secrets FROM crumbs_accounts').get();
  assert.ok(row.secrets.startsWith('v1.') && !row.secrets.includes('refresh'));
  // This device's public keys are now in the account, where other members can find them.
  const keys = [...net.state.records].filter(([uri]) => uri.startsWith(`at://${A}/com.breadboard.key/`));
  assert.equal(keys.length, 1);
  assert.equal(keys[0][1].signingKey.d, undefined, 'only public halves are published');
});

test('a sign-in link works once, and a cancelled or mismatched sign-in is reported plainly', async () => {
  const { crumbs } = people.bob;
  const { url } = await crumbs.startSignIn(1, { handle: 'bob.test', origin: 'http://localhost:3000' });
  const cancelled = new URLSearchParams({ state: net.state.oauth.pars.at(-1).state, error: 'access_denied', iss: net.origin });
  assert.equal((await crumbs.finishSignIn(cancelled)).error, 'Sign in was cancelled.');
  assert.equal((await crumbs.finishSignIn(cancelled)).error, 'That link expired. Start again.');
  // The server answering for a different account than the handle that was typed is refused.
  const second = await crumbs.startSignIn(1, { handle: 'bob.test', origin: 'http://localhost:3000' });
  assert.match((await crumbs.finishSignIn(net.approve(second.url, C))).error, /different account/);
  assert.equal(crumbs.status(1).signedIn, false);
  assert.ok(url.startsWith(`${net.origin}/oauth/authorize?client_id=`));
  assert.equal((await signIn(people.bob, 'bob.test')).error, undefined);
});

test('sign-up sends people to the create-account screen', async () => {
  const { url } = await people.guest.crumbs.startSignIn(1, { signup: true, origin: 'http://localhost:3000' });
  assert.equal(net.state.oauth.pars.at(-1).prompt, 'create');
  assert.equal(net.state.oauth.pars.at(-1).login_hint, undefined);
  assert.ok(url.includes('/oauth/authorize'));
});

test('a public crumb is a record in the author\'s own account and shows up for everyone', async () => {
  const posted = await comment(people.alice, 'First thought');
  assert.equal(posted.thread.count, 1);
  assert.deepEqual([posted.messages[0].body, posted.messages[0].own, posted.messages[0].handle], ['First thought', true, 'alice.test']);
  const [uri, record] = [...net.state.records].find(([key]) => key.startsWith(`at://${A}/com.breadboard.highlight/`));
  assert.deepEqual(record, { $type: 'com.breadboard.highlight', url: page, title: 'An article', target: { kind: 'text', quote: 'the exact passage', prefix: 'before ', suffix: ' after' }, comment: 'First thought', createdAt: record.createdAt });
  assert.equal(posted.messages[0].id, uri);

  await comment(people.bob, 'A reply');
  const seen = await people.guest.crumbs.readPublic(1, page);
  assert.equal(seen.threads[0].count, 2);
  assert.equal(seen.threads[0].preview, 'alice: First thought');
  const thread = await people.guest.crumbs.readPublic(1, page, seen.threads[0].id);
  assert.deepEqual(thread.messages.map(message => [message.author, message.own, message.avatar]), [['alice', false, 'https://cdn.test/alice.test.jpg'], ['bob', false, 'https://cdn.test/bob.test.jpg']]);
});

test('the client warns before posting, and the server gate has the last word', async () => {
  const before = net.state.records.size;
  await assert.rejects(comment(people.alice, 'you should kill yourself'), { status: 422, message: /breaks the Crumbs rules \(harassment\)/ });
  assert.equal(net.state.records.size, before, 'nothing was written');
  gateBlock = 'serverblock';
  await assert.rejects(comment(people.alice, 'passes the client, serverblock'), { status: 422, message: /held back by moderation/ });
  assert.equal(net.state.records.size, before, 'the rejected record was removed from the account again');
  gateBlock = 'holdme';
  const held = await comment(people.alice, 'holdme for review', { ...passage, quote: 'another passage' });
  assert.equal(held.notice, 'Waiting for review');
  assert.ok(!held.threads.some(thread => thread.target.quote === 'another passage'), 'not shown while pending');
  gateBlock = '';
  const pending = (await people.alice.crumbs.feed(1, 'mine')).items.find(item => item.comment === 'holdme for review');
  assert.equal(pending.state, 'pending');
  await people.alice.crumbs.deleteMine(1, pending.id);
  assert.ok(!(await people.alice.crumbs.feed(1, 'mine')).items.some(item => item.id === pending.id));
  await assert.rejects(people.bob.crumbs.deleteMine(1, pending.id), { status: 404 });
});

test('reports hide a crumb for everyone, withdrawing restores it, and nobody reports themselves', async () => {
  const thread = (await people.bob.crumbs.readPublic(1, page)).threads[0];
  const alices = (await people.bob.crumbs.readPublic(1, page, thread.id)).messages[0];
  await assert.rejects(people.alice.crumbs.writePublic(1, { target: passage, action: 'flag', messageId: alices.id, body: 'x' }), { status: 400 });
  const reported = await people.bob.crumbs.writePublic(1, { target: passage, action: 'flag', messageId: alices.id, body: 'spam' });
  assert.equal(reported.notice, 'Reported');
  assert.deepEqual(reported.messages.map(message => message.author), ['bob']);
  assert.equal((await people.alice.crumbs.feed(1, 'mine')).items.find(item => item.id === alices.id).state, 'reported');
  const restored = await people.bob.crumbs.writePublic(1, { target: passage, action: 'withdraw-flag', messageId: alices.id });
  assert.deepEqual(restored.messages.map(message => message.author), ['alice', 'bob']);
});

test('expired tokens refresh by themselves; a revoked sign-in asks to sign in again', async () => {
  for (const grant of net.state.oauth.access.values()) grant.expires = 0;
  const posted = await comment(people.bob, 'After a refresh', { ...passage, quote: 'refresh passage' });
  assert.equal(posted.messages[0].body, 'After a refresh');
  for (const grant of net.state.oauth.access.values()) if (grant.did === C) grant.expires = 0;
  await signIn(people.carol, 'carol.test');
  net.state.oauth.access.clear(); net.state.oauth.refresh.clear();
  await assert.rejects(comment(people.carol, 'hello'), { status: 401, message: /Sign in to Crumbs again/ });
  assert.deepEqual([people.carol.crumbs.status(1).signedIn, people.carol.crumbs.status(1).needsSignIn], [false, true]);
  await signIn(people.alice, 'alice.test'); await signIn(people.bob, 'bob.test'); await signIn(people.carol, 'carol.test');
  assert.equal(people.carol.crumbs.status(1).signedIn, true);
});

test('only the author can delete a crumb', async () => {
  const thread = (await people.bob.crumbs.readPublic(1, page)).threads.find(item => item.target.quote === 'refresh passage');
  const bobs = (await people.bob.crumbs.readPublic(1, page, thread.id)).messages[0];
  await assert.rejects(people.alice.crumbs.writePublic(1, { target: thread.target, action: 'delete-comment', messageId: bobs.id }), { status: 404 });
  const result = await people.bob.crumbs.writePublic(1, { target: thread.target, action: 'delete-comment', messageId: bobs.id });
  assert.ok(!result.threads.some(item => item.target.quote === 'refresh passage'));
  assert.ok(!net.state.records.has(bobs.id));
});

test('the feed: people you follow on Crumbs and on Bluesky, newest first, with a link to the passage', async () => {
  net.state.follows.set(A, [C]);
  await comment(people.carol, 'Carol on another page', { kind: 'text', url: 'https://example.com/other', title: 'Other', quote: 'a much longer passage that runs past twelve words so that the link uses a start and an end' });
  const lonely = await people.alice.crumbs.feed(1, 'following');
  assert.deepEqual(lonely.items.map(item => item.author.handle), ['carol.test', 'alice.test'], 'Bluesky follows count, and so do you');
  const following = await people.alice.crumbs.follow(1, 'bob.test', true);
  assert.deepEqual(following.crumbs.map(row => row.handle), ['bob.test']);
  assert.equal(following.bluesky, 1);
  const feed = await people.alice.crumbs.feed(1, 'following');
  assert.deepEqual(feed.items.map(item => item.comment), ['Carol on another page', 'A reply', 'First thought']);
  assert.equal(feed.items[0].url, 'https://example.com/other#:~:text=a%20much%20longer%20passage%20that,a%20start%20and%20an%20end');
  assert.equal(feed.items[2].url, 'https://example.com/article#:~:text=the%20exact%20passage');
  assert.equal(feed.items[2].threadCount, 2);
  assert.equal((await people.guest.crumbs.feed(1, 'everyone')).items.length, 3, 'everyone is readable without an account');
  assert.deepEqual((await people.alice.crumbs.follow(1, B, false)).crumbs, []);
  await assert.rejects(people.alice.crumbs.follow(1, 'alice.test', true), { status: 400 });
});

test('a Breadboard handle is reserved in the account and applied when the server allows it', async () => {
  await assert.rejects(people.alice.crumbs.claimHandle(1, 'x'), { status: 400 });
  net.state.rejectHandleUpdate = true;
  const reserved = await people.alice.crumbs.claimHandle(1, 'alice');
  assert.deepEqual([reserved.handle, reserved.applied], ['alice.crumbs.test', false]);
  assert.match(reserved.instructions, /I have my own domain/);
  await assert.rejects(people.bob.crumbs.claimHandle(1, 'alice'), { status: 409 });
  net.state.rejectHandleUpdate = false;
  assert.equal((await people.alice.crumbs.claimHandle(1, 'alice')).applied, true);
  assert.deepEqual(net.state.handleUpdates, [{ did: A, handle: 'alice.crumbs.test' }]);
  assert.equal(people.alice.crumbs.status(1).handle, 'alice.crumbs.test');
});

let orgId;
test('an organization: created, a member invited by handle, content readable only with the key', async () => {
  const org = await people.alice.crumbs.createOrg(1, 'Research lab');
  orgId = org.id;
  const detail = await people.alice.crumbs.addOrgMember(1, orgId, 'bob.test');
  assert.deepEqual(detail.members.map(member => [member.handle, member.role]), [['alice.crumbs.test', 'admin'], ['bob.test', 'member']]);
  const posted = await comment(people.alice, 'Is the March date still right?', passage, orgId);
  assert.equal(posted.messages[0].body, 'Is the March date still right?');

  assert.deepEqual(await people.bob.crumbs.listOrgs(1), [{ id: orgId, name: 'Research lab', role: 'member', ready: true }]);
  const threads = await people.bob.crumbs.readOrg(1, orgId, page);
  const read = await people.bob.crumbs.readOrg(1, orgId, page, threads.threads[0].id);
  assert.deepEqual(read.messages.map(message => [message.author, message.body, message.own, message.unverified]), [['alice', 'Is the March date still right?', false, undefined]]);
  assert.equal((await people.bob.crumbs.feed(1, `org:${orgId}`)).items[0].audience, 'Research lab');

  const stored = JSON.stringify([await orgDb.all('SELECT * FROM messages'), await orgDb.all('SELECT * FROM orgs')]);
  for (const secret of ['March', 'example.com', 'exact passage', 'Research lab']) assert.ok(!stored.includes(secret), `the store never sees "${secret}"`);
  await assert.rejects(people.carol.crumbs.readOrg(1, orgId, page), { status: 404 });
  assert.equal((await people.guest.crumbs.readPublic(1, page)).threads.length, 1, 'organization content never reaches the public index');
});

test('a forged sender is flagged: the signature is checked against the key that member published', async () => {
  const row = await orgDb.get('SELECT id, sig FROM messages');
  await orgDb.run('UPDATE messages SET sender=? WHERE id=?', [B, row.id]);
  const threads = await people.alice.crumbs.readOrg(1, orgId, page);
  assert.equal((await people.alice.crumbs.readOrg(1, orgId, page, threads.threads[0].id)).messages[0].unverified, true);
  await orgDb.run('UPDATE messages SET sender=? WHERE id=?', [A, row.id]);
});

test('a member\'s second computer receives the key from another member\'s client', async () => {
  const laptop = person('bobLaptop');
  await signIn(laptop, 'bob.test');
  assert.equal((await laptop.crumbs.listOrgs(1))[0].ready, false);
  assert.match((await laptop.crumbs.readOrg(1, orgId, page)).notice, /Waiting for a member/);
  await people.alice.crumbs.orgDetail(1, orgId); // Any member opening Crumbs hands the key over.
  assert.deepEqual(await laptop.crumbs.listOrgs(1), [{ id: orgId, name: 'Research lab', role: 'member', ready: true }]);
  assert.equal((await laptop.crumbs.readOrg(1, orgId, page)).threads[0].count, 1);
});

test('members report to admins, and admins can delete any message', async () => {
  const mine = await comment(people.bob, 'Something unkind', passage, orgId);
  const bobs = mine.messages.find(message => message.own);
  const alices = mine.messages.find(message => !message.own);
  await assert.rejects(people.bob.crumbs.writeOrg(1, orgId, { target: passage, action: 'delete-comment', messageId: alices.id }), { status: 404 });
  const reported = await people.bob.crumbs.writeOrg(1, orgId, { target: passage, action: 'flag', messageId: alices.id, body: 'Please look at this' });
  assert.match(reported.notice, /admins/);
  assert.deepEqual(reported.flags, [], 'members do not see reports');
  const adminView = await people.alice.crumbs.readOrg(1, orgId, page, mine.thread.id);
  assert.deepEqual(adminView.flags.map(flag => [flag.author, flag.reason]), [['bob', 'Please look at this']]);
  const detail = await people.alice.crumbs.orgDetail(1, orgId);
  assert.equal(detail.reports[0].reason, 'Please look at this');
  assert.equal((await people.alice.crumbs.dismissOrgReport(1, orgId, detail.reports[0].id)).reports.length, 0);
  const after = await people.alice.crumbs.writeOrg(1, orgId, { target: passage, action: 'delete-comment', messageId: bobs.id });
  assert.deepEqual(after.messages.map(message => message.body), ['Is the March date still right?']);
});

test('removing a member replaces the key: they are locked out and cannot read what follows', async () => {
  const bobKeysBefore = people.bob.db.prepare('SELECT count(*) AS n FROM crumbs_org_keys').get().n;
  const detail = await people.alice.crumbs.removeOrgMember(1, orgId, B);
  assert.deepEqual(detail.members.map(member => member.handle), ['alice.crumbs.test']);
  await comment(people.alice, 'After Bob left', passage, orgId);
  await assert.rejects(people.bob.crumbs.readOrg(1, orgId, page), { status: 404 });
  assert.equal(people.bob.db.prepare('SELECT count(*) AS n FROM crumbs_org_keys').get().n, bobKeysBefore, 'no new key reached the removed member');
  assert.equal((await orgDb.all('SELECT 1 AS x FROM envelopes WHERE did=?', [B])).length, 0);
  // The admin still reads both the old and the new epoch on one page.
  const threads = await people.alice.crumbs.readOrg(1, orgId, page);
  assert.equal(threads.threads[0].count, 2);
});

test('someone invited before they ever opened Crumbs gets the key once they do; leaving and deleting work', async () => {
  const fresh = did(24);
  net.account(fresh, 'dana.test');
  const invited = await people.alice.crumbs.addOrgMember(1, orgId, 'dana.test', 'admin');
  assert.equal(invited.members.find(member => member.handle === 'dana.test').waitingForKey, true);
  const dana = person('dana');
  await signIn(dana, 'dana.test');
  assert.equal((await dana.crumbs.listOrgs(1))[0].ready, false, 'opening Crumbs leaves a request for the key');
  await people.alice.crumbs.orgDetail(1, orgId);
  assert.equal((await dana.crumbs.readOrg(1, orgId, page)).threads[0].count, 2);
  await people.alice.crumbs.leaveOrg(1, orgId);
  assert.deepEqual(await people.alice.crumbs.listOrgs(1), []);
  // Dana, now the only admin, opens the organization: the key is replaced because someone left.
  const epochBefore = (await orgDb.get('SELECT epoch FROM orgs WHERE id=?', [orgId])).epoch;
  await dana.crumbs.orgDetail(1, orgId);
  assert.equal(Number((await orgDb.get('SELECT epoch, needs_rotation FROM orgs WHERE id=?', [orgId])).epoch), Number(epochBefore) + 1);
  await dana.crumbs.deleteOrg(1, orgId);
  assert.equal((await orgDb.all('SELECT 1 AS x FROM messages')).length, 0);
});

test('AI: a comment is checked against the full page, and the discussion is summarised', async () => {
  const { crumbs, prompts } = people.alice;
  const check = await crumbs.ai(1, { mode: 'check', url: page, claim: 'The launch is in March', quote: 'the exact passage' });
  assert.match(check.text, /^Supported/);
  assert.match(prompts.at(-1).prompt, /The launch is planned for March\./);
  assert.ok(!prompts.at(-1).prompt.includes('ignored()') && !prompts.at(-1).prompt.includes('menu'), 'scripts and navigation are stripped');
  assert.match(prompts.at(-1).prompt, /Comment to check:\nThe launch is in March/);
  await crumbs.ai(1, { mode: 'summary', url: page, scope: 'public' });
  assert.match(prompts.at(-1).prompt, /Passage: "the exact passage"\n- alice: First thought\n- bob: A reply/);
  assert.equal((await crumbs.ai(1, { mode: 'summary', url: 'https://example.com/empty' })).text, 'Nobody has left a crumb on this page yet.');
  await assert.rejects(crumbs.ai(1, { mode: 'check', url: 'http://127.0.0.1:1/x', claim: 'x' }), { status: 400 });
});

test('AI flags: one record per person per site in their own account, counted for everyone', async () => {
  const flagged = 'https://www.slop.example/some/post?x=1';
  assert.deepEqual(await people.guest.crumbs.aiFlags(1, flagged), { site: 'slop.example', count: 0, mine: false, level: null, signedIn: false });
  await assert.rejects(people.guest.crumbs.aiFlag(1, flagged, true), { status: 401 });
  await assert.rejects(people.alice.crumbs.aiFlag(1, 'http://localhost:3000/', true), { status: 400 });
  assert.equal((await people.alice.crumbs.aiFlags(1, 'about:blank')).site, null);
  const mine = await people.alice.crumbs.aiFlag(1, flagged, true);
  assert.deepEqual(mine, { site: 'slop.example', count: 1, mine: true, level: null, signedIn: true });
  assert.ok(net.state.records.has(`at://${A}/com.breadboard.aiflag/slop.example`), 'the flag is a record in the author repo');
  await people.alice.crumbs.aiFlag(1, 'https://slop.example/other', true); // the same site again
  await people.bob.crumbs.aiFlag(1, flagged, true);
  const seen = await people.carol.crumbs.aiFlag(1, flagged, true);
  assert.deepEqual(seen, { site: 'slop.example', count: 3, mine: true, level: 'yellow', signedIn: true });
  assert.equal((await people.guest.crumbs.aiFlags(1, 'https://slop.example/')).count, 3);
  const withdrawn = await people.carol.crumbs.aiFlag(1, flagged, false);
  assert.deepEqual([withdrawn.count, withdrawn.mine, withdrawn.level], [2, false, null]);
  assert.ok(!net.state.records.has(`at://${C}/com.breadboard.aiflag/slop.example`));
});

test('signing out forgets the tokens and tells the server; settings validate', async () => {
  const { crumbs, db } = people.carol;
  crumbs.setDefaultVisibility(1, 'public');
  assert.equal(crumbs.status(1).defaultVisibility, 'public');
  assert.throws(() => crumbs.setDefaultVisibility(1, 'everyone'), { status: 400 });
  const revoked = net.state.oauth.revoked;
  await crumbs.signOut(1);
  assert.equal(net.state.oauth.revoked, revoked + 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM crumbs_accounts').get().n, 0);
  assert.equal(crumbs.status(1).signedIn, false);
  assert.throws(() => crumbs.setServers({ indexer: 'ftp://nope' }), { status: 400 });
});

test('passage links use the text-fragment syntax and leave non-text anchors alone', () => {
  assert.equal(passageLink({ kind: 'text', url: 'https://a.test/p#top', title: '', quote: 'well-known fact' }), 'https://a.test/p#top:~:text=well%2Dknown%20fact');
  assert.equal(passageLink({ kind: 'page', url: 'https://a.test/p', title: '' }), 'https://a.test/p');
});
