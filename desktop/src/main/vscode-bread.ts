import * as fs from "node:fs";
import * as path from "node:path";

// Bread inside the Code tab's VS Code: a tiny extension, written into the
// profile's extensions folder on every launch, that shows Breadboard's
// /code/bread page in VS Code's secondary sidebar (where Copilot's Chat sits).
//
// The page needs the user's Breadboard session, which lives in Breadboard's
// Electron cookie jar, not VS Code's. Desktop writes the dashboard URL and the
// Cookie header to a user-only file whose path reaches the extension host in
// BREADBOARD_BREAD_CONFIG. The extension runs a loopback proxy that adds that
// Cookie to each request, and the view iframes the proxy. The extension stays
// inert in a standalone VS Code (no env var), so sharing the user's real
// extensions folder is harmless.

export const BREAD_EXTENSION_ID = "breadboard.bread";
export const BREAD_EXTENSION_VERSION = "0.1.0";

const manifest = {
  name: "bread",
  displayName: "Bread",
  description: "Breadboard's agent, Bread, inside the Code tab.",
  publisher: "breadboard",
  version: BREAD_EXTENSION_VERSION,
  engines: { vscode: "^1.100.0" },
  main: "./extension.js",
  activationEvents: ["onStartupFinished"],
  contributes: {
    viewsContainers: { secondarySidebar: [{ id: "bread", title: "Bread", icon: "$(comment-discussion)" }] },
    views: { bread: [{ type: "webview", id: "breadboard.bread", name: "Bread", when: "breadboard.hosted" }] },
  },
};

const extensionSource = String.raw`"use strict";
const vscode = require("vscode");
const fs = require("fs");
const http = require("http");
const https = require("https");

function readConfig() {
  try { return JSON.parse(fs.readFileSync(process.env.BREADBOARD_BREAD_CONFIG, "utf8")); } catch { return null; }
}

exports.activate = async function activate(context) {
  const initial = process.env.BREADBOARD_BREAD_CONFIG && readConfig();
  if (!initial) return;
  const target = new URL(initial.dashboard);
  const client = target.protocol === "https:" ? https : http;
  let proxyHost = "";
  // ponytail: loopback proxy guarded by Host and Origin checks only; any local
  // process could use it, but such a process could read the session anyway.
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (req.headers.host !== proxyHost || (origin && origin !== "http://" + proxyHost)) {
      res.writeHead(403); res.end(); return;
    }
    const headers = { ...req.headers, host: target.host, cookie: (readConfig() || initial).cookie || "" };
    if (origin) headers.origin = target.origin;
    if (req.headers.referer) headers.referer = target.origin + new URL(req.headers.referer).pathname;
    const upstream = client.request({ protocol: target.protocol, hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, response => {
      const out = { ...response.headers };
      delete out["x-frame-options"]; delete out["set-cookie"];
      if (out["content-security-policy"]) out["content-security-policy"] = String(out["content-security-policy"]).replace(/frame-ancestors[^;]*;?/gi, "");
      if (out.location) out.location = String(out.location).replace(target.origin, "http://" + proxyHost);
      res.writeHead(response.statusCode || 502, out);
      response.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("Breadboard is not reachable. Reopen the Code tab from Breadboard."); });
    req.pipe(upstream);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  proxyHost = "127.0.0.1:" + server.address().port;
  context.subscriptions.push({ dispose: () => server.close() });
  const page = "http://" + proxyHost + "/code/bread" + (initial.garden ? "?garden=" + encodeURIComponent(initial.garden) : "");
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("breadboard.bread", {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: true };
      view.webview.html = '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; frame-src http://' + proxyHost + '; style-src \'unsafe-inline\';">'
        + '<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;overflow:hidden}</style></head>'
        + '<body><iframe src="' + page + '" allow="clipboard-read; clipboard-write; microphone"></iframe></body></html>';
    },
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  await vscode.commands.executeCommand("setContext", "breadboard.hosted", true);
  await vscode.commands.executeCommand("workbench.view.extension.bread");
};
exports.deactivate = function deactivate() {};
`;

interface ExtensionEntry { identifier: { id: string }; [key: string]: unknown }

/** Write the Bread extension into `extensionsDir` and register it in extensions.json. */
export function installBreadExtension(extensionsDir: string): void {
  const folder = `${BREAD_EXTENSION_ID}-${BREAD_EXTENSION_VERSION}`;
  const target = path.join(extensionsDir, folder);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(target, "extension.js"), extensionSource);
  const registry = path.join(extensionsDir, "extensions.json");
  let entries: ExtensionEntry[] = [];
  try { entries = JSON.parse(fs.readFileSync(registry, "utf8")); } catch { /* A fresh folder has no registry yet. */ }
  if (!Array.isArray(entries)) entries = [];
  const others = entries.filter(entry => entry?.identifier?.id?.toLowerCase() !== BREAD_EXTENSION_ID);
  if (others.length + 1 === entries.length && entries.some(entry => entry.relativeLocation === folder)) return;
  const location = target.replace(/\\/g, "/");
  others.push({
    identifier: { id: BREAD_EXTENSION_ID }, version: BREAD_EXTENSION_VERSION,
    location: { $mid: 1, path: location.startsWith("/") ? location : `/${location}`, scheme: "file" },
    relativeLocation: folder,
    metadata: { installedTimestamp: Date.now(), pinned: true, source: "vsix", targetPlatform: "undefined", updated: false, isPreReleaseVersion: false, hasPreReleaseVersion: false },
  });
  fs.writeFileSync(registry, JSON.stringify(others));
}

/** Hand the extension the dashboard URL and session cookie; returns the file's path. */
export function writeBreadConfig(stateRoot: string, dashboard: string, cookie: string, garden?: string): string {
  const file = path.join(stateRoot, "bread.json");
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ dashboard, cookie, garden }), { mode: 0o600 });
  return file;
}
