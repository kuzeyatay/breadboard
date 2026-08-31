// Serves the acceptance-test page on loopback for the duration of a test run.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const file = path.join(import.meta.dirname, "customer-lookup.html");
const server = http.createServer((request, response) => {
  if ((request.url ?? "/").startsWith("/reset")) {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(fs.readFileSync(file));
});
const port = Number(process.argv[2] ?? 8123);
server.listen(port, "127.0.0.1", () => console.log(`fixture on http://127.0.0.1:${port}/`));
