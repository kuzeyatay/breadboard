import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, "src/app/gardens/[clusterSlug]/workspace-client.tsx");
const tree = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wanted = new Set(["ChatTranscript", "buildTranscriptRows", "transcriptRowKey", "transcriptRowHeight", "EMPTY_CHAT_ANNOTATIONS", "messageSelectionSourceId", "hasRunningExternalAgent"]);
const statements = tree.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => wanted.has(d.name.getText(tree)))));
const used = new Set();
function visit(node) { if (ts.isIdentifier(node)) used.add(node.text); ts.forEachChild(node, visit); }
statements.forEach(visit);
const imports = [], stubs = [];
const real = new Set(["ActivityPanel", "AssistantMessageActions", "MessageActionsSlot", "SelectableAssistantMarkdown", "VirtualizedMessageList"]);
for (const node of tree.statements) {
  if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly) continue;
  const clause = node.importClause;
  const bindings = [...(clause.name ? [{ name: clause.name.text, imported: "default" }] : []),
    ...(clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.filter(i => !i.isTypeOnly).map(i => ({ name: i.name.text, imported: i.propertyName?.text ?? i.name.text })) : [])];
  for (const { name, imported } of bindings) {
    if (!used.has(name)) continue;
    if (/^[A-Z]/.test(name) && !real.has(name)) stubs.push(`const ${name}=({children})=>children??null;`);
    else imports.push(imported === "default" ? `import ${name} from ${JSON.stringify(node.moduleSpecifier.text)};` : `import {${imported} as ${name}} from ${JSON.stringify(node.moduleSpecifier.text)};`);
  }
}

