import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const load = async entry => {
  const b=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm'});
  return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
};
const {parseDictationReply,requestDictationReply}=await load('src/lib/speech/dictation-reply.ts');
const {dictationReplyStream}=await load('src/lib/speech/dictation-reply-stream.ts');
const screen={dataUrl:'data:image/jpeg;base64,/9j/AA==',width:1600,height:900,caret:{x:200,y:500}};
const message=text=>({type:'message',content:[{type:'output_text',text}]});
async function* events(values){yield* values;}

test('only bounded JPEG snapshots and an explicit spoken request are accepted',()=>{
  assert.equal(parseDictationReply({text:' Explain this ',screen}).text,'Explain this');
  for(const invalid of [{...screen,dataUrl:'https://outside.test/image.jpg'},{...screen,width:0},{...screen,caret:{x:1001,y:2}},{...screen,dataUrl:'data:image/jpeg;base64,'+'x'.repeat(4_000_000)}])
    assert.throws(()=>parseDictationReply({text:'Question',screen:invalid}),/snapshot/);
  assert.throws(()=>parseDictationReply({text:'',screen}),/request/);
});
test('provider deltas, final-only replies and final recovery never duplicate the answer',async()=>{
  for(const deltas of [[],[{type:'response.output_text.delta',output_index:0,delta:'Hello '}]]){
    let stopped=0;
    const stream=dictationReplyStream(events([...deltas,{type:'response.output_item.done',output_index:0,item:message('Hello café 世界')},{type:'response.completed',response:{output:[message('Hello café 世界')]}}]),()=>stopped++);
    const lines=(await new Response(stream).text()).trim().split('\n').map(JSON.parse);
    assert.equal(lines.filter(x=>x.type==='delta').map(x=>x.text).join(''),'Hello café 世界');
    assert.equal(lines.at(-1).type,'done');assert.equal(stopped,1);
  }
});
test('a failed or truncated provider stream never reports a completed draft',async()=>{
  for(const tail of [[],[{type:'response.failed'}],[{type:'response.incomplete'}]]){
    const stream=dictationReplyStream(events([{type:'response.output_text.delta',output_index:0,delta:'partial'},...tail]),()=>{});
    const lines=(await new Response(stream).text()).trim().split('\n').map(JSON.parse);
    assert.equal(lines.at(-1).type,'error');assert.equal(lines.some(x=>x.type==='done'),false);
  }
});
test('client streams fragmented UTF-8, requires completion, and propagates cancellation',async t=>{
  const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
  let observed;
  const body=JSON.stringify({type:'delta',text:'Café 世界'})+'\n'+JSON.stringify({type:'done'})+'\n';
  globalThis.fetch=async(url,init)=>{observed={url,init};const bytes=new TextEncoder().encode(body);return new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}));};
  const previews=[],controller=new AbortController();
  assert.equal(await requestDictationReply('Reply',screen,controller.signal,x=>previews.push(x)),'Café 世界');
  assert.deepEqual(previews,['Café 世界']);assert.equal(observed.init.signal,controller.signal);assert.deepEqual(JSON.parse(observed.init.body),{text:'Reply',screen});
  globalThis.fetch=async()=>new Response('{"type":"delta","text":"incomplete"}\n');
  await assert.rejects(requestDictationReply('Reply',screen,controller.signal,()=>{}),/interrupted/);
  controller.abort();await assert.rejects(requestDictationReply('Reply',screen,controller.signal,()=>assert.fail('stale text')), {name:'AbortError'});
});
