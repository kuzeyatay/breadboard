import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

function load(file, modules) {
  const code=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  new Function('require','exports',code)(id=>{assert.ok(id in modules,`Unexpected import: ${id}`);return modules[id];},exports);
  return exports;
}

test('setup probes dependencies once, then reads the persona catalog without another import',()=>{
  let imports=0, catalogs=0;
  const checked={available:true,root:'C:/matraix',python:'D:/venv/python.exe',bridge:'C:/bridge.py',pythonVersion:'3.12',cloned:true};
  const runtime={MATRAIX_DEV_POOL:'dev',MATRAIX_PRODUCTION_POOL:'production',matraixAvailability:()=>{imports++;return checked;},matraixVenv:()=> 'D:/venv',productionPoolPresent:()=>false,resolveMatraixRoot:()=>checked.root};
  const catalog=load('../src/lib/matraix/catalog.ts',{
    './runtime.ts':runtime,
    'node:child_process':{spawnSync:(executable,args,options)=>{
      catalogs++;
      assert.equal(executable,checked.python);
      assert.deepEqual(args,[checked.bridge,'--root',checked.root,'--catalog','--pool','dev','--top','80']);
      assert.equal(options.env.PYTHONDONTWRITEBYTECODE,'1');
      assert.equal(options.timeout,180000);
      return {stdout:JSON.stringify({event:'catalog',pool:'dev',count:200,dimensionCount:1,dimensions:[{id:'age',personas:200,values:[]}]}),status:0};
    }},
  });
  catalog.forgetMatraixCatalog();
  try {
    const setup=load('../src/lib/matraix/setup.ts',{'node:path':{default:path},'../external-runtime-filesystem.ts':{externalRuntimePathExists:()=>true},'./runtime.ts':runtime,'./catalog.ts':catalog});
    const result=setup.setupStatus({});
    assert.equal(result.ready,true);
    assert.equal(result.pools[0].personas,200);
    assert.equal(imports,1);
    assert.equal(catalogs,1);
    catalog.forgetMatraixCatalog();
    assert.equal(catalog.matraixCatalog('dev').count,200);
    assert.equal(imports,2,'a standalone catalog read still checks dependencies');
  } finally { catalog.forgetMatraixCatalog(); }
});

test('an unavailable runtime does not attempt a catalog process',()=>{
  const catalog=load('../src/lib/matraix/catalog.ts',{
    './runtime.ts':{MATRAIX_DEV_POOL:'missing',matraixAvailability:()=>{throw Error('already checked');}},
    'node:child_process':{spawnSync:()=>{throw Error('must not launch');}},
  });
  assert.equal(catalog.matraixCatalog('missing',{available:false}),null);
});
