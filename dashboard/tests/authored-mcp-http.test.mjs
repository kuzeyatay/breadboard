import assert from "node:assert/strict";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import client from "../scripts/authored-mcp-http.cjs";

test("a JSON API tool forwards only its declared query and body and reports HTTP failures", async t => {
  t.mock.method(dns,"lookup",async () => [{address:"93.184.216.34",family:4}]);
  let statusCode = 201;
  let calls = 0;
  t.mock.method(https,"request",(url, options, receive) => {
    assert.equal(url.href,"https://inventory.example/items/sample%20box?warehouse=A+%26+B");
    assert.equal(options.method,"POST");
    assert.equal(options.headers["content-type"],"application/json");
    const request = new EventEmitter();
    request.end = body => {
      calls++;
      assert.deepEqual(JSON.parse(body),{sku:"sample",quantity:3});
      const response = Readable.from([Buffer.from('{"receipt":42}')]);
      response.statusCode = statusCode;
      receive(response);
    };
    return request;
  });
  const endpoint = {url:"https://inventory.example/items/{name}",method:"POST",query:["warehouse"],body:"item"};
  const args = {name:"sample box",warehouse:"A & B",item:{sku:"sample",quantity:3},unused:"local only"};
  assert.deepEqual(await client.requestJson(endpoint,args),{receipt:42});
  statusCode = 429;
  await assert.rejects(client.requestJson(endpoint,args),/HTTP 429/);
  assert.equal(calls,2);
});
