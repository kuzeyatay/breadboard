import { test } from "node:test";
import assert from "node:assert/strict";
import type { Cookie } from "electron";
import { browserSignedInSites } from "../src/main/browser-sign-in-sites";

const now = 1_800_000_000;
function cookie(domain: string, name: string, extra: Partial<Cookie> = {}): Cookie {
  return { domain, name, value: "private-cookie-value", path: "/", secure: true,
    httpOnly: true, sameSite: "lax", session: false, expirationDate: now + 3_600, ...extra };
}

test("visits, tracking, consent, bot checks and anonymous sessions never count as sign-ins", () => {
  assert.deepEqual(browserSignedInSites([
    cookie("analytics.test", "_ga"), cookie(".doubleclick.net", "IDE"),
    cookie("consent.test", "OptanonConsent"), cookie(".google.com", "SOCS"),
    cookie(".google.com", "NID"), cookie(".youtube.com", "YSC"),
    cookie("security.test", "cf_clearance"), cookie("security.test", "__cf_bm"),
    cookie("anonymous.test", "PHPSESSID"), cookie("anonymous.test", "JSESSIONID"),
    cookie("anonymous.test", "sessionid"), cookie("anonymous.test", "connect.sid"),
    cookie("anonymous.test", "auth"), cookie("anonymous.test", "next-auth.csrf-token"),
    cookie("anonymous.test", "next-auth.callback-url"), cookie(".github.com", "_gh_sess"),
  ], now), []);
});

test("provider-specific account sessions are grouped as websites and sorted", () => {
  assert.deepEqual(browserSignedInSites([
    cookie(".google.com", "SID"), cookie(".google.com", "HSID"),
    cookie("accounts.google.com", "SID"), cookie("mail.google.com", "_ga"),
    cookie(".github.com", "user_session"), cookie("github.com", "logged_in", { value: "yes" }),
    cookie(".www.linkedin.com", "li_at"), cookie(".linkedin.com", "liap"),
    cookie(".claude.ai", "sessionKeyV2"), cookie(".x.com", "auth_token"),
    cookie(".twitter.com", "auth_token"), cookie("login.microsoftonline.com", "ESTSAUTHPERSISTENT"),
  ], now), ["claude.ai", "github.com", "google.com", "linkedin.com", "login.microsoftonline.com", "x.com"]);
});

test("logged-out indicators and incomplete provider authentication are not sufficient", () => {
  assert.deepEqual(browserSignedInSites([
    cookie(".google.com", "SID"), cookie(".github.com", "user_session"),
    cookie(".github.com", "logged_in", { value: "no" }), cookie(".linkedin.com", "liap"),
    cookie("login.microsoftonline.com", "ESTSAUTHLIGHT"), cookie("claude.ai", "activitySessionId"),
  ], now), []);
});

test("provider cookie names are never trusted on unrelated or lookalike domains", () => {
  assert.deepEqual(browserSignedInSites([
    cookie("notgoogle.com", "SID"), cookie("notgoogle.com", "HSID"),
    cookie("github.com.attacker.test", "user_session"), cookie("github.com.attacker.test", "logged_in", { value: "yes" }),
    cookie("example.test", "li_at"), cookie("example.test", "sessionKey"), cookie("example.test", "auth_token"),
  ], now), []);
});

test("recognized framework sessions support custom sites without merging unrelated subdomains", () => {
  assert.deepEqual(browserSignedInSites([
    cookie(".chatgpt.com", "__Secure-next-auth.session-token.0"),
    cookie(".chatgpt.com", "__Secure-next-auth.session-token.1"),
    cookie("auth.example.co.uk", "__Secure-authjs.session-token"),
    cookie("other.example.co.uk", "__Secure-better-auth.session_token"),
    cookie("www.blog.example", "wordpress_logged_in_0123456789abcdef0123456789abcdef"),
    cookie("blog.example", "wordpress_logged_in_0123456789abcdef0123456789abcdef"),
    cookie("www.unrelated.example.co.uk", "PHPSESSID"),
  ], now), ["auth.example.co.uk", "blog.example", "chatgpt.com", "other.example.co.uk"]);
});

test("expired, empty, invalid and orphaned login cookies are omitted", () => {
  const cookies = [
    cookie("expired.test", "next-auth.session-token", { expirationDate: now }),
    cookie("invalid-expiry.test", "next-auth.session-token", { expirationDate: NaN }),
    cookie("empty.test", "next-auth.session-token", { value: " " }),
    cookie("deleted.test", "next-auth.session-token", { value: "deleted" }),
    cookie("orphan.test", "__Secure-authjs.session-token.1"),
    cookie("unprotected.test", "next-auth.session-token", { httpOnly: false }),
    cookie("site.test/path", "next-auth.session-token"),
    cookie("user@site.test", "next-auth.session-token"),
    cookie("", "next-auth.session-token"),
  ];
  assert.deepEqual(browserSignedInSites(cookies, now), []);
  assert.deepEqual(browserSignedInSites([cookie("session.test", "next-auth.session-token", {
    expirationDate: undefined, session: true,
  })], now), ["session.test"]);
});

test("removing the authentication cookie drops the site even while other cookies remain", () => {
  const preferences = cookie("account.test", "theme", { value: "dark" });
  const authentication = cookie("account.test", "next-auth.session-token");
  assert.deepEqual(browserSignedInSites([preferences, authentication], now), ["account.test"]);
  const afterLogout = browserSignedInSites([preferences], now);
  assert.deepEqual(afterLogout, []);
  assert.equal(JSON.stringify(browserSignedInSites([authentication], now)).includes(authentication.value), false);
});
