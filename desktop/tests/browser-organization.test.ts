import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BrowserPreferenceStore } from "../src/main/browser-preferences";
import { isTabsCommand } from "../src/shared/ipc-contract";
import { browserOrganizationWidth } from "../src/shared/browser-annotations";

test("Organization sidebar preference survives restart independently of site permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bb-organization-"));
  try {
    const store = new BrowserPreferenceStore(directory);
    assert.equal(store.snapshot().organizationSidebarEnabled, true);
    assert.ok(store.update({ type: "browser-organization-enabled", enabled: false }));
    assert.equal(new BrowserPreferenceStore(directory).snapshot().organizationSidebarEnabled, false);
    assert.equal(new BrowserPreferenceStore(directory).snapshot().notificationsEnabled, store.snapshot().notificationsEnabled);
    assert.ok(store.update({ type: "browser-organization-enabled", enabled: true }));
    assert.equal(new BrowserPreferenceStore(directory).snapshot().organizationSidebarEnabled, true);
  } finally { fs.rmSync(directory, {recursive:true,force:true}); }
});
test("Organization commands validate targets and bound marker batches", () => {
  assert.ok(isTabsCommand({type:"browser-organization",open:true}));
  assert.ok(isTabsCommand({type:"browser-organization-enabled",enabled:false}));
  assert.equal(isTabsCommand({type:"browser-organization-enabled",open:true}),false);
  assert.equal(isTabsCommand({type:"browser-organization",enabled:true}),false);
  const target={kind:"text",url:"https://example.org/page",quote:"The passage"};
  assert.ok(isTabsCommand({type:"browser-organization-target",target}));
  assert.equal(isTabsCommand({type:"browser-organization-target",target:{...target,url:"javascript:alert(1)"}}),false);
  assert.ok(isTabsCommand({type:"browser-organization-markers",items:[{id:"thread-1",target}]}));
  assert.equal(isTabsCommand({type:"browser-organization-markers",items:Array(201).fill({id:"thread-1",target})}),false);
  assert.equal(browserOrganizationWidth(1200),360);
  assert.equal(browserOrganizationWidth(300),251);
  assert.equal(browserOrganizationWidth(40),0);
});
