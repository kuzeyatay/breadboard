import assert from "node:assert/strict";
import test from "node:test";
import { authReturnPath as dashboardReturnPath } from "../src/lib/auth-navigation.ts";
import { authReturnPath as desktopReturnPath } from "../../desktop/src/shared/auth-navigation.ts";

for (const [name, authReturnPath] of [
  ["dashboard", dashboardReturnPath],
  ["desktop", desktopReturnPath],
]) {
  test(`${name} preserves local auth callbacks and rejects unsafe or looping destinations`, () => {
    const origin = "http://127.0.0.1:3000";
    for (const value of ["/gardens/one?chat=4#reply", `${origin}/gardens/one?chat=4#reply`]) {
      assert.equal(authReturnPath(value, origin), "/gardens/one?chat=4#reply");
    }
    for (const value of [
      undefined, null, "", "https://evil.example", "//evil.example", "/\\evil.example",
      "javascript:alert(1)", "/auth/login", "/api/auth/signout",
      "http://user:password@127.0.0.1:3000/profile", "http://[invalid",
    ]) {
      assert.equal(authReturnPath(value, origin), "/dashboard", String(value));
      assert.equal(authReturnPath(value, origin, "/new-tab"), "/new-tab", String(value));
    }
    assert.equal(authReturnPath("/profile", "invalid origin"), "/dashboard");
  });
}
