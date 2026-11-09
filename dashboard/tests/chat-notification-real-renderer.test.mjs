import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const root = path.basename(process.cwd()) === 'dashboard' ? process.cwd() : path.resolve('dashboard');
const require = createRequire(path.join(root, 'package.json'));
const esbuild = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { chromium } = require('playwright');

const fixture = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { createPortal, flushSync } from 'react-dom';
  import AgentRuntimePanel from './src/app/components/hermes/agent-runtime-panel';
  import { useChatNotificationView } from './src/lib/use-chat-notification-view';
  import { isChatNotificationRecordViewed } from './src/lib/chat-notification-inbox';
  import { useToast, Toaster } from './src/app/components/toast';

  const target = { surface: 'dashboard_terminal', chatId: 'conv_fixed_dock' };
  const answer = 'It looks like a **parallel-plate capacitor connected to a voltage source**. '
    + 'The left plate has negative charges. The electric field points from the right plate toward the left plate.';
  window.inbox = [];
  window.flashes = [];
  window.seen = [];
  window.fetch = async (url, options) => {
    if (String(url).includes('/api/chat-notifications')) {
      const body = options?.body ? JSON.parse(options.body) : null;
      if (body) {
        window.seen.push(body);
        return Response.json({ ok: true, acknowledged: body.viewed?.messageKeys ?? [] });
      }
      return Response.json({ messages: window.inbox, unread: [] });
    }
    return Response.json({ settings: {}, models: [], sessions: [], messages: [], artifacts: [], success: true });
  };

  function App() {
    const [key, setKey] = useState('initial');
    const [input, setInput] = useState('');
    useChatNotificationView(target);
    const { toasts, refreshNotifications, dismissToast } = useToast({ desktopOverlay: true });
    window.shown = toasts.map(toast => toast.notificationId);
    window.flashes.push(...window.shown);
    window.show = key => {
      flushSync(() => setKey(key));
      window.record = {
        id: key, target, title: 'Response ready', type: 'success', response: answer,
        chatTitle: 'What does this look like?', updatedAt: new Date().toISOString(),
        messageKeys: ['client:' + key],
      };

    };
    window.poll = () => { window.inbox = [window.record]; return refreshNotifications(); };
    window.viewed = () => isChatNotificationRecordViewed(window.record);
    return <>
      <AgentRuntimePanel
        sessionId={target.chatId} createdSessionId={target.chatId}
        messages={[
          { role: 'user', id: 'user:' + key, clientMessageId: key, content: 'What does this look like?' },
          { role: 'assistant', id: 'answer:' + key, clientMessageId: key, content: answer },
        ]}
        activities={[]} connection="idle" runState="idle" input={input}
        onInputChange={setInput} onSubmit={() => {}} onAbort={() => {}}
        pendingPermission={null} onPermissionDecision={() => {}} error={null} steerError={null}
        model="test" models={[]} onModelChange={() => {}}
        reasoningEffort="medium" onReasoningEffortChange={() => {}}
      />
      {createPortal(
        <Toaster toasts={toasts} onDismiss={dismissToast} mode="desktop-overlay" />,
        document.getElementById('notification-preview'),
      )}
    </>;
  }
  createRoot(document.getElementById('dock')).render(<App />);
