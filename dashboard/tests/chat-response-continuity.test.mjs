import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { supersededDelegationAssistantIndices, delegatedContinuationPreamble } from '../src/lib/hermes/super-agent-activity.ts';
import { taskRecoveryCheckpoint, taskFailureCanRecover } from '../src/lib/hermes/task-recovery-policy.ts';

// Execute the actual two surface projections, not a test copy of the filter.
function transcriptProjection(surface, messages) {
  const file = surface === 'terminal' ? '../src/app/components/hermes/agent-runtime-panel.tsx'
    : '../src/app/gardens/[clusterSlug]/workspace-client.tsx';
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (surface === 'terminal' && ts.isVariableDeclaration(node) && node.name.getText(tree) === 'transcriptRows' &&
      node.initializer && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0].getText(tree);
    if (surface === 'garden' && ts.isFunctionDeclaration(node) && node.name?.text === 'buildTranscriptRows') expression = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(expression, `${surface} transcript projection exists`);
  const javascript = ts.transpileModule(`const projection = ${expression};`, {
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
  }).outputText;
  const scope = { messages, supersededDelegationAssistantIndices,
    supersededDelegationAssistants: supersededDelegationAssistantIndices(messages),
    inlinedCourseCorrections:{hiddenMessageIndices:new Set()},runInFlight:false,lastAssistantIndex:messages.length-1,
    isClarificationAnswerMessage:()=>false,externalAgentCardContent:message=>message.content };
  return new Function(...Object.keys(scope), `${javascript}\nreturn projection(messages);`)(...Object.values(scope));
}

for (const surface of ['terminal','garden']) test(`${surface} retains rendered answers through pending, successful and failed recovery and reload`, () => {
  const original={role:'assistant',content:'Paste the passage so I can explain its key ideas.',id:'original'};
  const base=[{role:'user',content:'Explain the passage.'},original];
  for(const reply of [{content:''},{content:'A follow-up explanation.'},{content:'Provider limit reached.',failed:true}]) {
    const messages=[...base,{role:'user',content:'Hidden recovery request',internalAgentContinuation:true},
      {role:'assistant',id:'recovery',internalAgentContinuation:true,...reply}];
    for(const restored of [messages,JSON.parse(JSON.stringify(messages))]) {
      const rows=transcriptProjection(surface,restored);
      assert.deepEqual(rows.map(row=>row.index),[0,1,3]);
      assert.equal(rows[1].message.content,original.content);
      assert.equal(rows[2].message.content,reply.content);
    }
  }
});

test('completed answers survive an automatic recovery chain and reload', () => {
  const messages = [
    { role:'user', content:'Explain the passage I was reading.' },
    { role:'assistant', content:'Please paste the passage so I can explain it.' },
    { role:'user', content:'Explain the passage I was reading.', internalAgentContinuation:true },
    { role:'assistant', content:'The selected passage is still unavailable.', internalAgentContinuation:true },
    { role:'user', content:'Explain the passage I was reading.', internalAgentContinuation:true },
    { role:'assistant', content:'Here is a general explanation of the page.', internalAgentContinuation:true },
  ];
  for (const transcript of [messages.slice(0, 4), messages, JSON.parse(JSON.stringify(messages))]) {
    assert.deepEqual([...supersededDelegationAssistantIndices(transcript)], []);
    assert.equal(delegatedContinuationPreamble(transcript, transcript.length - 1), '');
  }
});

test('a pending continuation never removes a delivered answer', () => {
  for (const kind of ['recovery', 'goal', 'team', 'internal']) {
    const messages = [
      {role:'user',content:'A request'},
      {role:'assistant',content:'A completed answer with information the user has read.'},
      {role:'user',content:'Continue',clientMessageId:`${kind}:1`,internalAgentContinuation:true},
      {role:'assistant',content:'',internalAgentContinuation:true},
    ];
    assert.deepEqual([...supersededDelegationAssistantIndices(messages)], [], kind);
  }
});

