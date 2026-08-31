import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

import {
  generativeUiResourcesFromToolOutput,
  generativeUiResourcesFromVerification,
  normalizeGenerativeUiResource,
  normalizeGenerativeUiResources,
  productForAction,
  safeProductUrl,
} from "../src/lib/generative-ui/contracts.ts";
import { backfillGenerativeUiResources } from "../src/lib/generative-ui/backfill.ts";
import { serializeConversationExport } from "../src/lib/conversations/export.ts";
import { cloneMessages } from "../src/app/components/hermes/conversation-branches.ts";
import {
  jsonLdProductsFromHtml,
  pricedCandidatesFromSearchHtml,
  productPriceFromHtml,
  productPriceFromText,
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
        <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fshop.example%2Ftrackpad" class="result__a">T1 Plus Trackpad</a>
        <a class="result__snippet">Buy direct for $49.99 with free shipping.</a>
      </div>
    `),
    [{
      title: "T1 Plus Trackpad",
      pageUrl: "https://shop.example/trackpad",
      priceHint: { amount: "49.99", currency: "USD", display: "$49.99" },
    }],
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
  assert.match(productSearch, /`\$\{input\.query\} price buy`/);
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
