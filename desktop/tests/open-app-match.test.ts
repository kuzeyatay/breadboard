import assert from "node:assert/strict";
import { test } from "node:test";
import { findShortcut } from "../src/main/open-app-match";

const MENU = "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs";
const shortcuts = [
  `${MENU}\\Mendix 10.24.0\\Mendix Studio Pro 10.24.0.lnk`,
  `${MENU}\\Mendix 11.17.0\\Mendix Studio Pro 11.17.0.lnk`,
  `${MENU}\\Mendix 11.17.0\\Uninstall.lnk`,
  `${MENU}\\Mendix Version Selector\\Mendix Version Selector.lnk`,
  `${MENU}\\Visual Studio Code\\Visual Studio Code.lnk`,
  `${MENU}\\Visual Studio Code\\Visual Studio Code Help.lnk`,
];

test("a spoken app name resolves to its Start menu shortcut", () => {
  assert.equal(findShortcut("Visual Studio Code", shortcuts), shortcuts[4]);
  assert.equal(findShortcut("mendix studio pro 11.17.0", shortcuts), shortcuts[1]);
});

test("among several installed versions the newest wins", () => {
  assert.equal(findShortcut("Mendix Studio Pro", shortcuts), shortcuts[1]);
  assert.equal(findShortcut("Studio Pro", shortcuts), shortcuts[1]);
});

test("uninstallers and help links are never launched", () => {
  assert.equal(findShortcut("uninstall", shortcuts), null);
  assert.equal(findShortcut("Visual Studio Code Help", shortcuts), null);
});

test("no match returns null rather than a guess", () => {
  assert.equal(findShortcut("Photoshop", shortcuts), null);
  assert.equal(findShortcut("", shortcuts), null);
});
