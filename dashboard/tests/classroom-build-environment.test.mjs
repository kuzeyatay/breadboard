import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {installEnvironment} from '../src/lib/classroom/setup.ts';

const require=createRequire(import.meta.url);
function nextBuildIdentity(t,env){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'classroom-build-env-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'next.config.js'),"module.exports={generateBuildId:async()=> 'classroom-fixture',async headers(){return [{source:'/:path*',headers:[{key:'Content-Security-Policy',value:process.env.ALLOWED_FRAME_ANCESTORS}]}]}};");
  const script=`const load=require(${JSON.stringify(require.resolve('next/dist/server/config.js'))}).default;
    const {generateBuildId}=require(${JSON.stringify(require.resolve('next/dist/build/generate-build-id.js'))});
    (async()=>{const config=await load('phase-production-build',${JSON.stringify(root)},undefined,undefined,true);
      const id=await generateBuildId(config.generateBuildId,()=> 'fallback');
      console.log(JSON.stringify({id,headers:await config.headers()}));
    })().catch(error=>{console.error(error.message);process.exitCode=1});`;
  return spawnSync(process.execPath,['-e',script],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:30000});
}

test('Classroom keeps install settings but drops the parent Next process context without mutating it',()=>{
  const source={PATH:'/node',HTTPS_PROXY:'http://proxy.test',npm_config_cache:'D:/cache/npm',COREPACK_HOME:'D:/cache/corepack',
    __NEXT_PRIVATE_STANDALONE_CONFIG:'{"output":"standalone"}',__NEXT_PRIVATE_RENDER_WORKER:'1',__NEXT_PROCESSED_ENV:'true'};
  const original={...source},env=installEnvironment('D:/tools',source);
  for(const key of ['__NEXT_PRIVATE_STANDALONE_CONFIG','__NEXT_PRIVATE_RENDER_WORKER','__NEXT_PROCESSED_ENV'])assert.equal(env[key],undefined,key);
  assert.equal(env.HTTPS_PROXY,source.HTTPS_PROXY);assert.equal(env.npm_config_cache,source.npm_config_cache);
  assert.equal(env.COREPACK_HOME,source.COREPACK_HOME);assert.equal(env.PATH,`D:/tools${path.delimiter}/node`);
  assert.equal(env.ALLOWED_FRAME_ANCESTORS,'http://127.0.0.1:* http://localhost:*');
  assert.deepEqual(source,original);
});

test('inherited standalone JSON reproduces the real Next generate error before any build work',t=>{
  const result=nextBuildIdentity(t,{...process.env,__NEXT_PRIVATE_STANDALONE_CONFIG:'{"output":"standalone"}'});
  assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/generate is not a function/);
});

test('Classroom setup lets Next load its own build identity and embedding headers',t=>{
  const env=installEnvironment(path.dirname(process.execPath),{...process.env,
    __NEXT_PRIVATE_STANDALONE_CONFIG:'{"output":"standalone"}',__NEXT_PROCESSED_ENV:'true'});
  const result=nextBuildIdentity(t,env);
  assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout.trim());
  assert.equal(output.id,'classroom-fixture');
  assert.equal(output.headers[0].headers[0].value,'http://127.0.0.1:* http://localhost:*');
});
