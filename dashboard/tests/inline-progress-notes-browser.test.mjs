import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
const stylesheet = path.join(root, 'src/app/globals.css');

// The real InlineProgressNotes, driven the way the transcript drives it: a
// streaming draft drawn as the newest dot, then sealed into a note under the
// same key, then a steer that Bread has not answered yet.
test('live notes type in, keep their place when sealed, pulse, and show a dot for an unanswered steer', {timeout: 90_000}, async t => {
  const css = (await postcss([tailwindcss({base: root})]).process(readFileSync(stylesheet, 'utf8'), {from: stylesheet})).css;
  const bundle = await build({bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: {'@': path.join(root, 'src')}, logLevel: 'silent', stdin: {resolveDir: root, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import InlineProgressNotes from '@/app/components/hermes/inline-progress-notes';
    function App(){
      const [state,setState]=useState({timeline:[],waiting:false});
      window.show=(timeline,waiting=false)=>setState({timeline,waiting});
      return <main style={{maxWidth:640,margin:'40px auto'}}>
        {state.timeline.length||state.waiting?<InlineProgressNotes timeline={state.timeline} live waiting={state.waiting}/>:null}
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);`}});
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://localhost:53167/**', (route) => route.fulfill({contentType: 'text/html', body: '<!doctype html><html data-theme="light"><body><div id="root"></div></body></html>'}));
  await page.goto('http://localhost:53167/');
  await page.addStyleTag({content: css});
  await page.addScriptTag({content: bundle.outputFiles[0].text});

  const sentence = "I've read the course page; the grade isn't listed yet, so I'm checking the Results tab next.";
  const notes = page.locator('[data-progress-note]');

  // The streaming draft is a dot from its first characters, never a message.
  await page.evaluate((text) => window.show([{kind: 'note', key: 'note-0', text}]), sentence.slice(0, 12));
  await expect(notes).toHaveCount(1);
  // The rest arrives at once (a sealed note); it types in rather than appearing whole.
  await page.evaluate((text) => window.show([{kind: 'note', key: 'note-0', text}]), sentence);
  const partial = await notes.first().innerText();
  assert.ok(partial.length < sentence.length, `typed, not pasted: "${partial}"`);
  await expect(notes.first()).toHaveText(sentence, {timeout: 5000});

  // The newest dot pulses; earlier dots do not.
  await page.evaluate((text) => window.show([
    {kind: 'note', key: 'note-0', text},
    {kind: 'note', key: 'note-1', text: 'Found it: 7.4.'},
  ]), sentence);
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(1).locator('span[aria-hidden]')).toHaveClass(/animate-pulse/);
  await expect(notes.nth(0).locator('span[aria-hidden]')).not.toHaveClass(/animate-pulse/);
  await expect(notes.nth(0)).toHaveText(sentence, {timeout: 1000});

  // A steer Bread has not answered yet: a pulsing dot right away, and the last note stops pulsing.
  await page.evaluate((text) => window.show([
    {kind: 'note', key: 'note-0', text},
    {kind: 'note', key: 'note-1', text: 'Found it: 7.4.'},
    {kind: 'correction', correction: {id: 's1', content: 'also check Q2', offset: 0}},
  ], true), sentence);
  const waiting = page.locator('[data-progress-waiting]');
  await expect(waiting).toBeVisible();
  await expect(waiting).toHaveText('Reading your message');
  await expect(waiting.locator('span[aria-hidden]')).toHaveClass(/animate-pulse/);
  await expect(notes.nth(1).locator('span[aria-hidden]')).not.toHaveClass(/animate-pulse/);
  assert.deepEqual(errors, []);
});

test('a held-back answer types in as a normal message; other answers show whole', {timeout: 90_000}, async t => {
  const css = (await postcss([tailwindcss({base: root})]).process(readFileSync(stylesheet, 'utf8'), {from: stylesheet})).css;
  const bundle = await build({bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: {'@': path.join(root, 'src')}, logLevel: 'silent', stdin: {resolveDir: root, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {holdAnswer,TypeInAnswer} from '@/app/components/hermes/inline-progress-notes';
    function App(){
      const [answers,setAnswers]=useState([]);
      window.hold=holdAnswer;
      window.finish=(id,text)=>setAnswers(current=>[...current,{id,text}]);
      return <main>{answers.map(a=><TypeInAnswer key={a.id} id={a.id} content={a.text}>{text=><p data-answer={a.id}>{text}</p>}</TypeInAnswer>)}</main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);`}});
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://localhost:53168/**', (route) => route.fulfill({contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>'}));
  await page.goto('http://localhost:53168/');
  await page.addStyleTag({content: css});
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  const answer = 'The grade for Final exam Q1 is 7.4, published this morning on Ans.';

  // Held during the turn (it might have been a note): types in when it appears.
  await page.evaluate((text) => { window.hold('c1'); window.finish('c1', text); }, answer);
  const held = page.locator('[data-answer="c1"]');
  const partial = await held.innerText();
  assert.ok(partial.length < answer.length, `typed, not pasted: "${partial}"`);
  await expect(held).toHaveText(answer, {timeout: 5000});

  // Never held (an earlier message, a reload): shown whole at once.
  await page.evaluate((text) => window.finish('c2', text), answer);
  assert.equal(await page.locator('[data-answer="c2"]').innerText(), answer);
});

