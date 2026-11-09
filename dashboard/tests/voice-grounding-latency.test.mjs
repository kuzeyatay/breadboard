import test from 'node:test';
import assert from 'node:assert/strict';
import {adjudicateWebGrounding} from '../src/lib/hermes/web-grounding-decider.ts';

test('a shared deadline cancels a stalled classifier without restarting the clock for fallback',async()=>{
 const signals=[];
 const verdict=await adjudicateWebGrounding({request:'Which local connections are currently available?',plannerRequired:true,timeoutMs:80,totalTimeoutMs:30,
  fetcher:async(_url,{signal})=>{
   signals.push(signal);
   return new Promise((resolve,reject)=>{
    const guard=setTimeout(()=>reject(Error('Fixture exceeded its deadline')),500);
    signal.addEventListener('abort',()=>{clearTimeout(guard);reject(signal.reason);},{once:true});
   });
  }});
 assert.equal(signals.length,1,'a timed-out total budget cannot start another provider');
 assert.equal(signals[0].aborted,true);
 assert.equal(verdict.source,'decider_unavailable');
 assert.equal(verdict.required,false,'preserve the existing unavailable verdict');
});

test('a quick provider failure still allows a valid verdict inside the shared budget',async()=>{
 let calls=0;
 const verdict=await adjudicateWebGrounding({request:'Check the current departure time.',plannerRequired:true,totalTimeoutMs:1000,
  fetcher:async()=>++calls===1?new Response('',{status:503}):Response.json({choices:[{message:{content:'WEB: a current timetable is needed'}}]})});
 assert.equal(calls,2);assert.equal(verdict.source,'decider');assert.equal(verdict.required,true);
});

test('ordinary callers retain per-provider timeouts and their fallback',async()=>{
 let calls=0;
 const verdict=await adjudicateWebGrounding({request:'Explain this supplied report.',plannerRequired:true,timeoutMs:20,
  fetcher:async(_url,{signal})=>{
   if(++calls===2)return Response.json({choices:[{message:{content:'NO_WEB: the supplied report is sufficient'}}]});
   return new Promise((resolve,reject)=>{
    const guard=setTimeout(()=>reject(Error('Fixture exceeded its deadline')),500);
    signal.addEventListener('abort',()=>{clearTimeout(guard);reject(signal.reason);},{once:true});
   });
  }});
 assert.equal(calls,2);assert.equal(verdict.source,'decider');assert.equal(verdict.required,false);
});
