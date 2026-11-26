const https = require("node:https");
const dns = require("node:dns/promises");
const net = require("node:net");
const ipaddr = require("ipaddr.js");

// Connect to the address that was checked. Redirects would require approval
// for a different endpoint, so report them as HTTP errors.
async function requestJson(http, args, signal) {
  const url = new URL(http.url);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw Error("An HTTPS API endpoint is required.");
  url.pathname = url.pathname.split("/").map(segment => {
    const field = /^%7B([a-zA-Z][a-zA-Z0-9_]*)%7D$/i.exec(segment)?.[1];
    if (!field) return segment;
    const value = args[field];
    if (!["number","string","boolean"].includes(typeof value) || !String(value) || value === "." || value === "..")
      throw Error("Provide a path value for " + field);
    return encodeURIComponent(String(value));
  }).join("/");
  for (const key of http.query) {
    if (Object.hasOwn(args, key)) url.searchParams.set(key, String(args[key]));
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => ipaddr.process(address).range() !== "unicast")) {
    throw Error("Choose a publicly reachable API endpoint.");
  }
  const address = addresses.find(item => item.family === 4) ?? addresses[0];
  const body = http.body && Object.hasOwn(args, http.body) ? JSON.stringify(args[http.body]) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: http.method, agent: false, family: address.family, signal,
      lookup: (_host, options, done) => options.all ? done(null, [address]) : done(null, address.address, address.family),
      headers: { accept: "application/json", "user-agent": "Breadboard-MCP", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    }, res => {
      res.on("error", reject);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy(); reject(Error("API returned HTTP " + res.statusCode)); return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", chunk => {
        size += chunk.length;
        if (size > 512 * 1024) res.destroy(Error("API response exceeds 512 KiB."));
        else chunks.push(chunk);
      });
      res.on("end", () => {
        try { resolve(size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null); }
        catch { reject(Error("API response was not JSON.")); }
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

module.exports = { requestJson };
