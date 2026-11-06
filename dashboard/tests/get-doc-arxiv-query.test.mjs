import assert from 'node:assert/strict';
import test from 'node:test';
import {arxivUrl,exactArxivId,searchArxiv} from '../src/lib/get-doc/sources.ts';
import {planSearch} from '../src/lib/get-doc/query-plan.ts';
import {rankHits} from '../src/lib/get-doc/search.ts';

const query = text => ({query:text,limit:1,openAccessOnly:true,yearFrom:null,yearTo:null});
const paper = '<feed><opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is All You Need</title><published>2017-06-12</published><author><name>Ashish Vaswani</name></author></entry></feed>';

test('arXiv retains every keyword as an explicit conjunction rather than a loose single-term match', () => {
  const query = text => new URL(arxivUrl({query:text,limit:5,openAccessOnly:false,yearFrom:null,yearTo:null})).searchParams.get('search_query');
  assert.equal(query('quantum error correction'), 'all:quantum AND all:error AND all:correction');
  assert.equal(query('low-resource multilingual models'), 'all:low-resource AND all:multilingual AND all:models');
  assert.equal(query('énergie solaire'), 'all:énergie AND all:solaire');
  assert.equal(query('ti:password OR all:secret'), 'all:ti AND all:password AND all:OR AND all:all AND all:secret');
});

test('exact arXiv identifiers and links use id_list without splitting the catalog key', () => {
  for (const [input,expected] of [['1706.03762','1706.03762'],['arXiv:1706.03762v7','1706.03762v7'],['https://arxiv.org/abs/1706.03762','1706.03762'],['https://arxiv.org/pdf/1706.03762.pdf','1706.03762'],['hep-th/9901001','hep-th/9901001']]) {
    const url=new URL(arxivUrl(query(input)));
    assert.equal(url.searchParams.get('id_list'),expected);
    assert.equal(url.searchParams.has('search_query'),false);
  }
  for(const input of ['1706.03762 OR all:secret','https://evil.example/1706.03762','https://arxiv.org/abs/1706.03762?x=y','find 1706.03762']) assert.equal(exactArxivId(input),null);
});

test('an exact identifier survives conversation context without asking a model to rewrite it', async t => {
  t.mock.method(globalThis,'fetch',()=>{throw Error('Exact ID planning must not call a model');});
  const result=await planSearch({baseUrl:'http://unused',model:'unused',reasoningEffort:'low',task:'Earlier conversation mentions another paper. Current request: 1706.03762',catalogQuery:'1706.03762'});
  assert.deepEqual(result.plan.queries,['1706.03762']);
  assert.equal(result.modelUsed,false);
  assert.deepEqual(result.usage,{inputTokens:0,outputTokens:0});
});

test('a genuinely empty conjunction retries a safe exact phrase and returns the paper', async t => {
  const urls=[];
  t.mock.method(globalThis,'fetch',async input=>{urls.push(new URL(input));return new Response(urls.length===1?'<feed><opensearch:totalResults>0</opensearch:totalResults></feed>':paper);});
  const hits=await searchArxiv(query('Attention Is All You Need'));
  assert.equal(urls[0].searchParams.get('search_query'),'all:Attention AND all:Is AND all:All AND all:You AND all:Need');
  assert.equal(urls[1].searchParams.get('search_query'),'all:"Attention Is All You Need"');
  assert.equal(hits[0].title,'Attention Is All You Need');
  assert.equal(hits[0].pdfUrl,'https://arxiv.org/pdf/1706.03762v7');
});

test('an exact identifier uses one catalog request and returns a real document record', async t => {
  const urls=[];
  t.mock.method(globalThis,'fetch',async input=>{urls.push(new URL(input));return new Response(paper);});
  const hits=await searchArxiv(query('1706.03762'));
  assert.equal(urls.length,1);
  assert.equal(urls[0].searchParams.get('id_list'),'1706.03762');
  assert.equal(hits.length,1);
  assert.equal(hits[0].openAccess,true);
});

test('a normalized exact title ranks ahead of longer containing titles before a one-result limit', () => {
  const hit=title=>({title,sources:['arxiv'],pdfUrl:'https://arxiv.org/pdf/1706.03762',openAccess:true,citationCount:0});
  const longer=hit('Tool Attention Is All You Need: Dynamic Tool Gating');
  const exact=hit('Attention Is All You Need');
  assert.equal(rankHits([longer,exact],'  ATTENTION  Is All You Need ').at(0),exact);
  assert.equal(rankHits([longer,exact],'Ａttention Is All You Need').at(0),exact);
});

test('a substring or punctuation-different title receives no exact-title promotion', () => {
  const hit=(title,citationCount)=>({title,sources:['arxiv'],pdfUrl:'https://arxiv.org/pdf/1706.03762',openAccess:true,citationCount});
  const richer=hit('Methods of attention',100000);
  const partial=hit('Attention is all you need',0);
  assert.equal(rankHits([partial,richer],'attention').at(0),richer);
  const punctuated=hit('Attention Is All You Need!',100000);
  assert.equal(rankHits([partial,punctuated],'Attention Is All You Need?').at(0),punctuated);
});
