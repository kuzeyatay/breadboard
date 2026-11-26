import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { attachGoogleSignInHandoff, googleSignInDestination, isGoogleSignInPage } from "../src/main/browser-google-signin";

test("interactive Google sign-in pages hand off; silent refreshes stay in the tab", () => {
  for (const url of [
    "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2F",
    "https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn",
    "https://accounts.google.com/v3/signin/challenge/pwd",
    "https://accounts.google.com/signin/oauth/id?authuser=0", "https://accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2F",
    "https://accounts.google.com/AccountChooser?continue=x", "https://accounts.google.com/AddSession",
  ]) assert.equal(isGoogleSignInPage(url), true, url);
  for (const url of [
    "https://accounts.google.com/ServiceLogin?passive=true&continue=https%3A%2F%2Fwww.youtube.com%2F",
    "https://accounts.google.com/ServiceLogin?passive=1209600&osid=1&continue=https%3A%2F%2Fdocs.google.com%2Fforms%2Fd%2Fe%2Fx%2Fviewform",
    "https://accounts.google.com/o/oauth2/v2/auth?prompt=none",
    "https://user@accounts.google.com/ServiceLogin", "https://accounts.google.com:8443/ServiceLogin",
    "https://accounts.google.com/ServiceLoginAuth", "https://accounts.google.com/CheckCookie",
    "https://mail.google.com/", "https://accounts.google.com.evil.test/v3/signin/identifier", "http://accounts.google.com/v3/signin/identifier", "not a url",
  ]) assert.equal(isGoogleSignInPage(url), false, url);
});

test("only interactive top-level sign-ins are cancelled and handed to the system browser", () => {
  const contents = Object.assign(new EventEmitter(), { getURL: () => "https://www.youtube.com/", isDestroyed: () => false });
  const opened: string[] = [];
  attachGoogleSignInHandoff(contents as unknown as WebContents, url => opened.push(url));
  const login = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com";
  let cancelled = 0;
  const event = { preventDefault: () => { cancelled++; } };
  contents.emit("will-redirect", event, login, false, false);
  contents.emit("will-navigate", event, login + "&passive=true");
  contents.emit("will-navigate", event, login);
  contents.emit("will-redirect", event, login, false, true);
  assert.deepEqual(opened, [login, login]);
  assert.equal(cancelled, 2);
});

test("third-party OAuth starts at the initiating site in the system browser", () => {
  const url = "https://accounts.google.com/o/oauth2/v2/auth?state=fixture";
  assert.equal(googleSignInDestination(url, "https://example.org/login"), "https://example.org/login");
  assert.equal(googleSignInDestination(url, "about:blank"), url);
});
