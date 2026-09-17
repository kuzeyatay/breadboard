import assert from "node:assert/strict";
import test from "node:test";
import { visualizerCommandText } from "../src/lib/hermes/interactive-visualizer-intent.ts";

const select = (text, priorMessages) => visualizerCommandText({
  text, priorMessages, surface: "dashboard_terminal", authenticated: true,
});

test("questions about visualizer software do not require an artifact", () => {
  for (const text of [
    "is there an open source version of googles interactive visualizer that appears embedded inside a chat",
    "Is interactive visualizer in chat only 2D?",
    "What libraries support interactive 3D models?",
    "Find an open-source alternative to Gemini's interactive visualizer.",
    "Show me open-source interactive visualizer libraries.",
    "How do I build an interactive visualization?",
    "Explain what an interactive simulation is.",
    "Compare interactive visualization frameworks.",
    "The report mentions simulation tooling and managed teleoperation.",
  ]) assert.deepEqual(select(text), { text, automatic: false }, text);
});

test("creation requests still select the visualizer and explicit skills are preserved", () => {
  for (const text of [
    "Create an interactive 3D model showing how the Moon orbits Earth.",
    "Can you make an interactive simulation of Gauss's law?",
    "Please visualize exponential growth with a slider.",
    "I want you to build a Three.js scene of a Gaussian sphere.",
    "Show me how a double pendulum works. Let me change gravity.",
    "Interactive visualization of electric flux",
    "Is there an open-source visualizer? Create an interactive model of flux here.",
  ]) assert.equal(select(text).automatic, true, text);
  const explicit = "/interactive-visualizer-in-chat make it 3d";
  assert.deepEqual(select(explicit), { text: explicit, automatic: false });
});

test("retry follows the last request rather than a visualizer mention in a research answer", () => {
  const research = [
    { role: "user", content: "Is there an open-source interactive visualizer?" },
    { role: "assistant", content: "The required visualizer was not published before this turn ended." },
  ];
  assert.equal(select("retry", research).automatic, false);
  assert.equal(select("retry", [
    { role: "assistant", content: "This interactive visualizer supports rotation." },
  ]).automatic, false);
  assert.equal(select("retry", [
    { role: "user", content: "/interactive-visualizer-in-chat make it 3d" },
    { role: "assistant", content: "The artifact failed validation." },
  ]).automatic, true);
});
