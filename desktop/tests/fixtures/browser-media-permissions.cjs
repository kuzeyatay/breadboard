const assert = require("node:assert/strict");

module.exports = async function testMediaPermissions({ manager, chrome, page, overlay, web, notices, until, capture }) {
  const cards = () => notices.filter(notice => notice.notificationPermission?.media && !notice.dismissed);
  const permissionState = kind => page.executeJavaScript(`navigator.permissions.query({name:${JSON.stringify(kind)}}).then(permission=>permission.state)`);
  assert.equal(await permissionState("microphone"), "prompt", "an undecided microphone permission lets websites ask");
  assert.equal(await permissionState("camera"), "prompt", "an undecided camera permission lets websites ask");
  await page.executeJavaScript("navigator.permissions.query({name:'microphone'}).then(status=>{window.microphoneStatus=status;window.permissionChanges=[];status.onchange=()=>window.permissionChanges.push(status.state)})");
  const reset = (media = ["microphone", "camera"]) => assert.equal(manager.handleCommand(chrome, {
    type: "browser-media-permission", origin: web, media, permission: "default",
  }), true);
  const start = async constraints => {
    await page.executeJavaScript(`window.mediaResult=null; void navigator.mediaDevices.getUserMedia(${JSON.stringify(constraints)}).then(stream => {
      window.mediaResult=stream.getTracks().map(track=>({kind:track.kind,state:track.readyState}));
      stream.getTracks().forEach(track=>track.stop());
    },error=>window.mediaResult=error.name); true`, true);
  };
  const prompt = async constraints => {
    const count = cards().length;
    await start(constraints);
    await until(() => cards().length === count + 1, "media request reaches the browser prompt");
    await until(() => overlay.executeJavaScript("Boolean(document.querySelector('[role=dialog]'))"), "media prompt renders");
    assert.equal(await page.executeJavaScript("window.mediaResult"), null, "capture waits for the user's choice");
    return cards().at(-1).notificationPermission.id;
  };
  const choose = async label => {
    await overlay.executeJavaScript(`Array.from(document.querySelectorAll('[role=dialog] button')).find(button=>button.textContent===${JSON.stringify(label)}).click()`);
    await until(() => overlay.executeJavaScript("!document.querySelector('[role=dialog]')"), "media card closes");
    await until(() => page.executeJavaScript("window.mediaResult!==null"), "native media request resolves");
    return page.executeJavaScript("window.mediaResult");
  };
  const waitResult = async () => {
    await until(() => page.executeJavaScript("window.mediaResult!==null"), "saved permission resolves without a card");
    return page.executeJavaScript("window.mediaResult");
  };
  const id = await prompt({ audio: true });
  assert.match(cards().at(-1).title, /microphone/);
  assert.deepEqual(cards().at(-1).notificationPermission.media, ["microphone"]);
  for (const sender of [page, chrome]) assert.equal(manager.handleCommand(sender, {
    type: "browser-notification-permission-response", id, permission: "granted",
  }), false, "only the browser's overlay can answer");
  await capture(overlay, "microphone-permission-light.png");
  assert.equal(await choose("Not now"), "NotAllowedError");
  assert.equal(manager.stateFor(chrome).browserPreferences.mediaSites[web], undefined);
  assert.equal(manager.handleCommand(overlay, { type: "browser-notification-permission-response", id, permission: "granted" }), false);

  await prompt({ video: true });
  assert.deepEqual(cards().at(-1).notificationPermission.media, ["camera"]);
  assert.equal(await choose("Block"), "NotAllowedError");
  assert.equal(await permissionState("camera"), "denied");
  assert.deepEqual(await page.executeJavaScript("window.permissionChanges"), [], "camera changes do not change microphone status");
  let count = cards().length;
  await start({ video: true });
  assert.equal(await waitResult(), "NotAllowedError");
  assert.equal(cards().length, count, "saved Block does not prompt again");
  reset(["camera"]);

  await prompt({ audio: true });
  assert.deepEqual(await choose("Allow"), [{ kind: "audio", state: "live" }]);
  assert.equal(await permissionState("microphone"), "granted");
  assert.equal(await permissionState("camera"), "prompt");
  await until(() => page.executeJavaScript("window.permissionChanges.join(',')==='granted'"), "existing PermissionStatus receives its change event");
  count = cards().length;
  await start({ audio: true });
  assert.deepEqual(await waitResult(), [{ kind: "audio", state: "live" }]);
  assert.equal(cards().length, count, "saved Allow works without a second prompt");
  assert.equal(manager.stateFor(chrome).browserPreferences.mediaSites[web].camera, undefined);

  await prompt({ audio: true, video: true });
  assert.deepEqual(cards().at(-1).notificationPermission.media, ["camera"], "only the missing device permission is requested");
  assert.equal(await choose("Block"), "NotAllowedError");
  assert.deepEqual(manager.stateFor(chrome).browserPreferences.mediaSites[web], { microphone: "granted", camera: "denied" });
  reset();
  await prompt({ audio: true, video: true });
  await overlay.executeJavaScript("document.documentElement.dataset.theme='dark'; new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await capture(overlay, "camera-microphone-permission-dark.png");
  assert.deepEqual((await choose("Allow")).map(track => track.kind).sort(), ["audio", "video"]);
  await overlay.executeJavaScript("document.documentElement.dataset.theme='light'");

  // Even with permission delegation, another origin cannot borrow this site's grant.
  await page.executeJavaScript("document.querySelector('iframe').allow='microphone; camera'");
  const frame = page.mainFrame.frames.find(frame => frame.url && !frame.url.startsWith(web));
  assert.ok(frame);
  assert.equal(await frame.executeJavaScript("navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{stream.getTracks().forEach(track=>track.stop());return 'granted'},error=>error.name)"), "NotAllowedError");

  reset(["camera"]);
  await prompt({ audio: true, video: true });
  assert.deepEqual(cards().at(-1).notificationPermission.media, ["camera"]);
  reset(["microphone"]);
  assert.equal(await choose("Allow"), "NotAllowedError", "a camera-only card cannot re-grant a microphone reset in settings");
  assert.deepEqual(manager.stateFor(chrome).browserPreferences.mediaSites[web], { camera: "granted" });

  reset();
  const staleId = await prompt({ audio: true });
  await page.reload();
  await until(() => !page.isLoading(), "media requester reloads");
  await until(() => overlay.executeJavaScript("!document.querySelector('[role=dialog]')"), "navigation dismisses pending media requests");
  assert.equal(manager.handleCommand(overlay, { type: "browser-notification-permission-response", id: staleId, permission: "granted" }), false);
  assert.equal(manager.stateFor(chrome).browserPreferences.mediaSites[web], undefined);
  // Leave a choice for the actual settings UI to inspect and reset later.
  await prompt({ audio: true });
  assert.deepEqual(await choose("Allow"), [{ kind: "audio", state: "live" }]);
};
