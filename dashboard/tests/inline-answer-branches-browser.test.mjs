import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));

// Ask here keeps every question asked on a highlight and switches between the
// answers like chat branches; replying again to the same answer adds a branch
// on its whole-answer highlight instead of stacking a second one.
for (const surface of ['gardens/[clusterSlug]/workspace-client.tsx', 'components/hermes/agent-runtime-panel.tsx']) {
  test(`${surface}: Ask here answers switch like chat branches`, {timeout: 60_000}, async t => {
    const source = readFileSync(path.join(root, 'src/app', surface), 'utf8');
    assert.match(source, /attempts: \[\.\.\.attempts, previous\]/, 'earlier question/answer pairs are kept');
    assert.match(source, /newQuestionRequest=\{openAnswer\.newQuestion\}/);
    const tree = ts.createSourceFile(surface, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler;
    (function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'replyToInlineAnswer') handler = node.getText(tree);
      ts.forEachChild(node, visit);
    })(tree);
    assert.ok(handler);
    const bundle = await build({bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      alias: {'@': path.join(root, 'src')}, logLevel: 'silent', stdin: {resolveDir: root, loader: 'tsx', contents: `
        import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {InlineSelectionAnswerPopover, SelectableAssistantMarkdown} from '@/app/components/chat-text-selection-ui';
        const anchor = {left:100,right:200,top:80,bottom:100,width:100,height:20};
        const original = {id:'root-selection',mode:'inline',sourceMessageId:'main',start:0,end:5,quote:'Topic'};
        function App() {
          const [savedInlineSelections,setSavedInlineSelections] = useState([]);
          const [openInlineAnswers,setOpenInlineAnswers] = useState([{id:original.id,anchor}]);
          // Asked pairs per highlight, oldest first, as the hosts build them from messages.
          const [asked,setAsked] = useState({[original.id]:[{question:'Explain this',answer:'Parent answer.',answerMessageId:'msg_parent'}]});
          const [choice,setChoice] = useState({});
          const setSelectionMenu = () => {};
          const inlineSelectionThreads = new Map([original, ...savedInlineSelections].map(selection => {
            const pairs = (asked[selection.id] ?? []).map(pair => ({selection, pending:false, ...pair}));
            const latest = pairs.at(-1) ?? {selection, pending:false};
            if (pairs.length > 1) latest.attempts = pairs;
            return [selection.id, latest];
          }));
          ${handler}
          return <><main style={{margin:'60px 100px'}}><SelectableAssistantMarkdown content='Topic' sourceMessageId='main'
            annotations={[{...original,kind:'answer'}]} onSelection={()=>{}} onOpenAnnotation={()=>{}}/></main>
            {openInlineAnswers.map((openAnswer,index) => {
              const latest = inlineSelectionThreads.get(openAnswer.id);
              const attempts = latest.attempts;
              const attemptIndex = attempts ? Math.min(choice[openAnswer.id] ?? attempts.length - 1, attempts.length - 1) : 0;
              const thread = attempts?.[attemptIndex] ?? latest;
              const show = i => setChoice(current => ({...current,[openAnswer.id]:i}));
              return <InlineSelectionAnswerPopover key={openAnswer.id} anchor={openAnswer.anchor} selection={thread.selection}
                branch={attempts && attempts.length > 1 ? {current:attemptIndex+1,total:attempts.length,
                  onPrevious:()=>show(Math.max(0,attemptIndex-1)),onNext:()=>show(Math.min(attempts.length-1,attemptIndex+1))} : undefined}
                newQuestionRequest={openAnswer.newQuestion}
                question={thread.question} answer={thread.answer} answerMessageId={thread.answerMessageId}
                conversationId='conv' pending={false} onReply={replyToInlineAnswer}
                annotations={savedInlineSelections.filter(s=>s.sourceMessageId===thread.answerMessageId).map(s=>({...s,kind:'answer'}))}
                onSelection={()=>{}} onOpenAnnotation={()=>{}}
                onAskAgain={question=>{
                  setChoice(({[openAnswer.id]:_, ...rest}) => rest);
                  setAsked(current=>{
                    const list = current[openAnswer.id] ?? [];
                    return {...current,[openAnswer.id]:[...list,{question,answer:'Answer to '+question,answerMessageId:'msg_'+openAnswer.id+'_'+list.length}]};
                  });
                }}
                onClose={()=>setOpenInlineAnswers(current=>current.slice(0,index))} onDelete={()=>{}}/>;
            })}</>;
        }
        createRoot(document.getElementById('root')).render(<App/>);
      `}});
    const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {})});
    t.after(() => browser.close());
    const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost:53160/**', route => route.request().url().includes('/api/')
      ? route.fulfill({json: {messages: []}})
      : route.fulfill({contentType: 'text/html', body: '<!doctype html><div id="root"></div>'}));
    await page.goto('http://localhost:53160/');
    await page.addStyleTag({content: '.bb-inline-answer{position:fixed;overflow-y:auto;background:white;border:1px solid #ccc;padding:20px;box-sizing:border-box}'});
    await page.addScriptTag({content: bundle.outputFiles[0].text});

    const cards = page.getByRole('dialog', {name: 'Answer about highlighted text'});
    const ask = async (card, question) => {
      const editor = card.getByRole('textbox', {name: 'Edit question about highlighted text'});
      await expect(editor).toBeFocused();
      await expect(editor).toHaveValue('');
      await editor.fill(question);
      await editor.press('Enter');
      await expect(card.getByText('Answer to ' + question, {exact: true})).toBeVisible();
    };
    const branch = card => card.getByLabel(/^Response branch \d+ of \d+$/);

    // Reply to the whole answer, then reply to it again: same card, a fresh question.
    await cards.first().getByRole('button', {name: 'Reply to message'}).click();
    await expect(cards).toHaveCount(2);
    await ask(cards.nth(1), 'First reply');
    await expect(branch(cards.nth(1))).toHaveCount(0);
    await cards.first().getByRole('button', {name: 'Reply to message'}).click();
    await expect(cards).toHaveCount(2);
    await ask(cards.nth(1), 'Second reply');
    await expect(branch(cards.nth(1))).toHaveText('2/2');

    // Switch back and forth between the two full replies.
    await cards.nth(1).getByRole('button', {name: 'Previous response branch'}).click();
    await expect(cards.nth(1).getByText('Answer to First reply', {exact: true})).toBeVisible();
    await expect(cards.nth(1).getByText('First reply', {exact: true})).toBeVisible();
    await expect(branch(cards.nth(1))).toHaveText('1/2');
    await cards.nth(1).getByRole('button', {name: 'Next response branch'}).click();
    await expect(cards.nth(1).getByText('Answer to Second reply', {exact: true})).toBeVisible();
    await expect(branch(cards.nth(1))).toHaveText('2/2');

    // Editing the question and asking again adds a branch, like chat edits.
    await cards.first().getByRole('button', {name: 'Edit this question'}).click();
    const editor = cards.first().getByRole('textbox', {name: 'Edit question about highlighted text'});
    await editor.fill('Explain it differently');
    await editor.press('Enter');
    await expect(cards.first().getByText('Answer to Explain it differently', {exact: true})).toBeVisible();
    await expect(branch(cards.first())).toHaveText('2/2');
    await cards.first().getByRole('button', {name: 'Previous response branch'}).click();
    await expect(cards.first().getByText('Parent answer.', {exact: true})).toBeVisible();
    await expect(branch(cards.first())).toHaveText('1/2');
    assert.deepEqual(errors, []);
  });
}
