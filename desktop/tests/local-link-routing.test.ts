import { test } from "node:test";
import assert from "node:assert/strict";
import type { HandlerDetails, WebContents, WindowOpenHandlerResponse } from "electron";
import { hardenWebContents, type LocalOpenHandlers } from "../src/main/security";

const origin = "http://127.0.0.1:4300";

function linkHandler(handlers: LocalOpenHandlers) {
  let open!: (details: HandlerDetails) => WindowOpenHandlerResponse;
  const navigations: string[] = [];
  hardenWebContents({
    on: () => {},
    setWindowOpenHandler: (handler: typeof open) => { open = handler; },
    loadURL: async (url: string) => { navigations.push(url); },
  } as unknown as WebContents, { origins: new Set([origin]) }, handlers);
  return {
    open: (url: string, disposition: HandlerDetails["disposition"], features = "") => open({ url, disposition, features } as HandlerDetails),
    navigations,
  };
}

test("local blank-target links and script opens select a tab; background gestures keep their disposition", () => {
  for (const disposition of ["foreground-tab", "background-tab", "new-window", "default"] as const) {
    const calls: unknown[][] = [];
    const handler = linkHandler({
      onOpenLocalTab: (...args) => { calls.push(args); return true; },
      onOpenLocalWindow: () => assert.fail("ordinary links must not create a window"),
    });
    const url = origin + "/gardens/electromagnetism/pdf/lecture#page=3";
    assert.deepEqual(handler.open(url, disposition), { action: "deny" });
    assert.deepEqual(calls, [[url, disposition === "background-tab"]]);
    assert.deepEqual(handler.navigations, []);
  }
});

test("local links fall back when their window cannot open tabs", () => {
  const windows: string[] = [];
  const url = origin + "/garden/electromagnetism";
  const handler = linkHandler({ onOpenLocalTab: () => false, onOpenLocalWindow: target => windows.push(target) });
  handler.open(url, "foreground-tab");
  assert.deepEqual(windows, [url]);
  const standalone = linkHandler({});
  standalone.open(url, "foreground-tab");
  assert.deepEqual(standalone.navigations, [url]);
});

test("web links use the isolated browser and unsafe schemes cannot create tabs", () => {
  const external: unknown[][] = [];
  const handler = linkHandler({
    onOpenLocalTab: () => assert.fail("external URLs must not enter a trusted tab"),
    onOpenLocalWindow: () => assert.fail("external URLs must not enter a trusted window"),
    onOpenExternalTab: (...args) => { external.push(args); },
  });
  for (const disposition of ["foreground-tab", "background-tab"] as const) {
    handler.open("https://example.com/lecture", disposition);
  }
  for (const url of ["javascript:alert(1)", "file:///C:/Windows/win.ini", "data:text/html,hello"]) {
    assert.deepEqual(handler.open(url, "foreground-tab"), { action: "deny" });
  }
  assert.deepEqual(external, [["https://example.com/lecture", false], ["https://example.com/lecture", true]]);
  assert.deepEqual(handler.navigations, []);
});


test("explicit popup requests open a separate local window without selecting a tab", () => {
  for (const features of ["popup,noopener,noreferrer", "popup=yes", "noopener, popup=1", "popup=true"]) {
    const windows: string[] = [];
    const handler = linkHandler({
      onOpenLocalTab: () => assert.fail("explicit windows must not become tabs"),
      onOpenLocalWindow: url => windows.push(url),
    });
    const url = origin + "/gardens/circuits?chat=42";
    assert.deepEqual(handler.open(url, "new-window", features), { action: "deny" });
    assert.deepEqual(windows, [url]);
    assert.deepEqual(handler.navigations, []);
  }
});

test("disabled popup flags preserve normal tab routing", () => {
  for (const features of ["popup=no", "popup=0", "popup=false", "notpopup=yes"]) {
    const tabs: string[] = [];
    const handler = linkHandler({
      onOpenLocalTab: url => { tabs.push(url); return true; },
      onOpenLocalWindow: () => assert.fail("disabled popup flags must not create windows"),
    });
    const url = origin + "/dashboard?terminalChat=conv_a";
    handler.open(url, "new-window", features);
    assert.deepEqual(tabs, [url]);
  }
});

test("popup intent cannot send external or unsafe URLs into a trusted local window", () => {
  const external: unknown[][] = [];
  const handler = linkHandler({
    onOpenLocalTab: () => assert.fail("must not open a trusted tab"),
    onOpenLocalWindow: () => assert.fail("must not open a trusted window"),
    onOpenExternalTab: (...args) => { external.push(args); },
  });
  handler.open("https://example.com/lecture", "new-window", "popup,noopener");
  for (const url of ["javascript:alert(1)", "file:///C:/Windows/win.ini", "data:text/html,hello"]) {
    assert.deepEqual(handler.open(url, "new-window", "popup"), { action: "deny" });
  }
  assert.deepEqual(external, [["https://example.com/lecture", false]]);
});
