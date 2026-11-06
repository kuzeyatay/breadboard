import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = new EventTarget();
const attributes = {};
globalThis.document = { documentElement: { toggleAttribute: (name, on) => { attributes[name] = on; } } };
const { USER_IDLE_MS, subscribeUserIdle, userIdle, wakeUser } = await import("../src/lib/user-idle.ts");

test("goes idle after a quiet minute, wakes on input, and resets when the last subscriber leaves", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let changes = 0;
  const unsubscribe = subscribeUserIdle(() => { changes += 1; });
  assert.equal(userIdle(), false);

  t.mock.timers.tick(USER_IDLE_MS - 1000);
  window.dispatchEvent(new Event("pointermove"));
  t.mock.timers.tick(1500);
  assert.equal(userIdle(), false, "input pushes the deadline out");

  t.mock.timers.tick(USER_IDLE_MS);
  assert.equal(userIdle(), true);
  assert.equal(changes, 1);
  assert.equal(attributes["data-user-idle"], true, "CSS-only loops settle too");

  window.dispatchEvent(new Event("keydown"));
  assert.equal(userIdle(), false);
  assert.equal(changes, 2);
  assert.equal(attributes["data-user-idle"], false);

  t.mock.timers.tick(USER_IDLE_MS);
  assert.equal(userIdle(), true);
  wakeUser();
  assert.equal(userIdle(), false, "a newly mounted decoration wakes it");

  window.dispatchEvent(new Event("blur"));
  assert.equal(userIdle(), true, "the window losing focus settles decoration at once");
  window.dispatchEvent(new Event("focus"));
  assert.equal(userIdle(), false, "coming back wakes it");

  unsubscribe();
  window.dispatchEvent(new Event("keydown"));
  t.mock.timers.tick(USER_IDLE_MS * 2);
  assert.equal(userIdle(), false, "no listeners, no timer");
});
