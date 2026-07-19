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
const quartzComponent = source(
  "../../quartz/quartz/components/BreadboardAI.tsx",
);
const quartzStyles = source(
  "../../quartz/quartz/components/styles/breadboardAI.scss",
);

test("dashboard chat surfaces share a borderless neumorphic composer", () => {
  assert.match(composer, /neumorphic-chat-bar relative rounded-\[30px\] p-2/);
  assert.match(globalStyles, /\.neumorphic-chat-bar \{[\s\S]*?border: 0;/);
  assert.match(globalStyles, /9px 9px 20px/);
  assert.match(globalStyles, /-9px -9px 20px/);
  assert.match(globalStyles, /\.neumorphic-chat-bar:focus-within/);
  assert.doesNotMatch(workspace, /shrink-0 border-t border-gray-800 px-4 py-4/);
  assert.doesNotMatch(garden, /border-t border-gray-800 p-3/);
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
