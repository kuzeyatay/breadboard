import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
// Exercise the terminal's actual click handler without booting its agents.
const source = fs.readFileSync(path.join(root, 'src/app/components/hermes/agent-runtime-panel.tsx'), 'utf8');
const tree = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'openAnnotation') handler = node.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(handler);

test('terminal highlight clicks show their popup above the dock and preserve the composer', {timeout:60000}, async t => {
  const bundle = await build({bundle:true, write:false, platform:'browser', format:'iife', jsx:'automatic',
    alias:{'@':path.join(root, 'src')}, logLevel:'silent', stdin:{resolveDir:root, loader:'tsx', contents:`
      import React, {useState,useRef,useCallback} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SelectableAssistantMarkdown,ChatSelectionMenu,InlineSelectionAnswerPopover} from '@/app/components/chat-text-selection-ui';
      const make = (id,sourceMessageId,quote,start=0) => ({id,mode:'inline',sourceMessageId,quote,start,end:start+quote.length});
      const answered = make('answered','main','Answered passage');
      const empty = make('empty','main','Unsent passage',18);
      const child = make('child','answer-message','Nested passage');
      const plain = {...make('plain','main','Saved passage',34),mode:'chat',kind:'highlight',color:'blue'};
      const inlineSelectionThreads = new Map([
        ['answered',{selection:answered,question:'Explain this',answer:'Nested passage with a saved answer.',answerMessageId:'answer-message'}],
        ['empty',{selection:empty}],
        ['child',{selection:child,question:'Explain the detail',answer:'The nested answer.'}],
      ]);
      const savedChatHighlights = [plain];
      function App() {
        const [openInlineAnswers,setOpenInlineAnswers] = useState([]);
        const [selectionMenu,setSelectionMenu] = useState(null);
        const [composerSelection,setComposerSelection] = useState(null);
        const composerTextareaRef = useRef(null);
        const ${handler};
        window.composerSelection = composerSelection;
        return <>
          <section data-terminal-dock className='bb-terminal-dock fixed inset-0 z-40 bg-white' style={{padding:'140px 160px'}}>
            <SelectableAssistantMarkdown content='Answered passage. Unsent passage. Saved passage.' sourceMessageId='main'
              annotations={[{...answered,kind:'answer'},{...empty,kind:'answer'},plain]}
              onSelection={setSelectionMenu} onOpenAnnotation={openAnnotation}/>
            <div className='bb-composer-overlay'><textarea aria-label='Chat composer' ref={composerTextareaRef} defaultValue='Keep this draft'/></div>
          </section>
          {selectionMenu && <ChatSelectionMenu selection={selectionMenu} highlighted={true} onHighlightColor={()=>{}}
            onRemoveHighlight={()=>{}} onClose={()=>setSelectionMenu(null)}/>}
          {openInlineAnswers.map(open => {
            const thread = inlineSelectionThreads.get(open.id);
            return <InlineSelectionAnswerPopover key={open.id} {...thread} anchor={open.anchor} pending={false}
              annotations={open.id==='answered'?[{...child,kind:'answer'}]:[]} onSelection={setSelectionMenu} onOpenAnnotation={openAnnotation}
              onAskAgain={question=>{window.asked={id:open.id,question}}} onDelete={()=>setOpenInlineAnswers([])}
              onClose={()=>setOpenInlineAnswers(current=>current.slice(0,current.findIndex(item=>item.id===open.id)))}/>;
          })}
        </>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `}});
  const stylesheet = path.join(root, 'src/app/globals.css');
  const css = (await postcss([tailwindcss({base:root})]).process(fs.readFileSync(stylesheet,'utf8'), {from:stylesheet})).css;
  const executablePath = [chromium.executablePath(), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1400,height:900}});
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('http://highlight.test/', route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
  await page.goto('http://highlight.test/');
  await page.addStyleTag({content:css});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const dialogs = page.getByRole('dialog',{name:'Answer about highlighted text'});
  const mark = id=>page.locator('[data-chat-selection-id="'+id+'"]');
  await mark('plain').click();
  assert.equal(await page.getByRole('toolbar',{name:'Selected text actions'}).isVisible(),true);
  await mark('answered').click();
  await dialogs.first().waitFor({state:'visible'});
  assert.equal(await dialogs.first().evaluate(card=>{
    const button=card.querySelector('[aria-label="Delete highlight"]');
    const rect=button.getBoundingClientRect();
    return card.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
  }),true,'the answer is painted above the terminal and receives pointer events');
  assert.equal(await page.getByRole('toolbar',{name:'Selected text actions'}).count(),0);
  await mark('child').click();
  assert.equal(await dialogs.count(),2,'opening a nested answer keeps its parent');
  assert.equal(await dialogs.nth(1).evaluate(card=>{
    const button=card.querySelector('[aria-label="Delete highlight"]');
    const rect=button.getBoundingClientRect();
    return card.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
  }),true,'nested answers inherit the terminal popup layer');
  await page.keyboard.press('Escape');
  await mark('empty').click();
  await dialogs.first().waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.composerSelection),null,'an unsent highlight must not change the main chat context');
  assert.equal(await page.getByRole('textbox',{name:'Chat composer'}).inputValue(),'Keep this draft');
  assert.equal(await page.getByRole('textbox',{name:'Chat composer'}).evaluate(el=>el===document.activeElement),false);
  await dialogs.getByRole('button',{name:'Ask a question',exact:true}).click();
  await dialogs.getByRole('textbox').fill('What does this mean?');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.asked),{id:'empty',question:'What does this mean?'});
  await dialogs.getByRole('button',{name:'Delete highlight',exact:true}).click();
  assert.equal(await dialogs.count(),0);
  await mark('answered').focus();
  await page.keyboard.press('Enter');
  await dialogs.first().waitFor({state:'visible'});
  assert.deepEqual(errors,[]);
});
