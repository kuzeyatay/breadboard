import assert from 'node:assert/strict';
import test from 'node:test';
import {restrictsExternalResearch} from '../src/lib/research/scope.ts';
test('topics about lack of internet retain research capabilities',()=>{
  for(const text of ['Compare students with no internet access and those with internet access.','Research schools without internet access.','Explain no web restrictions policies.','Research internet restrictions.','There are no internet restrictions.'])assert.equal(restrictsExternalResearch(text),false,text);
});
test('actual negative retrieval instructions still constrain automatic lookups',()=>{
  for(const text of ['Use no internet or repository files.','Please do not browse.','Compare the values; do not access the internet.','No web searches.','Do not install packages, download models, browse, or publish.','No mains power, fabrication, or external parts lookup.','Answer without browsing.','Avoid the web.'])assert.equal(restrictsExternalResearch(text),true,text);
});
