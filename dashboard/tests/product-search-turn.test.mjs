import assert from "node:assert/strict";
import test from "node:test";
import { isProductBuyingRequest, prepareProductSearchTurn, productSearchTurnContext, productSearchTurnEvent } from "../src/lib/product-search/turn.ts";
import { generativeUiResourcesFromToolOutput, normalizeGenerativeUiResources } from "../src/lib/generative-ui/contracts.ts";

const request = "is there an ssd i could buy that would be as fast as my computers internal one that can be connected via usb or type c or via any cable, i just want it to be fast af";
const source = { id: "source:ssd", title: "Acme external SSD", site: "shop.example.nl", url: "https://shop.example.nl/products/ssd", accessedAt: "2026-09-26T12:00:00Z" };
const resource = {
  schemaVersion: 1, kind: "product-search", renderer: "product-carousel", id: "products:test", title: "External SSDs", createdAt: source.accessedAt, actions: ["visit"],
  data: { query: "external USB4 SSD", sources: [source], products: [{ id: "ssd", title: source.title, url: source.url, merchant: source.site, price: { amount: "199", currency: "EUR", display: "€199.00" }, sourceIds: [source.id] }] },
};
const result = { query: resource.data.query, productsReturned: 1, uiResources: [resource], sources: [source], summary: "Found 1 sourced product." };
const planner = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ query: "external USB4 Thunderbolt SSD", country: "us-en" }) } }] });

test("the original SSD request triggers discovery; pasted instructions and repair requests do not", () => {
  for (const text of [request, "is there a bluetooth trackpad I can buy?", "What headphones should I buy?", "Can you recommend a laptop under €900?", "Find an external SSD 2 TB", "I want to buy an external SSD"]) {
    assert.equal(isProductBuyingRequest(text), true, text);
  }
  for (const text of ["Explain how an SSD works", "Fix the product recommendations UI", "My SSD is broken; how do I fix it?", "Don't recommend products", 'Translate "is there an SSD I could buy?"', `Summarize this:\n> ${request}`, `<attachment>${request}</attachment>`, "Recommend a restaurant for tonight", "What stocks should I buy?"]) {
    assert.equal(isProductBuyingRequest(text), false, text);
  }
});

test("a buying turn searches before synthesis and its real result survives event/history normalization", async () => {
  let calls = 0;
  const turn = await prepareProductSearchTurn({ request, enabled: true, country: "nl-nl" }, {
    fetcher: planner,
    search: async (args, options) => {
      calls++;
      assert.equal(args.query, "external USB4 Thunderbolt SSD");
      assert.equal(args.country, "nl-nl", "server market wins over query planner");
      assert.equal(options.userRequest, request);
      return result;
    },
  });
  assert.equal(calls, 1);
  const restored = JSON.parse(JSON.stringify({ productSearch: turn })).productSearch;
  const event = productSearchTurnEvent(restored, "session", "run");
  assert.equal(event.payload.toolName, "product_search");
  assert.equal(event.payload.success, true);
  assert.equal(event.payload.websites[0].url, source.url);
  assert.deepEqual(event.payload.uiResources, normalizeGenerativeUiResources([resource]));
  assert.deepEqual(generativeUiResourcesFromToolOutput("product_search", JSON.stringify(event.payload.details.result)), event.payload.uiResources);
  assert.match(productSearchTurnContext(restored), /Acme external SSD/);
});

test("query-planner failure cannot silently skip a buying request", async () => {
  let calls = 0;
  const turn = await prepareProductSearchTurn({ request, enabled: true }, {
    fetcher: async () => { throw new Error("offline"); },
    search: async (args) => { calls++; assert.equal(args.query, request); return result; },
  });
  assert.equal(calls, 1);
  assert.equal(turn.result.productsReturned, 1);
});

test("no matches and unavailable search are distinct receipts with no invented cards", async () => {
  for (const fail of [false, true]) {
    const turn = await prepareProductSearchTurn({ request, enabled: true }, {
      fetcher: planner,
      search: async () => { if (fail) throw new Error("offline"); return { ...result, productsReturned: 0, uiResources: [], sources: [], summary: "No matching products." }; },
    });
    const event = productSearchTurnEvent(turn, "session", "run");
    assert.equal(event.payload.success, !fail);
    assert.deepEqual(event.payload.uiResources, []);
    assert.match(productSearchTurnContext(turn), /never recommend unrelated products/);
  }
});

test("disabled tools and non-buying requests never call the planner or search", async () => {
  const unexpected = async () => { assert.fail("unexpected external call"); };
  for (const input of [{ request, enabled: false }, { request: "Explain USB4", enabled: true }]) {
    assert.equal(await prepareProductSearchTurn(input, { fetcher: unexpected, search: unexpected }), null);
  }
});