test('Garden turns: a steer sits among the live notes with a reading dot, then above the finished turn', {timeout: 90_000}, async t => {
  const css = (await postcss([tailwindcss({base: root})]).process(readFileSync(stylesheet, 'utf8'), {from: stylesheet})).css;
  const bundle = await build({bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: {'@': path.join(root, 'src')}, logLevel: 'silent', stdin: {resolveDir: root, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {IntermediateTurn} from '@/app/components/hermes/inline-progress-notes';
    function App(){
      const [state,setState]=useState({live:true,notes:['I jumped to the update too quickly.'],corrections:[]});
      window.set=(next)=>setState(current=>({...current,...next}));
      return <main style={{maxWidth:640,margin:'40px auto'}}>
        <IntermediateTurn live={state.live} notes={state.notes} answer={state.live?'':'Final answer.'} corrections={state.corrections}
          renderPanel={()=> <div data-panel>Thinking</div>}/>
        {state.live?null:<p data-answer>Final answer.</p>}
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);`}});
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
  t.after(() => browser.close());
  const page = await browser.newPage();
  // The preference request fails here, which keeps the default: on.
  await page.route('http://localhost:53169/**', (route) => route.request().url().endsWith('/')
    ? route.fulfill({contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>'})
    : route.fulfill({status: 404, body: ''}));
  await page.goto('http://localhost:53169/');
  await page.addStyleTag({content: css});
  await page.addScriptTag({content: bundle.outputFiles[0].text});

  const steer = {id: 'steer:1', content: 'give one clear connected example', offset: 0, noteIndex: 1};
  await page.evaluate((correction) => window.set({corrections: [correction]}), steer);
  const progress = page.locator('[data-inline-progress]');
  // Order: the note, then the steer bubble, then the pulsing reading dot.
  await expect(progress).toContainText('I jumped to the update too quickly.');
  await expect(progress).toContainText(steer.content);
  await expect(page.locator('[data-progress-waiting]')).toContainText('Reading your message');
  const order = await progress.evaluate((el) => el.innerText.indexOf('I jumped') < el.innerText.indexOf('give one') &&
    el.innerText.indexOf('give one') < el.innerText.indexOf('Reading your message'));
  assert.ok(order, 'note, steer, reading dot');

  // Bread answers the steer with a new note: the reading dot goes away.
  await page.evaluate(() => window.set({notes: ['I jumped to the update too quickly.', 'Starting again from the OR gate.']}));
  await expect(page.locator('[data-progress-waiting]')).toHaveCount(0);

  // The turn ends: the steer sits above the Thinking row, no inline notes.
  await page.evaluate(() => window.set({live: false}));
  await expect(page.locator('[data-inline-progress]')).toHaveCount(0);
  await expect(page.locator('[data-turn-corrections]')).toContainText(steer.content);
  const above = await page.evaluate(() => {
    const bubble = document.querySelector('[data-turn-corrections]');
    const panel = document.querySelector('[data-panel]');
    return Boolean(bubble.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.ok(above, 'the steer is above the Thinking row');
});
