import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {launchShape} from '../scripts/runtime-v2-managed-python-service.mjs';

test('validated local state paths reach Python without Windows namespace syntax',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'managed-service-paths-'));
 const previous={...process.env};
 try{
  delete process.env.BREADBOARD_BULK_DATA_DIR;
  const data=path.join(root,'data'),source=path.join(root,'source');
  fs.mkdirSync(source,{recursive:true});
  for(const service of ['vibe-trading','stock-analyst']){
   const python=path.join(data,'runtime-v2/services',service,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
   fs.mkdirSync(path.dirname(python),{recursive:true});fs.writeFileSync(python,'owned-path-validation-fixture');
   const home=path.join(data,'runtime',service,'home');
   const canonical=process.platform==='win32'?path.toNamespacedPath: x=>x;
   Object.assign(process.env,{BREADBOARD_MANAGED_PYTHON_EXECUTABLE:canonical(python),BREADBOARD_MANAGED_PYTHON_SOURCE_ROOT:canonical(source),BREADBOARD_MANAGED_PYTHON_SERVICE_ID:service,BREADBOARD_MANAGED_PYTHON_SERVICE_PORT:'12345',VIBE_TRADING_SERVICE_API_KEY:'owned-test-value-with-at-least-32-characters',VIBE_TRADING_HOME:canonical(home),STOCK_ANALYST_HOME:canonical(home)});
   const config=service==='vibe-trading'?{schemaVersion:1,serviceId:service,environment:{},bindHost:'127.0.0.1',serviceAuthentication:'runtime-injected'}:{schemaVersion:1,serviceId:service,environment:{},envFileContents:'SCHEDULE_ENABLED=false\n',stateLayout:{database:'data/stock_analysis.db',logs:'logs'},bindHost:'127.0.0.1'};
   const shape=launchShape(service,12345,config,canonical(data));
   assert.equal(shape.python,python);assert.equal(shape.cwd,source);
   assert.equal(shape.env.PYTHONUTF8,'1');assert.equal(shape.env.PYTHONIOENCODING,'utf-8');
   if(service==='vibe-trading')assert.equal(shape.env.VIBE_TRADING_HOME,home);
   else{
    assert.equal(shape.env.DATABASE_PATH,path.join(home,'data/stock_analysis.db'));
    assert.equal(shape.env.LOG_DIR,path.join(home,'logs'));
    assert.equal(shape.env.ENV_FILE,path.join(home,'breadboard.env'));
   }
  }
 }finally{
  for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];
  Object.assign(process.env,previous);
  const resolved=path.resolve(root),parent=path.resolve(os.tmpdir());
  assert.ok(resolved.startsWith(parent+path.sep));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
});
