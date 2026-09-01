import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

import {
  generativeUiResourcesFromToolOutput,
  generativeUiResourcesFromVerification,
  gardenNavigationResourceFromSources,
  normalizeGenerativeUiResource,
  normalizeGenerativeUiResources,
  productForAction,
  safeProductUrl,
} from "../src/lib/generative-ui/contracts.ts";
import { backfillGenerativeUiResources } from "../src/lib/generative-ui/backfill.ts";
import { serializeConversationExport } from "../src/lib/conversations/export.ts";
import { cloneMessages } from "../src/app/components/hermes/conversation-branches.ts";
import {
  isBuyableProductUrl,
  jsonLdProductsFromHtml,
  pricedCandidatesFromSearchHtml,
  productPriceFromHtml,
  productPriceFromText,
  structuredProductAvailableInCountry,
} from "../src/lib/product-search/service.ts";
import { composeHermesSystemPrompt } from "../src/lib/hermes/system-prompts.ts";

const productResource = {
  schemaVersion: 1,
  kind: "product-search",
  renderer: "product-carousel",
  id: "product-search:test",
  title: "Products for headphones",
  createdAt: "2026-08-31T10:00:00.000Z",
  actions: ["open-details", "find-similar", "compare", "visit"],
  data: {
    query: "noise cancelling headphones",
    sources: [
      {
        id: "source:one",
        title: "Acme Headphones",
        url: "https://shop.example/products/acme",
        site: "shop.example",
        accessedAt: "2026-08-31T10:00:00.000Z",
      },
    ],
    products: [
      {
        id: "product:one",
        title: "Acme Quiet One",
        merchant: "Acme",
        url: "https://shop.example/products/acme",
        imageUrl: "https://images.example/acme.png",
        price: { amount: "199.99", currency: "USD", display: "$199.99" },
        rating: 4.6,
        reviewCount: 412,
        attributes: [{ label: "Battery", value: "30 hours" }],
        sourceIds: ["source:one"],
      },
    ],
  },
};

const gardenResource = {
  schemaVersion: 1,
  kind: "garden-search",
  renderer: "garden-navigator",
  id: "garden-search:test",
  title: "Found in your Gardens",
  createdAt: "2026-08-31T10:00:00.000Z",
  actions: ["open-garden", "open-page"],
  data: {
    query: "where are my notes about spiking neural networks?",
    gardens: [{
      slug: "neuromorphic-computing",
      name: "Neuromorphic Computing",
      results: [{
        pageSlug: "spiking-neural-networks",
        title: "Spiking neural networks",
        heading: "Event-driven computation",
      }],
    }],
  },
};

test("normalizes the versioned product-search resource and action allowlist", () => {
  const normalized = normalizeGenerativeUiResource({
    ...productResource,
    actions: ["visit", "run-script", "open-details"],
    executable: "alert(document.cookie)",
  });
  assert.ok(normalized);
  assert.deepEqual(normalized.actions, ["open-details", "visit"]);
  assert.equal("executable" in normalized, false);
  assert.equal(normalized.data.products[0].price.display, "$199.99");
});

test("rejects unknown renderers, invalid versions, and local destinations", () => {
  assert.equal(
    normalizeGenerativeUiResource({ ...productResource, renderer: "remote-component" }),
    null,
  );
  assert.equal(
    normalizeGenerativeUiResource({ ...productResource, schemaVersion: 2 }),
    null,
  );
  assert.equal(safeProductUrl("http://shop.example/product"), "");
  assert.equal(safeProductUrl("https://127.0.0.1/admin"), "");
  assert.equal(safeProductUrl("https://catalog.internal/product"), "");
  assert.equal(safeProductUrl("javascript:alert(1)"), "");
});

test("only product_search can project a product resource from tool output", () => {
  const output = JSON.stringify({ uiResources: [productResource] });
  assert.equal(generativeUiResourcesFromToolOutput("web_search", output).length, 0);
  assert.equal(generativeUiResourcesFromToolOutput("product_search", output).length, 1);
  assert.equal(generativeUiResourcesFromToolOutput("product_search", "not json").length, 0);
});

test("normalizes Garden navigation resources and keeps them scoped to garden_search", () => {
  const normalized = normalizeGenerativeUiResource({
    ...gardenResource,
    actions: ["open-page", "run-script", "open-garden"],
    href: "javascript:alert(document.cookie)",
  });
  assert.ok(normalized);
  assert.equal(normalized.kind, "garden-search");
  assert.deepEqual(normalized.actions, ["open-garden", "open-page"]);
  assert.equal("href" in normalized, false);

  const output = JSON.stringify({ uiResources: [gardenResource, productResource] });
  assert.deepEqual(
    generativeUiResourcesFromToolOutput("garden_search", output).map((item) => item.kind),
    ["garden-search"],
  );
  assert.equal(generativeUiResourcesFromToolOutput("web_search", output).length, 0);
  assert.equal(
    normalizeGenerativeUiResource({
      ...gardenResource,
      data: {
        ...gardenResource.data,
        gardens: [{ ...gardenResource.data.gardens[0], slug: "../../admin" }],
      },
    }),
    null,
  );
});

