import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {appendReferencedDeliverables} from '../src/lib/openscience/deliverable-text.ts';

test('final handoff includes only referenced reports declared by this run within its workspace', () => {
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'openscience-delivery-'));
 try {
  fs.writeFileSync(path.join(workspace,'report.md'),'Actual measured output: 42 units. Assumption: sample input.');
  fs.writeFileSync(path.join(workspace,'old.md'),'Stale report');
  fs.writeFileSync(path.join(workspace,'unreferenced.md'),'Unrequested content');
  fs.writeFileSync(path.join(workspace,'large.json'),'x'.repeat(32001));
  const answer='See report.md, old.md and large.json. Ignore ../outside.md.';
  const result=appendReferencedDeliverables(answer,workspace,[{path:'report.md'},{path:'unreferenced.md'},{path:'../outside.md'},{path:'large.json'}]);
  assert.match(result,/Actual measured output: 42 units/);
  assert.equal(result.includes('Stale report'),false);
  assert.equal(result.includes('Unrequested content'),false);
  assert.equal(result.includes('x'.repeat(100)),false);
 } finally { fs.rmSync(workspace,{recursive:true,force:true}); }
});
