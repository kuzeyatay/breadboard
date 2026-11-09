import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { chromium } from 'playwright';
import { notificationHistoryItem } from '../src/lib/notification-history.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

test('notification replies respond immediately, recover failed drafts and answer questions in place', { timeout: 90_000 }, async t => {
  const bundle = await esbuild.build({
    stdin: { loader: 'tsx', resolveDir: root, contents: `
      import React,{useState} from 'react';import{createRoot}from'react-dom/client';
      import{Toaster,useToast}from'./src/app/components/toast';
      import NotificationCenter from './src/app/components/notification-center';
      const mode=new URLSearchParams(location.search).get('mode');
      window.routes=[];window.sizes=[];
      function App(){
        const feed=useToast({desktopOverlay:mode==='desktop',notificationCenter:mode==='center'});
        const[open,setOpen]=useState(true);window.refresh=feed.refreshNotifications;
        return mode==='center'?<NotificationCenter notifications={feed.centerNotifications} status={feed.inboxStatus}
          onRefresh={feed.refreshNotifications} onDismiss={feed.dismissCenterNotification} onRead={feed.readCenterNotification}
          onClear={feed.clearCenterNotifications} onOpenChat={()=>false} open={open} onOpenChange={setOpen}/>
          :<Toaster toasts={feed.toasts} onDismiss={feed.dismissToast} mode={mode==='desktop'?'desktop-overlay':'page'}
            onSizeChange={(width,height)=>window.sizes.push({width,height})}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: 'fixture.js', platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'fixture', setup(build) {
      build.onResolve({ filter: /^(next\/navigation|next\/dynamic|\.\/navigation-progress|@\/lib\/notification-sound)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: root, contents: args.path === 'next/dynamic'
        // Like next/dynamic: load the real component, render nothing until it arrives.
        ? "import{lazy,createElement,Suspense}from'react';export default load=>{const L=lazy(()=>load().then(m=>({default:m.default??m})));return props=>createElement(Suspense,{fallback:null},createElement(L,props));};"
        : 'export const useRouter=()=>({push:href=>window.routes.push(href)});export const startNavigationProgress=()=>{};export const chimeForNotifications=()=>()=>{};export const getNotificationSoundEnabled=()=>false;export const setNotificationSoundEnabled=()=>{};export const subscribeNotificationSound=()=>()=>{};export const notificationDeliveryReceipts=()=>new Set();export const recordNotificationDelivery=()=>{};' }));
    } }],
  });
  const cssInput = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8')
    .replace('@source "../**/*.{js,mjs,cjs,ts,tsx,jsx,mdx}";', '@source "./components/toast.tsx"; @source "./components/notification-reply-composer.tsx"; @source "./components/effects/*.tsx";');
  const css = (await postcss([tailwindcss({ base: root })]).process(cssInput, { from: path.join(root, 'src/app/globals.css') })).css;
  const makeQuestion = (choices = ['This year (Recommended)', 'Last year']) => ({
    id: 'question_1', kind: 'chat_question', title: 'Answer needed', type: 'success',
    response: 'Which period should I research?\n\n• This year (Recommended)\n\n• Last year', chatTitle: 'Research plan',
    target: { surface: 'garden_chat', chatId: '42', gardenSlug: 'signals', conversationId: 'conv_garden' },
    updatedAt: new Date().toISOString(),
    clarification: { sessionId: 3, requestId: 'request/1', question: 'Which period should I research?', choices },
  });
  let record = makeQuestion(), pending = true, answered = false, failAnswer = false, deliveryGate = null;
  const replies = [], dismissals = [];
  const holdDelivery = () => {
    let release;
    deliveryGate = new Promise(resolve => { release = resolve; });
    return () => { release(); deliveryGate = null; };
  };
  const waitFor = async (check, message) => {
    for (let i = 0; i < 500; i++) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail(message);
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).text); return; }
    if (req.url === '/app.css') { res.setHeader('Content-Type', 'text/css'); res.end(css + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text); return; }
    if (req.url.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST') {
        let text = ''; for await (const chunk of req) text += chunk;
        const body = JSON.parse(text);
        if (req.url.startsWith('/api/hermes/clarifications/') || req.url === '/api/chat-notifications/reply') {
          replies.push({ url: req.url, ...body });
          if (deliveryGate) await deliveryGate;
          await new Promise(resolve => setTimeout(resolve, 150));
          if (failAnswer) { res.statusCode = 503; res.end(JSON.stringify({ error: 'Could not reach the AI. Try again.' })); return; }
          answered = true; pending = false; res.end('{"ok":true,"persisted":true,"accepted":true}'); return;
        }
        if (body.dismiss) dismissals.push(...body.dismiss);
        if (body.dismiss || body.readHistory) pending = false;
        res.end('{"ok":true}'); return;
      }
      res.end(JSON.stringify({ messages: pending ? [record] : [], history: [notificationHistoryItem({ ...record, clarification: answered ? undefined : record.clarification }, !pending)] })); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="en"><head><link rel="stylesheet" href="/app.css"></head><body style="background:var(--paper)"><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  const output = path.join(root, '.tmp-notification-question-qa'); fs.mkdirSync(output, { recursive: true });
  const form = page.getByRole('form', { name: 'Answer this question' });
  const send = page.getByRole('button', { name: 'Send answer', exact: true });

  await page.goto(url);
  await form.waitFor();
  await page.getByRole('heading', { name: record.chatTitle, exact: true }).waitFor();
  assert.equal(await page.getByText('Answer needed', { exact: true }).count(), 0);
  assert.equal(await send.isDisabled(), true, 'no automatic answer is selected');
  await page.getByRole('radio', { name: 'Last year', exact: true }).check();
  assert.equal(replies.length, 0, 'selection requires an explicit send');
  await page.screenshot({ path: path.join(output, 'page-options.png') });
  const releaseQuestion = holdDelivery();
  await send.click();
  await form.waitFor({ state: 'hidden', timeout: 1000 });
  await waitFor(() => replies.length === 1, 'question delivery started');
  assert.equal(answered, false, 'question closes before the server responds');
  assert.equal(dismissals.length, 0, 'pending replies must not be dismissed on the server');
  await page.evaluate(() => window.refresh());
  assert.equal(await form.count(), 0, 'inbox polling cannot reopen a pending reply');
  releaseQuestion();
  await waitFor(() => dismissals.length === 1, 'accepted question was dismissed');
  assert.deepEqual(replies, [{ url: '/api/hermes/clarifications/request%2F1', sessionId: 3, answer: 'Last year' }]);
  assert.deepEqual(await page.evaluate(() => window.routes), []);

  pending = true; answered = false; failAnswer = true;
  await page.goto(`${url}/?mode=desktop`);
  await form.waitFor();
  await page.getByRole('radio', { name: 'This year (Recommended)', exact: true }).check();
  const input = page.getByRole('textbox', { name: 'Or write your own answer' });
  await input.fill('The last five years');
  assert.equal(await page.getByRole('radio', { name: 'This year (Recommended)', exact: true }).isChecked(), false);
  await input.press('Shift+Enter');
  await input.press('Enter');
  await form.getByRole('alert').waitFor();
  assert.equal(await input.inputValue(), 'The last five years\n');
  assert.equal(replies.at(-1).answer, 'The last five years');
  failAnswer = false;
  await page.setViewportSize({ width: 390, height: 640 });
  await page.screenshot({ path: path.join(output, 'desktop-retry-narrow.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(await page.evaluate(() => window.sizes.some(size => size.width > 0 && size.height > 0)));
  await send.click();
  await form.waitFor({ state: 'hidden' });
  await waitFor(() => dismissals.length === 2, 'retried question was dismissed');
  assert.equal(replies.length, 3, 'failure and retry each send exactly once');
  assert.deepEqual(await page.evaluate(() => window.routes), []);

  record = makeQuestion([]); pending = false; answered = false;
  record.clarification.question = 'Consider these research constraints. '.repeat(15) + 'Which sources should I prioritize?';
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto(`${url}/?mode=center`);
  await form.waitFor();
  await page.getByText(record.clarification.question, { exact: true }).waitFor();
  assert.equal(await page.getByRole('radio').count(), 0);
  const freeText = page.getByRole('textbox', { name: 'Write your answer', exact: true });
  await freeText.fill('Focus on recent work');
  await freeText.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal(replies.length, 3, 'IME confirmation must not send an answer');
  await page.screenshot({ path: path.join(output, 'center-free-text.png') });
  assert.equal(await page.locator('button input, button textarea, button button').count(), 0);
  await freeText.press('Enter');
  await form.waitFor({ state: 'hidden' });
  await page.getByText('Sending answer…', { exact: true }).waitFor();
  await waitFor(() => answered, 'history answer was accepted');
  assert.equal(replies.at(-1).answer, 'Focus on recent work');
  assert.deepEqual(await page.evaluate(() => window.routes), []);
  await page.reload();
  await page.getByRole('heading', { name: 'Research plan' }).waitFor();
  assert.equal(await form.count(), 0, 'answered history cannot submit again');

  record = makeQuestion(Array.from({ length: 15 }, (_, i) => `Research period ${i + 1}: include publications and supporting evidence`));
  pending = true; answered = false;
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto(`${url}/?mode=desktop`);
  await form.waitFor();
  await page.getByRole('radio').last().check();
  await send.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'desktop-many-options.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await send.click();
  await form.waitFor({ state: 'hidden' });
  await waitFor(() => dismissals.length === 3, 'long question was dismissed');
  assert.equal(replies.at(-1).answer, record.clarification.choices.at(-1));

  // Reproduce the failed-response card and hold delivery open: UI feedback must
  // not depend on runtime startup or on the original notice surviving a poll.
  record = { ...makeQuestion(), id: 'response_1', kind: 'chat_response', title: 'Response failed', type: 'error',
    chatTitle: 'CAD mounting bracket',
    response: 'No valid solid was produced. The last build failed: The model did not finish within 120000 ms and its process tree was terminated.',
    clarification: undefined };
  pending = true; answered = false;
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto(`${url}/?mode=desktop`);
  const replyForm = page.getByRole('form', { name: 'Reply to this chat' });
  const replyInput = replyForm.getByRole('textbox', { name: 'Reply to this chat' });
  const replySend = replyForm.getByRole('button', { name: 'Send', exact: true });
  await replyForm.waitFor();
  await page.getByLabel('AI response', { exact: true }).getByText(record.response, { exact: true }).waitFor();
  await page.getByRole('heading', { name: record.chatTitle, exact: true }).waitFor();
  assert.equal(await page.getByText('Response failed', { exact: true }).count(), 0);
  assert.equal(await replySend.isDisabled(), true);
  await replyForm.locator('.bb-metal-send').waitFor();
  await page.locator('.bb-toast-card').screenshot({ path: path.join(output, 'response-light.png') });
  const draft = '  Try a simpler solid.\nKeep the mounting holes.\n';
  await replyInput.fill(draft);
  await replyInput.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal(replies.length, 5, 'IME confirmation must not submit a chat reply');
  const releaseFailure = holdDelivery();
  const replyCount = replies.length;
  await replyForm.evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await replyForm.waitFor({ state: 'hidden', timeout: 1000 });
  await waitFor(() => replies.length > replyCount, 'chat reply delivery started');
  assert.equal(replies.length, replyCount + 1, 'repeated submits send exactly once');
  assert.equal(answered, false, 'reply closes while delivery is still pending');
  assert.deepEqual(await page.evaluate(() => window.sizes.at(-1)), { width: 0, height: 0 }, 'desktop releases the notification hit area immediately');
  assert.equal(dismissals.length, 3);
  await page.evaluate(() => window.refresh());
  assert.equal(await replyForm.count(), 0);
  pending = false;
  await page.evaluate(() => window.refresh());
  failAnswer = true;
  releaseFailure();
  await replyForm.getByRole('alert').waitFor();
  await page.getByRole('heading', { name: record.chatTitle, exact: true }).waitFor();
  await replyForm.locator('.bb-metal-send').waitFor();
  assert.equal(await replyInput.inputValue(), draft, 'failed reply restores the full draft after the inbox removes its notice');
  assert.equal(replies.at(-1).message, draft.trim());
  assert.deepEqual(replies.at(-1).target, record.target);
  assert.equal(dismissals.length, 3, 'failed replies remain undismissed');

  await page.setViewportSize({ width: 390, height: 500 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await replyInput.focus();
  await page.locator('.bb-toast-card').screenshot({ path: path.join(output, 'response-dark-narrow.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const geometry = await replyForm.evaluate(form => {
    const composer = form.querySelector('textarea').parentElement;
    const input = form.querySelector('textarea').getBoundingClientRect();
    const button = form.querySelector('button').getBoundingClientRect();
    const box = composer.getBoundingClientRect();
    return { noOverlap: input.right < button.left, contained: button.right < box.right && button.bottom < box.bottom,
      noOuterShadow: getComputedStyle(composer).boxShadow === 'none' || getComputedStyle(composer).boxShadow.includes('inset') };
  });
  assert.deepEqual(geometry, { noOverlap: true, contained: true, noOuterShadow: true });
  failAnswer = false;
  const releaseRetry = holdDelivery();
  await replySend.click();
  await replyForm.waitFor({ state: 'hidden', timeout: 1000 });
  await waitFor(() => replies.length === replyCount + 2, 'retry started');
  releaseRetry();
  await waitFor(() => dismissals.length === 4, 'accepted reply was dismissed');
  assert.equal(await replyForm.count(), 0);
  assert.deepEqual(await page.evaluate(() => window.routes), [], 'replying never navigates away');
  assert.deepEqual(errors, []);
});
