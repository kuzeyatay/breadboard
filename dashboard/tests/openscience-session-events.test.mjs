import assert from "node:assert/strict";
import test from "node:test";
import { eventSessionId, sessionIsIdle } from "../src/lib/openscience/session-events.ts";

test("shared events identify nested message ownership and exclude global heartbeats", () => {
  const events = [
    {type:"message.updated",properties:{info:{id:"m1",role:"assistant",sessionID:"other"}}},
    {type:"message.part.updated",properties:{part:{id:"p1",sessionID:"own",text:"Actual findings"}}},
    {type:"server.heartbeat",properties:{}},
    {type:"session.error",properties:{sessionID:"other",error:"An unrelated error"}},
  ];
  assert.deepEqual(events.filter(e => eventSessionId(e) === "own"), [events[1]]);
  assert.equal(eventSessionId(events[2]), null);
});

test("both current and legacy idle events end the owning session", () => {
  assert.equal(sessionIsIdle({type:"session.status",properties:{sessionID:"own",status:{type:"idle"}}}), true);
  assert.equal(sessionIsIdle({type:"session.idle",properties:{sessionID:"own"}}), true);
  assert.equal(sessionIsIdle({type:"session.status",properties:{status:{type:"busy"}}}), false);
  assert.equal(sessionIsIdle({type:"message.updated",properties:{info:{status:{type:"idle"}}}}), false);
});