`;

// Service-bound widgets are irrelevant to visibility. Keep the real transcript,
// notification presence, inbox consumer, toast and their CSS in this fixture.
function leafModule(modulePath) {
  if (modulePath === 'next/navigation') {
    return 'export const useRouter = () => ({ push() {}, replace() {}, refresh() {} });'
      + 'export const usePathname = () => "/"; export const useSearchParams = () => new URLSearchParams();';
  }
  if (modulePath === 'next/dynamic') return 'export default function dynamic() { return () => null; }';
  if (modulePath.endsWith('command-hub')) return 'export const CommandHub = () => null;';
  if (modulePath.endsWith('inline-artifact-cards')) {
    return 'export const primeInlineArtifacts = async () => [];'
      + 'export const useInlineArtifactPrefetch = () => true;'
      + 'export const useInlineArtifactScope = () => null; export const useInlineArtifactViewer = () => null;'
      + 'export const useRegisterInlineArtifact = () => {};'
      + 'export const InlineArtifactCardsProvider = ({ children }) => children;'
      + 'export default function Cards() { return null; }';
  }
  if (modulePath.endsWith('inline-proposal-cards')) {
    return 'export const InlineProposalCardsProvider = ({ children }) => children;'
      + 'export default function Cards() { return null; }';
  }
  return 'export default function Leaf() { return null; }';
}

test('the real chat suppresses a visible answer through unrelated overflow ancestors', { timeout: 60_000 }, async t => {
  const bundle = await esbuild.build({
    stdin: { resolveDir: root, loader: 'tsx', contents: fixture },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: 'app.js',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    plugins: [{
      name: 'fixture',
      setup(builder) {
        if (process.env.VISIBILITY_CANDIDATE) {
          builder.onResolve({ filter: /chat-notification-visibility(?:\.ts)?$/ }, () => ({
            path: path.resolve(process.env.VISIBILITY_CANDIDATE),
          }));
        }
        builder.onResolve({
          filter: /^(next\/dynamic|next\/navigation)$|\/(settings-dialog|voice-conversation-overlay|speech-dictation-button|slash-command-menu|command-hub)$|^\.\/(inline-[^/.]+|generative-ui-renderer)$/,
        }, args => ({ path: args.path, namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: modulePath }) => ({
          loader: 'tsx', resolveDir: root, contents: leafModule(modulePath),
        }));
      },
    }],
  });
  const cssPath = path.join(root, 'src/app/globals.css');
  const cssInput = fs.readFileSync(cssPath, 'utf8').replace(
    '@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";',
    ['assistant-composer.tsx', 'chat-text-selection-ui.tsx', 'hermes/agent-runtime-panel.tsx',
      'toast.tsx', 'notification-reply-composer.tsx']
      .map(file => '@source "./components/' + file + '";').join('\n'),
  );
  const css = (await postcss([tailwind({ base: root })]).process(cssInput, { from: cssPath })).css;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(req.url === '/app.js' ? bundle.outputFiles.find(file => file.path.endsWith('.js')).text : `
      <!doctype html><style>
        ${css}
        body { margin: 0; background: var(--paper-bg); }
        #position-root { position: relative; height: 100vh; }
        #stage { height: 40px; overflow: hidden; }
        #dock { position: fixed; inset: 80px 80px 32px; display: flex; }
        #notification-preview { position: fixed; right: 0; bottom: 0; z-index: 10000; pointer-events: none; }
      </style>
      <div id="position-root"><div id="stage"><div id="dock"></div></div></div>
      <div id="notification-preview"></div><script src="/app.js"></script>
    `);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({
    headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1569, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(8_000);
  await page.addInitScript(() => {
    let state = { selfId: 1, activeId: 1, visibleIds: [1], windowFocused: true, enabled: true, tabs: [], extensions: [] };
    const listeners = new Set();
    window.breadboardDesktop = {
      getTabsState: async () => state,
      onTabsState: callback => { listeners.add(callback); return () => listeners.delete(callback); },
      tabs: async () => true,
    };
    window.setFocus = value => {
      state = { ...state, windowFocused: value };
      for (const callback of listeners) callback(state);
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.show);
  await page.evaluate(() => window.show('fixed-visible'));
  await page.locator('[data-chat-selectable-message]').waitFor();
  const actual = await page.locator('[data-chat-selectable-message]').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      hit: element.contains(hit),
      stageHeight: document.getElementById('stage').getBoundingClientRect().height,
      answerTop: rect.top,
    };
  });
  assert.equal(actual.hit, true, 'browser paints the real answer outside the unrelated overflow ancestor');
  assert.ok(actual.answerTop > actual.stageHeight);
  if (process.env.CAPTURE_VISIBILITY_BASELINE) {
    assert.equal(await page.evaluate(() => window.viewed()), false);
    await page.evaluate(() => window.poll());
    await page.waitForFunction(() => window.shown.includes('fixed-visible'));
    await page.locator('.bb-toast-card strong').waitFor();
    await page.locator('.bb-toast-card').evaluate(async card => {
      await Promise.all(card.getAnimations().map(animation => animation.finished));
    });
    await page.screenshot({ path: path.resolve(root, '../.tmp/notification-candidate/baseline-visible-duplicate.png') });
    return;
  }
  assert.equal(await page.evaluate(() => window.viewed()), true, JSON.stringify(actual));
  await page.evaluate(() => window.poll());
  assert.equal(await page.evaluate(() => window.flashes.includes('fixed-visible')), false);
  if (process.env.VISIBILITY_CANDIDATE) {
    await page.screenshot({ path: path.resolve(root, '../.tmp/notification-candidate/candidate-visible-suppressed.png') });
  }

  await page.evaluate(() => {
    document.getElementById('stage').style.transform = 'translateZ(0)';
    window.show('actually-clipped');
  });
  assert.equal(await page.evaluate(() => window.viewed()), false, 'a transformed containing block really clips the dock');
  await page.evaluate(() => window.poll());
  await page.waitForFunction(() => window.shown.includes('actually-clipped'));

  await page.evaluate(() => {
    document.getElementById('stage').style.transform = '';
    document.getElementById('dock').style.position = 'absolute';
    window.show('absolute-visible');
  });
  // The real transcript virtualizes rows and measures them on the next frame.
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-chat-selectable-message]');
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  });
  assert.equal(await page.evaluate(() => window.viewed()), true, 'absolute panels escape ancestors before their containing block');
  await page.evaluate(() => window.poll());
  assert.equal(await page.evaluate(() => window.flashes.includes('absolute-visible')), false);

  await page.evaluate(() => {
    document.getElementById('stage').style.position = 'relative';
    window.show('absolute-clipped');
  });
  assert.equal(await page.evaluate(() => window.viewed()), false, 'a positioned containing block really clips an absolute panel');
  await page.evaluate(() => window.poll());
  await page.waitForFunction(() => window.shown.includes('absolute-clipped'));

  await page.evaluate(() => {
    document.getElementById('stage').style.position = '';
    document.getElementById('dock').style.position = 'fixed';
    window.show('unfocused');
    window.setFocus(false);
  });
  assert.equal(await page.evaluate(() => window.viewed()), false);
  await page.evaluate(() => window.poll());
  await page.waitForFunction(() => window.shown.includes('unfocused'));

  await page.evaluate(() => { window.setFocus(true); window.show('visible-again'); });
  // Restoring the fixed dock invalidates the real virtualizer's measurements.
  // Require painted text before asserting how a visible answer is classified.
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-chat-selectable-message]');
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  });
  assert.equal(await page.evaluate(() => window.viewed()), true);
  await page.evaluate(() => window.poll());
  assert.equal(await page.evaluate(() => window.flashes.includes('visible-again')), false);
  assert.deepEqual(errors, []);
});
