import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameTabScreen } from "../src/main/tab-navigation-policy";
import { isTabsCommand } from "../src/shared/ipc-contract";

const at = (path: string) => `http://127.0.0.1:3000${path}`;

test("anchoring keeps navigation within a screen, including its subpages and state", () => {
  for (const [from, to] of [
    ["/garden/circuits?note=intro", "/garden/circuits?note=diodes#example"],
    ["/garden/circuits", "/garden/physics/chapter"],
    ["/gardens/circuits?chat=one", "/gardens/circuits?chat=two"],
    ["/gardens/circuits", "/gardens/physics"],
    ["/plan", "/plan/calendar"],
    ["/buzz/channels/one", "/buzz/channels/two"],
    ["/", "/dashboard"],
    ["/gardens/circuits/pdf/paper", "/attachments/other/pdf#page=2"],
    ["/browser", "/browser?settings=1"],
  ]) assert.equal(isSameTabScreen(at(from!), at(to!)), true, `${from} -> ${to}`);
});

test("different screens require unanchoring", () => {
  for (const [from, to] of [
    ["/garden/circuits", "/gardens/circuits"],
    ["/gardens/circuits", "/garden/circuits"],
    ["/gardens/circuits", "/gardens/circuits/pdf/paper"],
    ["/garden/circuits", "/dashboard"],
    ["/plan", "/profile"],
    ["/processes", "/hooks"],
    ["/new-tab", "/browser"],
    ["/browser", "/gardens/circuits"],
  ]) assert.equal(isSameTabScreen(at(from!), at(to!)), false, `${from} -> ${to}`);
  assert.equal(isSameTabScreen(at("/garden/circuits"), "https://example.com/garden/circuits"), false);
  assert.equal(isSameTabScreen("invalid", "/garden/circuits"), false);
});

test("navigation check commands validate bounded destinations", () => {
  assert.equal(isTabsCommand({ type: "navigation-check", url: at("/garden/circuits") }), true);
  for (const url of [null, 3, "", "x".repeat(8193)]) {
    assert.equal(isTabsCommand({ type: "navigation-check", url }), false);
  }
});
