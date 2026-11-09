import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync(new URL('../src/lib/bolt-slides/deck-preview.ts',import.meta.url),'utf8');
const {withBoltDeckBase}=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);

const run='job_'+'b'.repeat(64),root=`http://127.0.0.1:63090/api/bolt-slides/runs/${run}/deck`;
const html='<!doctype html><html><head><script type="module" src="./assets/index.js"></script><link rel="stylesheet" href="./assets/index.css"></head><body><div id="root"></div></body></html>';
for(const page of [root,root+'/',root+'/index.html']){
  test(`built scripts and styles resolve under the owned deck at ${new URL(page).pathname.split('/').at(-1)||'slash'}`,()=>{
    const served=withBoltDeckBase(html,run),base=served.match(/<base href="([^"]+)"/)[1];
    for(const file of ['index.js','index.css'])assert.equal(new URL('./assets/'+file,new URL(base,page)).href,root+'/assets/'+file);
    assert.ok(served.indexOf('<base ')<served.indexOf('<script '));
    assert.ok(served.includes('<div id="root"></div>'));
    assert.equal(html.includes('<base '),false,'the portable build stays unchanged');
  });
}
test('an authored base cannot redirect the preview away from its owning run',()=>{
  const served=withBoltDeckBase('<HEAD lang="en"><base href="https://example.invalid/"></HEAD>',run);
  assert.equal(served.match(/<base href="([^"]+)"/)[1],new URL(root).pathname+'/');
});
test('a minimal HTML entry still receives its owned base',()=>{
  assert.ok(withBoltDeckBase('<div>Deck</div>',run).startsWith('<base href="/api/bolt-slides/'));
});
test('existing safe run identifiers retain the same preview contract',()=>{
  assert.ok(withBoltDeckBase(html,'job_older-identifier').includes('/runs/job_older-identifier/deck/'));
});
test('untrusted run values cannot become HTML or a cross-run path',()=>{
  for(const id of ['../other','x"/><script>bad</script>','','x'.repeat(129)])assert.throws(()=>withBoltDeckBase(html,id),/invalid_run_id/);
});
