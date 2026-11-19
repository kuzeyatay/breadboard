import { test } from "node:test";
import assert from "node:assert/strict";
import { devToolsCookieParam, electronCookie, isGoogleCookieDomain, isGoogleSignInPage, signInBrowserCandidates, signInContinueUrl } from "../src/main/browser-google-signin";

test("existing Google accounts are copied into the sign-in window, nothing else", () => {
  for (const domain of [".google.com", "accounts.google.com", ".google.com.tr", ".google.co.uk", ".google.nl", ".youtube.com", "mail.google.com"]) assert.equal(isGoogleCookieDomain(domain), true, domain);
  for (const domain of [".github.com", "notgoogle.com", ".google.com.evil.test.example"]) assert.equal(isGoogleCookieDomain(domain), false, domain);
  assert.deepEqual(devToolsCookieParam({ name: "SID", value: "v", domain: ".google.com", hostOnly: false, path: "/", secure: true, httpOnly: true, session: false, expirationDate: 2000000000, sameSite: "no_restriction" }),
    { name: "SID", value: "v", path: "/", domain: ".google.com", secure: true, httpOnly: true, expires: 2000000000, sameSite: "None" });
  assert.deepEqual(devToolsCookieParam({ name: "__Host-GAPS", value: "v", domain: "accounts.google.com", hostOnly: true, path: "/", secure: true, httpOnly: true, session: true, sameSite: "unspecified" }),
    { name: "__Host-GAPS", value: "v", path: "/", url: "https://accounts.google.com/", secure: true, httpOnly: true });
});

test("interactive Google sign-in pages hand off; silent refreshes and consent stay", () => {
  for (const url of [
    "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2F",
    "https://accounts.google.com/signin/v2/identifier?flowName=GlifWebSignIn",
    "https://accounts.google.com/v3/signin/challenge/pwd",
    "https://accounts.google.com/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2F",
    "https://accounts.google.com/AccountChooser?continue=x", "https://accounts.google.com/AddSession",
  ]) assert.equal(isGoogleSignInPage(url), true, url);
  for (const url of [
    "https://accounts.google.com/ServiceLogin?passive=true&continue=https%3A%2F%2Fwww.youtube.com%2F",
    "https://accounts.google.com/signin/oauth/id?authuser=0", "https://accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com/ServiceLoginAuth", "https://accounts.google.com/CheckCookie",
    "https://mail.google.com/", "https://accounts.google.com.evil.test/v3/signin/identifier", "http://accounts.google.com/v3/signin/identifier", "not a url",
  ]) assert.equal(isGoogleSignInPage(url), false, url);
});

test("continues to the page the sign-in was for, never to a non-https target", () => {
  assert.equal(signInContinueUrl("https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F"), "https://mail.google.com/mail/");
  assert.equal(signInContinueUrl("https://accounts.google.com/v3/signin/identifier?continue=javascript%3Aalert(1)"), "https://www.google.com/");
  assert.equal(signInContinueUrl("https://accounts.google.com/v3/signin/identifier"), "https://www.google.com/");
});

test("Windows candidates cover per-user and machine installs of Chrome and Edge", () => {
  const candidates = signInBrowserCandidates({ LOCALAPPDATA: "C:\\L", PROGRAMFILES: "C:\\P", "PROGRAMFILES(X86)": "C:\\X" }, "win32");
  assert.ok(candidates.includes("C:\\L\\Google\\Chrome\\Application\\chrome.exe"));
  assert.ok(candidates.includes("C:\\X\\Microsoft\\Edge\\Application\\msedge.exe"));
});

test("CDP cookies map to Electron cookies without breaking host-only or __Host- rules", () => {
  const base = { value: "v", path: "/", expires: 2000000000, httpOnly: true, secure: true };
  assert.deepEqual(electronCookie({ ...base, name: "SID", domain: ".google.com", sameSite: "None" }), {
    url: "https://google.com/", name: "SID", value: "v", path: "/", domain: ".google.com",
    secure: true, httpOnly: true, expirationDate: 2000000000, sameSite: "no_restriction",
  });
  const hostOnly = electronCookie({ ...base, name: "__Host-GAPS", domain: "accounts.google.com", expires: -1 });
  assert.equal(hostOnly?.url, "https://accounts.google.com/");
  assert.equal("domain" in (hostOnly ?? {}), false);
  assert.equal("expirationDate" in (hostOnly ?? {}), false);
  assert.equal(hostOnly?.sameSite, "unspecified");
  assert.equal(electronCookie({ ...base, name: "p", domain: ".google.com", partitionKey: { topLevelSite: "https://x.test" } }), null);
});
