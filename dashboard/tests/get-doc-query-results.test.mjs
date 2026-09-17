import assert from "node:assert/strict";
import test from "node:test";
import {mergeQueryResults} from "../src/lib/get-doc/query-results.ts";

test("a full first query cannot crowd complementary evidence out of the final list", () => {
  const group=name=>Array.from({length:10},(_,index)=>({title:`${name} ${index}`}));
  const result=mergeQueryResults([group("First subject"),group("Second subject"),group("Third subject")],10);
  assert.equal(result.length,10);
  assert.deepEqual(result.slice(0,3).map(p=>p.title),["First subject 0","Second subject 0","Third subject 0"]);
});

test("duplicate and empty query results preserve the limit and remaining unique papers", () => {
  assert.deepEqual(mergeQueryResults([
    [{title:"One",doi:"10.1234/ABC"},{title:"Two"}],[],
    [{title:"Same paper",doi:"10.1234/abc"},{title:"Three"}],
  ],3).map(p=>p.title),["One","Two","Three"]);
  assert.deepEqual(mergeQueryResults([[{title:"Only"}]],0),[]);
});