test("Garden Retry replaces the answer without crashing its real virtual transcript", { timeout: 30_000 }, async () => {
  const bundle = await build({ stdin: { resolveDir: path.dirname(file), loader: "tsx", contents: `
    ${imports.join('\n')}
    import React from 'react';import{createRoot}from'react-dom/client';
    import {createConversationBranch} from '@/app/components/hermes/conversation-branches';
    import {useChatVirtualBridge} from '@/app/components/use-chat-auto-scroll';
    ${stubs.join('\n')}
    ${statements.map(n => n.getText(tree)).join('\n')}
    window.errors=[];
    class Boundary extends React.Component {state={error:null};static getDerivedStateFromError(e){return{error:e.message}}componentDidCatch(e){window.errors.push(e.stack)}render(){return this.state.error?<p>{this.state.error}</p>:this.props.children}}
    function App(){
      const [messages,setMessages]=useState(Array.from({length:18},(_,i)=>({id:'m'+i,clientMessageId:'turn'+Math.floor(i/2),role:i%2?'assistant':'user',content:i%2?'Saved answer '+i:'Question '+i,sources:[]})));
      const [branchGroups,setBranchGroups]=useState({});const [busy,setBusy]=useState(false);
      const scroll=useRef(null),bridge=useChatVirtualBridge();
      window.retryAt=index=>{
        const branch=createConversationBranch({messages,branchGroups,userMessageIndex:index-1,content:messages[index-1].content,createId:()=>crypto.randomUUID()});
        setBranchGroups({...branchGroups,[branch.groupId]:branch.group});
        setBusy(true);setMessages(branch.variant);
        setTimeout(()=>{setMessages([...branch.variant.slice(0,-1),{...branch.variant.at(-1),content:'Replacement answer'}]);setBusy(false)},100);
      };
      return <div ref={scroll} style={{height:600,overflow:'auto'}}><ChatTranscript clusterName='EM1' clusterSlug='em1' chatSessionId={1}
        messages={messages} branchGroups={branchGroups} isStreaming={busy} connection={busy?'streaming':'idle'} loadingChats={false}
        gardenSourceAttachments={[]} activities={[]} pendingPermission={null} pendingClarification={null} onPermissionDecision={()=>{}} onClarificationAnswer={()=>{}}
        annotationsByMessage={new Map()} delegationInFlight={false} transcriptScrollRef={scroll} transcriptVirtual={bridge} naturalRewriteFor={()=>undefined}
        onRetryAssistant={window.retryAt} onSwitchBranch={()=>{}}/></div>;
    }createRoot(document.getElementById('root')).render(<Boundary><App/></Boundary>);
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: { "@": path.join(root, "src") }, logLevel: "silent" });
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(edge) ? { executablePath: edge } : {}) });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://localhost:53147/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' }));
    await page.goto("http://localhost:53147/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => window.errors?.length || document.querySelector('[data-chat-virtual-list]'));
    assert.deepEqual(await page.evaluate(() => window.errors), []);
    await page.evaluate(() => window.retryAt(17));
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => window.errors), []);
    await page.evaluate(() => window.retryAt(5));
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => window.errors), []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("large Garden branches refresh without browser-storage writes and retain legacy history", { timeout: 30_000 }, async () => {
  const names = new Set(["BRANCH_STORAGE_PREFIX", "loadBranchGroups", "useGardenResponseBranches"]);
  const branchSource = tree.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.has(d.name.getText(tree)))));
  assert.equal(branchSource.length, 3, "exercise the production branch-storage hook");
  const bundle = await build({ stdin: { resolveDir: path.dirname(file), loader: "tsx", contents: `
    import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
    ${branchSource.map(node => node.getText(tree)).join('\n')}
    const group=(id,content)=>({id,activeIndex:0,variants:[[{role:'assistant',content}],[{role:'assistant',content:'Alternative'}]]});
    const legacy={legacy:group('legacy','Older local answer'),shared:group('shared','Old shared answer')};
    localStorage.setItem(BRANCH_STORAGE_PREFIX+'1',JSON.stringify(legacy));
    localStorage.setItem(BRANCH_STORAGE_PREFIX+'2',JSON.stringify({other:group('other','Another chat')}));
    window.originalLegacy=localStorage.getItem(BRANCH_STORAGE_PREFIX+'1');
    window.storageWrites=[];
    Storage.prototype.setItem=function(key,value){window.storageWrites.push({key,characters:value.length});throw new DOMException('Full','QuotaExceededError')};
    function App(){
      const [chat,setChat]=useState(1),[saved,setSaved]=useState(undefined);
      const [branches]=useGardenResponseBranches(chat,saved);
      window.supplyBranches=()=>setSaved({shared:group('shared','Durable answer'),large:group('large','x'.repeat(8*1024*1024))});
      window.refreshBranches=()=>setSaved(current=>Object.fromEntries(Object.entries(current).map(([id,value])=>[id,{...value,activeIndex:1-value.activeIndex}])));
      window.selectChat=id=>{setChat(id);setSaved(undefined)};
      useEffect(()=>{window.branchState={keys:Object.keys(branches).sort(),shared:branches.shared?.variants[0][0].content,
        largeLength:branches.large?.variants[0][0].content.length,activeIndex:branches.large?.activeIndex}},[branches]);
      return <p>{Object.keys(branches).length} branches</p>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent" });
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(edge) ? { executablePath: edge } : {}) });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://localhost:53147/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' }));
    await page.goto("http://localhost:53147/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() => window.branchState?.keys.join(',') === 'legacy,shared');
    await page.evaluate(() => window.supplyBranches());
    await page.waitForFunction(() => window.branchState?.largeLength === 8 * 1024 * 1024);
    assert.equal(await page.evaluate(() => window.branchState.shared), 'Durable answer', "server branches override older cached variants");
    for (let iteration = 0; iteration < 4; iteration++) {
      await page.evaluate(() => window.refreshBranches());
      await page.waitForFunction(expected => window.branchState?.activeIndex === expected, (iteration + 1) % 2);
    }
    assert.deepEqual(await page.evaluate(() => window.storageWrites), [], "no large IPC writes, including repeated quota failures");
    assert.equal(await page.evaluate(() => localStorage.getItem('breadboard:garden-conversation-branches:1') === window.originalLegacy), true, "legacy data is retained untouched");
    await page.evaluate(() => window.selectChat(2));
    await page.waitForFunction(() => window.branchState?.keys.join(',') === 'other');
    await page.evaluate(() => window.selectChat(null));
    await page.waitForFunction(() => window.branchState?.keys.length === 0);
    await page.evaluate(() => window.selectChat(1));
    await page.waitForFunction(() => window.branchState?.keys.join(',') === 'legacy,shared');
    assert.deepEqual(await page.evaluate(() => window.storageWrites), []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
