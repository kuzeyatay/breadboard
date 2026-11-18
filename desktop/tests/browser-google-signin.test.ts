import { test } from "node:test";
import assert from "node:assert/strict";
import { firefoxUserAgent, isGoogleSignInUrl } from "../src/main/browser-google-signin";

test("only the Google sign-in host gets the Firefox identity", () => {
  assert.equal(isGoogleSignInUrl("https://accounts.google.com/v3/signin/identifier?x=1"), true);
  for (const url of ["https://mail.google.com/", "https://accounts.google.com.evil.test/", "not a url"]) {
    assert.equal(isGoogleSignInUrl(url), false);
  }
});

test("Firefox identity keeps the OS and a current version", () => {
  const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
  assert.equal(firefoxUserAgent(chrome, Date.UTC(2024, 6, 9)), "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0");
  assert.match(firefoxUserAgent(chrome, Date.UTC(2026, 10, 18)), /Firefox\/158\.0$/);
});
