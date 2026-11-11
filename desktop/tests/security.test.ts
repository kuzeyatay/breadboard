import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowExternalBrowserNavigationFor,
  allowedOriginsFor,
  hardenExternalBrowserWebContents,
  isExternalBrowserWebContents,
  isNavigationAllowed,
  isRendererPermissionAllowed,
  isSafeBrowserUrl,
  isSafeExternalUrl,
  revokeExternalBrowserNavigationFor,
} from "../src/main/security";

test("navigation is restricted to owned origins and exact product local files", () => {
  const allowed = allowedOriginsFor([
    "http://127.0.0.1:4300",
    "http://127.0.0.1:4303",
    "file:///C:/app/startup/index.html",
    "file:///C:/app/startup/recovery.html",
  ]);
  assert.ok(isNavigationAllowed(allowed, "http://127.0.0.1:4300/dashboard"));
  assert.ok(isNavigationAllowed(allowed, "http://127.0.0.1:4303/my-garden/page"));
  assert.ok(isNavigationAllowed(allowed, "file:///C:/app/startup/index.html?theme=dark"));
  assert.ok(isNavigationAllowed(allowed, "file:///C:/app/startup/recovery.html#status"));
  assert.ok(!isNavigationAllowed(allowed, "file:///C:/app/startup/untrusted.html"));
  assert.ok(!isNavigationAllowed(allowed, "file:///C:/Windows/System32/drivers/etc/hosts"));
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

test("embedded browser pages admit only web URLs and are explicitly registered", () => {
  assert.ok(isSafeBrowserUrl("https://example.com/docs"));
  assert.ok(isSafeBrowserUrl("http://localhost:3000/"));
  assert.ok(!isSafeBrowserUrl("mailto:someone@example.com"));
  assert.ok(!isSafeBrowserUrl("file:///C:/Windows/system32"));
  assert.ok(!isSafeBrowserUrl("javascript:alert(1)"));

  assert.equal(isExternalBrowserWebContents(413), false);
  allowExternalBrowserNavigationFor(413);
  assert.equal(isExternalBrowserWebContents(413), true);
  revokeExternalBrowserNavigationFor(413);
  assert.equal(isExternalBrowserWebContents(413), false);
});

test("an embedded player may go fullscreen only inside an owned page", () => {
  const allowed = allowedOriginsFor(["http://127.0.0.1:4300"]);
  // YouTube's own fullscreen button: the frame is cross-origin, the page is ours.
  assert.ok(
    isRendererPermissionAllowed(
      allowed,
      "fullscreen",
      "https://www.youtube-nocookie.com/embed/abc",
      [],
      false,
      "http://127.0.0.1:4300/chat",
    ),
  );
  // The same frame on a page that is not ours stays denied.
  assert.ok(
    !isRendererPermissionAllowed(
      allowed,
      "fullscreen",
      "https://www.youtube-nocookie.com/embed/abc",
      [],
      false,
      "https://example.com/",
    ),
  );
  // Without a known embedder the frame is judged on its own origin, as before.
  assert.ok(!isRendererPermissionAllowed(allowed, "fullscreen", "https://www.youtube-nocookie.com/embed/abc"));
  assert.ok(isRendererPermissionAllowed(allowed, "fullscreen", "http://127.0.0.1:4300/chat"));
  // The page-level judgement is specific to fullscreen: a cross-origin frame
  // inside our page still gets no microphone.
  assert.ok(
    !isRendererPermissionAllowed(
      allowed,
      "media",
      "https://example.com/",
      ["audio"],
      false,
      "http://127.0.0.1:4300/chat",
    ),
  );
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

test("browser pages hand script-built blob:/data: files to the download manager", () => {
  const listeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
  let openHandler: (details: { url: string }) => { action: string } = () => ({ action: "" });
  const downloads: string[] = [];
  const fake = {
    id: 9_001,
    on: (name: string, listener: never) => listeners.set(name, listener),
    once: () => {},
    setWindowOpenHandler: (handler: typeof openHandler) => { openHandler = handler; },
    downloadURL: (url: string) => downloads.push(url),
    ipc: { on: () => {} },
    session: { setPermissionCheckHandler: () => {}, setPermissionRequestHandler: () => {} },
  };
  hardenExternalBrowserWebContents(fake as never, { onOpenWindow: () => ({ action: "allow" }) });
  let prevented = 0;
  const event = { preventDefault: () => { prevented++; } };
  listeners.get("will-navigate")!(event, "blob:https://tue.osiris-student.nl/1f2e");
  listeners.get("will-navigate")!(event, "javascript:alert(1)");
  listeners.get("will-navigate")!(event, "https://example.com/");
  assert.equal(openHandler({ url: "data:application/pdf;base64,JVBERi0=" }).action, "deny");
  assert.equal(openHandler({ url: "https://example.com/" }).action, "allow");
  assert.equal(prevented, 2);
  assert.deepEqual(downloads, ["blob:https://tue.osiris-student.nl/1f2e", "data:application/pdf;base64,JVBERi0="]);
  revokeExternalBrowserNavigationFor(9_001);
});

test("app links reach the OS only for ordinary app schemes", async () => {
  const { isAppLaunchUrl } = await import("../src/main/browser-dialogs");
  for (const url of ["zoommtg://zoom.us/join?confno=1", "msteams:/l/meetup-join/x", "mailto:a@b.nl", "tel:+31", "spotify:track:1"]) {
    assert.ok(isAppLaunchUrl(url), url);
  }
  for (const url of ["https://x.nl", "javascript:alert(1)", "file:///C:/x", "ms-msdt:/id PCWDiagnostic", "search-ms:query=x", "SHELL:startup", "data:text/html,x", "not a url"]) {
    assert.ok(!isAppLaunchUrl(url), url);
  }
});
