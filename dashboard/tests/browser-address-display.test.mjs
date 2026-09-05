import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { browserAddressDisplayValue } from "../src/app/browser/browser-address-display.ts";

const client = fs.readFileSync(
  new URL("../src/app/browser/browser-client.tsx", import.meta.url),
  "utf8",
);

test("the idle address bar elides only the ordinary secure scheme", () => {
  assert.equal(
    browserAddressDisplayValue("https://mail.google.com/mail/u/0/#inbox"),
    "mail.google.com/mail/u/0/#inbox",
  );
  assert.equal(browserAddressDisplayValue("https://example.com/"), "example.com");
  assert.equal(
    browserAddressDisplayValue("https://example.com/docs?q=browser#address"),
    "example.com/docs?q=browser#address",
  );
  assert.equal(
    browserAddressDisplayValue("http://example.com/"),
    "http://example.com/",
    "insecure HTTP remains visible",
  );
  assert.equal(browserAddressDisplayValue("not a URL"), "not a URL");
});

test("the browser edits and submits the canonical address", () => {
  assert.match(client, /value=\{addressDisplay\}/);
  assert.match(client, /setDraftAddress\(browser\.address\)/);
  assert.match(client, /navigate\(suggestion\?\.value \?\? address\)/);
  assert.doesNotMatch(client, /navigate\(suggestion\?\.value \?\? addressDisplay\)/);
});
