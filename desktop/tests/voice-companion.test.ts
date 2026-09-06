import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

test('voice companion uses a wide frameless widget, hides to keep wake available, and restricts its bridge', {skip:process.platform !== 'win32'}, () => {
  const desktopRoot = path.resolve(__dirname, '..', '..');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'breadboard-voice-'));
  try {
    const resultPath = path.join(fixtureRoot, 'result.json');
    const config = path.join(fixtureRoot, 'config.json');
    fs.writeFileSync(config, JSON.stringify({desktopRoot,fixtureRoot,resultPath}));
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(path.join(desktopRoot,'node_modules','electron','dist','electron.exe'), [path.join(desktopRoot,'tests','fixtures','voice-companion.cjs'),config], {env,windowsHide:true,encoding:'utf8',timeout:30000});
    const result = fs.existsSync(resultPath) ? fs.readFileSync(resultPath,'utf8') : run.stderr;
    assert.equal(run.status,0,result); assert.equal(JSON.parse(result).ok,true,result);
  } finally { fs.rmSync(fixtureRoot,{recursive:true,force:true}); }
});
