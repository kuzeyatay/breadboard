import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("workspace neumorphism is built from shared visual-only materials", () => {
  const css = source("../src/app/globals.css");
  for (const token of [
    "--neu-hover-shadow",
    "--neu-divider-shadow",
    "--neu-recessed-shadow",
    "--neu-sidebar-left-shadow",
    "--neu-sidebar-right-shadow",
    "--neu-tray-shadow",
  ]) {
    assert.match(css, new RegExp(token));
  }
  for (const utility of [
    ".bb-neu-tray",
    ".bb-neu-toolbar",
    ".bb-neu-sidebar-left",
    ".bb-neu-sidebar-right",
    ".bb-neu-conversation-row-selected",
    ".bb-neu-learn-tray",
    ".bb-neu-accordion-open",
    ".bb-neu-accordion-panel",
    ".bb-neu-recessed",
    ".bb-neu-artifact-card",
  ]) {
    assert.match(css, new RegExp(utility.replace(".", "\\.")));
  }

  const materialStart = css.indexOf("Breadboard workspace materials");
  const visualMaterials = css.slice(
    materialStart,
    css.indexOf("\n.neu-progress-track", materialStart),
  );
  assert.ok(visualMaterials.length > 0);
  assert.doesNotMatch(
    visualMaterials,
    /^\s*(?:transform|translate|width|height|position|overflow|pointer-events|visibility|z-index)\s*:/m,
    "workspace material utilities must not override panel motion or layout",
  );
});

test("Terminal and Garden retain their existing mechanics while using the shared materials", () => {
  const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const graph = source("../src/app/components/knowledge-graph.tsx");
  const composer = source("../src/app/components/assistant-composer.tsx");

  const terminalSidebar = source("../src/app/components/hermes/terminal-sidebar.tsx");

  assert.match(terminal, /bb-neu-tray[\s\S]*fixed inset-x-0 bottom-0/);
  // The rail is its own component now, and a little wider than the old one.
  assert.match(terminalSidebar, /bb-neu-sidebar-left[\s\S]*w-\[260px\] shrink-0/);
  assert.match(terminalSidebar, /bb-neu-conversation-row-selected/);
  assert.match(terminal, /bb-neu-sidebar-right[\s\S]*w-\[min\(42vw,520px\)\]/);

  assert.match(garden, /bb-neu-toolbar breadboard-flower-navbar/);
  assert.match(garden, /style=\{\{ width: leftSidebarWidth \}\}/);
  assert.match(garden, /bb-neu-sidebar-left/);
  assert.match(garden, /bb-neu-learn-tray/);
  assert.match(garden, /bb-neu-accordion-open/);
  assert.match(garden, /transition-transform duration-200/);

  assert.match(graph, /style=\{\{ width: panelWidth \}\s+as CSSProperties\}/);
  assert.match(graph, /bb-neu-sidebar-right/);
  assert.match(graph, /bb-neu-recessed/);
  assert.match(composer, /neu-composer relative rounded-\[30px\] p-2/);
  assert.doesNotMatch(composer, /bb-neu-composer-entry/);
});

