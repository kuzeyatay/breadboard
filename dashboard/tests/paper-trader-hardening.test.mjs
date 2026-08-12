import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = (relativePath) =>
  fs.readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");

test("the company universe refreshes atomically and expires in a long-running process", async () => {
  const universeModule = await import("../src/lib/paper-trader/equity-universe.ts");
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-equities-"));
  const previousHome = process.env.PAPER_TRADER_HOME;
  const previousFetch = globalThis.fetch;
  const cacheKey = "__breadboardPaperTraderEquityUniverse";
  const nasdaq = [
    "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
    "AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N",
  ].join("\n");
  const other = [
    "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
    "MSFT|Microsoft Corporation - Common Stock|N|MSFT|N|100|N|MSFT",
  ].join("\n");
  let partialRefresh = false;
  let fetches = 0;

  try {
    process.env.PAPER_TRADER_HOME = temporaryHome;
    delete globalThis[cacheKey];
    globalThis.fetch = async (url) => {
      fetches += 1;
      if (partialRefresh && String(url).includes("otherlisted")) {
        throw new Error("one exchange directory is temporarily unavailable");
      }
      return new Response(String(url).includes("otherlisted") ? other : nasdaq, { status: 200 });
    };

    const startedAt = Date.now();
    const firstPromise = universeModule.equityUniverse(startedAt);
    const complete = await firstPromise;
    assert.deepEqual(
      complete.map((listing) => listing.symbol).sort(),
      ["AAPL", "MSFT"],
    );
    assert.strictEqual(universeModule.equityUniverse(startedAt + 1), firstPromise);
    assert.equal(fetches, 2, "a warm in-process cache fetched the directories again");

    partialRefresh = true;
    const refreshedPromise = universeModule.equityUniverse(startedAt + 25 * 60 * 60 * 1000);
    assert.notStrictEqual(refreshedPromise, firstPromise, "the in-memory promise never expired");
    const preserved = await refreshedPromise;
    assert.deepEqual(
      preserved.map((listing) => listing.symbol).sort(),
      ["AAPL", "MSFT"],
      "a partial refresh replaced the complete cached universe",
    );
    assert.equal(fetches, 4);
  } finally {
    if (previousHome === undefined) delete process.env.PAPER_TRADER_HOME;
    else process.env.PAPER_TRADER_HOME = previousHome;
    globalThis.fetch = previousFetch;
    delete globalThis[cacheKey];
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
});

test("the simulated arena inherits only operating-system variables", async () => {
  const { paperTraderEnv } = await import("../src/lib/paper-trader/runtime.ts");
  const child = paperTraderEnv(
    { DATABASE_PATH: "paper.db" },
    {
      Path: "C:\\tools",
      SystemRoot: "C:\\Windows",
      DATABASE_URL: "must-not-cross",
      SESSION_COOKIE: "must-not-cross",
      UNUSUAL_CREDENTIAL: "must-not-cross",
    },
  );
  assert.equal(child.Path, "C:\\tools");
  assert.equal(child.SystemRoot, "C:\\Windows");
  assert.equal(child.DATABASE_PATH, "paper.db");
  assert.equal(child.DATABASE_URL, undefined);
  assert.equal(child.SESSION_COOKIE, undefined);
  assert.equal(child.UNUSUAL_CREDENTIAL, undefined);
});

test("unknown market state, missing marks, and expensive shares all fail safely", async () => {
  const equity = source("../scripts/paper-trader-overlay/equity.ts");
  assert.match(equity, /marketState \?\? 'UNKNOWN'/);
  assert.doesNotMatch(equity, /marketState \?\? 'REGULAR'/);

  const route = source("src/app/api/paper-trader/decide/chat/completions/route.ts");
  assert.match(route, /livePriceBook\.missing\.length/);
  assert.match(route, /will not act on an incomplete risk picture/);

  const symbols = await import("../../scripts/paper-trader-overlay/deskSymbols.ts");
  assert.equal(symbols.roundQuantity("BRK-A", 0.00285714), 0.002857);
});
