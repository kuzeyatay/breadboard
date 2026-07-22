import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const composer = source("../src/app/components/assistant-composer.tsx");
const globalStyles = source("../src/app/globals.css");
const workspace = source(
  "../src/app/gardens/[clusterSlug]/workspace-client.tsx",
);
const garden = source("../src/app/garden/garden-assistant.tsx");
const runtime = source(
  "../src/app/components/openharness/agent-runtime-panel.tsx",
);
const terminal = source("../src/app/components/knowledge-terminal.tsx");
const quartzComponent = source(
  "../../quartz/quartz/components/BreadboardAI.tsx",
);
const quartzStyles = source(
  "../../quartz/quartz/components/styles/breadboardAI.scss",
);

test("dashboard chat surfaces share a borderless neumorphic composer", () => {
  assert.match(composer, /neu-composer relative rounded-\[30px\] p-2/);
  assert.match(globalStyles, /\.neu-composer,[\s\S]*?\.neumorphic-chat-bar \{/);
  assert.match(globalStyles, /7px 8px 18px var\(--neu-shadow\)/);
  assert.match(globalStyles, /-6px -6px 16px var\(--neu-highlight\)/);
  assert.match(globalStyles, /\.neu-composer:focus-within/);
  assert.doesNotMatch(workspace, /shrink-0 border-t border-gray-800 px-4 py-4/);
  assert.doesNotMatch(garden, /border-t border-gray-800 p-3/);
});

test("the composer text uses balanced optical vertical alignment", () => {
  assert.match(
    composer,
    /compact \? 'min-h-9 pb-\[7px\] pt-\[9px\] text-sm leading-5' : 'min-h-11 pb-\[9px\] pt-\[11px\] text-\[15px\] leading-6'/,
  );
  assert.doesNotMatch(composer, /compact \? 'py-2 text-sm leading-5' : 'py-2\.5 text-\[15px\] leading-6'/);
});

test("Quartz uses the same raised pill structure without input borders", () => {
  assert.match(quartzComponent, /breadboard-ai-composer-shell/);
  assert.match(
    quartzComponent,
    /class="breadboard-ai-input"[\s\S]*?rows=\{1\}/,
  );
  assert.match(
    quartzStyles,
    /\.breadboard-ai-composer-shell \{[\s\S]*?border-radius: 999px;/,
  );
  assert.match(quartzStyles, /8px 8px 18px/);
  assert.match(quartzStyles, /-6px -6px 16px/);
  assert.match(
    quartzStyles,
    /\.breadboard-ai-input \{[\s\S]*?border: 0;[\s\S]*?background: transparent;/,
  );
  assert.match(
    quartzStyles,
    /\.breadboard-ai-composer \{[\s\S]*?border-top: 0;/,
  );
});

test("user chat messages use warm neumorphic bubbles while assistant replies stay flat", () => {
  for (const transcript of [workspace, garden, runtime, terminal]) {
    assert.match(transcript, /neu-chat-message-user/);
    assert.doesNotMatch(transcript, /neu-chat-message-assistant/);
  }
  assert.match(globalStyles, /--neu-chat-user-surface:/);
  assert.match(
    globalStyles,
    /\.neu-chat-message-user \{[\s\S]*?background: var\(--neu-chat-user-surface\);[\s\S]*?box-shadow:/,
  );
  assert.doesNotMatch(globalStyles, /\.neu-chat-message-assistant \{/);
});
