import test from "node:test";
import assert from "node:assert/strict";
import { turnVideoSkill } from "../src/lib/remotion/request.ts";

// Real selections from live Make a shot turns: a broad turn selects both skills, its own first.
test("a render is credited to the turn's own video skill, not always Film", () => {
  assert.equal(turnVideoSkill(["video", "video-to-markdown", "bullshit-detector", "film", "breadboard-use"]), "video");
  assert.equal(turnVideoSkill(["film", "video", "image-to-3d", "math-animation"]), "film");
  assert.equal(turnVideoSkill(["breadboard-use", "plan"]), undefined);
  assert.equal(turnVideoSkill(undefined), undefined);
});
