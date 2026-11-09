import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json',import.meta.url));
const ts=require('typescript');
const source=fs.readFileSync(new URL('../src/lib/meeting-notes/artifact.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const context={userId:7,conversationId:12,conversationPublicId:'conv_owned',runtimeSessionId:9,hermesSessionId:'owned',clusterId:null,surface:'dashboard_terminal',runId:'run_owned',assistantMessageId:14};
function moduleWith(render){
 const exports={},created=[];
 new Function('exports','require',code)(exports,id=>{
  if(id==='../hermes/artifact-store.ts')return {createArtifact:input=>{created.push(input);return {id:'art_owned',status:'draft'};},renderArtifact:render};
  return {};
 });
 return {...exports,created};
}
const note={context,summary:{meetingName:'Owned meeting',sections:[]},markdown:'# Owned meeting\nRoom B',transcriptEngine:'none',speakers:[],sourceLabel:'pasted transcript'};
test('notes wait for a readable rendered artifact in the owning conversation',async()=>{
 let finish,renderInput,settled=false;
 const m=moduleWith(input=>{renderInput=input;return new Promise(resolve=>{finish=resolve;});});
 const pending=m.saveNotesArtifact(note).then(value=>{settled=true;return value;});
 await Promise.resolve();
 assert.equal(settled,false);
 assert.equal(m.created[0].conversationId,12);
 assert.equal(m.created[0].userId,7);
 assert.equal(renderInput.runId,context.runId);
 assert.equal(renderInput.assistantMessageId,14);
 finish({id:'art_owned',status:'ready',output_location:'owned-notes.md'});
 assert.equal((await pending).status,'ready');
});
test('render failure cannot be reported as successful artifact delivery',async()=>{
 const m=moduleWith(async()=>({id:'art_owned',status:'failed'}));
 await assert.rejects(m.saveNotesArtifact(note),/could not be prepared for opening or download/);
});
test('transcripts are also rendered before their artifact is returned',async()=>{
 let renders=0;
 const m=moduleWith(async input=>{renders++;return {...input.artifact,status:'ready'};});
 const result=await m.saveTranscriptArtifact({context,title:'Owned meeting',transcript:{engine:'scriberr',text:'Mira: Room B.',speakers:['Mira'],language:'en',durationSeconds:4}});
 assert.equal(result.status,'ready');assert.equal(renders,1);
 assert.match(m.created[0].content,/Mira: Room B/);
 assert.equal(m.created[0].metadata.meetingTranscript,true);
});
