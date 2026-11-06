import assert from 'node:assert/strict';
import { installBreadboardFlowBrowser, FlowStore, BrowserManager } from '../../../scripts/google-flow-browser.mjs';
const [directory,url,targetId]=process.argv.slice(2);
installBreadboardFlowBrowser(directory);
const browsers=new BrowserManager(new FlowStore(directory));
try {
  const page=await browsers.pageFor('breadboard');
  assert.equal(page.context().pages().length,1,'only the hidden target may be attached');
  const client=await page.context().newCDPSession(page);
  assert.equal((await client.send('Target.getTargetInfo')).targetInfo.targetId,targetId);
  await client.detach();
  await page.goto(url);
  assert.equal(await page.locator('body').innerText(),'shared sign-in');
  assert.equal(await browsers.pageFor('breadboard'),page);
  await browsers.closeAll();
  process.exit(0);
} catch(error) {console.error(error);process.exit(1);}
