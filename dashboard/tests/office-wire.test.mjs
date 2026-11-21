// IPC values between the Office editor iframe and its host survive JSON:
// binary data keeps its type, and Map/Set/Date/undefined come back as themselves.
import assert from "node:assert/strict";
import test from "node:test";
import { decodeWire, encodeWire } from "../src/lib/office/wire.ts";

const roundTrip = value => decodeWire(JSON.parse(JSON.stringify(encodeWire(value))));

test("binary values keep their type and bytes", () => {
  const bytes = new Uint8Array([0, 1, 254, 255]);
  const back = roundTrip({ data: bytes, buffer: bytes.buffer.slice(1, 3), floats: new Float32Array([1.5, -2]) });
  assert.ok(back.data instanceof Uint8Array);
  assert.deepEqual([...back.data], [0, 1, 254, 255]);
  assert.ok(back.buffer instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(back.buffer)], [1, 254]);
  assert.ok(back.floats instanceof Float32Array);
  assert.deepEqual([...back.floats], [1.5, -2]);
});

test("structured-clone types and undefined survive", () => {
  const back = roundTrip({ map: new Map([["a", 1]]), set: new Set([2]), when: new Date(0), gone: undefined, list: [undefined, NaN] });
  assert.equal(back.map.get("a"), 1);
  assert.ok(back.set.has(2));
  assert.equal(back.when.getTime(), 0);
  assert.ok("gone" in back && back.gone === undefined);
  assert.equal(back.list[0], undefined);
  assert.ok(Number.isNaN(back.list[1]));
});