test("all scrolling surfaces use the shared minimal neumorphic scrollbar", () => {
  const css = source("../src/app/globals.css");
  const quartzCss = source("../../quartz/quartz/styles/custom.scss");

  for (const token of [
    "--bb-scrollbar-size",
    "--bb-scrollbar-track",
    "--bb-scrollbar-thumb",
    "--bb-scrollbar-thumb-hover",
    "--bb-scrollbar-thumb-active",
  ]) {
    assert.match(css, new RegExp(token));
  }

  assert.match(css, /--bb-scrollbar-shadow/);
  assert.match(css, /--bb-scrollbar-highlight/);
  assert.match(css, /--bb-scrollbar-size:\s*0\.625rem/);
  assert.match(css, /\*::-webkit-scrollbar-thumb\s*\{[\s\S]*?border:\s*2px solid var\(--bb-scrollbar-track\)/);
  assert.match(css, /@supports \(-moz-appearance: none\)\s*\{[\s\S]*?\*\s*\{[\s\S]*?scrollbar-color:[\s\S]*?scrollbar-width:\s*thin;/);
  assert.match(css, /\*::-webkit-scrollbar\s*\{[\s\S]*?width:\s*var\(--bb-scrollbar-size\);[\s\S]*?height:\s*var\(--bb-scrollbar-size\);/);
  assert.match(css, /\*::-webkit-scrollbar-track\s*\{[\s\S]*?background:\s*var\(--bb-scrollbar-track\)[\s\S]*?box-shadow:/);
  assert.match(css, /\*::-webkit-scrollbar-thumb\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?background:\s*var\(--bb-scrollbar-thumb\);[\s\S]*?box-shadow:/);
  assert.match(css, /\*::-webkit-scrollbar-thumb:hover/);
  assert.match(css, /\*::-webkit-scrollbar-thumb:active/);
  assert.match(css, /\*::-webkit-scrollbar-corner/);

  assert.match(quartzCss, /--neu-q-scrollbar-track/);
  assert.match(quartzCss, /--neu-q-scrollbar-size:\s*0\.625rem/);
  assert.match(quartzCss, /\*::-webkit-scrollbar-thumb\s*\{[\s\S]*?border:\s*2px solid var\(--neu-q-scrollbar-track\)/);
  assert.match(quartzCss, /@supports \(-moz-appearance: none\)/);
  assert.match(quartzCss, /\*::-webkit-scrollbar-track\s*\{[\s\S]*?background:\s*var\(--neu-q-scrollbar-track\)[\s\S]*?box-shadow:/);
  assert.match(quartzCss, /\*::-webkit-scrollbar-thumb\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?background:\s*var\(--neu-q-scrollbar-thumb\);[\s\S]*?box-shadow:/);
});

test("liquid glass stays paused and out of scrollers and app chrome", () => {
  const css = source("../src/app/globals.css");
  const quartzCss = source("../../quartz/quartz/styles/custom.scss");
  const packageJson = source("../package.json");
  const terminal = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  const gardenAgent = source("../src/app/components/hermes/garden-agent-chat.tsx");
  const composer = source("../src/app/components/assistant-composer.tsx");

  assert.match(packageJson, /"@vercel\/oidc": "\^3\.8\.0"/);

  // The dock's liquid-glass bar is paused, not removed, so the dependency
  // legitimately stays. What must hold is that nothing runs: with the flag off
  // the hook never initialises and neither library is even imported.
  assert.match(terminal, /const LIQUID_GLASS_BAR_ENABLED = false/);
  assert.match(terminal, /NEXT_PUBLIC_LIQUID_GLASS/);

  // No scroller anywhere grows a glass treatment.
  assert.doesNotMatch(css, /scrollbar-(?:rim|specular|thumb-strong)/i);
  assert.doesNotMatch(quartzCss, /scrollbar-(?:rim|specular|thumb-strong)|liquid.?glass/i);
  assert.doesNotMatch(css, /\.bb-liquid-glass|data-ybouane-liquid-glass|backdrop-filter:\s*blur\(14px\)/);

  // Every other chat surface stays plain neumorphic material.
  for (const chrome of [composer, garden, gardenAgent]) {
    assert.doesNotMatch(chrome, /useLiquidGlassSurface|bb-liquid-glass|liquidGlass/);
  }
  assert.match(composer, /neu-composer relative rounded-\[30px\] p-2/);
  assert.match(terminal, /className=\{`bb-neu-toolbar flex/);
  assert.match(garden, /bb-neu-toolbar breadboard-flower-navbar neu-surface-subtle/);
  assert.match(gardenAgent, /className="bb-neu-toolbar flex/);
});

test("artifact cards use raised containers and recessed preview material", () => {
  const archive = source("../src/app/components/hermes/artifact-panel.tsx");
  const inlineCards = source("../src/app/components/hermes/inline-artifact-cards.tsx");
  const viewer = source("../src/app/components/hermes/artifact-viewer.tsx");

  assert.match(archive, /bb-neu-artifact-card/);
  assert.match(archive, /bb-neu-artifact-preview/);
  assert.match(inlineCards, /bb-neu-artifact-card/);
  assert.match(inlineCards, /bb-neu-artifact-preview/);
  assert.match(viewer, /bb-neu-recessed/);
  assert.match(viewer, /neu-button shrink-0/);
});

test("composer image attachments use large responsive previews", () => {
  const composer = source("../src/app/components/assistant-composer.tsx");

  assert.match(composer, /h-36 w-36[\s\S]*?sm:h-44 sm:w-44/);
  assert.doesNotMatch(composer, /group relative h-16 w-16/);
  assert.match(composer, /right-1\.5 top-1\.5 flex h-7 w-7/);
  assert.match(composer, /onClick=\{\(\) => openLightbox\(index\)\}/);
  assert.match(composer, /onClick=\{\(\) => onRemoveAttachment\(index\)\}/);
});
