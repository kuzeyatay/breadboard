import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { refreshQuartzRuntimeAssets } from '../src/main/quartz-runtime-assets';

test('app upgrades refresh retained Quartz scripts without publishing or changing Garden data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quartz-runtime-assets-'));
  try {
    const assets = path.join(root, 'app'), published = path.join(root, 'public');
    fs.mkdirSync(assets); fs.mkdirSync(path.join(published, 'static'), { recursive: true });
    for (const name of ['prescript.js', 'postscript.js', 'index.css']) {
      fs.writeFileSync(path.join(assets, name), `current ${name}`);
      fs.writeFileSync(path.join(published, name), `obsolete ${name}`);
    }
    fs.writeFileSync(path.join(published, 'static/contentIndex.json'), '{"old garden":{}}');
    fs.writeFileSync(path.join(published, 'index.html'), 'retained publication');
    assert.equal(refreshQuartzRuntimeAssets(assets, published), 3);
    assert.equal(fs.readFileSync(path.join(published, 'postscript.js'), 'utf8'), 'current postscript.js');
    assert.equal(fs.readFileSync(path.join(published, 'index.html'), 'utf8'), 'retained publication');
    assert.equal(fs.readFileSync(path.join(published, 'static/contentIndex.json'), 'utf8'), '{"old garden":{}}');
    const modified = fs.statSync(path.join(published, 'postscript.js')).mtimeMs;
    assert.equal(refreshQuartzRuntimeAssets(assets, published), 0);
    assert.equal(fs.statSync(path.join(published, 'postscript.js')).mtimeMs, modified);
    // A publication rolled back independently of the app must also recover.
    fs.writeFileSync(path.join(published, 'postscript.js'), 'obsolete again');
    assert.equal(refreshQuartzRuntimeAssets(assets, published), 1);
    fs.rmSync(path.join(assets, 'postscript.js'));
    fs.writeFileSync(path.join(assets, 'prescript.js'), 'partial new build');
    assert.throws(() => refreshQuartzRuntimeAssets(assets, published), /ENOENT/);
    assert.equal(fs.readFileSync(path.join(published, 'prescript.js'), 'utf8'), 'current prescript.js');
    assert.equal(fs.readdirSync(published).some(name => name.endsWith('.tmp')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
