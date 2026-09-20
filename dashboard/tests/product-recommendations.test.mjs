import assert from "node:assert/strict";
import dns from "node:dns/promises";
import test from "node:test";
import { productPriceFromHtml, productPriceFromText, searchProducts } from "../src/lib/product-search/service.ts";
import { parseReviewedProducts, reviewProductRecommendations } from "../src/lib/product-search/recommendations.ts";

test("prices remain single validated amounts, including European separators", () => {
  for (const [raw, amount] of [["33,98", "33.98"], ["1.299,95", "1299.95"], ["1,299.95", "1299.95"], ["1 299,95", "1299.95"], ["1.299", "1299"]]) {
    assert.equal(productPriceFromHtml(`<meta property="product:price:amount" content="${raw}"><meta property="product:price:currency" content="EUR">`)?.amount, amount);
  }
  for (const raw of ["33,988901", "33,98 8901", "EUR 33,98 SKU 8901", "-33.98", "33.98–89.01", "33,98,89,01"]) {
    assert.equal(productPriceFromHtml(`<meta property="product:price:amount" content="${raw}"><meta property="product:price:currency" content="EUR">`), undefined, raw);
  }
  assert.equal(productPriceFromText("€33,98 · SKU 8901", "nl-nl")?.amount, "33.98");
  assert.equal(productPriceFromText("€33,988901", "nl-nl"), undefined);
});

const candidate = { id: "ssd", title: "Acme X4 externe SSD 2 TB - Snelle levering", merchant: "shop.example.nl", url: "https://shop.example.nl/product/ssd", imageUrl: "https://shop.example.nl/ssd.jpg", price: { amount: "199", currency: "EUR", display: "€199.00" }, sourceIds: ["source:ssd"] };
test("review can translate and rank, but cannot replace sourced commercial facts", () => {
  const reviewed = parseReviewedProducts(JSON.stringify({ products: [{ id: "ssd", title: "Acme X4 External SSD 2 TB", url: "https://wrong.example/", price: { amount: "1" } }] }), [candidate]);
  assert.deepEqual(reviewed, [{ ...candidate, title: "Acme X4 External SSD 2 TB" }]);
  assert.equal(candidate.title, "Acme X4 externe SSD 2 TB - Snelle levering");
  for (const products of [[{ id: "invented", title: "SSD" }], [{ id: "ssd", title: "" }], [{ id: "ssd", title: "SSD" }, { id: "ssd", title: "SSD" }]]) {
    assert.throws(() => parseReviewedProducts(JSON.stringify({ products }), [candidate]));
  }
  assert.deepEqual(parseReviewedProducts('{"products":[]}', [candidate]), []);
});

test("a failed review never silently releases unreviewed candidates", async () => {
  await assert.rejects(reviewProductRecommendations("external SSD", [candidate], { fetcher: async () => new Response("offline", { status: 503 }) }));
  await assert.rejects(reviewProductRecommendations("external SSD", [candidate], { fetcher: async () => Response.json({ choices: [{ message: { content: "not JSON" } }] }) }));
});

