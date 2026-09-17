import assert from "node:assert/strict";
import test from "node:test";
import {collectFeynmanFacets} from "../src/lib/max-research/feynman-facets.ts";

test("Feynman covers distinct planned queries within one budget and removes repeated papers", async () => {
  const calls=[];
  const results=await collectFeynmanFacets(["Material strength", "Energy demand", "Operating cost", "Material strength"], async input => {
    calls.push(input);
    return {query:input.query,papers:[{id:"common",doi:"10.1/Common"},{id:input.query,doi:null}],sources:[],limitations:[]};
  });
  assert.deepEqual(calls.map(call=>call.query),["Material strength","Energy demand","Operating cost"]);
  assert.equal(calls.reduce((total,call)=>total+call.limit,0),12);
  assert.equal(calls.reduce((total,call)=>total+call.fullTextTop,0),3);
  assert.deepEqual(results.map(result=>result.papers.length),[2,1,1]);
  assert.equal(results[2].papers[0].id,"Operating cost");
});
