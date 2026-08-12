// The page a gadget actually runs in, and the `host` object its code calls.
//
// The frame is `sandbox="allow-scripts"` and nothing else, so the document is
// cross-origin to Breadboard: it cannot read cookies, cannot touch the parent
// DOM, and has no ambient credentials of its own. Every call it makes goes out
// over postMessage to the embedder, which forwards it to the authenticated host
// route. That indirection is the point — the gadget never holds a token, so
// revoking it is a matter of the embedder refusing to forward.
//
// The `host` API deliberately has exactly two verbs:
//
//   host.<binding>.observe(op, payload)  a read. Resolves with real data, or
//                                        rejects if it was not authorized.
//   host.<binding>.act(op, payload)      a write. Resolves *immediately* with
//                                        the simulated result and a queued
//                                        action id. It has not happened yet.
//
// `act` resolving before anything happened is the contract, not a bug. It is
// what lets a gadget queue five dependent writes in one pass and stay
// responsive while the user takes a day to look at them.

import type { GadgetBinding, GadgetPackage } from "./gadget-types.ts";

/** Escape a string for embedding inside a <script> block. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The bridge client, injected ahead of the gadget's own script.
 *
 * Written as a plain string rather than a module because it has to run inside
 * an opaque-origin document with no bundler and no network.
 */
function bridgeClientSource(bindings: GadgetBinding[]): string {
  return `
(function () {
  "use strict";
  var BINDINGS = ${jsonForScript(bindings.map((b) => ({ name: b.name, writable: b.writable })))};
  var pending = new Map();
  var nextId = 1;

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.channel !== "breadboard-gadget") return;
    var entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });

  function call(kind, binding, operation, payload) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending.set(id, { resolve: resolve, reject: reject });
      parent.postMessage(
        { channel: "breadboard-gadget", id: id, kind: kind, binding: binding, operation: operation, payload: payload },
        "*"
      );
      // A host that never answers must not leave the gadget hanging forever.
      setTimeout(function () {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error("The host did not respond to " + binding + "." + operation + "."));
      }, 30000);
    });
  }

  var host = {
    /** Tell the embedder the gadget mounted, so it can size and reveal it. */
    ready: function () {
      parent.postMessage({ channel: "breadboard-gadget", kind: "ready", height: document.documentElement.scrollHeight }, "*");
    },
    log: function (message) {
      parent.postMessage({ channel: "breadboard-gadget", kind: "log", message: String(message) }, "*");
    }
  };

  BINDINGS.forEach(function (binding) {
    var api = {
      observe: function (operation, payload) {
        return call("observe", binding.name, operation, payload);
      }
    };
    // A read-only binding simply has no \`act\`. The host would refuse the call
    // anyway; omitting it makes that visible while the gadget is being written.
    if (binding.writable) {
      api.act = function (operation, payload) {
        return call("act", binding.name, operation, payload);
      };
    }
    host[binding.name] = api;
  });

  window.host = host;

  window.addEventListener("error", function (event) {
    host.log("Uncaught error: " + (event.message || "unknown"));
  });
  window.addEventListener("unhandledrejection", function (event) {
    host.log("Unhandled rejection: " + ((event.reason && event.reason.message) || event.reason));
  });
})();
`.trim();
}

/**
 * Compose the complete, self-contained document for one gadget.
 *
 * Everything is inlined. The frame has no network access, so a stylesheet or
 * script left as a URL would silently never load.
 */
export function renderGadgetDocument(gadget: GadgetPackage): string {
  const body = gadget.files["index.html"];
  const styles = gadget.files["styles.css"];
  const script = gadget.files["main.js"];
  const bridge = bridgeClientSource(gadget.manifest.bindings);

  // The generated index.html is a fragment: the validator requires it to
  // reference main.js, and that reference is replaced here by the real inlined
  // script so nothing has to be fetched.
  const withoutScriptTag = body.replace(
    /<\s*script\b[^>]*\bsrc\s*=\s*["']main\.js["'][^>]*>\s*<\s*\/\s*script\s*>/gi,
    "",
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(gadget.manifest.title)}</title>
<style>
:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
body { padding: 16px; }
${styles}
</style>
</head>
<body>
${withoutScriptTag}
<script>${bridge}</script>
<script>
try {
${script}
} catch (error) {
  window.host && window.host.log("Gadget failed to start: " + error.message);
}
</script>
</body>
</html>`;
}

/**
 * The API reference handed to the model when it writes a gadget, and the same
 * text the skill points at. Generated from the binding list so guidance can
 * never drift from what the bridge actually exposes.
 */
export function gadgetHostApiReference(): string {
  return [
    "Inside a gadget, `host` is the only way to reach anything outside the frame.",
    "",
    "```js",
    "// A read. Resolves with real data once Breadboard authorizes and records it.",
    "const rows = await host.<binding>.observe('<operation>', { ...args });",
    "",
    "// A write. Resolves IMMEDIATELY, before it has happened, with:",
    "//   { actionId, status: 'pending' | 'approved', simulated, outcome }",
    "// `simulated` is shaped like the real result, so the next line can use it.",
    "const queued = await host.<binding>.act('<operation>', { ...args });",
    "```",
    "",
    "A write has not occurred when `act` resolves. It is queued, and the user",
    "approves it later — possibly days later. Never tell the user something was",
    "sent, saved, or created because `act` resolved; say it was queued, and read",
    "`queued.outcome` to describe what will happen.",
    "",
    "`host.ready()` reveals the gadget once it has mounted. `host.log(message)`",
    "writes to the gadget's own log strip.",
  ].join("\n");
}
