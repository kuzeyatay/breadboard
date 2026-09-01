import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  productSearchMarketContext,
  productSearchMarketFromTimeZone,
  resolveProductSearchMarket,
  setProductSearchMarketContext,
} from "../src/lib/product-search/market-context.ts";

const AMSTERDAM = {
  latitude: 52.37,
  longitude: 4.9,
  capturedAt: "2026-08-31T19:00:00.000Z",
  accuracyMeters: 60,
  timeZone: "Europe/Amsterdam",
};

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Amsterdam resolves deterministically to Breadboard's Netherlands market", async () => {
  assert.deepEqual(productSearchMarketFromTimeZone("Europe/Amsterdam"), {
    locale: "nl-nl",
    countryCode: "NL",
    countryName: "Netherlands",
  });
  let reverseCalls = 0;
  assert.deepEqual(
    await resolveProductSearchMarket(AMSTERDAM, {
      reverse: async () => {
        reverseCalls += 1;
        return { address: { countryCode: "DE" } };
      },
    }),
    {
      locale: "nl-nl",
      countryCode: "NL",
      countryName: "Netherlands",
    },
  );
  assert.equal(reverseCalls, 0, "an unambiguous time zone needs no location-network call");
});

test("unknown zones fall back to reverse geocoding and retain only country data", async () => {
  const market = await resolveProductSearchMarket(
    { ...AMSTERDAM, timeZone: "Etc/UTC" },
    { reverse: async () => ({ address: { countryCode: "nl" } }) },
  );
  assert.deepEqual(market, {
    locale: "nl-nl",
    countryCode: "NL",
    countryName: "Netherlands",
  });
  assert.equal("latitude" in market, false);
  assert.equal("longitude" in market, false);
});

test("runtime market context replaces, expires, and clears instead of persisting a trail", () => {
  const market = productSearchMarketFromTimeZone("Europe/Amsterdam");
  assert.ok(market);
  setProductSearchMarketContext(991_001, market, 10_000);
  assert.deepEqual(productSearchMarketContext(991_001, 10_001), market);
  assert.equal(productSearchMarketContext(991_001, 10_000 + 31 * 60_000), null);

  setProductSearchMarketContext(991_001, market, 20_000);
  setProductSearchMarketContext(991_001, null, 20_001);
  assert.equal(productSearchMarketContext(991_001, 20_002), null);
});

test("the tool route overrides model locale from signed runtime market context", () => {
  const route = source("../src/app/api/hermes/tools/product-search/route.ts");
  assert.match(route, /productSearchMarketContext\(session\.id\)/);
  assert.match(route, /\.\.\.\(market \? \{ country: market\.locale \} : \{\}\)/);
  assert.match(route, /localizedMarket: Boolean\(market\)/);

  const turn = source("../src/lib/conversations/turn-service.ts");
  assert.match(turn, /resolveProductSearchMarket\(currentLocationSnapshot\)/);
  assert.match(turn, /setProductSearchMarketContext\(session\.row\.id, productSearchMarket\)/);
});
