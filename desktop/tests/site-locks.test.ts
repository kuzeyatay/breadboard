import { test } from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { localDay, siteLockConfig, siteLockPage, siteLockUsage, siteLockVerdict, verifySiteLockPassword } from "../src/main/site-locks";

const config = siteLockConfig({ password: null, sites: [
  { domain: "youtube.com", mode: "daily", minutes: 30 }, { domain: "tiktok.com", mode: "always" }, { domain: "bad domain", mode: "always" }] });
const now = Date.now();

test("always-locked sites and their subdomains are blocked; other sites are not", () => {
  const usage = siteLockUsage(null, now);
  assert.equal(config.sites.length, 2);
  assert.equal(siteLockVerdict(config, usage, "https://www.tiktok.com/@x", now)?.mode, "always");
  assert.equal(siteLockVerdict(config, usage, "https://m.tiktok.com/", now)?.domain, "tiktok.com");
  assert.equal(siteLockVerdict(config, usage, "https://nottiktok.com/", now), null);
  assert.equal(siteLockVerdict(config, usage, "data:text/html,x", now), null);
});

test("a daily limit blocks only once today's minutes are used, and an unlock lifts it", () => {
  const under = siteLockUsage({ day: localDay(now), used: { "youtube.com": 29 * 60000 } }, now);
  assert.equal(siteLockVerdict(config, under, "https://youtube.com/watch", now), null);
  const over = siteLockUsage({ day: localDay(now), used: { "youtube.com": 30 * 60000 } }, now);
  assert.equal(siteLockVerdict(config, over, "https://youtube.com/watch", now)?.minutes, 30);
  over.unlocks["youtube.com"] = now + 60000;
  assert.equal(siteLockVerdict(config, over, "https://youtube.com/watch", now), null);
  // Yesterday's usage and expired unlocks do not carry over.
  assert.deepEqual(siteLockUsage({ day: "2000-01-01", used: { "youtube.com": 1e9 }, unlocks: { "tiktok.com": now - 1 } }, now), { day: localDay(now), used: {}, unlocks: {} });
});

test("the dashboard's scrypt format verifies and the lock page escapes the site", async () => {
  const salt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const stored = `scrypt$${salt.toString("hex")}$${scryptSync("hunter22", salt, 32).toString("hex")}`;
  assert.equal(await verifySiteLockPassword(stored, "hunter22"), true);
  assert.equal(await verifySiteLockPassword(stored, "wrong"), false);
  assert.equal(await verifySiteLockPassword(null, "hunter22"), false);
  const page = decodeURIComponent(siteLockPage({ domain: "tiktok.com", mode: "always", minutes: 0 }, "https://tiktok.com/</script><b>"));
  assert.ok(page.startsWith("data:text/html;charset=utf-8,<!--bb-site-lock-->"));
  assert.ok(!page.includes("</script><b>"));
});
