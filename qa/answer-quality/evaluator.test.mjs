import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(repo, 'scripts/evaluate-answer-quality.mjs');
const answer = 'An IPv6 address is 16 bytes (128 bits).';
const grade = JSON.stringify({results: ['must-1','must-2','mustNot-1','mustNot-2','mustNot-3']
  .map(id => ({id, holds:true, why:'Fixture verdict.'}))});
function completion(content, finishReason='stop') {
  return {model:'gpt-6-sol', choices:[{message:{role:'assistant',content},finish_reason:finishReason}],
    usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}};
}

async function exercise(respond, {model=true}={}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'breadboard-answer-quality-'));
  const reportPath = path.join(temp,'report.json');
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    let body='';
    for await(const chunk of req) body+=chunk;
    requests.push(JSON.parse(body));
    respond(req,res,requests.length);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let output='';
  try {
    const env={...process.env,BREADBOARD_REPO_ROOT:repo,BREADBOARD_DATA_DIR:path.join(temp,'data'),
      ANSWER_QUALITY_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`};
    for(const key of ['ANSWER_QUALITY_MODEL','ANSWER_QUALITY_GRADER','ANSWER_QUALITY_REASONING_EFFORT','ANSWER_QUALITY_GRADER_REASONING_EFFORT']) delete env[key];
    const child=spawn(process.execPath,['--experimental-strip-types',script,
      ...(model?['--model','gpt-6-sol','--reasoning-effort','max']:[]),
      '--scenario','one-fact-question-gets-the-fact','--json',reportPath],
      {cwd:repo,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>output+=b.toString());
    child.stderr.on('data',b=>output+=b.toString());
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
    const report=await fs.readFile(reportPath,'utf8').then(JSON.parse).catch(()=>null);
    return {code,requests,report,output};
  } finally {
    await new Promise(resolve=>server.close(resolve));
    const resolvedTemp=path.resolve(temp);
    assert.equal(path.dirname(resolvedTemp),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolvedTemp).startsWith('breadboard-answer-quality-'));
    await fs.rm(resolvedTemp,{recursive:true,force:true});
  }
}

test('uses the selected model and effort without Council and records the actual response',async()=>{
  const r=await exercise((_req,res,n)=>{
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(completion(n===1?answer:grade)));
  });
  assert.equal(r.code,0,r.output);
  assert.equal(r.requests.length,2);
  assert.equal(r.requests[0].model,'gpt-6-sol');
  assert.equal(r.requests[0].reasoning_effort,'max');
  assert.equal(r.requests[0].council,false);
  assert.equal(r.requests[1].council,false);
  assert.equal('max_completion_tokens' in r.requests[0],false);
  const entry=r.report[0];
  assert.equal(entry.status,'complete');
  assert.equal(entry.completion.reportedModel,'gpt-6-sol');
  assert.equal(entry.completion.finishReason,'stop');
  assert.equal(entry.answer,answer);
  assert.equal(entry.input.systemSha256,createHash('sha256').update(r.requests[0].messages[0].content).digest('hex'));
  assert.equal(entry.input.user,r.requests[0].messages[1].content);
  assert.ok(entry.completion.elapsedSeconds>=0);
});

for(const finish of ['length',null]) {
  test(`records an unfinished answer (${finish}) without retrying or grading it`,async()=>{
    const r=await exercise((_req,res)=>{
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(completion('Partial explanation',finish)));
    });
    assert.equal(r.code,1,r.output);
    assert.equal(r.requests.length,1);
    assert.equal(r.report[0].status,'error');
    assert.equal(r.report[0].passed,false);
    assert.equal(r.report[0].failedCompletion.answer,'Partial explanation');
    assert.equal(r.report[0].failedCompletion.finishReason,finish);
    assert.equal(r.report[0].graderCompletion,undefined);
  });
}

test('records a provider failure instead of replacing it with a hidden retry',async()=>{
  const r=await exercise((_req,res)=>{res.statusCode=503;res.end('Unavailable');});
  assert.equal(r.code,1,r.output);
  assert.equal(r.requests.length,1);
  assert.equal(r.report[0].status,'error');
  assert.match(r.report[0].error,/503/);
});

test('retains the answer when the grader stops before completion',async()=>{
  const r=await exercise((_req,res,n)=>{
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(n===1?completion(answer):completion('{"results":[','length')));
  });
  assert.equal(r.code,1,r.output);
  assert.equal(r.requests.length,2);
  assert.equal(r.report[0].failedStage,'grading');
  assert.equal(r.report[0].answer,answer);
  assert.equal(r.report[0].failedCompletion.answer,'{"results":[');
  assert.equal(r.report[0].passed,false);
});

test('retains a completed but malformed grader response for inspection',async()=>{
  const r=await exercise((_req,res,n)=>{
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(completion(n===1?answer:'This is not the required JSON.')));
  });
  assert.equal(r.code,1,r.output);
  assert.equal(r.requests.length,2);
  assert.equal(r.report[0].failedStage,'grading');
  assert.equal(r.report[0].answer,answer);
  assert.equal(r.report[0].graderCompletion.answer,'This is not the required JSON.');
  assert.equal(r.report[0].passed,false);
});

test('requires an explicit answering model before making provider calls',async()=>{
  const r=await exercise((_req,res)=>res.end('{}'),{model:false});
  assert.equal(r.code,1);
  assert.equal(r.requests.length,0);
  assert.match(r.output,/Select the implicated answering model/);
});
