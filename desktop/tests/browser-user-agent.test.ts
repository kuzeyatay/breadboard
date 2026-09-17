import { test } from "node:test";
import assert from "node:assert/strict";
import { browserUserAgent } from "../src/main/browser-user-agent";

test("browser identity retains the installed Chromium version and OS without shell products", () => {
  for (const os of ["Windows NT 10.0; Win64; x64", "X11; Linux x86_64", "Macintosh; Intel Mac OS X 10_15_7"]) {
    const prefix = `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko)`;
    const expected = `${prefix} Chrome/130.0.6723.191 Safari/537.36`;
    for (const product of ["", "breadboard-desktop/0.1.0 ", "Breadboard/0.1.0 "]) {
      assert.equal(browserUserAgent(`${prefix} ${product}Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36`), expected);
    }
    assert.equal(browserUserAgent(expected), expected);
  }
});

test("browser identity preserves other products and does not manufacture Chromium support", () => {
  const custom = "Mozilla/5.0 Chrome/140.0.1.2 Electron/38.0.0 Safari/537.36 Custom/1.0";
  assert.equal(browserUserAgent(custom), "Mozilla/5.0 Chrome/140.0.1.2 Safari/537.36 Custom/1.0");
  for (const value of ["", "custom-client", "Mozilla/5.0 Firefox/140.0"]) {
    assert.equal(browserUserAgent(value), value);
  }
});