test("groups retrieved pages into one navigation destination per Garden", () => {
  const resource = gardenNavigationResourceFromSources({
    id: "garden-search:grouped",
    query: "find my learning notes",
    createdAt: "2026-08-31T10:00:00.000Z",
    sources: [
      {
        gardenName: "Physics",
        gardenSlug: "physics",
        pageSlug: "waves",
        title: "Waves",
      },
      {
        gardenName: "Physics",
        gardenSlug: "physics",
        pageSlug: "fields",
        title: "Fields",
      },
      {
        gardenName: "Mathematics",
        gardenSlug: "mathematics",
        pageSlug: "fourier-series",
        title: "Fourier series",
      },
    ],
  });
  assert.ok(resource);
  assert.equal(resource.data.gardens.length, 2);
  assert.deepEqual(
    resource.data.gardens.map((garden) => [garden.slug, garden.results.length]),
    [["physics", 2], ["mathematics", 1]],
  );
});

test("recovers and promotes a historical live product result exactly once", () => {
  const verification = {
    evidence: [{
      success: true,
      details: {
        toolName: "product_search",
        result: { success: true, uiResources: [productResource] },
      },
    }],
  };
  assert.equal(generativeUiResourcesFromVerification(verification).length, 1);

  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE conversation_messages (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL,
      metadata TEXT
    );
  `);
  db.prepare(
    "INSERT INTO conversation_messages(id, role, metadata) VALUES (1, 'assistant', ?)",
  ).run(JSON.stringify({ verification }));

  assert.equal(backfillGenerativeUiResources(db), 1);
  const metadata = JSON.parse(
    db.prepare("SELECT metadata FROM conversation_messages WHERE id = 1").get().metadata,
  );
  assert.equal(metadata.uiResources[0].renderer, "product-carousel");
  assert.equal(backfillGenerativeUiResources(db), 0);
  db.close();
});

test("the product tool owns shopping discovery in Hermes normal tool selection", () => {
  const decision = {
    mode: "knowledge",
    requestedOutcome: "Recommend a product",
    implementationRequired: false,
    decisionReason: "Knowledge task",
    decisionSource: "breadboard_server_policy_v1",
    authorizedRoots: [],
    authorizedPathPatterns: [],
    allowedTools: ["websearch", "product_search"],
    allowedOperations: ["knowledge_work"],
    allowedCommandPatterns: [],
    selectedConditionalSkills: [],
    selectedConnections: [],
    createdAt: "2026-08-31T10:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
  };
  const prompt = composeHermesSystemPrompt({
    surface: "dashboard_terminal",
    decision,
    userText: "is there a bluetooth connected trackpad I can buy?",
  });
  assert.match(prompt, /# native_product_search/);
  assert.match(prompt, /is there a .* I can buy/i);
  assert.match(prompt, /Do not substitute generic `web_search`/);
  assert.match(prompt, /call `product_search` before answering/i);

  const withoutProductTool = composeHermesSystemPrompt({
    surface: "quartz_ai",
    decision: { ...decision, allowedTools: ["websearch"] },
    userText: "is there a bluetooth connected trackpad I can buy?",
  });
  assert.doesNotMatch(withoutProductTool, /# native_product_search/);
});

test("controlled actions cannot exceed the resource action grant", () => {
  const resource = normalizeGenerativeUiResource({
    ...productResource,
    actions: ["open-details"],
  });
  assert.ok(resource);
  assert.equal(
    productForAction({
      type: "product.open-details",
      resource,
      productId: "product:one",
    })?.title,
    "Acme Quiet One",
  );
  assert.equal(
    productForAction({ type: "product.visit", resource, productId: "product:one" }),
    null,
  );
  const selectable = normalizeGenerativeUiResource(productResource);
  assert.ok(selectable);
  assert.equal(
    productForAction({ type: "product.select", resource: selectable, productId: "product:one" })?.id,
    "product:one",
  );
});

test("branch snapshots deep-clone generative UI resources", () => {
  const original = [{ role: "assistant", content: "Results", uiResources: [productResource] }];
  const cloned = cloneMessages(original);
  assert.deepEqual(cloned, original);
  assert.notEqual(cloned[0].uiResources, original[0].uiResources);
  assert.notEqual(
    cloned[0].uiResources[0].data.products,
    original[0].uiResources[0].data.products,
  );
  cloned[0].uiResources[0].data.products[0].title = "Changed only in branch";
  assert.equal(original[0].uiResources[0].data.products[0].title, "Acme Quiet One");
});

test("JSON and markdown exports retain the complete native UI resource", () => {
  const conversation = {
    id: "conversation-1",
    title: "Headphone research",
    surface: "dashboard_terminal",
    messages: [
      { role: "user", content: "Find headphones" },
      { role: "assistant", content: "Here are the strongest options.", uiResources: [productResource] },
    ],
  };
  const json = serializeConversationExport(conversation, "json");
  const parsed = JSON.parse(json.body);
  assert.deepEqual(parsed.messages[1].uiResources, normalizeGenerativeUiResources([productResource]));
  assert.match(json.filename, /Headphone-research\.breadboard\.json$/);

  const markdown = serializeConversationExport(conversation, "markdown");
  assert.match(markdown.body, /```breadboard-ui/);
  assert.match(markdown.body, /"renderer": "product-carousel"/);
  assert.match(markdown.body, /Acme Quiet One/);
});