test('a failed recovery preserves the earlier completed answer and its context', () => {
  const messages = [
    {role:'user',content:'Explain the code passage.'},
    {role:'assistant',content:'Paste the passage here so I can explain its key ideas.'},
    {role:'user',content:'Explain the code passage.',internalAgentContinuation:true},
    {role:'assistant',content:'The provider usage limit was reached.',failed:true,internalAgentContinuation:true},
  ];
  assert.deepEqual([...supersededDelegationAssistantIndices(messages)], []);
  assert.equal(delegatedContinuationPreamble(messages, 3), '');
});

test('only an explicit handoff is folded; its substantive synthesis survives later continuations', () => {
  const messages = [
    {role:'user',content:'Research this'},
    {role:'assistant',content:'Starting research.',delegatedAgentPreamble:'Starting research.'},
    {role:'user',content:'Worker result',internalAgentContinuation:true},
    {role:'assistant',content:'The evidence supports this conclusion.'},
    {role:'user',content:'Another update',internalAgentContinuation:true},
    {role:'assistant',content:'Additional evidence supports the earlier conclusion.'},
  ];
  assert.deepEqual([...supersededDelegationAssistantIndices(messages)], [1]);
  assert.equal(delegatedContinuationPreamble(messages, 3), 'Starting research.');
});

test('a finished typed answer is not restarted for unsuccessful evidence lookups', () => {
  for (const toolName of ['web_search','web_extract','garden_get_source_excerpt','browser_terminal','memory_query']) {
    for (const alternative of [[], [{toolName:'web_search',success:true}]]) {
      assert.deepEqual(taskRecoveryCheckpoint({status:'idle',turn:0,completedTextAnswer:true,
        tools:[{toolName,success:false,failure:{code:'not_found',message:'No matching evidence'}},...alternative]}), {}, toolName);
    }
  }
});

test('missing linked browser context requires user input rather than an automatic replay', () => {
  assert.equal(taskFailureCanRecover({code:'browser_not_linked',message:'Page context unavailable'}),false);
  assert.equal(taskFailureCanRecover({code:'task_tool_failed',message:'browser_terminal: Send a message from the Terminal beside the browser page to connect it.'}),false);
  assert.equal(taskFailureCanRecover({code:'browser_request_failed',message:'Temporary HTTP 503'}),true);
});

test('completed deliverables are not replayed for an incidental lookup failure', () => {
  for (const toolName of ['artifact_render','terminal_execute_command','skill_open','delegate_task']) {
    assert.deepEqual(taskRecoveryCheckpoint({status:'idle',turn:0,completedTextAnswer:true,tools:[
      {toolName:'web_search',success:false,summary:'No results'}, {toolName,success:true},
    ]}),{},toolName);
  }
});

test('failed and stopped rows are retained even when their body comes from an error renderer', () => {
  for(const state of [{failed:true},{interrupted:true}]) {
    const messages=[{role:'user',content:'A request'},{role:'assistant',content:'',...state},
      {role:'user',content:'Continue',internalAgentContinuation:true},{role:'assistant',content:'A later reply'}];
    assert.deepEqual([...supersededDelegationAssistantIndices(messages)],[]);
  }
});

test('unfinished runs, missing artifacts and failed writes retain real recovery', () => {
  const lookup={toolName:'web_search',success:false,summary:'Temporary failure'};
  assert.ok(taskRecoveryCheckpoint({status:'idle',turn:0,tools:[lookup]}).checkpoint);
  assert.ok(taskRecoveryCheckpoint({status:'failed',turn:0,completedTextAnswer:true,tools:[lookup],
    failure:{code:'required_artifact_missing',message:'Requested file is not ready'}}).checkpoint);
  for(const toolName of ['artifact_render','terminal_execute_command','delegate_task','unknown_tool']) {
    assert.ok(taskRecoveryCheckpoint({status:'idle',turn:0,completedTextAnswer:true,tools:[{...lookup,toolName}]}).checkpoint,toolName);
  }
  assert.equal(taskRecoveryCheckpoint({status:'cancelled',turn:0,completedTextAnswer:true,tools:[lookup]}).stopped,'cancelled');
});
