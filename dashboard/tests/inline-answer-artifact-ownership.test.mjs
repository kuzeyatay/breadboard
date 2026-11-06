import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { delegatedThinkingUpdates } from '../src/lib/hermes/super-agent-activity.ts';

function declarations(file) {
  const source = fs.readFileSync(new URL('../src/app/' + file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) result.set(node.name.text, node.getText(tree));
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
      result.set(node.name.getText(tree), node.initializer.arguments[0]?.getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}

function evaluate(source, context) {
  const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.React}}).outputText;
  return vm.runInNewContext(js, context);
}

const selection = {id:'highlight',mode:'inline',sourceMessageId:'source',quote:'Volume'};
for (const file of ['components/hermes/agent-runtime-panel.tsx','gardens/[clusterSlug]/workspace-client.tsx']) {
  test(`${file}: inline artifact ownership uses durable response ids, including restored branches`, () => {
    const source = declarations(file);
    for (const message of [
      {id:'msg_saved',clientMessageId:'client-turn'},
      {id:'msg_branch',clientMessageId:'client-turn',artifactMessageId:'msg_original'},
      {clientMessageId:'client-pending'},
    ]) {
      const threads = evaluate(`${source.get('messageSelectionSourceId')}; (${source.get('inlineSelectionThreads')})()`, {
        messages:[{role:'assistant',content:'Adjust dx.',textSelection:selection,...message}],
        savedInlineSelections:[],deletedInlineSelectionIds:new Set(),activeRun:false,
        webSelection:null,sessionId:'conv_fixture',onAbortInline:undefined,
        delegatedThinkingUpdates,
      });
      const thread = threads.get(selection.id);
      assert.equal(thread.artifactMessageId, message.artifactMessageId ?? message.id);
      assert.ok(thread.answerMessageId, 'text selection retains its own identity');
    }
  });
}

test('Quartz resolves its stable selection id to the saved artifact owner', () => {
  const source = declarations('garden/garden-assistant.tsx');
  const messages = [
    {id:'msg_saved',clientMessageId:'turn-1',role:'assistant'},
    {id:'msg_branch',clientMessageId:'turn-2',role:'assistant',artifactMessageId:'msg_original'},
  ];
  const render = evaluate(`${source.get('gardenSelectionMessageId')}; (${source.get('renderAnswerArtifacts')})`, {
    messages,activeChatId:42,activeClusterSlug:'vectors',InlineArtifactCards:'Cards',
    React:{createElement:(_component,props)=>props},
    chatRowKey:message=>'id:'+message.id,
  });
  assert.equal(render('client:turn-1:assistant').ownerMessageId,'msg_saved');
  assert.equal(render('client:turn-2:assistant').ownerMessageId,'msg_original');
  assert.equal(render('client:turn-1:assistant').legacyChatSessionId,42);
  assert.equal(render('unknown-answer'),null);
});
