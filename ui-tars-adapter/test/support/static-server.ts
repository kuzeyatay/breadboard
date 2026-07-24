// A tiny deterministic static server for E2E tests. Serves the fixture site and
// counts POST /submit so tests can assert "exactly one submission occurred".

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "site");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export interface TestSite {
  url: string;
  port: number;
  submitCount: () => number;
  stop: () => Promise<void>;
}

export async function startTestSite(): Promise<TestSite> {
  let submissions = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/submit") {
      submissions += 1;
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<p id='result'>submitted</p>");
      return;
    }
    if (req.method === "GET" && url.pathname === "/count") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ count: submissions }));
      return;
    }
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const file = path.join(SITE_DIR, safe);
    if (!file.startsWith(SITE_DIR)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(buf);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    submitCount: () => submissions,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
