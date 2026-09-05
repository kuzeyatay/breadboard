import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("profile Knowledge and the garden workspace share the scattered-dot loader", () => {
  const loader = read("src/app/components/thought-topology-loading-dots.tsx");
  const profile = read("src/app/profile/brain-map-skeleton.tsx");
  const workspace = read("src/app/components/knowledge-graph.tsx");
  const styles = read("src/app/globals.css");

  assert.equal((loader.match(/<span aria-hidden="true" \/>/g) ?? []).length, 4);
  assert.match(profile, /<ThoughtTopologyLoadingDots \/>/);
  assert.match(
    workspace,
    /<ThoughtTopologyLoadingDots label="Loading garden preview" \/>/,
  );
  assert.match(
    workspace,
    /label=\{previewUpdateLabel \?\? 'Loading garden preview'\}/,
  );
  assert.doesNotMatch(workspace, />\s*Loading(?: garden preview)?\.\.\.\s*</);
  assert.match(
    styles,
    /thought-topology-loading-pulse 1\.4s ease-in-out infinite alternate/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.thought-topology-loading-dots > span \{[\s\S]*?animation: none/,
  );
});

test("Quartz shows the same dots only when an initial topology has no canvas", () => {
  const graph = read("../quartz/quartz/components/Graph.tsx");
  const styles = read("../quartz/quartz/components/styles/graph.scss");

  assert.match(graph, /isHomeVariant && <ThoughtTopologyLoadingDots \/>/);
  assert.match(
    styles,
    /home-knowledge-graph\[data-active-mode="topology-pending"\][\s\S]*?> \.graph-container:empty[\s\S]*?\+ \.thought-topology-loading-dots[\s\S]*?display: block/,
  );
  assert.match(styles, /background: var\(--secondary\)/);
  assert.match(
    styles,
    /\.thought-topology-status[\s\S]*?\&\[data-state="building"\][\s\S]*?padding-left: 0[\s\S]*?display: none/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.thought-topology-loading-dots > span[\s\S]*?animation: none/,
  );
});
