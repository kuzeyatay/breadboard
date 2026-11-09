import assert from 'node:assert/strict';
import test from 'node:test';
import {enclosureIntent} from '../src/lib/cad/board-enclosures.ts';
import {parseHardwareBlueprintRequest} from '../src/lib/hardware/identity.ts';
import {startRuntimeWorkerRun,getRuntimeWorkerEventsSince,isRuntimeWorkerTerminal,abortRuntimeWorkerRun} from '../src/lib/hardware/run-manager.ts';

const brief='Create an ESP32 DevKit V1 blueprint with a BME280 and a 128x64 OLED. Power it through USB and generate PlatformIO firmware. No mains power, fabrication, enclosure generation, hardware connection or external parts lookup.';
test('a mixed negative list does not request enclosure generation',()=>{
  const result=enclosureIntent(brief);
  assert.equal(result.wanted,false);assert.equal(result.declined,true);
  assert.equal(result.remaining,brief,'keep the complete user request for downstream reasoning');
});
test('enclosure exclusions preserve separately requested physical capabilities',()=>{
  for(const text of ['Without a case, make a 3D-printable bracket.','No enclosure, but design a mounting plate.','No enclosure restrictions. Make a case.','Not just a case — design a wearable frame.'])assert.equal(enclosureIntent(text).wanted,true,text);
  assert.equal(enclosureIntent('No enclosure generation. --enclosure').wanted,true);
  assert.equal(enclosureIntent('Design a case. --no-enclosure').wanted,false);
  assert.equal(enclosureIntent('Add a test case for the sensor driver.').declined,false);
});
test('the real blueprint pipeline omits excluded CAD even when the saved preference is always',async()=>{
  const interpreted={mode:'new',note:'A temperature sensor and OLED',request:{title:'Owned sensor test',purpose:'Display temperature',controller:'ESP32 DevKit V1',inputs:[{type:'BME280',quantity:1}],outputs:[{type:'128x64 OLED',quantity:1}],communication:['i2c'],power:{source:'usb'},prototypeType:'breadboard',firmware:{platform:'platformio',language:'cpp'},constraints:{beginnerFriendly:true,preferredComponents:[],forbiddenComponents:[]}}};
  const firmware={helperDeclarations:'',setupBody:'Serial.println("Ready");',loopBody:'Serial.println(bmeU2.readTemperature()); delay(2000);',expectedSerialOutput:'Ready\n21.4'};
  for(const preference of ['auto','always']){
    const previous=globalThis.fetch;let calls=0,runId;
    globalThis.fetch=async()=>{
      assert.ok(calls<2,'Only interpretation and firmware model requests are allowed');
      return new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{arguments:JSON.stringify([interpreted,firmware][calls++])}}]}}]}),{headers:{'content-type':'application/json'}});
    };
    try{
      ({runId}=startRuntimeWorkerRun({userId:1,conversationPublicId:'conv_owned_missing_scope_fixture',brief,parsed:parseHardwareBlueprintRequest(brief),preferences:{enclosure:preference},model:'offline-test',reasoningEffort:'low',baseUrl:'http://127.0.0.1:9/v1'}));
      const end=Date.now()+5000;
      while(!isRuntimeWorkerTerminal(1,runId)&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));
      const events=getRuntimeWorkerEventsSince(1,runId,0);
      assert.ok(isRuntimeWorkerTerminal(1,runId),'The local fixture completed');
      assert.equal(events.some(event=>/^enclosure\.|^cad\./.test(event.type)),false,preference);
      assert.equal(events.find(event=>event.type==='validation.completed')?.payload.errors,0);
      assert.ok(events.some(event=>event.type==='firmware.completed'));
      assert.ok(events.some(event=>event.type==='run.completed'));
      assert.equal(calls,2);
    }finally{if(runId&&!isRuntimeWorkerTerminal(1,runId))abortRuntimeWorkerRun(1,runId);globalThis.fetch=previous;}
  }
});
