import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { participantRuntime } from "../src/lib/max-research/participants.ts";

test("ARIS performs a fresh review and hands back its actual answer, not its prompt", async () => {
  let request;
  const critique = "The source describes a controlled comparison, but the supplied claim extends beyond its population. Narrow the claim to that population, state the untested assumption, and retain the requested implementation details as practical judgment. Review independence: same-family/provisional.";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    request = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: critique } }] }));
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  try {
    const runtime = participantRuntime("aris");
    assert.equal((await runtime.available()).available, true);
    const result = await runtime.run({question:"Compare two material designs",guidance:"",brief:"Compare two material designs"}, {
      userId:1,model:"test-model",reasoningEffort:"high",baseUrl:`http://127.0.0.1:${server.address().port}`,
      priorEvidence:"A controlled material comparison: https://example.test/materials",
    });
    assert.equal(result.status,"completed");
    assert.equal(result.output,critique);
    const prompt = request.messages[0].content;
    assert.match(prompt,/Compare two material designs/);
    assert.match(prompt,/https:\/\/example.test\/materials/);
    assert.match(prompt,/ARIS Agent Guide/);
    assert.match(prompt,/no tools|no new searches|do not claim new searches/i);
    assert.match(prompt,/same-family\/provisional/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
