import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardBuildMemoryPlan} from './commit-preflight.mjs';
test('packaging keeps its established default budget',()=>{
 for(const value of [undefined,'','   ']) assert.deepEqual(dashboardBuildMemoryPlan({BREADBOARD_DASHBOARD_BUILD_HEAP_MB:value}),{heapMb:8192,estimateMb:11264});
});
test('a bounded lower heap reduces its estimate by exactly the same amount',()=>{
 for(const heap of [4096,6144,8192]){
  const plan=dashboardBuildMemoryPlan({BREADBOARD_DASHBOARD_BUILD_HEAP_MB:String(heap)});
  assert.equal(plan.heapMb,heap);assert.equal(plan.estimateMb-plan.heapMb,3072);
 }
});
test('unsupported or malformed ceilings are rejected before compilation',()=>{
 for(const value of ['0','4095','8193','6144.5','6GiB','-1','NaN','Infinity','1e4']) assert.throws(()=>dashboardBuildMemoryPlan({BREADBOARD_DASHBOARD_BUILD_HEAP_MB:value}));
});
