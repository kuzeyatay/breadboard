import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const bundled = await build({stdin:{resolveDir:path.resolve(import.meta.dirname,'..'),loader:'ts',contents:`
export {MarkdownCodec} from './src/lib/quartz-editor/markdown';
export {annotationPlugin,annotationsKey,paintAnnotations,setAnswerStates} from './src/lib/quartz-editor/annotations';
export {EditorState} from '@tiptap/pm/state';
export {history,undo,redo,closeHistory} from '@tiptap/pm/history';
`},bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};
new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {MarkdownCodec,annotationPlugin,annotationsKey,paintAnnotations,setAnswerStates,EditorState,history,undo,redo,closeHistory}=module.exports;

function fixture(body) {
  const codec=new MarkdownCodec();
  let state=EditorState.create({doc:codec.parse(body),plugins:[history(),annotationPlugin]});
  const view={get state(){return state;},dispatch(tr){state=state.apply(tr);}};
  const replace=body=>{
    const next=codec.parse(body);
    view.dispatch(closeHistory(state.tr.replaceWith(0,state.doc.content.size,next.content)
      .setDocAttribute('sourceContext',next.attrs.sourceContext).setMeta('bb-source-replaced',true)));
  };
  const annotationState=()=>annotationsKey.getState(state);
  return {view,replace,annotationState};
}

test('source replacement uses the current edited quote and keeps its note and answer in the same transaction',()=>{
  const {view,replace,annotationState}=fixture('A First passage.\n\nOther text.');
  paintAnnotations(view,[{id:'one',start:2,end:7,text:'First',prefix:'A ',suffix:' passage.',color:'blue',note:'Remember this',noteOnly:true}]);
  setAnswerStates(view,[{highlightId:'one',state:'complete'}]);
  // Type inside the mark without waiting for autosave to update its stored quote.
  view.dispatch(view.state.tr.insertText('X',4));
  assert.equal(annotationState().anchors[0].entry.text,'First');
  replace('AI introduction.\n\nA FXirst passage.\n\nOther text.');
  const {anchors,decorations}=annotationState();
  assert.equal(anchors[0].entry.text,'FXirst');
  assert.equal(anchors[0].detached,false);
  assert.equal(view.state.doc.textBetween(anchors[0].from,anchors[0].to),'FXirst');
  assert.equal(anchors[0].entry.note,'Remember this');
  assert.equal(decorations.find()[0].type.attrs['data-hl-answer'],'complete');
  assert.equal(decorations.find()[0].type.attrs['data-hl-note-only'],'true');
});

test('removed and ambiguous quotes stay detached, while undo restores their annotations immediately',()=>{
  const {view,replace,annotationState}=fixture('Before target after.');
  paintAnnotations(view,[{id:'one',start:7,end:13,text:'target',prefix:'Before ',suffix:' after.',color:'pink',note:'Original note'}]);
  setAnswerStates(view,[{highlightId:'one',state:'complete'}]);
  replace('A revised passage with no matching quote.');
  assert.equal(annotationState().anchors[0].detached,true);
  assert.equal(annotationState().anchors[0].entry.note,'Original note');
  assert.equal(annotationState().decorations.find().length,0);
  undo(view.state,view.dispatch);
  assert.equal(annotationState().anchors[0].detached,false);
  assert.equal(annotationState().decorations.find()[0].type.attrs['data-hl-answer'],'complete');
  redo(view.state,view.dispatch);
  assert.equal(annotationState().anchors[0].detached,true);
  replace('Two copies: target and target.');
  assert.equal(annotationState().anchors[0].detached,true,'never attach an orphaned answer to an arbitrary duplicate');
  assert.equal(annotationState().anchors[0].entry.id,'one');
});

test('legacy highlights across equations migrate without losing their notes or answer IDs',()=>{
  const {view,annotationState}=fixture('Before $x^2$ after.');
  const entries=paintAnnotations(view,[{id:'legacy',start:0,end:14,text:'Before  after.',prefix:'',suffix:'',color:'blue',note:'Original'}]);
  assert.equal(entries[0].text,'Before $x^2$ after.');
  assert.equal(entries[0].id,'legacy'); assert.equal(entries[0].note,'Original'); assert.equal(entries[0].detached,false);
  assert.equal(annotationState().decorations.find().length,3,'prose and the atomic equation are all decorated');
});
