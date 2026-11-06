const assert = require('node:assert/strict');

// A cookie-authenticated feed with the editing/event behavior used by modern
// chat composers. All messages and saved posts stay in this local fixture.
const html = `<!doctype html><title>Signed-in social account</title>
<style>html,body{margin:0;height:100%;overflow:hidden}main{padding:20px}
#feed{height:280px;width:600px;overflow:auto}article{height:300px}
[contenteditable]{border:1px solid gray;min-height:30px;width:400px}</style>
<main><h1>Signed in as Taylor</h1><h2>Chat with Alice</h2>
<div role="textbox" aria-label="Message Alice" contenteditable="true"><p>Old draft</p></div>
<div role="textbox" aria-label="Quick reply" contenteditable="plaintext-only">Old reply</div>
<div role="textbox" aria-label="Read-only composer" contenteditable="true" aria-readonly="true">Locked</div>
<button id="send">Send</button><output id="sent"></output>
<div id="feed" role="feed" aria-label="Following feed">
<article>Jordan: first recipe<button id="save" aria-pressed="false"><svg width="24" height="24" aria-label="Save Jordan's recipe"></svg></button></article>
<article>Sam: second recipe</article><article>Casey: third recipe</article></div>
<output id="scroll-status"></output><output id="saved"></output></main>
<script>
const editor = document.querySelector('[aria-label="Message Alice"]');
let message = '';
editor.addEventListener('input', event => {
  // Synthetic Event('input') must not make this test pass.
  if (event.isTrusted && event instanceof InputEvent) message = editor.innerText;
});
document.querySelector('#send').onclick = event => {
  if (!event.isTrusted) return;
  document.querySelector('#sent').textContent = message ? 'Sent to Alice: ' + message : 'Nothing sent';
};
document.querySelector('#save').onclick = event => {
  if (!event.isTrusted) return;
  event.currentTarget.setAttribute('aria-pressed', 'true');
  document.querySelector('#saved').textContent = 'Saved Jordan: first recipe';
};
document.querySelector('#feed').onscroll = event => {
  document.querySelector('#scroll-status').textContent = 'Feed scrolled to ' + event.target.scrollTop;
};
</script>`;

async function exerciseSignedInBrowser({ call, useBreadboard, browserContents, browser, origin, until }) {
  // Simulate the user already signing in in the actual persistent browser
  // partition before the agent inspects it; do not give credentials to tools.
  await browserContents.loadURL(origin + '/social-login');
  await until(() => !browserContents.isLoading());
  const state = await call({ action: 'state' });
  const target = state.targets.find(t => t.kind === 'browser' && t.url === origin + '/social');
  assert.equal(target.targetId, browser.targetId, 'Reuse the tab the user signed into');
  const targetId = target.targetId;
  const snapshot = () => call({ action: 'snapshot', targetId });
  let page = await snapshot();
  assert.match(page.text, /Signed in as Taylor/);
  assert.match(page.text, /Chat with Alice/);
  assert.ok(!JSON.stringify(page).includes('fixture-login-secret'));
  const composer = page.elements.find(e => e.name === 'Message Alice');
  assert.equal(composer.editable, true);
  await assert.rejects(useBreadboard({ action: 'fill', targetId, snapshotId: page.snapshotId,
    ref: composer.ref, text: 'Wrong conversation' }, 'conversation-b', 7), /expired/);
  await call({ action: 'fill', targetId, snapshotId: page.snapshotId, ref: composer.ref, text: 'Meet at six — see you 👋' });
  await assert.rejects(call({ action: 'fill', targetId, snapshotId: page.snapshotId, ref: composer.ref, text: 'Duplicate' }), /expired/);
  page = await snapshot();
  assert.equal(page.elements.find(e => e.name === 'Message Alice').value, 'Meet at six — see you 👋');
  await call({ action: 'click', targetId, snapshotId: page.snapshotId, ref: page.elements.find(e => e.name === 'Send').ref });
  page = await snapshot();
  assert.match(page.text, /Sent to Alice: Meet at six — see you 👋/);
  assert.doesNotMatch(page.text, /Old draft/);

  for (const text of ['Replacement reply', '']) {
    await call({ action: 'fill', targetId, snapshotId: page.snapshotId, ref: page.elements.find(e => e.name === 'Quick reply').ref, text });
    page = await snapshot();
    assert.equal(page.elements.find(e => e.name === 'Quick reply').value, text);
  }
  await assert.rejects(call({ action: 'fill', targetId, snapshotId: page.snapshotId,
    ref: page.elements.find(e => e.name === 'Read-only composer').ref, text: 'overwrite' }), /read-only/);
  const save = page.elements.find(e => e.name === "Save Jordan's recipe");
  assert.ok(save, 'Icon controls must retain their accessible name');
  assert.equal(save.checked, false);
  await call({ action: 'click', targetId, snapshotId: page.snapshotId, ref: save.ref });
  page = await snapshot();
  assert.equal(page.elements.find(e => e.name === "Save Jordan's recipe").checked, true);
  assert.match(page.text, /Saved Jordan: first recipe/);
  const feed = page.elements.find(e => e.name === 'Following feed');
  assert.equal(feed.scrollable, true);
  assert.equal(feed.scrollTop, 0);
  // No ref must still scroll a full-height app's nested feed.
  assert.equal((await call({ action: 'scroll', targetId, snapshotId: page.snapshotId, direction: 'down' })).moved, true);
  page = await until(async () => {
    const current = await snapshot();
    return /Feed scrolled/.test(current.text) && current;
  });
  assert.ok(page.elements.find(e => e.name === 'Following feed').scrollTop > 0);
  // A control within a feed selects its scrollable ancestor.
  await call({ action: 'scroll', targetId, snapshotId: page.snapshotId, ref: page.elements.find(e => e.name === "Save Jordan's recipe").ref, direction: 'top' });
  page = await snapshot();
  assert.equal(page.elements.find(e => e.name === 'Following feed').scrollTop, 0);
  await call({ action: 'scroll', targetId, snapshotId: page.snapshotId, ref: page.elements.find(e => e.name === 'Following feed').ref, direction: 'bottom' });
  page = await snapshot();
  assert.ok(page.elements.find(e => e.name === 'Following feed').scrollTop > 500);
  assert.equal((await call({ action: 'scroll', targetId, snapshotId: page.snapshotId, direction: 'down' })).moved, false);
  await browserContents.reload();
  await until(() => !browserContents.isLoading());
  assert.match((await snapshot()).text, /Signed in as Taylor/);
  console.log('Signed-in browser: reused session, trusted editor input, verified send/save, nested feed scrolling passed.');
}

module.exports = { html, exerciseSignedInBrowser };
