import http from "node:http";

/** A deterministic real PCM WAV. Test-only sine tone, never a production fallback. */
export function testWav(seconds = 0.2, frequency = 220) {
  const rate = 8000, frames = Math.round(seconds * rate), result = Buffer.alloc(44 + frames * 2);
  result.write("RIFF"); result.writeUInt32LE(result.length - 8, 4); result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(rate, 24); result.writeUInt32LE(rate * 2, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34);
  result.write("data", 36); result.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) result.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * frequency * i / rate)), 44 + 2 * i);
  return result;
}
export async function fakeAceStep(options = {}) {
  const requests = [], receipts = new Map(); let submissions = 0;
  const envelope = data => JSON.stringify({ code: 200, error: null, data });
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ url: req.url, method: req.method, headers: req.headers, body });
    if (options.onRequest) await options.onRequest(req.url);
    if (req.headers.authorization !== "Bearer fixture-key") { res.writeHead(401); res.end(); return; }
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") res.end(envelope({ models: [{ name: "acestep-v15-turbo", is_default: true }], default_model: "acestep-v15-turbo" }));
    else if (req.url === "/release_task") {
      const id = `task-${++submissions}`; receipts.set(id, 0);
      if (options.loseReceipt) { req.socket.destroy(); return; }
      res.end(envelope({ task_id: id, status: "queued" }));
    } else if (req.url === "/query_result") {
      const id = JSON.parse(body).task_id_list[0];
      const status = options.failed ? 2 : options.running ? 0 : 1;
      res.end(envelope([{ task_id: id, status, result: status === 1 ? JSON.stringify([{ file: "/v1/audio?path=fixture.wav", status: 1, seed_value: "42" }]) : "[]" }]));
    } else if (req.url?.startsWith("/v1/audio")) {
      if (options.redirect) { res.writeHead(302, { location: options.redirect }); res.end(); return; }
      res.setHeader("content-type", options.corrupt ? "text/html" : "audio/wav");
      res.end(options.corrupt ? Buffer.from("<html>not audio</html>") : testWav(options.duration ?? 0.2));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { requests, get submissions() { return submissions; }, connection: { baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "fixture-key", model: "acestep-v15-turbo" },
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
