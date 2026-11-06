import { test } from "node:test";
import assert from "node:assert/strict";
import { authReturnPath, isAuthenticationUrl } from "../src/shared/auth-navigation";
import { restoredTabUrl, saveTab } from "../src/main/tab-session";

test("login returns to a local screen and rejects external, credential and auth-loop destinations", () => {
  const origin = "http://127.0.0.1:3000";
  assert.equal(authReturnPath("/gardens/one?chat=4#reply", origin), "/gardens/one?chat=4#reply");
  for (const url of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/auth/login", "/api/auth/signout", "http://user@127.0.0.1:3000/profile"]) {
    assert.equal(authReturnPath(url, origin), "/dashboard");
  }
  assert.equal(isAuthenticationUrl("https://example.com/auth/login", origin), false);
  assert.equal(saveTab({ url: origin + "/auth/login", title: "Login", anchored: false }, origin), null);
  assert.equal(restoredTabUrl({ kind: "dashboard", url: "/auth/login?callbackUrl=%2Fprofile", title: "Login", anchored: false }, origin), origin + "/profile");
});
