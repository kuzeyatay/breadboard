// earthtojake/text-to-cad: twelve reviewed CAD/CAE/CAM workflows that are
// shipped with Breadboard and selected from ordinary requests, without making
// people discover or type slash commands.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { listFirstPartySkills } from "../src/lib/hermes/skills.ts";
import {
  textToCadCommandText,
  textToCadSkillForRequest,
} from "../src/lib/hermes/text-to-cad-intent.ts";
import {
  TEXT_TO_CAD_COMMIT,
  TEXT_TO_CAD_SKILLS,
  TEXT_TO_CAD_SOURCE,
  TEXT_TO_CAD_VERSION,
  textToCadRuntimeGuidance,
} from "../src/lib/hermes/text-to-cad.ts";
import { cadSystemPrompt } from "../src/lib/cad/prompts.ts";
import { runtimeAgentById } from "../src/lib/hermes/capability-combinations.ts";

const prebuiltRoot = path.resolve(import.meta.dirname, "../../hermes-skills/prebuilt");

function selectedSkill(text, priorMessages) {
  return textToCadSkillForRequest({
    text,
    surface: "dashboard_terminal",
    authenticated: true,
    priorMessages,
  });
}

test("the complete reviewed upstream release is pinned and vendored", () => {
  const receipt = JSON.parse(
    fs.readFileSync(path.join(prebuiltRoot, "TEXT_TO_CAD_UPSTREAM.json"), "utf8"),
  );
  assert.equal(receipt.source, TEXT_TO_CAD_SOURCE);
  assert.equal(receipt.version, TEXT_TO_CAD_VERSION);
  assert.equal(receipt.commit, TEXT_TO_CAD_COMMIT);
  assert.deepEqual(receipt.skills, [...TEXT_TO_CAD_SKILLS]);

  for (const slug of TEXT_TO_CAD_SKILLS) {
    for (const relative of ["SKILL.md", "LICENSE", "agents/openai.yaml"]) {
      assert.ok(
        fs.existsSync(path.join(prebuiltRoot, slug, ...relative.split("/"))),
        `${slug} is missing ${relative}`,
      );
    }
  }
  assert.ok(
    fs.existsSync(path.join(prebuiltRoot, "cad-viewer/scripts/viewer/dist/index.html")),
    "the offline viewer build must ship with the skill",
  );
});

test("all twelve workflows are ready first-party skills on both chat surfaces", () => {
  for (const surface of ["dashboard_terminal", "garden_chat"]) {
    const inventory = listFirstPartySkills(surface);
    for (const slug of TEXT_TO_CAD_SKILLS) {
      const skill = inventory.find((candidate) => candidate.slug === slug);
      assert.ok(skill, `${slug} missing from ${surface}`);
      assert.equal(skill.source, TEXT_TO_CAD_SOURCE, `${surface}/${slug}`);
      assert.equal(skill.version, TEXT_TO_CAD_VERSION, `${surface}/${slug}`);
      assert.equal(skill.id, `${TEXT_TO_CAD_SOURCE}/${slug}`, `${surface}/${slug}`);
      assert.equal(skill.classification, "eligible_general", `${surface}/${slug}`);
      assert.equal(skill.availability, "ready", `${surface}/${slug}`);
    }
  }
});

test("ordinary CAD and fabrication requests select the most specific workflow", () => {
  const cases = new Map([
    ["create a STEP bracket with four M3 holes", "cad"],
    ["design a 24 tooth spur gear", "cad"],
    ["model an adjustable AR glasses temple", "cad"],
    ["make a DXF gasket outline for laser cutting", "dxf"],
    ["validate robot.urdf", "urdf"],
    ["edit the MoveIt2 planning groups in arm.srdf", "srdf"],
    ["create an SDFormat world for Gazebo", "sdf"],
    ["slice enclosure.stl into G-code with OrcaSlicer", "gcode"],
    ["upload this validated G-code to my Bambu A1", "bambu-labs"],
    ["prepare this DXF for SendCutSend", "sendcutsend"],
    ["check this mesh for DfAM wall thickness and overhangs", "dfam-check"],
    ["find the STEP model for this off-the-shelf bearing", "step-parts"],
    ["open housing.step in the CAD viewer", "cad-viewer"],
    ["build an implicit CAD signed-distance-field model", "implicit-cad"],
  ]);
  for (const [request, expected] of cases) {
    assert.equal(selectedSkill(request), expected, request);
  }
});

test("the innate router stays out of education and coincidental vocabulary", () => {
  for (const request of [
    "what is CAD?",
    "which CAD software should I learn?",
    "how do I make a bracket in SolidWorks?",
    "explain the difference between STEP and STL",
    "the support volume is 3 liters",
    "write a report about additive manufacturing",
    "build a CAD plugin for FreeCAD",
    "debug the URDF parser library in this repository",
    "/diagram-design draw a CAD workflow",
  ]) {
    assert.equal(selectedSkill(request), null, request);
  }
});

test("CAD follow-ups retain the workflow and routing is chat/auth scoped", () => {
  const priorMessages = [
    { role: "assistant", content: "The Parametric CAD project is ready as housing.step." },
  ];
  assert.equal(selectedSkill("make the walls 3 mm", priorMessages), "cad");
  assert.equal(
    textToCadSkillForRequest({
      text: "make a STEP bracket",
      surface: "quartz_ai",
      authenticated: true,
    }),
    null,
  );
  assert.equal(
    textToCadSkillForRequest({
      text: "make a STEP bracket",
      surface: "dashboard_terminal",
      authenticated: false,
    }),
    null,
  );
});

test("command injection preserves the request and bridge selects the CAD worker", () => {
  const request = "create a STEP bracket with four M3 holes";
  assert.deepEqual(
    textToCadCommandText({
      text: request,
      surface: "garden_chat",
      authenticated: true,
    }),
    { text: `/cad ${request}`, automatic: true, skill: "cad" },
  );
  const guidance = textToCadRuntimeGuidance({
    slug: "cad",
    firstPartyRoot: prebuiltRoot,
    surface: "dashboard_terminal",
  });
  assert.match(guidance, /agent_launch/);
  assert.match(guidance, /parametric-cad/);
  assert.match(guidance, new RegExp(TEXT_TO_CAD_COMMIT.slice(0, 12)));
  assert.equal(
    runtimeAgentById("parametric-cad")?.requiresLaunchApproval,
    false,
    "innate local CAD work must not pause for a second launch confirmation",
  );
});

test("the CAD agent enforces STEP-first numerical and visual validation", () => {
  const prompt = cadSystemPrompt({
    safety: { level: "supported" },
    attemptBudget: 3,
  });
  assert.match(prompt, /STEP as the primary interchange artifact/);
  assert.match(prompt, /cad_render_views once/);
  assert.match(prompt, /passing script alone is not\s+evidence/i);
});

test("both turn pipelines route CAD before image meshes and expose the worker", () => {
  for (const relative of [
    "../src/lib/conversations/turn-service.ts",
    "../src/lib/hermes/garden-chat-adapter.ts",
  ]) {
    const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /textToCadCommandText\(/, relative);
    assert.match(source, /text: textToCadSelection\.text/, `${relative}: chain order`);
    assert.match(source, /!textToCadSelection\.automatic/, `${relative}: fallback`);
    assert.match(source, /\{ agent_launch: true \}/, `${relative}: CAD worker tool`);
    assert.match(source, /automaticTextToCad/, `${relative}: provenance`);
  }
});
