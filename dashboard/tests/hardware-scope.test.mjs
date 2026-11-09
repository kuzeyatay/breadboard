import assert from 'node:assert/strict';
import test from 'node:test';
import {assessSafety} from '../src/lib/hardware/safety.ts';
import {discoverRequestComponents} from '../src/lib/hardware/component-discovery.ts';
import {restrictsExternalResearch} from '../src/lib/research/scope.ts';

test('explicitly excluding mains does not reject a low voltage circuit',()=>{
  for(const text of ['Build a 5 V LED circuit. No mains power, fabrication or enclosure.', 'USB LED without mains.', 'Avoid high voltage; use a USB supply.'])assert.equal(assessSafety(text).level,'supported',text);
});
test('exclusions do not hide positive hazardous requirements or missing protection',()=>{
  for(const text of ['No mains power. Switch a 230V lamp.', 'No mains isolation is needed for my lamp circuit.', 'Switch a mains lamp with a relay.','Use a 120V supply without mains.'])assert.equal(assessSafety(text).level,'concept-only',text);
  assert.equal(assessSafety('Design a detonator circuit').level,'refused');
});
test('no-research component discovery never invokes the search hook',async()=>{
  const request={title:'Diagnostic',purpose:'Read one sensor',controller:'ESP32 DevKit V1',inputs:[{type:'Acme diagnostic unknown sensor',quantity:1}],outputs:[],communication:['i2c'],power:{source:'usb'},prototypeType:'breadboard',firmware:{platform:'platformio',language:'cpp'},constraints:{beginnerFriendly:true,preferredComponents:[],forbiddenComponents:[]}};
  const result=await discoverRequestComponents({request,baseUrl:'http://127.0.0.1:1',model:'no-provider',allowExternalResearch:false,search:async()=>{assert.fail('No external lookup is allowed');}});
  assert.deepEqual(result.attempted,[]);assert.equal(result.records.length,1);assert.equal(result.records[0].status,'deferred');assert.match(result.records[0].note,/excluded/);
});
test('negative retrieval instructions cover polite requests and prohibition lists',()=>{
  for(const text of ['Please do not browse.','Use only these values; do not access the internet.','Do not install packages, download models, browse, or publish.','No external parts lookup.'])assert.equal(restrictsExternalResearch(text),true,text);
  for(const text of ['There are no internet restrictions.','Research web access restrictions.','Do not omit relevant sources.'])assert.equal(restrictsExternalResearch(text),false,text);
});
