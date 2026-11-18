// Local-only replay of the explicitly selected desktop history. Writes go to
// an isolated profile. The receipt contains counts and timings only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BrowserHistory } from "../../desktop/dist-tests/src/main/browser-history.js";
import { personalFixture } from "../tests/helpers/personal-context-fixture.mjs";

const [host, query, out] = process.argv.slice(2);
assert.ok(host && query, "Supply the expected host and lookup text.");
const f = await personalFixture();
try {
  const { resolvePersonalContext } = await import("../src/lib/personal-context/resolve.ts");
  const live = path.join(process.env.APPDATA, "breadboard-desktop/Data/config/browser-history.json");
  const copy = path.join(f.dir, "browser-history.json");
  fs.writeFileSync(copy, fs.readFileSync(live));
  const legacy = JSON.parse(fs.readFileSync(copy, "utf8")).entries.filter(entry => entry.visitsByUser === undefined).length;
  const history = new BrowserHistory(
    f.dir,
    () => {},
    () => "1",
  );
  const snapshot = history.snapshot();
  assert.equal(snapshot.error, null);
  assert.ok(history.restorePersonalHistory(), history.snapshot().error);
  const times = [];
  let matched = false;
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    const results = await resolvePersonalContext({ ...f.input, query }, f.options);
    times.push(Math.round(performance.now() - start));
    matched = results.slice(0, 3).some((hit) => hit.ref.startsWith("https://" + host + "/"));
  }
  const report = {
    entries: snapshot.items.length,
    legacy,
    correctHostInTopThree: matched,
    lookupMs: times,
  };
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(report);
  assert.ok(matched);
} finally {
  f.close();
  f.canonical.close();
  fs.rmSync(f.root, { recursive: true, force: true });
}
