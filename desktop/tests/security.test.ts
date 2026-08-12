import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedOriginsFor,
  isNavigationAllowed,
  isRendererPermissionAllowed,
  isSafeExternalUrl,
} from "../src/main/security";

test("navigation is restricted to owned local origins plus file:", () => {
  const allowed = allowedOriginsFor(["http://127.0.0.1:4300", "http://127.0.0.1:4303"]);
  assert.ok(isNavigationAllowed(allowed, "http://127.0.0.1:4300/dashboard"));
  assert.ok(isNavigationAllowed(allowed, "http://127.0.0.1:4303/my-garden/page"));
  assert.ok(isNavigationAllowed(allowed, "file:///C:/app/startup/index.html"));
  assert.ok(!isNavigationAllowed(allowed, "http://127.0.0.1:9999/"));
  assert.ok(!isNavigationAllowed(allowed, "http://localhost:4300/")); // origin mismatch by hostname
  assert.ok(!isNavigationAllowed(allowed, "https://example.com/"));
  assert.ok(!isNavigationAllowed(allowed, "javascript:alert(1)"));
  assert.ok(!isNavigationAllowed(allowed, "not a url"));
});

test("external link safety only admits web/mailto schemes", () => {
  assert.ok(isSafeExternalUrl("https://example.com/docs"));
  assert.ok(isSafeExternalUrl("mailto:someone@example.com"));
  assert.ok(!isSafeExternalUrl("javascript:alert(1)"));
  assert.ok(!isSafeExternalUrl("file:///C:/Windows/system32"));
  assert.ok(!isSafeExternalUrl("vbscript:x"));
});

test("only the owned dashboard origin may request an audio-only microphone grant", () => {
  const allowed = allowedOriginsFor(["http://127.0.0.1:4300"]);
  assert.ok(
    isRendererPermissionAllowed(
      allowed,
      "media",
      "http://127.0.0.1:4300/dashboard",
      ["audio"],
    ),
  );
  assert.ok(
    !isRendererPermissionAllowed(
      allowed,
      "media",
      "http://127.0.0.1:4300/dashboard",
      ["audio", "video"],
    ),
  );
  assert.ok(
    !isRendererPermissionAllowed(
      allowed,
      "media",
      "https://example.com/",
      ["audio"],
    ),
  );
  assert.ok(
    !isRendererPermissionAllowed(
      allowed,
      "geolocation",
      "http://127.0.0.1:4300/dashboard",
    ),
  );
  assert.ok(
    isRendererPermissionAllowed(
      allowed,
      "geolocation",
      "http://127.0.0.1:4300/profile",
      [],
      true,
    ),
  );
});
