// Reading the operating system's answer about where this computer is. The
// script on the other end is PowerShell, so the parser's job is to turn every
// shape it can emit — including a broken one — into a state the card can show.

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSystemLocationOutput,
  unsupportedSystemLocation,
} from "../src/lib/system-location.ts";

test("a position comes back as an available fix", () => {
  const result = parseSystemLocationOutput(
    '{"state":"available","latitude":40.94,"longitude":29.11,"accuracyMeters":102}',
  );
  assert.deepEqual(result, {
    state: "available",
    latitude: 40.94,
    longitude: 29.11,
    accuracyMeters: 102,
  });
});

test("an unknown radius becomes a frank coarse one rather than zero", () => {
  // GeoCoordinate reports "I don't know" as Double.MaxValue; treating that as a
  // pinpoint accuracy would be the one wrong direction to round it in.
  const huge = parseSystemLocationOutput(
    '{"state":"available","latitude":1,"longitude":2,"accuracyMeters":1.7976931348623157E+308}',
  );
  assert.equal(huge.state, "available");
  assert.equal(huge.accuracyMeters, 50_000);
  const missing = parseSystemLocationOutput('{"state":"available","latitude":1,"longitude":2}');
  assert.equal(missing.accuracyMeters, 50_000);
});

test("coordinates outside the world are not a fix", () => {
  const result = parseSystemLocationOutput(
    '{"state":"available","latitude":91,"longitude":29}',
  );
  assert.equal(result.state, "unavailable");
});

test("a refusal keeps its own wording, an empty answer gets ours", () => {
  const blocked = parseSystemLocationOutput(
    '{"state":"blocked","reason":"The Windows location service is turned off."}',
  );
  assert.deepEqual(blocked, {
    state: "blocked",
    reason: "The Windows location service is turned off.",
  });
  const empty = parseSystemLocationOutput('{"state":"unavailable"}');
  assert.equal(empty.state, "unavailable");
  assert.match(empty.reason, /did not return a position/);
});

test("noise around the JSON, and no JSON at all, stay recoverable", () => {
  const noisy = parseSystemLocationOutput(
    'WARNING: something\n{"state":"available","latitude":10,"longitude":20,"accuracyMeters":30}\n',
  );
  assert.equal(noisy.state, "available");
  for (const output of ["", "Add-Type : Cannot load assembly", "{ not json"]) {
    assert.equal(parseSystemLocationOutput(output).state, "unavailable");
  }
});

test("a platform with no location service Breadboard can read says so", () => {
  const result = unsupportedSystemLocation();
  assert.equal(result.state, "unsupported");
});