test("the full search reviews relevance before count limiting and emits only English reviewed names", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  let modelCalls = 0;
  let reviewMode = "match";
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "duckduckgo.com") throw new Error("image search unavailable");
    if (url.hostname === "html.duckduckgo.com") return new Response(`
      <a class="result__a" href="https://shop.example.nl/product/valve">Voetklep smal model</a><a class="result__snippet">€31,14</a>
      <a class="result__a" href="https://shop.example.nl/product/ssd">Acme X4 externe SSD 2 TB</a><a class="result__snippet">€199,00</a>
      <a class="result__a" href="https://shop.example.nl/product/sold">Acme Sold SSD</a><a class="result__snippet">€100,00</a>
    `, { headers: { "content-type": "text/html" } });
    if (url.hostname === "shop.example.nl") {
      const ssd = url.pathname.endsWith("/ssd");
      return new Response(`<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: ssd ? candidate.title : "Voetklep smal model", description: ssd ? "External USB4 SSD with 3800 MB/s read speed, 2 TB." : "Brass foot valve for irrigation.", image: ssd ? candidate.imageUrl : undefined, offers: { "@type": "Offer", price: ssd ? "199.00" : "31.14", priceCurrency: "EUR", availability: url.pathname.endsWith("/sold") ? "https://schema.org/OutOfStock" : "https://schema.org/InStock" } })}</script>`, { headers: { "content-type": "text/html" } });
    }
    if (url.pathname.endsWith("/chat/completions")) {
      modelCalls++;
      const body = JSON.parse(init.body);
      assert.match(body.messages[0].content, /English/);
      assert.match(body.messages[0].content, /Exclude accessories/);
      const review = JSON.parse(body.messages[1].content);
      assert.equal(review.query, "external USB4 SSD 2 TB 3800 MB/s");
      assert.equal(review.candidates.length, 2, "sold-out product is not resurrected from its snippet");
      const ssd = review.candidates.find(product => product.title.includes("X4"));
      if (reviewMode === "failure") return new Response("unavailable", { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ products: reviewMode === "empty" ? [] : [{ id: ssd.id, title: "Acme X4 External SSD 2 TB" }] }) } }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const result = await searchProducts({ query: "external USB4 SSD 2 TB 3800 MB/s", country: "nl-nl", count: 1 });
  assert.equal(modelCalls, 1);
  assert.equal(result.productsReturned, 1);
  const [product] = result.uiResources[0].data.products;
  assert.equal(product.title, "Acme X4 External SSD 2 TB");
  assert.equal(product.url, candidate.url);
  assert.equal(product.imageUrl, candidate.imageUrl);
  assert.equal(product.price.display, "€199.00");
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, candidate.url);
  reviewMode = "empty";
  const empty = await searchProducts({ query: "external USB4 SSD 2 TB 3800 MB/s", country: "nl-nl", count: 1 });
  assert.equal(empty.productsReturned, 0);
  assert.deepEqual(empty.uiResources, []);
  reviewMode = "failure";
  await assert.rejects(searchProducts({ query: "external USB4 SSD 2 TB 3800 MB/s", country: "nl-nl", count: 1 }), { code: "product_search_review_failed" });
});

test("multiple structured products retain their own images, prices and destinations", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "duckduckgo.com") throw new Error("image search unavailable");
    if (url.hostname === "html.duckduckgo.com") return new Response('<a class="result__a" href="https://shop.example.nl/product/main">Acme External SSD</a><a class="result__snippet">€199,00</a>');
    if (url.hostname === "shop.example.nl") {
      const products = [
        { name: "Acme X4 External SSD", url: "https://shop.example.nl/product/main", image: "https://shop.example.nl/main.jpg", offers: { price: 199, priceCurrency: "EUR" } },
        { name: "Acme X8 External SSD", url: "https://shop.example.nl/product/related", image: "https://shop.example.nl/related.jpg", offers: { price: 299, priceCurrency: "EUR" } },
        { name: "Unidentified product", offers: { price: 9, priceCurrency: "EUR" } },
        { name: "Product without its own price", url: "https://shop.example.nl/product/no-price" },
      ].map(product => ({ "@type": "Product", ...product }));
      return new Response(`<meta property="product:price:amount" content="199"><meta property="product:price:currency" content="EUR"><script type="application/ld+json">${JSON.stringify(products)}</script>`, { headers: { "content-type": "text/html" } });
    }
    if (url.pathname.endsWith("/chat/completions")) {
      const { candidates } = JSON.parse(JSON.parse(init.body).messages[1].content);
      assert.equal(candidates.length, 2);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ products: candidates.map(({ id, title }) => ({ id, title })) }) } }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const { uiResources } = await searchProducts({ query: "external SSD", country: "nl-nl" });
  assert.deepEqual(uiResources[0].data.products.map(({ url, imageUrl, price }) => [url, imageUrl, price.amount]), [
    ["https://shop.example.nl/product/main", "https://shop.example.nl/main.jpg", "199"],
    ["https://shop.example.nl/product/related", "https://shop.example.nl/related.jpg", "299"],
  ]);
});
