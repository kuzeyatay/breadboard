import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { chatCorePrompt, composeHermesSystemPrompt } from '../src/lib/hermes/system-prompts.ts';
import { createEmDashFilter } from '../src/lib/prose-punctuation.ts';
import { createResponseTextRecovery, reasoningTextFromOutputItem, assistantTextFromOutputItem } from '../src/lib/responses-stream-text.ts';
import { chatTokenUsageEventFromResponse } from '../src/lib/chat-token-usage.ts';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('full lesson requests keep writing preferences and normal tools without injecting the teaching workflow', () => {
  const decision = { mode:'knowledge', implementationRequired:false, authorizedRoots:[], authorizedPathPatterns:[],
    allowedTools:['garden_get_page_context'], allowedOperations:['knowledge_work'], allowedCommandPatterns:[] };
  for (const surface of ['dashboard_terminal','garden_chat','quartz_ai']) {
    const prompt = composeHermesSystemPrompt({surface, decision, userText:'Form me a full lesson on LTI systems.'});
    assert.ok(prompt.includes(chatCorePrompt()));
    assert.match(prompt,/Use negative contrasts only to address a real misconception/);
    assert.match(prompt,/one References list at the end/);
    assert.match(prompt,/Write to the reader in connected prose/);
    assert.match(prompt,/# server_capability_decision/);
    assert.doesNotMatch(prompt,/# Teaching workflow|teaching_preparation|reader_comprehension_layer|final quality gate/);
  }
});

test('normal chat and tool entry points have no automatic teaching model stages', () => {
  for (const file of ['src/app/api/chat/route.ts','src/app/api/knowledge-chat/route.ts',
    'src/lib/conversations/turn-service.ts','src/lib/conversations/direct-turn-service.ts',
    'src/lib/hermes/event-stream.ts','src/lib/hermes/garden-chat-adapter.ts','src/lib/hermes/garden-tools.ts',
    'src/app/api/humanizer/versions/route.ts']) {
    assert.doesNotMatch(read(file),/prepareTeachingExplanation|reviewRuntimeExplanation|reviewGardenTeachingText|reviewTeachingMessageRewrite|reviewExplanation\(|teachingReviewPrompt|teachingPreparation/,file);
  }
});

// Execute the production stream handlers, stopping the fake provider between
// its first delta and completion. The answer must reach the client immediately.
for (const route of ['chat','knowledge-chat']) {
  const source = read(`src/app/api/${route}/route.ts`);
  const tree = ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
  let body;
  function visit(node) {
    if (ts.isNewExpression(node) && node.expression.getText(tree)==='ReadableStream') {
      body=node.arguments[0].properties.find(item=>item.name?.getText(tree)==='start').body.getText(tree);
    }
    ts.forEachChild(node,visit);
  }
  visit(tree);
  assert.ok(body);
  test(`${route} streams the selected model's answer before completion, with no review or added usage`,async () => {
    const options={events:[],closed:false};
    const scope={options,assert,createEmDashFilter,createResponseTextRecovery,chatTokenUsageEventFromResponse,
      reasoningTextFromOutputItem,assistantTextFromOutputItem};
    const code=compile(`return (async()=>{
      const sourceNames=[], legacyFallback=false, runtime={mode:'legacy'};
      const imageGenerationItemsFromUnknown=()=>[];
      const stream=(async function*(){
        yield {type:'response.output_text.delta',output_index:0,delta:'The original answer.'};
        assert.equal(options.events.filter(event=>event.type==='delta').map(event=>event.text).join(''),'The original answer.');
        yield {type:'response.completed',response:{output:[],usage:{input_tokens:30,output_tokens:10}}};
      })();
      const controller={enqueue(bytes){const raw=new TextDecoder().decode(bytes).slice(6).trim();if(raw!=='[DONE]')options.events.push(JSON.parse(raw));},close(){options.closed=true;}};
      await (async function start(controller) ${body})(controller);
    })();`);
    await new Function(...Object.keys(scope),code)(...Object.values(scope));
    assert.equal(options.closed,true);
    assert.equal(options.events.filter(event=>event.type==='delta').map(event=>event.text).join(''),'The original answer.');
    assert.equal(options.events.filter(event=>event.type==='usage').length,1);
  });
}

test('Agent-off emits each original answer chunk without buffering a review', () => {
  const source=read('src/lib/conversations/direct-turn-service.ts');
  const tree=ts.createSourceFile('direct.ts',source,ts.ScriptTarget.Latest,true);
  let emitAnswer;
  function visit(node) {
    if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='emitAnswer')emitAnswer=node.initializer.getText(tree);
    ts.forEachChild(node,visit);
  }
  visit(tree);
  assert.ok(emitAnswer);
  const events=[];
  const run=new Function('createEmDashFilter','events',compile(`let answer='';const emDash=createEmDashFilter();const emit=event=>events.push(event);const emitAnswer=${emitAnswer};emitAnswer('Original answer.');return answer;`));
  assert.equal(run(createEmDashFilter,events),'Original answer.');
  assert.deepEqual(events,[{type:'delta',text:'Original answer.'}]);
});