test("extracts Product JSON-LD without executing or repairing page scripts", () => {
  const html = `
    <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"BreadcrumbList","name":"Ignored"},
        {"@type":"Product","name":"Acme Quiet One","offers":{"@type":"Offer","price":"199.99","priceCurrency":"USD"}}
      ]}
    </script>
    <script type="application/ld+json">{ definitely invalid }</script>
  `;
  const products = jsonLdProductsFromHtml(html);
  assert.equal(products.length, 1);
  assert.equal(products[0].name, "Acme Quiet One");
});

test("uses standard merchant metadata when Product JSON-LD omits its price", () => {
  const price = productPriceFromHtml(`
    <meta content="49.99" property="product:price:amount">
    <meta property="product:price:currency" content="USD">
  `);
  assert.deepEqual(price, {
    amount: "49.99",
    currency: "USD",
    display: "$49.99",
  });
  assert.equal(
    productPriceFromHtml('<meta property="product:price:amount" content="49.99">'),
    undefined,
  );
  assert.deepEqual(
    productPriceFromHtml('<script>window.product={"currency":"EUR","currentPrice":"49,99"}</script>'),
    { amount: "49.99", currency: "EUR", display: "€49.99" },
  );
});

test("resolves prices from product-specific search snippets", () => {
  assert.deepEqual(
    productPriceFromText("ProtoArc T1 Plus — now US$49.99 with free shipping", "us-en"),
    { amount: "49.99", currency: "USD", display: "$49.99" },
  );
  assert.deepEqual(
    productPriceFromText("Trackpad aanbieding €49,99", "nl-nl"),
    { amount: "49.99", currency: "EUR", display: "€49.99" },
  );
  assert.equal(productPriceFromText("A trackpad with Bluetooth and USB-C", "us-en"), undefined);

  assert.deepEqual(
    pricedCandidatesFromSearchHtml(`
      <div class="result">
        <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fshop.example%2Fproducts%2Ftrackpad" class="result__a">T1 Plus Trackpad</a>
        <a class="result__snippet">Buy direct for $49.99 with free shipping.</a>
      </div>
    `),
    [{
      title: "T1 Plus Trackpad",
      pageUrl: "https://shop.example/products/trackpad",
      priceHint: { amount: "49.99", currency: "USD", display: "$49.99" },
    }],
  );
});

test("accepts only direct merchant product-detail destinations", () => {
  for (const url of [
    "https://www.amazon.nl/dp/B0C1234567",
    "https://www.bol.com/nl/nl/p/acme-trackpad/9300000123456/",
    "https://protoarc.com/products/t1-plus-wireless-trackpad",
    "https://www.ebay.nl/itm/123456789012",
  ]) {
    assert.equal(isBuyableProductUrl(url), true, url);
  }
  for (const url of [
    "https://www.amazon.nl/s?k=trackpad",
    "https://www.ebay.nl/b/Trackpads/1234/bn_700000",
    "https://example.com/reviews/best-trackpads",
    "https://shop.example/collections/trackpads",
    "https://allesrefurbished.nl/open-product.php?id=3248605",
    "https://shop.example/",
  ]) {
    assert.equal(isBuyableProductUrl(url), false, url);
  }
});

