import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));

for (const surface of ['gardens/[clusterSlug]/workspace-client.tsx', 'components/hermes/agent-runtime-panel.tsx']) {
  test(`${surface}: inline answers star and reply to the full formatted answer`, {timeout: 60_000}, async t => {
    const source = readFileSync(path.join(root, 'src/app', surface), 'utf8');
    const tree = ts.createSourceFile(surface, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler;
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'replyToInlineAnswer') handler = node.getText(tree);
      ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.ok(handler);
    const bundle = await build({bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      alias: {'@': path.join(root, 'src')}, logLevel: 'silent', stdin: {resolveDir: root, loader: 'tsx', contents: `
        import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {InlineSelectionAnswerPopover, SelectableAssistantMarkdown} from '@/app/components/chat-text-selection-ui';
        const anchor = {left:100,right:200,top:80,bottom:100,width:100,height:20};
        const original = {id:'root-selection',mode:'inline',sourceMessageId:'main',start:0,end:5,quote:'Topic'};
        const content = '**Complete answer**\\n\\n' + 'Long paragraph. '.repeat(350) +
          '\\n\\n- First item\\n- Last item\\n\\nFormula: $x^2$.\\n\\nFINAL SENTENCE';
        window.answerContent = content;
        function App() {
          const [savedInlineSelections,setSavedInlineSelections] = useState(() => JSON.parse(localStorage.getItem('inline-selections') || '[]'));
          const [openInlineAnswers,setOpenInlineAnswers] = useState([{id:original.id,anchor}]);
          const [answers,setAnswers] = useState({});
          const setSelectionMenu = () => {};
          localStorage.setItem('inline-selections', JSON.stringify(savedInlineSelections));
          const inlineSelectionThreads = new Map([
            [original.id,{selection:original,question:'Explain this',answer:content,answerMessageId:'msg_parent'}],
            ...savedInlineSelections.map(selection => [selection.id,{selection,...answers[selection.id]}]),
          ]);
          ${handler}
          return <><main style={{margin:'60px 100px'}}><SelectableAssistantMarkdown content='Topic' sourceMessageId='main'
            annotations={[{...original,kind:'answer'}]} onSelection={()=>{}} onOpenAnnotation={()=>{}}/></main>
            <textarea aria-label='Main composer' defaultValue='Keep my draft'/>
            {openInlineAnswers.map((open,index) => {
              const thread = inlineSelectionThreads.get(open.id);
              return <InlineSelectionAnswerPopover key={open.id} anchor={open.anchor} selection={thread.selection}
                question={thread.question} answer={thread.answer} answerMessageId={thread.answerMessageId}
                conversationId='conv_saved' pending={false} onReply={replyToInlineAnswer}
                annotations={savedInlineSelections.filter(s=>s.sourceMessageId===thread.answerMessageId).map(s=>({...s,kind:'answer'}))}
                onSelection={()=>{}} onOpenAnnotation={(id,anchor)=>setOpenInlineAnswers(current=>[...current.slice(0,index+1),{id,anchor}])}
                onAskAgain={question=>{window.sent={question,selection:thread.selection};setAnswers(current=>({...current,[open.id]:{question,answer:'A nested answer.',answerMessageId:'msg_child'}}));}}
                onClose={()=>setOpenInlineAnswers(current=>current.slice(0,index))}
                onDelete={()=>{setSavedInlineSelections(current=>current.filter(s=>s.id!==open.id));setOpenInlineAnswers(current=>current.slice(0,index));}}/>;
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
    let stars = [];
    const writes = [];
    await page.route('http://localhost:53159/**', async route => {
      if (route.request().url().endsWith('/api/starred-messages')) {
        if (route.request().method() === 'PUT') {
          const body = route.request().postDataJSON();
          writes.push(body);
          stars = body.starred ? [{conversationId:'conv_saved',messageId:'msg_parent',clientMessageId:'msg_parent'}] : [];
        }
        return route.fulfill({json: {messages: stars}});
      }
      if (route.request().url().includes('/api/')) return route.fulfill({json: {}});
      return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});
    });
    const mount = async () => {
      await page.goto('http://localhost:53159/');
      await page.addStyleTag({content: '.bb-inline-answer{position:fixed;overflow-y:auto;background:white;border:1px solid #ccc;padding:20px;box-sizing:border-box} mark{background:#ffdf8b}'});
      await page.addScriptTag({content:bundle.outputFiles[0].text});
    };
    await mount();
    const cards = page.getByRole('dialog', {name:'Answer about highlighted text'});
    await cards.first().getByRole('button',{name:'Star message',exact:true}).click();
    await expect(cards.first().getByRole('button',{name:'Unstar message',exact:true})).toHaveAttribute('aria-pressed','true');
    assert.deepEqual(writes[0], {conversationId:'conv_saved',messageId:'msg_parent',starred:true});
    await cards.first().getByRole('button',{name:'Reply to message'}).click();
    await expect(cards).toHaveCount(2);
    const editor = cards.nth(1).getByRole('textbox',{name:'Edit question about highlighted text'});
    await expect(editor).toBeFocused();
    await expect(page.getByRole('textbox',{name:'Main composer'})).toHaveValue('Keep my draft');
    assert.ok(await page.locator('[data-chat-selectable-message="msg_parent"]').evaluate(body => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent.trim() && !node.parentElement.closest('[data-selection-exclude]') && !node.parentElement.closest('mark')) return false;
      }
      return true;
    }), 'every rendered answer text node, including math, is highlighted');
    await editor.fill('Explain the whole answer');
    await editor.press('Enter');
    await expect(cards.nth(1).getByText('A nested answer.',{exact:true})).toBeVisible();
    const sent = await page.evaluate(() => window.sent);
    assert.equal(sent.selection.quote, await page.evaluate(() => window.answerContent));
    assert.ok(sent.selection.quote.length > 4000);
    assert.equal(sent.selection.wholeMessage, true);
    assert.equal(sent.selection.mode, 'inline');
    assert.equal(sent.selection.sourceMessageId, 'msg_parent');
    await cards.nth(1).getByRole('button',{name:'Reply to message'}).click();
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(2).getByRole('textbox')).toBeFocused();
    await mount();
    await expect(cards.first().getByRole('button',{name:'Unstar message',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(cards.first().locator('[data-chat-selection-kind="answer"]').first()).toBeVisible();
    await cards.first().getByRole('button',{name:'Unstar message',exact:true}).click();
    await expect(cards.first().getByRole('button',{name:'Star message',exact:true})).toHaveAttribute('aria-pressed','false');
    assert.deepEqual(stars, []);
    assert.deepEqual(errors, []);
  });
}
