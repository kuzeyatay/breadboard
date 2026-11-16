// Crumbs in a real browser, end to end. Two people, each with their own
// Breadboard (database + client core), share the real indexer and the real
// organization store. Sign-in goes through a stand-in account server that
// checks OAuth, PKCE and DPoP like a real one and shows its own approval page.
// The panel and the Crumbs page are the real components, bundled with esbuild.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { ensureBuzzSchema } from '../src/lib/buzz/schema.ts';
import { AnnotationError, readBrowserAnnotations, writeBrowserAnnotation } from '../src/lib/browser-annotations-store.ts';
import { CrumbsError, createCrumbs } from '../src/lib/crumbs/core.ts';
import { browserAnnotationCaptureScript, browserAnnotationPaintScript } from '../../desktop/src/main/browser-annotations-dom.ts';
import { openDatabase } from '../../crumbs/lib/db.mjs';
import { serve } from '../../crumbs/lib/http.mjs';
import { createIndexer, settings as indexerSettings } from '../../crumbs/indexer.mjs';
import { createOrgStore, settings as orgSettings } from '../../crumbs/org-store.mjs';
import { did, startFakeNetwork } from '../../crumbs/test/fake-network.mjs';

process.env.NEXTAUTH_SECRET = 'crumbs-ui-test-secret-0123456789';
const PAGE = 'https://example.com/article';
const QUOTE = 'A more considered way to browse';
const ARTICLE = `<p>Field notes</p><h1>A quieter internet</h1><p>${QUOTE}. A little room to reflect, share a source, and leave a thought for the people reading alongside you. The study behind it ran for twelve weeks.</p>`;
const TOKENS = ':root{--neu-bg: var(--paper-bg); --neu-surface: var(--paper-surface); --neu-surface-raised: var(--paper-raised); --neu-surface-pressed: color-mix( in srgb, var(--paper-surface) 78%, var(--paper-bg) ); --neu-chat-user-surface: color-mix( in srgb, var(--paper-surface) 78%, var(--botanical-3) ); --neu-highlight: color-mix(in srgb, var(--paper-raised) 76%, transparent); --neu-shadow: color-mix(in srgb, var(--ink) 13%, transparent); --neu-shadow-soft: color-mix(in srgb, var(--ink) 8%, transparent); --neu-shadow-strong: color-mix(in srgb, var(--ink) 20%, transparent); --neu-border: color-mix(in srgb, var(--line-strong) 72%, var(--paper-raised)); --neu-focus: var(--botanical); --neu-radius-sm: 0.5rem; --neu-radius-md: 0.75rem; --neu-radius-lg: 1rem; --neu-duration: 160ms; --neu-easing: cubic-bezier(0.2, 0.8, 0.2, 1); --neu-raised-shadow: 5px 5px 12px var(--neu-shadow), -5px -5px 12px var(--neu-highlight), inset 1px 1px 0 color-mix(in srgb, var(--paper-raised) 68%, transparent); --neu-soft-shadow: 3px 3px 8px var(--neu-shadow-soft), -3px -3px 8px color-mix(in srgb, var(--neu-highlight) 76%, transparent); --neu-strong-shadow: 9px 10px 24px var(--neu-shadow-strong), -7px -7px 18px color-mix(in srgb, var(--neu-highlight) 86%, transparent); --neu-inset-shadow: inset 2px 2px 5px color-mix(in srgb, var(--ink) 12%, transparent), inset -2px -2px 5px color-mix(in srgb, var(--paper-raised) 74%, transparent); --neu-hover-shadow: 4px 4px 10px var(--neu-shadow), -4px -4px 10px var(--neu-highlight); --neu-divider-shadow: inset 0 1px 0 color-mix(in srgb, var(--paper-raised) 78%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--line-strong) 34%, transparent); --neu-recessed-shadow: inset 3px 3px 8px color-mix(in srgb, var(--ink) 13%, transparent), inset -3px -3px 8px color-mix(in srgb, var(--paper-raised) 76%, transparent), 0 1px 0 color-mix(in srgb, var(--paper-raised) 62%, transparent); --neu-sidebar-left-shadow: 6px 0 16px color-mix(in srgb, var(--ink) 9%, transparent), inset -1px 0 0 color-mix(in srgb, var(--paper-raised) 62%, transparent); --neu-sidebar-right-shadow: -6px 0 16px color-mix(in srgb, var(--ink) 9%, transparent), inset 1px 0 0 color-mix(in srgb, var(--paper-raised) 62%, transparent); --neu-tray-shadow: 0 -7px 20px color-mix(in srgb, var(--ink) 11%, transparent), inset 0 1px 0 color-mix(in srgb, var(--paper-raised) 72%, transparent);--breadboard-navbar-height:69px;--paper-bg:#e6f0e6;--paper:#fffefa;--paper-surface:#faf7ef;--paper-raised:#fffefb;--paper-strong:#ece3d2;--ink:#13201b;--ink-heading:#0f1a16;--ink-muted:#50615a;--line:#bccfc2;--line-strong:#9cb7a7;--botanical:#4f6f68;--botanical-hover:#3f5f58;--botanical-2:#7b97aa;--danger:#a45c5c}*{box-sizing:border-box}body{margin:0;background:var(--paper-bg);font:15px system-ui;color:var(--ink)}';
const shots = process.env.BREADBOARD_CRUMBS_SCREENSHOTS;
const shot = async (page, name) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}.png`) }); } };

test('Crumbs: sign in, public and encrypted crumbs, moderation, AI, feed and account, in a real browser', { timeout: 180000 }, async t => {
  const root = path.resolve(import.meta.dirname, '..');
  const stubLoading = { name: 'loading', setup(build) { build.onResolve({ filter: /use-page-loading$/ }, () => ({ path: 'loading', namespace: 'test' })); build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export function usePageLoading(){}' })); } };
  const bundle = entry => build({ stdin: { resolveDir: root, loader: 'tsx', contents: entry }, outfile: 'ui.js', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [stubLoading] });
  const [panel, crumbsPage, settingsPage] = await Promise.all([
    bundle(`import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import Panel from './src/app/browser/browser-organization-panel';
      function App(){const [target,setTarget]=useState(); const [open,setOpen]=useState(true);
        window.selectPassage=()=>setTarget({kind:'text',url:${JSON.stringify(PAGE)},title:'A quieter internet',quote:${JSON.stringify(QUOTE)},prefix:'',suffix:''});
        const send=async command=>{window.commands.push(command);if(command.type==='browser-organization-target')setTarget(command.target);return true;};
        return open?<Panel url={${JSON.stringify(PAGE)}} title="A quieter internet" target={target} send={send} onClose={()=>setOpen(false)}/>:<button onClick={()=>setOpen(true)}>Open Crumbs</button>;
      } window.commands=[];createRoot(document.getElementById('root')).render(<App/>);`),
    bundle(`import React from 'react'; import {createRoot} from 'react-dom/client'; import Client from './src/app/crumbs/crumbs-client';
      createRoot(document.getElementById('root')).render(<div style={{height:'100vh',display:'flex',flexDirection:'column'}}><Client initialTab={new URLSearchParams(location.search).get('tab')||'feed'}/></div>);`),
    bundle(`import React from 'react'; import {createRoot} from 'react-dom/client'; import {CrumbsAccountSection} from './src/app/crumbs/crumbs-client';
      createRoot(document.getElementById('root')).render(<main style={{maxWidth:760,margin:'40px auto',padding:24,background:'var(--paper-surface)',border:'1px solid var(--line)',borderRadius:16}}><h2 style={{margin:'0 0 16px',fontSize:14}}>Crumbs account</h2><CrumbsAccountSection onStatus={status=>{window.identity=status;}}/></main>);`),
  ]);
  const asset = (output, extension) => output.outputFiles.find(file => file.path.endsWith(extension)).text;

  // ---- The shared world: network stand-in, indexer, organization store ----
  const net = await startFakeNetwork(); t.after(() => net.close());
  const A = did(31), B = did(32);
  net.account(A, 'alice.test'); net.account(B, 'bob.test');
  process.env.CRUMBS_SIGNUP_SERVER = net.origin;
  const indexerDb = await openDatabase({ file: ':memory:' }), orgDb = await openDatabase({ file: ':memory:' });
  const indexer = await createIndexer({ db: indexerDb, config: { ...indexerSettings({}), reportThreshold: 1, noteThreshold: 1, handleDomain: 'crumbs.test' } });
  const orgStore = await createOrgStore({ db: orgDb, config: orgSettings({}) });
  for (const [name, handler] of [['CRUMBS_INDEXER_URL', indexer.api], ['CRUMBS_ORG_STORE_URL', orgStore.api]]) {
    const server = await serve({ port: 0, host: '127.0.0.1', handler, name });
    t.after(() => { server.closeAllConnections(); server.close(); });
    process.env[name] = `http://127.0.0.1:${server.address().port}`;
  }

  // ---- One Breadboard per person: the routes below mirror src/app/api/crumbs and api/browser/annotations ----
  async function breadboard() {
    const db = new Database(':memory:'); t.after(() => db.close()); db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT); CREATE TABLE organizations(id INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE organization_members(id INTEGER PRIMARY KEY,organization_id INTEGER,user_id INTEGER,role TEXT DEFAULT 'member',UNIQUE(organization_id,user_id));
      CREATE TABLE conversations(id INTEGER PRIMARY KEY,public_id TEXT,user_id INTEGER,title TEXT); INSERT INTO users VALUES(1,'local');`);
    ensureBuzzSchema(db);
    const fetcher = (url, init) => String(url).startsWith('https://example.com/') ? Promise.resolve(new Response(`<html><body>${ARTICLE}</body></html>`, { headers: { 'content-type': 'text/html' } })) : fetch(url, init);
    const crumbs = createCrumbs({ db, fetcher, complete: async (_user, system) => system.includes('summarise') ? 'Readers mostly agree the approach is calmer, though bob has a reservation about the first passage.' : 'Supported\nThe page says the study ran for twelve weeks.' });
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const send = (status, type, body) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
      const json = (value, status = 200) => send(status, 'application/json', JSON.stringify(value));
      const html = (script, body = '') => send(200, 'text/html', `<!doctype html><html><head><link rel="stylesheet" href="/${script}.css"><style>${TOKENS}#root{height:100vh}article.page{margin:150px 420px 0 90px;max-width:620px}article.page h1{font:40px/1.15 Georgia}article.page p{line-height:1.8}</style></head><body>${body}<div id="root"></div><script src="/${script}.js"></script></body></html>`);
      try {
        if (url.pathname === '/panel.js') return send(200, 'text/javascript', asset(panel, '.js'));
        if (url.pathname === '/panel.css') return send(200, 'text/css', asset(panel, '.css'));
        if (url.pathname === '/crumbs.js') return send(200, 'text/javascript', asset(crumbsPage, '.js'));
        if (url.pathname === '/crumbs.css') return send(200, 'text/css', asset(crumbsPage, '.css'));
        if (url.pathname === '/panel') return html('panel', `<article class="page">${ARTICLE}</article>`);
        if (url.pathname === '/crumbs') return html('crumbs');
        if (url.pathname === '/settings.js') return send(200, 'text/javascript', asset(settingsPage, '.js'));
        if (url.pathname === '/settings.css') return send(200, 'text/css', asset(settingsPage, '.css'));
        if (url.pathname === '/settings') return html('settings');
        if (url.pathname === '/api/buzz/rooms') return json({ organizations: [], rooms: [] });
        if (url.pathname === '/api/crumbs/oauth/callback') { const result = await crumbs.finishSignIn(url.searchParams); return send(result.error ? 400 : 200, 'text/html', `<h1>${result.error ? 'Could not sign in' : 'Signed in to Crumbs'}</h1><p>${result.error ?? ''}</p>`); }
        let body = {};
        if (req.method === 'POST') { let raw = ''; for await (const chunk of req) raw += chunk; body = JSON.parse(raw); }
        const query = url.searchParams, org = String(body.org ?? '');
        if (url.pathname === '/api/crumbs' && req.method === 'GET') {
          switch (query.get('view')) {
            case 'status': return json(crumbs.status(1));
            case 'typeahead': return json({ people: await crumbs.typeahead(query.get('q')) });
            case 'feed': return json(await crumbs.feed(1, query.get('scope') ?? 'following', query.get('before')));
            case 'follows': return json(await crumbs.follows(1));
            case 'orgs': return json({ orgs: await crumbs.listOrgs(1), local: [] });
            case 'org': return json(await crumbs.orgDetail(1, query.get('id') ?? ''));
            case 'notes': return json(await crumbs.listNotes(1, query.get('id')));
            case 'rooms': return json({ rooms: await crumbs.listRooms(1, query.get('id') ?? '') });
            case 'chat': return json(await crumbs.readChat(1, query.get('id') ?? '', query.get('room'), query.get('after')));
          }
        }
        if (url.pathname === '/api/crumbs' && req.method === 'POST') {
          switch (body.action) {
            case 'sign-in': return json(await crumbs.startSignIn(1, { handle: body.handle, signup: body.signup === true, origin: url.origin, returnTo: body.returnTo }));
            case 'sign-out': await crumbs.signOut(1); return json(crumbs.status(1));
            case 'visibility': crumbs.setDefaultVisibility(1, body.value); return json(crumbs.status(1));
            case 'servers': crumbs.setServers({ indexer: body.indexer, orgStore: body.orgStore, publicMode: body.publicMode }); return json(crumbs.status(1));
            case 'follow': return json(await crumbs.follow(1, body.who, body.on !== false));
            case 'delete': await crumbs.deleteMine(1, body.id); return json({ deleted: true });
            case 'handle': return json(await crumbs.claimHandle(1, body.name));
            case 'note-add': return json(await crumbs.addNote(1, body.id, body.body, body.source));
            case 'note-delete': return json(await crumbs.deleteNote(1, body.id, body.note));
            case 'note-rate': return json(await crumbs.rateNote(1, body.id, body.note, body.helpful));
            case 'org-create': return json(await crumbs.createOrg(1, body.name));
            case 'org-add': return json(await crumbs.addOrgMember(1, org, body.who, body.role));
            case 'org-remove': return json(await crumbs.removeOrgMember(1, org, body.did));
            case 'org-leave': await crumbs.leaveOrg(1, org); return json({ left: true });
            case 'org-delete': await crumbs.deleteOrg(1, org); return json({ deleted: true });
            case 'org-dismiss-report': return json(await crumbs.dismissOrgReport(1, org, body.report));
            case 'ai': return json(await crumbs.ai(1, body));
          }
        }
        if (url.pathname === '/api/browser/annotations') {
          const scope = req.method === 'GET' ? query.get('scope') ?? '' : String(body.scope ?? '');
          const orgScope = /^org:([a-zA-Z0-9-]{8,64})$/.exec(scope);
          if (req.method === 'GET') return json(scope === 'public' ? await crumbs.readPublic(1, query.get('url'), query.get('thread')) : orgScope ? await crumbs.readOrg(1, orgScope[1], query.get('url'), query.get('thread')) : readBrowserAnnotations(db, 1, scope, query.get('url'), query.get('thread')));
          return json(scope === 'public' ? await crumbs.writePublic(1, body) : orgScope ? await crumbs.writeOrg(1, orgScope[1], body) : writeBrowserAnnotation(db, 1, 'You', body));
        }
        json({ error: 'Not found' }, 404);
      } catch (error) {
        if (error instanceof CrumbsError || error instanceof AnnotationError) return json({ error: error.message }, error.status);
        console.error(error); json({ error: 'harness failure: ' + error.message }, 500);
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return { db, crumbs, url: `http://127.0.0.1:${server.address().port}` };
  }
  const alice = await breadboard(), bob = await breadboard();

  const browser = await chromium.launch({ headless: true, ...(process.env.BREADBOARD_BROWSER_EXECUTABLE ? { executablePath: process.env.BREADBOARD_BROWSER_EXECUTABLE } : { channel: 'msedge' }) }); t.after(() => browser.close());
  const errors = [];
  async function session(app) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: `<html><body style="font:18px/1.8 Georgia;max-width:640px;margin:120px auto">${ARTICLE}</body></html>` }));
    await context.route('https://cdn.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#7b97aa"/></svg>' }));
    context.setDefaultTimeout(8000);
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    return { context, open: async route => { const page = await context.newPage(); await page.goto(app.url + route); return page; } };
  }
  const a = await session(alice), b = await session(bob);

  async function signIn(who, prefix, handle) {
    const page = await who.open('/settings');
    await page.getByRole('heading', { name: 'Sign in to Crumbs' }).waitFor();
    await page.getByRole('combobox', { name: 'Your handle' }).fill(prefix);
    const option = page.getByRole('option', { name: new RegExp(handle.replace('.', '\\.')) });
    await option.waitFor();
    assert.equal(await option.locator('img').count(), 1, 'suggestions show the account avatar');
    await option.click();
    assert.equal(await page.getByRole('combobox', { name: 'Your handle' }).inputValue(), handle);
    const popup = who.context.waitForEvent('page');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const account = await popup;
    // The account server's own page: the password is typed here, never in Breadboard.
    await account.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    assert.ok(account.url().startsWith(net.origin + '/oauth/authorize'));
    await account.getByRole('button', { name: `Continue as ${handle}` }).click();
    await account.getByRole('heading', { name: 'Signed in to Crumbs' }).waitFor();
    await account.close();
    await page.getByRole('heading', { name: handle.split('.')[0], exact: true }).waitFor(); // The page notices by itself.
    return page;
  }

  // 1. Reading needs no account.
  const feedA = await a.open('/crumbs');
  await feedA.getByRole('heading', { name: 'No crumbs yet' }).waitFor();
  assert.equal(await feedA.getByRole('link', { name: 'Sign in' }).getAttribute('href'), '/settings#crumbs');
  const guestPanel = await a.open('/panel');
  await guestPanel.getByRole('radio', { name: 'Public' }).click();
  await guestPanel.getByText('Sign in to post publicly').waitFor();
  await shot(guestPanel, '1-panel-signed-out');
  await guestPanel.close();

  // 2. Sign in with a handle; the suggestion list shows avatars.
  await feedA.close();
  const signInPage = await a.open('/settings');
  await signInPage.getByRole('heading', { name: 'Sign in to Crumbs' }).waitFor();
  await shot(signInPage, '2-sign-in');
  await signInPage.close();
  const accountA = await signIn(a, 'ali', 'alice.test');
  assert.equal(net.state.oauth.pars.at(-1).login_hint, 'alice.test');
  await shot(accountA, '3-account');
  assert.equal(await accountA.evaluate(() => window.identity.avatar), 'https://cdn.test/alice.test.jpg', 'settings learns the photo Breadboard should show');
  const accountB = await signIn(b, 'bo', 'bob.test');

  // 3. Alice: a private note stays on her machine; a public crumb goes to her account and the index.
  const panelA = await a.open('/panel');
  await panelA.waitForFunction(() => document.querySelector('[role=radio][aria-checked=true]')?.textContent === 'Only me'); // Private is the default.
  await panelA.getByRole('textbox', { name: 'Comment', exact: true }).fill('A private thought');
  await panelA.getByRole('button', { name: 'Post comment' }).click();
  await panelA.getByText('A private thought', { exact: true }).waitFor();
  assert.equal(net.state.records.size, [...net.state.records.keys()].filter(uri => uri.includes('com.breadboard.key')).length, 'nothing but device keys left the machine');
  await panelA.getByRole('radio', { name: 'Public' }).click();
  await panelA.getByText('No crumbs here yet').waitFor();
  assert.equal(await panelA.getByText('A private thought', { exact: true }).count(), 0);
  await panelA.evaluate(() => window.selectPassage());
  await panelA.locator('aside blockquote').getByText(QUOTE).waitFor();
  await panelA.getByRole('textbox', { name: 'Comment', exact: true }).fill('The study ran for twelve weeks.');
  await panelA.getByRole('button', { name: 'Post comment' }).click();
  await panelA.getByText('The study ran for twelve weeks.', { exact: true }).waitFor();
  await panelA.locator('aside article img').first().waitFor();
  assert.equal(await panelA.locator('aside article img').count(), 1, 'network crumbs carry the author avatar');
  assert.ok([...net.state.records.keys()].some(uri => uri.startsWith(`at://${A}/com.breadboard.highlight/`)), 'the crumb is a record in her own account');
  // The client warns before posting something that breaks the rules.
  await panelA.getByRole('textbox', { name: 'Comment', exact: true }).fill('you should kill yourself');
  await panelA.getByRole('button', { name: 'Post comment' }).click();
  await panelA.getByText(/breaks the Crumbs rules \(harassment\)/).waitFor();
  await panelA.getByRole('textbox', { name: 'Comment', exact: true }).fill('');
  // The page marker: count and hover preview, painted by the desktop's own script.
  const markers = await panelA.evaluate(() => window.commands.filter(command => command.type === 'browser-organization-markers').at(-1).items);
  assert.deepEqual([markers.length, markers[0].count, markers[0].preview], [1, 1, 'alice: The study ran for twelve weeks.']);
  // In the app the website is its own document, separate from the panel.
  const site = await a.context.newPage();
  await site.goto(PAGE);
  await site.evaluate(browserAnnotationPaintScript(markers));
  assert.equal(await site.evaluate(() => CSS.highlights.get('breadboard-community').size), 1);
  const mark = await site.evaluate(quote => { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let node = walker.nextNode(); node; node = walker.nextNode()) { const index = node.textContent.indexOf(quote); if (index >= 0) { const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + quote.length); const rect = range.getBoundingClientRect(); return { x: rect.right - 2, y: rect.top - 12 }; } } }, QUOTE);
  await site.mouse.move(mark.x, mark.y);
  await shot(site, '4b-page-marker-hover');
  await site.close();
  await shot(panelA, '4-panel-public-thread');

  // 4. Bob reads it, replies, checks it against the page, asks for a summary, and reports it.
  const panelB = await b.open('/panel');
  await panelB.getByRole('radio', { name: 'Public' }).click();
  await panelB.getByRole('button', { name: /A more considered way to browse.*1 crumb/ }).click();
  await panelB.getByText('The study ran for twelve weeks.', { exact: true }).waitFor();
  await panelB.getByRole('textbox', { name: 'Comment', exact: true }).fill('I have a reservation about this.');
  await panelB.getByRole('button', { name: 'Post comment' }).click();
  await panelB.getByText('I have a reservation about this.', { exact: true }).waitFor();
  await panelB.getByLabel('Options for alice’s crumb').click();
  await panelB.getByRole('button', { name: 'Check against the page' }).click();
  await panelB.getByText('The page says the study ran for twelve weeks.').waitFor();
  await shot(panelB, '5-panel-thread-with-check');
  await panelB.getByRole('button', { name: 'This page' }).click();
  await panelB.getByRole('button', { name: 'Summarize the discussion' }).click();
  await panelB.getByText(/Readers mostly agree/).waitFor();
  await shot(panelB, '6-panel-summary');
  // Community notes: Bob adds context to Alice's crumb from the feed; it shows once a reader rates it helpful.
  const feedB = await b.open('/crumbs');
  await feedB.getByRole('tab', { name: 'Everyone' }).click();
  const alicesCrumb = feedB.locator('article').filter({ hasText: 'The study ran for twelve weeks.' });
  await alicesCrumb.getByRole('button', { name: 'Add note' }).click();
  await alicesCrumb.getByRole('textbox', { name: 'Community note' }).fill('The study had only nine participants.');
  await alicesCrumb.getByRole('textbox', { name: 'Note source' }).fill('https://example.org/study');
  await alicesCrumb.getByRole('button', { name: 'Post note' }).click();
  await alicesCrumb.getByText('Needs more ratings').waitFor();
  assert.equal(await alicesCrumb.getByText('Readers added context').count(), 0, 'a note is not shown until it is rated');
  assert.equal(await alicesCrumb.getByRole('button', { name: 'Helpful', exact: true }).count(), 0, 'nobody rates their own note');
  await feedB.close();
  const feedA2 = await a.open('/crumbs');
  await feedA2.getByRole('tab', { name: 'Everyone' }).click();
  const rated = feedA2.locator('article').filter({ hasText: 'The study ran for twelve weeks.' });
  await rated.getByRole('button', { name: '1 note' }).click();
  await rated.getByRole('button', { name: 'Helpful', exact: true }).click();
  await rated.getByText('Readers added context').waitFor();
  await shot(feedA2, '5b-feed-community-note');
  await feedA2.close();
  await panelB.reload();
  await panelB.getByRole('radio', { name: 'Public' }).click();
  await panelB.getByRole('button', { name: /A more considered way to browse.*2 crumbs/ }).click();
  await panelB.getByText('Readers added context').waitFor(); // The panel shows the note too.
  await panelB.getByLabel('Options for alice’s crumb').click();
  await panelB.getByRole('button', { name: 'Report', exact: true }).click();
  await panelB.getByRole('textbox', { name: 'Reason for reporting' }).fill('Not accurate');
  await panelB.getByRole('button', { name: 'Send report' }).click();
  await panelB.getByText('Reported', { exact: true }).waitFor();
  assert.equal(await panelB.getByText('The study ran for twelve weeks.', { exact: true }).count(), 0, 'a reported crumb is hidden');

  // 5. An encrypted organization: created, a member invited, content readable by members only.
  const orgsA = await a.open('/crumbs?tab=organizations');
  await orgsA.getByRole('textbox', { name: 'Organization name' }).fill('Research lab');
  await orgsA.getByRole('button', { name: 'Create' }).click();
  await orgsA.getByRole('heading', { name: 'Research lab' }).waitFor();
  await orgsA.getByRole('combobox', { name: 'Handle to invite' }).fill('bob.test');
  await orgsA.getByRole('button', { name: 'Add', exact: true }).click();
  await orgsA.getByText('@bob.test').waitFor();
  await shot(orgsA, '7-organization');
  await panelA.reload();
  await panelA.getByRole('radio', { name: 'Organization' }).click();
  await panelA.getByText('Encrypted for members').waitFor();
  await panelA.getByRole('textbox', { name: 'Comment', exact: true }).fill('Our launch notes are in here.');
  await panelA.getByRole('button', { name: 'Post comment' }).click();
  await panelA.getByText('Our launch notes are in here.', { exact: true }).waitFor();
  assert.ok(!JSON.stringify(await orgDb.all('SELECT * FROM messages')).includes('launch notes'), 'the store holds ciphertext only');
  await panelB.reload();
  await panelB.getByRole('radio', { name: 'Organization' }).click();
  await panelB.getByText('Our launch notes are in here.', { exact: true }).waitFor();
  assert.equal(await panelB.getByText('could not be verified').count(), 0, 'the sender signature verified');
  await panelB.getByLabel('Options for alice’s crumb').click();
  await panelB.getByRole('button', { name: 'Report to admins' }).click();
  await panelB.getByRole('textbox', { name: 'Reason for reporting' }).fill('Should this be here?');
  await panelB.getByRole('button', { name: 'Send report' }).click();
  await panelB.getByText('Sent to the admins').waitFor();
  await shot(panelB, '8-panel-organization');
  await orgsA.reload();
  await orgsA.getByText('Should this be here?').waitFor();
  await orgsA.getByRole('button', { name: 'Remove bob' }).click();
  await orgsA.getByText('@bob.test').waitFor({ state: 'hidden' });
  await panelB.reload();
  await panelB.getByRole('radio', { name: 'Organization' }).click();
  await panelB.getByText('No organizations yet').waitFor();

  // 6. The feed: follow someone, see their crumb with its passage, open the page at the passage.
  await accountA.bringToFront();
  await accountA.getByRole('combobox', { name: 'Handle to follow' }).fill('bob.test');
  await accountA.getByRole('button', { name: 'Follow', exact: true }).click();
  await accountA.getByRole('button', { name: 'Unfollow bob' }).waitFor();
  await accountA.getByRole('radio', { name: 'Public', exact: true }).click();
  await accountA.waitForFunction(() => document.querySelector('[role=radiogroup][aria-label="Default audience"] [aria-checked=true]')?.textContent === 'Public');
  const feedPage = await a.open('/crumbs');
  await feedPage.getByText('I have a reservation about this.', { exact: true }).waitFor();
  assert.equal(await feedPage.locator('article q').first().innerText(), QUOTE);
  const bobsCrumb = feedPage.locator('article').filter({ hasText: 'I have a reservation about this.' });
  await bobsCrumb.getByRole('button', { name: /^Reply,/ }).click();
  await bobsCrumb.getByRole('textbox', { name: 'Reply' }).fill('Fair point, thanks.');
  await bobsCrumb.getByRole('button', { name: 'Reply', exact: true }).click();
  await bobsCrumb.getByText('Fair point, thanks.', { exact: true }).waitFor();
  assert.ok([...net.state.records.values()].some(record => record.comment === 'Fair point, thanks.'), 'a reply is a crumb on the same passage');
  // Clicking a crumb opens it as a post with its replies; Back returns to the feed.
  await bobsCrumb.getByText('I have a reservation about this.', { exact: true }).click();
  const post = feedPage.locator('article[data-detail]');
  await post.getByText('Fair point, thanks.', { exact: true }).waitFor();
  assert.equal(await feedPage.getByRole('tab', { name: 'Everyone' }).isVisible(), false, 'the feed steps aside for the post');
  await shot(feedPage, '5c-post-view');
  await feedPage.getByRole('button', { name: 'Back' }).click();
  await feedPage.getByRole('tab', { name: 'Everyone' }).waitFor();
  assert.equal(await feedPage.getByRole('link', { name: 'alice' }).getAttribute('href'), '/settings#crumbs');
  await feedPage.waitForTimeout(400);
  await shot(feedPage, '9-feed');
  const opened = a.context.waitForEvent('page');
  await bobsCrumb.getByRole('button', { name: /A quieter internet/ }).click();
  const passage = await opened;
  assert.equal(passage.url(), 'https://example.com/article#:~:text=A%20more%20considered%20way%20to%20browse');
  await passage.close();
  await feedPage.getByRole('tab', { name: 'Mine' }).click();
  await feedPage.getByText('Hidden after reports').waitFor();
  await feedPage.getByRole('tab', { name: 'Research lab' }).click();
  await feedPage.getByText('Our launch notes are in here.', { exact: true }).waitFor();
  // The default visibility chosen above now opens the panel on Public.
  await panelA.reload();
  await panelA.getByRole('radio', { name: 'Public' }).waitFor();
  await panelA.waitForFunction(() => document.querySelector('[role=radio][aria-checked=true]')?.textContent === 'Public');

  // 7. Narrow window, closing, signing out.
  await panelA.setViewportSize({ width: 540, height: 700 });
  assert.equal(await panelA.evaluate(() => document.querySelector('aside').scrollWidth <= document.querySelector('aside').clientWidth), true);
  await panelA.getByRole('button', { name: 'Close Crumbs' }).click();
  assert.equal(await panelA.locator('aside').count(), 0);
  await accountA.bringToFront();
  await accountA.getByRole('button', { name: 'Sign out' }).click();
  await accountA.getByRole('heading', { name: 'Sign in to Crumbs' }).waitFor();
  assert.equal(alice.db.prepare('SELECT count(*) AS n FROM crumbs_accounts').get().n, 0);
  void accountB;
  assert.deepEqual(errors, []);

  // Capture actual DOM selections and media timestamps; shared paint is reversible.
  const page = await a.context.newPage();
  await page.setContent('<p id="quote">Before <b>selected words</b> after</p><img id="image" src="https://example.com/image.png"><video id="video"></video><input id="secret" value="private">');
  await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('b')); getSelection().removeAllRanges(); getSelection().addRange(range); });
  assert.equal((await page.evaluate(browserAnnotationCaptureScript(0, 0, 'none', ''))).quote, 'selected words');
  const imageTarget = await page.evaluate(browserAnnotationCaptureScript(0, 0, 'image', 'https://example.com/image.png')); assert.equal(imageTarget.selector, '#image');
  await page.evaluate(() => Object.defineProperty(document.getElementById('video'), 'currentTime', { value: 81.6 }));
  const bounds = await page.locator('video').boundingBox(); const videoTarget = await page.evaluate(browserAnnotationCaptureScript(bounds.x + 5, bounds.y + 5, 'video', '')); assert.equal(videoTarget.time, 82);
  await page.evaluate(browserAnnotationPaintScript([{ id: 'text', target: { kind: 'text', url: PAGE, title: '', quote: 'selected words' }, count: 3, preview: 'ada: a note' }]));
  assert.equal(await page.evaluate(() => CSS.highlights.get('breadboard-community').size), 1);
  await page.evaluate(browserAnnotationPaintScript([])); assert.equal(await page.locator('[data-breadboard-selection="community"]').count(), 0);
});
