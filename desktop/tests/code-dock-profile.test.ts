import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse } from "jsonc-parser";
import { prepareVSCodeProfile, synchronizeVSCodeTheme, withVSCodeTheme } from "../src/main/vscode-profile";
import { resolveVSCodeStorage } from "../src/main/vscode-installation";

test("theme synchronization preserves comments, nested preferences, and chosen light/dark themes", () => {
  const source = '{\r\n  // Keep my preferences\r\n  "editor.fontSize": 17,\r\n  "workbench.preferredDarkColorTheme": "My Dark Theme",\r\n  "workbench.colorTheme": "Light Modern",\r\n  "[typescript]": { "editor.defaultFormatter": "example.formatter" },\r\n}\r\n';
  const dark = withVSCodeTheme(source, "dark");
  assert.ok(dark.includes("// Keep my preferences\r\n"));
  assert.equal(parse(dark)["editor.fontSize"], 17);
  assert.deepEqual(parse(dark)["[typescript]"], { "editor.defaultFormatter": "example.formatter" });
  assert.equal(parse(dark)["workbench.colorTheme"], "My Dark Theme");
  assert.equal(parse(dark)["window.autoDetectColorScheme"], false);
  assert.equal(parse(dark)["window.titleBarStyle"], "native");
  assert.equal(parse(dark)["window.menuStyle"], "custom");
  assert.equal(parse(dark)["security.workspace.trust.enabled"], false);
  assert.equal(parse(withVSCodeTheme('{"security.workspace.trust.enabled": true}', "dark"))["security.workspace.trust.enabled"], true);
  assert.equal(withVSCodeTheme(dark, "dark"), dark);
  assert.equal(parse(withVSCodeTheme(dark, "light"))["workbench.colorTheme"], "Light Modern");
});

test("invalid settings are left intact instead of being replaced by theme defaults", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-theme-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "settings.json"), source = '{"editor.fontSize": }';
  fs.writeFileSync(file, source);
  assert.throws(() => synchronizeVSCodeTheme(file, "dark"), /invalid JSON/);
  assert.equal(fs.readFileSync(file, "utf8"), source);
  assert.throws(() => withVSCodeTheme("[]", "dark"), /invalid JSON/);
});

test("an installed editor reuses extensions and seeds an independent profile only once", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-profile-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "app", "Code.exe"), appdata = path.join(root, "appdata"), home = path.join(root, "home");
  const originalUser = path.join(appdata, "Code", "User"), extensions = path.join(home, ".vscode", "extensions");
  fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.writeFileSync(executable, "test");
  fs.mkdirSync(originalUser, { recursive: true }); fs.mkdirSync(extensions, { recursive: true });
  const original = '{\n// My font\n"editor.fontSize":18,"workbench.colorTheme":"My Theme"\n}';
  fs.writeFileSync(path.join(originalUser, "settings.json"), original);
  fs.writeFileSync(path.join(originalUser, "keybindings.json"), "[]");
  const profileRoot = path.join(root, "breadboard"), env = { APPDATA: appdata, USERPROFILE: home };
  const profile = prepareVSCodeProfile({ stateRoot: profileRoot, payloadRoot: profileRoot }, { executable, kind: "installed" }, "dark", env);
  assert.deepEqual(profile.args, ["--user-data-dir", path.join(profile.portable, "user-data"), "--extensions-dir", extensions]);
  assert.equal(parse(fs.readFileSync(profile.settings, "utf8"))["editor.fontSize"], 18);
  assert.equal(fs.readFileSync(path.join(originalUser, "settings.json"), "utf8"), original);
  fs.writeFileSync(profile.settings, '{"editor.fontSize":23}');
  prepareVSCodeProfile({ stateRoot: profileRoot, payloadRoot: profileRoot }, { executable, kind: "installed" }, "light", env);
  assert.equal(parse(fs.readFileSync(profile.settings, "utf8"))["editor.fontSize"], 23);
  assert.equal(fs.readFileSync(path.join(path.dirname(profile.settings), "keybindings.json"), "utf8"), "[]");
});

test("a managed ZIP uses its owned portable profile and the installed release's theme IDs", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-profile-managed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "app", "Code.exe");
  const themes = path.join(root, "app", "resources/app/extensions/theme-defaults/package.json");
  fs.mkdirSync(path.dirname(themes), { recursive: true }); fs.writeFileSync(executable, "test");
  fs.writeFileSync(themes, JSON.stringify({ contributes: { themes: [{ id: "Default Light Modern" }, { id: "Default Dark Modern" }] } }));
  const profile = prepareVSCodeProfile({ stateRoot: path.join(root, "breadboard"), payloadRoot: path.join(root, "breadboard") }, { executable, kind: "managed" }, "light", {});
  assert.equal(profile.args[3], path.join(profile.portable, "extensions"));
  assert.equal(parse(fs.readFileSync(profile.settings, "utf8"))["workbench.colorTheme"], "Default Light Modern");
  synchronizeVSCodeTheme(profile.settings, "dark", profile.themes);
  assert.equal(parse(fs.readFileSync(profile.settings, "utf8"))["workbench.colorTheme"], "Default Dark Modern");
});

test("managed extensions use bulk storage while settings and unsaved-work state stay in the active profile", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-profile-split-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bulk = path.join(root, "bulk"); fs.mkdirSync(bulk);
  const executable = path.join(bulk, "Code.exe"); fs.writeFileSync(executable, "test");
  const storage = resolveVSCodeStorage(path.join(root, "active"), bulk);
  const profile = prepareVSCodeProfile(storage, { executable, kind: "managed" }, "light", {});
  assert.equal(profile.portable, path.join(storage.stateRoot, "profiles", "managed-stable"));
  assert.equal(profile.args[1], path.join(profile.portable, "user-data"));
  assert.equal(profile.args[3], path.join(storage.payloadRoot, "profiles", "managed-stable", "extensions"));
  assert.equal(fs.existsSync(path.join(profile.portable, "extensions")), false);
  const disconnected = { ...storage, bulkRoot: path.join(root, "disconnected") };
  assert.throws(() => prepareVSCodeProfile(disconnected, { executable, kind: "managed" }, "light", {}), /Reconnect it/);
});
