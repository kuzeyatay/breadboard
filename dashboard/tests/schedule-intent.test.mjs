import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {pathToFileURL} from 'node:url';
import test from 'node:test';

const candidate=process.env.BREADBOARD_SCHEDULE_TEST_SOURCE;
let module;
if(candidate){
  const cron=pathToFileURL(process.env.BREADBOARD_SCHEDULE_TEST_CRON).href;
  const source=fs.readFileSync(candidate,'utf8').replace('"./cron.ts"',JSON.stringify(cron));
  module=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
}else module=await import('../src/lib/schedules/natural-language.ts');
const {parseExplicitScheduleRequest,parseScheduleRequest}=module;
const now=new Date('2026-11-07T08:27:19.000Z');

for(const prompt of [
  '/agents:vibe-trading Use the strategy specialist to calculate the compounded total return of this fictional price series100,110,99. Explain why adding the daily percentages gives a different result. Use only these inline numbers; no real market lookup, recommendation, trade, accounts, files, installation or settings change.',
  '/workflows:markets:strategy Analyze the daily percentages in this price series: 100, 110, 99.',
  'Analyze daily returns using only the supplied numbers.',
  'Summarize the monthly costs in this table.',
  'Write a weekly report from these supplied notes.',
  'Calculate the hourly rate for this project.',
  'Review every row and summarize the daily totals.',
  'Explain why prices change every day.',
  'What should I check every morning?',
  'Summarize the phrase "run this every day".',
  'Write a paragraph explaining `every weekday at 8`.',
  'Do not run this daily.',
  "Please don't schedule this every week.",
  'What happened in an hour?',
])test('ordinary request stays in chat: '+prompt,()=>assert.equal(parseExplicitScheduleRequest(prompt,now),null));

for(const [prompt,cron] of [
  ['every friday at 6pm summarize the week','0 18 * * 5'],
  ['every weekday at 8:30 brief me','30 8 * * 1-5'],
  ['every hour check the build','0 * * * *'],
  ['every weekend at 10am prepare a reading list','0 10 * * 0,6'],
  ['every month on the 3rd review my notes','0 9 3 * *'],
  ['Send me the forecast daily','0 9 * * *'],
  ['Please check the build hourly.','0 * * * *'],
  ['daily at 8am send me a brief','0 8 * * *'],
  ['Can you schedule a daily report about the supplied prices?','0 9 * * *'],
  ['/agents:vibe-trading Analyze the portfolio every weekday at 8:30','30 8 * * 1-5'],
])test('explicit recurring action remains supported: '+prompt,()=>{
  const result=parseExplicitScheduleRequest(prompt,now);assert.ok(result);assert.equal(result.cron,cron);assert.equal(result.oneShot,false);
  if(prompt.startsWith('/agents:'))assert.ok(result.prompt.startsWith('/agents:vibe-trading '));
});

test('explicit delayed tasks and reminders retain their exact due time',()=>{
  assert.equal(parseExplicitScheduleRequest('start this task in an hour and half',now).runAt,'2026-11-07T09:57:19.000Z');
  assert.equal(parseExplicitScheduleRequest('can you remind me to drink water 5 minutes later',now).runAt,'2026-11-07T08:32:19.000Z');
});
test('the dedicated schedule editor retains its visible default for an ambiguous draft',()=>{
  const result=parseScheduleRequest('keep an eye on my reading list',now);assert.equal(result.recognized,false);assert.equal(result.cron,'0 9 * * *');
});
