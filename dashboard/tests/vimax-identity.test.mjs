// Reaching the ViMax agent, and reading a prompt into a production request.

import assert from "node:assert/strict";
import test from "node:test";

const { briefFromVimaxCommand, parseVimaxRequest, vimaxUserMessage, VIMAX_COMMAND } =
  await import("../src/lib/vimax/identity.ts");

test("only a message addressed to the agent carries a brief", () => {
  assert.equal(briefFromVimaxCommand("/agents:vimax a cat befriends a dog"), "a cat befriends a dog");
  assert.equal(briefFromVimaxCommand("  /AGENTS:VIMAX  a heist  "), "a heist");
  assert.equal(briefFromVimaxCommand("/agents:hyperframes a cat"), null);
  assert.equal(briefFromVimaxCommand("make me a film"), null);
});

test("the command typed on its own yields an empty brief, not a launch", () => {
  // The palette inserts the token first, so an empty string means "still
  // writing" and the caller waits rather than starting an empty run.
  assert.equal(briefFromVimaxCommand(VIMAX_COMMAND), "");
  assert.equal(vimaxUserMessage(""), VIMAX_COMMAND);
  assert.equal(vimaxUserMessage("a heist"), `${VIMAX_COMMAND} a heist`);
});

test("flags are lifted out of the brief and never left in the story", () => {
  const parsed = parseVimaxRequest(
    'A lighthouse keeper meets a whale --scenes 3 --shots 4 --style "watercolour" --vertical',
  );
  assert.equal(parsed.brief, "A lighthouse keeper meets a whale");
  assert.equal(parsed.sceneCount, 3);
  assert.equal(parsed.shotBudget, 4);
  assert.equal(parsed.style, "watercolour");
  assert.equal(parsed.aspectRatio, "9:16");
  assert.equal(parsed.mode, "idea2video");
  assert.equal(parsed.images, true);
  // Counts become requirements the screenwriter and storyboard artist read.
  assert.match(parsed.userRequirement, /exactly 3 scenes/);
  assert.match(parsed.userRequirement, /no more than 4 shots per scene/);
});

test("the defaults are a 16:9 illustrated film written from an idea", () => {
  const parsed = parseVimaxRequest("Two rivals share the last umbrella in a storm");
  assert.equal(parsed.mode, "idea2video");
  assert.equal(parsed.aspectRatio, "16:9");
  assert.equal(parsed.images, true);
  assert.equal(parsed.style, null);
  assert.equal(parsed.sceneCount, null);
  assert.equal(parsed.userRequirement, "");
});

test("--script switches to the screenplay pipeline and keeps the screenplay intact", () => {
  const screenplay = "INT. KITCHEN - NIGHT\n\n<Ada> stares at the kettle.\n<Ada>: Boil, then.";
  const parsed = parseVimaxRequest(`${screenplay} --script`);
  assert.equal(parsed.mode, "script2video");
  // Line structure survives: a screenplay that lost its line breaks would be
  // cut into scenes wrongly.
  assert.equal(parsed.brief, screenplay);
});

test("--no-images plans the film without drawing it", () => {
  const parsed = parseVimaxRequest("A silent film about a clock --no-images");
  assert.equal(parsed.images, false);
  assert.equal(parsed.brief, "A silent film about a clock");
});

test("--for carries creative requirements without polluting the idea", () => {
  const parsed = parseVimaxRequest('A bakery mystery --for "for children, no scary scenes"');
  assert.equal(parsed.brief, "A bakery mystery");
  assert.equal(parsed.userRequirement, "for children, no scary scenes");
});

test("scene and shot counts are clamped to what a run can actually produce", () => {
  const parsed = parseVimaxRequest("An epic --scenes 99 --shots 99");
  assert.equal(parsed.sceneCount, 12);
  assert.equal(parsed.shotBudget, 12);
});

test("an unrecognized flag stays part of the brief", () => {
  const parsed = parseVimaxRequest("A film about --telephoto lenses");
  assert.equal(parsed.brief, "A film about --telephoto lenses");
});

test("the frame generator can be chosen per message", () => {
  assert.equal(parseVimaxRequest("A film").imageGenerator, "auto");
  assert.equal(parseVimaxRequest("A film --gemini").imageGenerator, "gemini");
  assert.equal(parseVimaxRequest("A film --chatgpt").imageGenerator, "chatgpt");
  assert.equal(parseVimaxRequest("A film --generator gemini").imageGenerator, "gemini");
  assert.equal(parseVimaxRequest("A film --generator=openai").imageGenerator, "chatgpt");
  // The flag never survives into the story.
  assert.equal(parseVimaxRequest("A film --gemini").brief, "A film");
});

test("a saved generator preference is overridable in one message", () => {
  const saved = { imageGenerator: "gemini" };
  assert.equal(parseVimaxRequest("A film", saved).imageGenerator, "gemini");
  assert.equal(parseVimaxRequest("A film --chatgpt", saved).imageGenerator, "chatgpt");
  assert.equal(parseVimaxRequest("A film --auto", saved).imageGenerator, "auto");
});
