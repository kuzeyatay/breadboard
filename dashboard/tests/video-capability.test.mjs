import test from "node:test";
import assert from "node:assert/strict";
import { videoCapabilityRoute } from "../src/lib/hermes/video-capability.ts";

test("one Video command routes each brief to the engine that fits", () => {
  const route = (brief, options) => videoCapabilityRoute(`/agents:video ${brief}`, options);
  assert.equal(route("a launch video for our app"), "/video a launch video for our app");
  assert.equal(route("a 3D cinematic intro with particles"), "/film a 3D cinematic intro with particles");
  assert.equal(route("make shorts from this podcast https://youtu.be/x"), "/agents:shorts make shorts from this podcast https://youtu.be/x");
  assert.equal(route("a faceless video about sleep with stock footage"), "/agents:money-printer a faceless video about sleep with stock footage");
  assert.equal(route("a short film about a lighthouse keeper"), "/agents:vimax a short film about a lighthouse keeper");
  assert.equal(route("a vox style collage explainer on inflation"), "/agents:vox-director a vox style collage explainer on inflation");
  assert.equal(route("a documentary on bees"), "/agents:openmontage a documentary on bees");
  // An attached video plus an edit verb goes to the chat's edit path as plain text.
  assert.equal(route("trim the first 5 seconds and add captions", { hasVideo: true }), "trim the first 5 seconds and add captions");
  assert.equal(route("trim the first 5 seconds"), "/video trim the first 5 seconds");
  assert.equal(videoCapabilityRoute("/agents:video"), null);
  assert.equal(videoCapabilityRoute("/agents:video-use cut it"), null);
  assert.equal(videoCapabilityRoute("make a video"), null);
});
