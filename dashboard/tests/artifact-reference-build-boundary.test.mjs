import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

import {
  artifactReferenceMarkdown,
  parseArtifactReference,
} from "../src/lib/generated/artifact-reference.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

test("the dashboard artifact codec matches the canonical Quartz source", () => {
  const canonical = fs.readFileSync(
    path.join(dashboardRoot, "../quartz/quartz/util/artifactReference.ts"), "utf8",
  );
  const generated = fs.readFileSync(
    path.join(dashboardRoot, "src/lib/generated/artifact-reference.ts"), "utf8",
  );
  assert.equal(
    generated.replace(/^\/\/ Generated[^\n]*\n/, "").replace(/\r\n/g, "\n"),
    canonical.replace(/\r\n/g, "\n"),
    "Run node scripts/build-quartz-reader.mjs to refresh the dashboard codec",
  );

  const reference = {
    id: "artifact-1", conversationId: "chat-1", kind: "video",
    title: "Lecture\n```\n<script>alert(1)</script>",
  };
  const markdown = artifactReferenceMarkdown(reference);
  assert.equal(markdown.match(/```/g).length, 2);
  assert.deepEqual(parseArtifactReference(markdown.split("\n")[1]), reference);
  assert.equal(parseArtifactReference('{"id":"../private","conversationId":"chat-1"}'), null);
});

test("the garden artifact client bundles entirely inside the dashboard root", async () => {
  const result = await build({
    absWorkingDir: dashboardRoot,
    entryPoints: ["src/app/garden/garden-markdown-artifacts.tsx"],
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "esm",
    external: ["react", "react/jsx-runtime", "next/dynamic", "@/app/components/hermes/artifact-viewer"],
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    const relative = path.relative(dashboardRoot, path.resolve(dashboardRoot, input));
    assert.ok(!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `Turbopack cannot resolve an input outside its dashboard root: ${input}`);
  }
  assert.ok(result.metafile.inputs["src/lib/generated/artifact-reference.ts"]);
});