test("localized discovery retains market evidence only on direct merchant results", () => {
  assert.deepEqual(
    pricedCandidatesFromSearchHtml(`
      <div class="result">
        <a class="result__a" href="https://shop.example.nl/products/trackpad">Trackpad</a>
        <span>€49,99 — op voorraad in Nederland</span>
      </div>
      <div class="result">
        <a class="result__a" href="https://shop.example.nl/search?q=trackpad">Search</a>
        <span>€39,99</span>
      </div>
    `, "nl-nl"),
    [{
      title: "Trackpad",
      pageUrl: "https://shop.example.nl/products/trackpad",
      priceHint: { amount: "49.99", currency: "EUR", display: "€49.99" },
      marketEvidence: true,
    }],
  );
});

test("honours merchant stock and shipping-region evidence", () => {
  const product = {
    "@type": "Product",
    name: "Local Trackpad",
    offers: {
      "@type": "Offer",
      price: "59.99",
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      shippingDetails: {
        shippingDestination: { addressCountry: "NL" },
      },
    },
  };
  assert.equal(structuredProductAvailableInCountry(product, "NL"), true);
  assert.equal(structuredProductAvailableInCountry(product, "US"), false);
  assert.equal(
    structuredProductAvailableInCountry({
      ...product,
      offers: {
        ...product.offers,
        availability: "https://schema.org/OutOfStock",
      },
    }, "NL"),
    false,
  );
});

test("the renderer registry and surface wiring stay Breadboard-owned", () => {
  const renderer = readFileSync(
    new URL("../src/app/components/hermes/generative-ui-renderer.tsx", import.meta.url),
    "utf8",
  );
  const carousel = readFileSync(
    new URL("../src/app/components/hermes/product-carousel.tsx", import.meta.url),
    "utf8",
  );
  const details = readFileSync(
    new URL("../src/app/components/hermes/product-details-panel.tsx", import.meta.url),
    "utf8",
  );
  const productSearch = readFileSync(
    new URL("../src/lib/product-search/service.ts", import.meta.url),
    "utf8",
  );
  const runtimePanel = readFileSync(
    new URL("../src/app/components/hermes/agent-runtime-panel.tsx", import.meta.url),
    "utf8",
  );
  const terminal = readFileSync(
    new URL("../src/app/components/hermes/dashboard-agent-terminal.tsx", import.meta.url),
    "utf8",
  );
  const garden = readFileSync(
    new URL("../src/app/gardens/[clusterSlug]/workspace-client.tsx", import.meta.url),
    "utf8",
  );
  assert.match(renderer, /switch \(resource\.renderer\)/);
  assert.match(renderer, /case "product-carousel"/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML|eval\(|new Function|import\(resource/);
  assert.match(carousel, /touch-pan-x/);
  assert.match(carousel, /grid-flow-col/);
  assert.match(carousel, /sm:auto-cols-\[calc\(\(100%_-_3rem\)_\/_2\)\]/);
  assert.match(carousel, /text-white/);
  assert.doesNotMatch(carousel, /Product facts come|sourced result/);
  assert.match(carousel, /aria-pressed=\{compareActive\}/);
  assert.match(carousel, /compareActive \? "Selected" : "Select"/);
  assert.match(carousel, /dispatch\("product\.select"/);
  assert.match(carousel, /group-hover:scale-\[1\.035\]/);
  assert.doesNotMatch(carousel, /Price on site|Price unavailable/);
  assert.match(details, /const comparing = compared\.length >= 2/);
  assert.match(details, /Product comparison/);
  assert.match(details, /comparisonRows\(compared\)/);
  assert.doesNotMatch(details, />Sources</);
  assert.doesNotMatch(details, /Price on site|Price unavailable/);
  assert.match(productSearch, /marketSearchSuffix\(input\.country\)/);
  assert.match(productSearch, /isBuyableProductUrl/);
  assert.match(productSearch, /structuredProductAvailableInCountry/);
  assert.match(productSearch, /filter\(\(\{ product \}\) => Boolean\(product\.price\)\)/);
  assert.match(runtimePanel, /message\.uiResources\?\.length/);
  for (const surface of [terminal, garden]) {
    assert.match(surface, /<ProductDetailsPanel/);
    assert.match(surface, /<SidePanelDock/);
    assert.match(surface, /onGenerativeUiAction/);
    assert.match(surface, /type: "product" as const/);
    assert.match(surface, /slice\(-2\)/);
  }
});

test("canonical, Garden compatibility, branch, restore, and export paths carry uiResources", () => {
  const files = [
    "../src/lib/hermes/event-stream.ts",
    "../src/lib/hermes/session-presentation.ts",
    "../src/lib/hermes/garden-chat-adapter.ts",
    "../src/app/api/chat-sessions/route.ts",
    "../src/app/api/chat-sessions/[sessionId]/route.ts",
    "../src/app/components/hermes/conversation-branches.ts",
    "../src/lib/conversations/export.ts",
  ];
  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /uiResources/, `${relative} must preserve native UI resources`);
  }
});
