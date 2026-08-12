import assert from "node:assert/strict";
import test from "node:test";
import { proxyCatalogRequest } from "../lib/catalog-proxy.ts";

const TOKEN = "request-scoped-secret-token";

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://proxy.example${path}`, init);
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

test("valid list requests use the fixed skills.sh upstream and bounded query", async () => {
  let upstream = "";
  const response = await proxyCatalogRequest(
    request("/api/v1/skills?view=trending&page=2&per_page=500"),
    ["skills"],
    {
      getOidcToken: async () => TOKEN,
      fetchImpl: async (url) => {
        upstream = String(url);
        return jsonResponse({ data: [], pagination: { page: 2 } }, { headers: { "Cache-Control": "public, max-age=120" } });
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(upstream, "https://skills.sh/api/v1/skills?view=trending&page=2&per_page=500");
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=120/);
});

test("valid search, detail, and audit routes are forwarded", async () => {
  const urls: string[] = [];
  const fetchImpl = async (url: URL | RequestInfo) => {
    urls.push(String(url));
    return jsonResponse({ ok: true });
  };
  const deps = { getOidcToken: async () => TOKEN, fetchImpl };
  assert.equal((await proxyCatalogRequest(request("/api/v1/skills/search?q=paper&limit=20&owner=openai"), ["skills", "search"], deps)).status, 200);
  assert.equal((await proxyCatalogRequest(request("/api/v1/skills/openai/skills/paper"), ["skills", "openai", "skills", "paper"], deps)).status, 200);
  assert.equal((await proxyCatalogRequest(request("/api/v1/skills/audit/openai/skills/paper"), ["skills", "audit", "openai", "skills", "paper"], deps)).status, 200);
  assert.deepEqual(urls, [
    "https://skills.sh/api/v1/skills/search?q=paper&limit=20&owner=openai",
    "https://skills.sh/api/v1/skills/openai/skills/paper",
    "https://skills.sh/api/v1/skills/audit/openai/skills/paper",
  ]);
});

test("OIDC is added only upstream and incoming authorization is discarded", async () => {
  let headers = new Headers();
  const response = await proxyCatalogRequest(
    request("/api/v1/skills", { headers: { Authorization: "Bearer incoming-user-secret", "X-Arbitrary": "discard-me" } }),
    ["skills"],
    {
      getOidcToken: async () => TOKEN,
      fetchImpl: async (_url, init) => {
        headers = new Headers(init?.headers);
        return jsonResponse({ data: [] });
      },
    },
  );
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(headers.get("x-arbitrary"), null);
  assert.equal(headers.get("accept"), "application/json");
  assert.doesNotMatch(await response.text(), new RegExp(TOKEN));
});

test("unsupported methods and routes are rejected without obtaining OIDC", async () => {
  let tokenCalls = 0;
  const dependencies = {
    getOidcToken: async () => { tokenCalls += 1; return TOKEN; },
    fetchImpl: async () => assert.fail("upstream fetch must not run"),
  };
  const method = await proxyCatalogRequest(request("/api/v1/skills", { method: "POST" }), ["skills"], dependencies);
  const route = await proxyCatalogRequest(request("/api/v1/admin"), ["admin"], dependencies);
  const shortDetail = await proxyCatalogRequest(request("/api/v1/skills/openai/paper"), ["skills", "openai", "paper"], dependencies);
  const longDetail = await proxyCatalogRequest(request("/api/v1/skills/openai/skills/paper/extra"), ["skills", "openai", "skills", "paper", "extra"], dependencies);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD");
  assert.equal(route.status, 404);
  assert.equal(shortDetail.status, 404);
  assert.equal(longDetail.status, 404);
  assert.equal(tokenCalls, 0);
});

test("unknown, duplicate, missing, and out-of-range query parameters are rejected", async () => {
  const dependencies = { getOidcToken: async () => TOKEN, fetchImpl: async () => assert.fail("no fetch") };
  const cases: Array<[string, string[]]> = [
    ["/api/v1/skills?other=1", ["skills"]],
    ["/api/v1/skills?page=1&page=2", ["skills"]],
    ["/api/v1/skills?per_page=501", ["skills"]],
    ["/api/v1/skills/search?q=x", ["skills", "search"]],
    ["/api/v1/skills/search?limit=0&q=paper", ["skills", "search"]],
    ["/api/v1/skills/search?q=paper&owner=bad%2Fowner", ["skills", "search"]],
    ["/api/v1/skills/openai/skills/paper?extra=1", ["skills", "openai", "skills", "paper"]],
  ];
  for (const [url, segments] of cases) {
    const response = await proxyCatalogRequest(request(url), segments, dependencies);
    assert.equal(response.status, 400, url);
  }
});

test("path traversal, encoded traversal, backslashes, NUL, and excessive paths are rejected", async () => {
  const dependencies = { getOidcToken: async () => TOKEN, fetchImpl: async () => assert.fail("no fetch") };
  const cases: Array<[string, string[]]> = [
    ["/api/v1/skills/../secret", ["skills", "..", "secret"]],
    ["/api/v1/skills/%252e%252e/secret", ["skills", "%2e%2e", "secret"]],
    ["/api/v1/skills/openai%5Csecret/paper", ["skills", "openai\\secret", "paper"]],
    ["/api/v1/skills/openai/nu%00l/paper", ["skills", "nu\0l", "paper"]],
    [`/api/v1/skills/${"a".repeat(600)}`, ["skills", "a".repeat(600)]],
  ];
  for (const [url, segments] of cases) {
    const response = await proxyCatalogRequest(request(url), segments, dependencies);
    assert.equal(response.status, 400, url);
  }
});

for (const status of [401, 404, 429, 503]) {
  test(`upstream ${status} is preserved with a sanitized JSON error`, async () => {
    const response = await proxyCatalogRequest(request("/api/v1/skills"), ["skills"], {
      getOidcToken: async () => TOKEN,
      fetchImpl: async () => new Response(`<html>${TOKEN}</html>`, {
        status,
        headers: { "Content-Type": "text/html", "Retry-After": "7" },
      }),
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("retry-after"), "7");
    const text = await response.text();
    assert.doesNotMatch(text, /<html>|request-scoped-secret-token/);
  });
}

test("upstream timeouts return a bounded sanitized 504", async () => {
  const response = await proxyCatalogRequest(request("/api/v1/skills"), ["skills"], {
    getOidcToken: async () => TOKEN,
    timeoutMs: 1_000,
    fetchImpl: async (_url, init) => await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  });
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), {
    error: "upstream_timeout",
    message: "The catalog upstream request timed out.",
  });
});

test("only safe response headers are forwarded", async () => {
  const response = await proxyCatalogRequest(request("/api/v1/skills"), ["skills"], {
    getOidcToken: async () => TOKEN,
    fetchImpl: async () => jsonResponse({ data: [] }, {
      headers: {
        ETag: '"catalog"',
        "Last-Modified": "Mon, 01 Jan 2024 00:00:00 GMT",
        "X-RateLimit-Limit": "600",
        "X-RateLimit-Remaining": "599",
        "X-RateLimit-Reset": "1234",
        "Set-Cookie": "secret=cookie",
        "Access-Control-Allow-Origin": "*",
        "X-Arbitrary": "no",
      },
    }),
  });
  assert.equal(response.headers.get("etag"), '"catalog"');
  assert.equal(response.headers.get("x-ratelimit-limit"), "600");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("x-arbitrary"), null);
});

test("token values are redacted from successful responses and never logged", async () => {
  const calls: unknown[][] = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...values) => { calls.push(values); };
  console.error = (...values) => { calls.push(values); };
  console.warn = (...values) => { calls.push(values); };
  try {
    const response = await proxyCatalogRequest(request("/api/v1/skills"), ["skills"], {
      getOidcToken: async () => TOKEN,
      fetchImpl: async () => jsonResponse({ reflected: TOKEN, nested: [TOKEN], [TOKEN]: "key" }, {
        headers: { ETag: `"${TOKEN}"` },
      }),
    });
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), new RegExp(TOKEN));
    assert.doesNotMatch(response.headers.get("etag") ?? "", new RegExp(TOKEN));
    assert.doesNotMatch(JSON.stringify(calls), new RegExp(TOKEN));
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
  }
});

test("HEAD returns no body and keeps safe cache metadata", async () => {
  const response = await proxyCatalogRequest(request("/api/v1/skills", { method: "HEAD" }), ["skills"], {
    getOidcToken: async () => TOKEN,
    fetchImpl: async (_url, init) => {
      assert.equal(init?.method, "HEAD");
      return new Response(null, { status: 200, headers: { ETag: '"head"' } });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("etag"), '"head"');
});
