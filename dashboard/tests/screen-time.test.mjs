import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { formatDuration, normalizeUsage, readUsageSlice, safeUsageUrl, screenTimeRange, summarizeUsage } from '../src/lib/screen-time/model.ts';
import { activityRecommendationEvidence } from '../src/lib/screen-time/evidence.ts';

const start = Date.parse('2026-11-08T08:00:00Z');
const slice = (from, to, extra = {}) => ({ start:start+from, end:start+to, app:'Breadboard', process:'breadboard', title:'Signals and systems', kind:'breadboard', url:'/garden/signals', ...extra });

test('time is counted once across app totals, named tabs and domains', () => {
  const result = summarizeUsage([slice(0,30000),slice(30000,60000),slice(60000,120000,{app:'Visual Studio Code',process:'Code',title:'app.ts',kind:'app',url:undefined}),
    slice(120000,180000,{title:'Filter design',kind:'website',url:'https://en.wikipedia.org/wiki/Filter',domain:'en.wikipedia.org'})], [start,start+180000]);
  assert.equal(result.total,180000); assert.equal(result.breadboardTotal,120000);
  assert.equal(result.apps.reduce((sum,item)=>sum+item.milliseconds,0),result.total);
  assert.equal(result.tabs.reduce((sum,item)=>sum+item.milliseconds,0),result.breadboardTotal);
  assert.equal(result.websites[0].milliseconds,60000); assert.equal(result.tabs.find(item=>item.name==='Signals and systems').visits,1);
  assert.equal(result.switches,2); assert.equal(result.longestSession,60000);
});

test('overlapping or replayed intervals cannot inflate totals; windows clip at both ends', () => {
  const rows=[slice(0,30000),slice(0,30000),slice(15000,45000),slice(60000,90000)];
  const result=summarizeUsage(rows,[start+10000,start+75000]);
  assert.equal(result.total,50000); assert.equal(result.switches,0);
  assert.equal(result.longestSession,35000);
  assert.equal(normalizeUsage(rows,start+10000,start+75000).length,2);
});

test('hour and midnight splits preserve durations and full bucket drilldowns',()=>{
  const rows=[];for(let index=0;index<220;index++) rows.push(slice(index*20000,index*20000+10000,{title:`Tab ${index}`}));
  const result=summarizeUsage(rows,[start,start+3600000,start+7200000]);
  assert.equal(result.timeline.length,150);
  assert.equal(result.buckets[0].tabs.length,180,'older bucket rows are independent of the recent timeline cap');
  assert.equal(result.buckets[0].total,1800000);
  assert.equal(result.buckets.reduce((sum,item)=>sum+item.total,0),result.total);
  const crossing=summarizeUsage([slice(0,30000)],[start+5000,start+15000,start+25000]);
  assert.deepEqual(crossing.buckets.map(item=>item.total),[10000,10000]);
});

test('empty histories, seconds and sanitization are honest and safe',()=>{
  assert.equal(summarizeUsage([],[start,start+3600000]).total,0);
  assert.equal(formatDuration(40000),'<1m'); assert.equal(formatDuration(3660000),'1h 1m');
  for(const value of ['javascript:alert(1)','//evil.example','/\\evil.example','https://user:secret@example.org']) assert.equal(safeUsageUrl(value),undefined);
  assert.equal(safeUsageUrl('https://example.org/page?token=secret#section'),'https://example.org/page');
  assert.equal(readUsageSlice({...slice(0,1),end:Infinity}),null);
  assert.equal(readUsageSlice({...slice(0,1),end:start+86400000}),null);
  assert.equal(readUsageSlice(slice(0,1000)).title,'Signals and systems');
});

test('calendar ranges respect Amsterdam DST and month length',()=>{
  const moduleUrl=new URL('../src/lib/screen-time/model.ts',import.meta.url).href;
  const code=`import {screenTimeRange} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(['2026-03-29','2026-10-25'].map(d=>{const r=screenTimeRange('day',d);return [r.boundaries.length-1,(r.end-r.start)/3600000]})));`;
  const result=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{env:{...process.env,TZ:'Europe/Amsterdam'},encoding:'utf8'}));
  assert.deepEqual(result,[[23,23],[25,25]]);
  const month=screenTimeRange('month','2026-02-14');assert.equal(month.boundaries.length,29);
});

test('suggestion evidence excludes fleeting visits and housekeeping; it never assumes unfinished work',()=>{
  const result=summarizeUsage([slice(0,120000),slice(120000,130000,{title:'Brief visit'}),slice(130000,250000,{title:'Screen Time · Breadboard',url:'/screen-time'})],[start,start+250000]);
  const evidence=activityRecommendationEvidence(result.tabs);
  assert.equal(evidence.length,1);assert.equal(evidence[0].title,'Signals and systems');
  assert.equal(evidence[0].source,'screen-time');assert.match(evidence[0].summary,/does not show whether/);
  assert.match(evidence[0].summary,/2m/);assert.equal(evidence[0].id,activityRecommendationEvidence(result.tabs)[0].id);
});
