import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';
import {voiceReasoningEffort} from '../src/lib/speech/assistant-preferences.ts';
const root=process.env.VOICE_POLICY_SOURCE_ROOT??fileURLToPath(new URL('../',import.meta.url));
function extract(relative,name,scope,{variable=false}={}){
 const text=fs.readFileSync(path.join(root,relative),'utf8');const ast=ts.createSourceFile(relative,text,ts.ScriptTarget.Latest,true);let found;
 function visit(n){if((variable?ts.isVariableDeclaration(n):ts.isFunctionDeclaration(n))&&n.name?.getText(ast)===name)found=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(found,name);
 const code=ts.transpileModule(variable?'const '+found.getText(ast)+';':found.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 return new Function('exports',...Object.keys(scope),code+'\nreturn '+name)({},...Object.values(scope));
}
test('the voice client gives Fast a reasoning budget and preserves High and the chosen model',async()=>{
 for(const [voiceThinking,expected]of [['fast','low'],['high','high']]){
  const request=extract('src/lib/speech/voice-request.ts','voiceRequestOptions',{
   currentVoiceScreenContext:async()=>({browserAccess:null}),fetch:async()=>Response.json({preferences:{voiceModel:'chosen-model',voiceThinking}}),
   parseVoiceAssistantPreferences:p=>p,normalizeAssistantModelId:x=>x,GLOBAL_MODEL_SENTINEL:'default',parseVoiceScreenContext:x=>x,voiceReasoningEffort});
  assert.deepEqual(await request(),{model:'chosen-model',reasoningEffort:expected,voice:true,browserAccess:null});
 }
});
test('voice warmup matches the turn policy while typed chat keeps its explicit preferences',()=>{
 for(const [voiceThinking,expected]of [['fast','low'],['high','high']]){
  const preferences=extract('src/lib/hermes/session-service.ts','conversationRuntimePreferences',{
   getHermesUserSettings:()=>({fallbackModel:'typed-model',reasoningEffort:'xhigh'}),readVoiceAssistantPreferences:()=>({voiceModel:'chosen-model',voiceThinking}),db:{},GLOBAL_MODEL_SENTINEL:'default',voiceReasoningEffort});
  assert.deepEqual(preferences({user_id:1,origin_label:'Voice'}),{model:'chosen-model',reasoningEffort:expected});
  assert.deepEqual(preferences({user_id:1,origin_label:'Chat'}),{model:'typed-model',reasoningEffort:'xhigh'});
 }
});
test('API defaults use the same policy while every explicit effort, including none, remains authoritative',()=>{
 for(const voice of [true,false])for(const explicit of [undefined,'none','low','medium','high','xhigh']){
  const input={voice,reasoningEffort:explicit,conversation:{user_id:1}};
  const scope={input,db:{},readVoiceAssistantPreferences:()=>({voiceThinking:'fast'}),voiceReasoningEffort};
  const voicePreferences=extract('src/lib/conversations/turn-service.ts','voicePreferences',scope,{variable:true});
  const actual=extract('src/lib/conversations/turn-service.ts','reasoningEffort',{...scope,voicePreferences},{variable:true});
  assert.equal(actual,voice&&explicit===undefined?'low':explicit);
 }
});
