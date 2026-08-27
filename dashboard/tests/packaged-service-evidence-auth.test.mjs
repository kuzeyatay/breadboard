import assert from "node:assert/strict";
import test from "node:test";

import { authorizedPackagedServiceEvidenceRequest } from
  "../src/lib/runtime-v2/packaged-service-evidence-auth.ts";

const TOKEN = "a".repeat(64);
const PORT = "42731";

function request({
  authorization = `Bearer ${TOKEN}`,
  host = `127.0.0.1:${PORT}`,
  url = "http://n/api/internal/runtime-service-evidence",
} = {}) {
  return new Request(url, { headers: { authorization, host } });
}

test("authorizes the canonical loopback Host used by a standalone Next request", () => {
  assert.equal(authorizedPackagedServiceEvidenceRequest(request(), TOKEN, PORT), true);
});

test("rejects a wrong token without weakening the timing-safe bearer boundary", () => {
  assert.equal(
    authorizedPackagedServiceEvidenceRequest(
      request({ authorization: `Bearer ${"b".repeat(64)}` }),
      TOKEN,
      PORT,
    ),
    false,
  );
  for (const authorization of ["", "Basic credentials", "Bearer short", "Bearer z".repeat(32)]) {
    assert.equal(
      authorizedPackagedServiceEvidenceRequest(request({ authorization }), TOKEN, PORT),
      false,
    );
  }
});

test("rejects noncanonical hosts, ports, protocols, and listener configuration", () => {
  for (const candidate of [
    request({ host: `localhost:${PORT}` }),
    request({ host: `[::1]:${PORT}` }),
    request({ host: "" }),
    request({ host: `127.0.0.1.evil:${PORT}` }),
    request({ host: "127.0.0.1:42732" }),
    request({ url: "https://n/api/internal/runtime-service-evidence" }),
  ]) {
    assert.equal(authorizedPackagedServiceEvidenceRequest(candidate, TOKEN, PORT), false);
  }
  for (const port of [undefined, "0", "042731", "65536", "not-a-port"]) {
    assert.equal(authorizedPackagedServiceEvidenceRequest(request(), TOKEN, port), false);
  }
  assert.equal(
    authorizedPackagedServiceEvidenceRequest(
      { url: "not an absolute URL", headers: request().headers },
      TOKEN,
      PORT,
    ),
    false,
  );
});
