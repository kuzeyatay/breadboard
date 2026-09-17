// A Garden whose source exists but whose pages were never published used to be
// a dead end: the reader handed the frame a URL, the static service answered
// with "This Garden page could not be found", and nothing in that page could
// ever produce the missing publication. These cover the recovery that closes
// that gap, and the limits that keep it from becoming a rebuild on every visit.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const stateKey = "__breadboardGardenPublicationRecoveryState";

/** The publication module with its Runtime client replaced by a recorder. */
async function loadQuartzPublish() {
  const result = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "quartz-publish.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [
      {
        name: "garden-publication-recovery-stub",
        setup(build) {
          build.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "stub",
          }));
          build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
            path: "supervisor-control",
            namespace: "stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, (args) =>
            args.path === "server-only"
              ? { loader: "js", contents: "" }
              : {
                  loader: "js",
                  contents: `
                    const state = () => globalThis[${JSON.stringify(stateKey)}];
                    export async function submitRuntimeJob() {
                      throw new Error("recovery must use the sealed worker executor here");
                    }
                    export async function inspectRuntimeJob() {
                      throw new Error("unused");
                    }
                    export async function readRuntimeJobOutput() {
                      throw new Error("unused");
                    }
                  `,
                },
          );
        },
      },
    ],
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Math.random()}`);
}

/** A Quartz data root: `math-1` has content, and nothing is published yet. */
function quartzRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-garden-recovery-"));
  const contentPath = path.join(root, "quartz", "content");
  fs.mkdirSync(path.join(contentPath, "math-1", "Concepts"), { recursive: true });
  fs.writeFileSync(path.join(contentPath, "math-1", "_index.md"), "# Math 1\n");
  fs.mkdirSync(path.join(root, "quartz", "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "quartz", "public", "index.html"), "site");
  return { root, contentPath, publicPath: path.join(root, "quartz", "public") };
}

function publishGarden(publicPath, slug) {
  fs.mkdirSync(path.join(publicPath, slug), { recursive: true });
  fs.writeFileSync(path.join(publicPath, slug, "index.html"), "garden");
}

async function withEnvironment(contentPath, run) {
  const previous = {
    contentPath: process.env.QUARTZ_CONTENT_PATH,
    autoPublish: process.env.QUARTZ_AUTO_PUBLISH,
  };
  process.env.QUARTZ_CONTENT_PATH = contentPath;
  process.env.QUARTZ_AUTO_PUBLISH = "1";
  try {
    return await run();
  } finally {
    if (previous.contentPath === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previous.contentPath;
    if (previous.autoPublish === undefined) delete process.env.QUARTZ_AUTO_PUBLISH;
    else process.env.QUARTZ_AUTO_PUBLISH = previous.autoPublish;
  }
}

/** Installs a recording executor and returns the publications it received. */
function recordPublications(quartz, behavior = async () => {}) {
  const publications = [];
  quartz.installSealedRuntimeV2QuartzPublishExecutor(async (input) => {
    publications.push(input);
    await behavior(input, publications.length);
    return { published: true, durationMs: 1, reasonCount: input.reasons.length };
  });
  return publications;
}

test("an unpublished Garden publishes itself, scoped, when its reader opens", async () => {
  const { root, contentPath, publicPath } = quartzRoot();
  try {
    const quartz = await loadQuartzPublish();
    const publications = recordPublications(quartz, () => {
      // The build is what creates the page; do that here so the second call
      // below sees a published Garden.
      publishGarden(publicPath, "math-1");
    });

    await withEnvironment(contentPath, async () => {
      await quartz.ensureGardenPublicationForView(1, "math-1");
      assert.equal(publications.length, 1, "the missing Garden is published once");
      assert.deepEqual(publications[0].scope, [
        "math-1",
        "private-library",
        "public-library",
        "organization-library",
      ]);
      assert.deepEqual(publications[0].reasons, ["publish unpublished garden math-1"]);

      // Opening it again costs nothing: the page is there now.
      await quartz.ensureGardenPublicationForView(1, "math-1");
      assert.equal(publications.length, 1);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an already published Garden is never rebuilt on the way in", async () => {
  const { root, contentPath, publicPath } = quartzRoot();
  try {
    publishGarden(publicPath, "math-1");
    const quartz = await loadQuartzPublish();
    const publications = recordPublications(quartz);
    await withEnvironment(contentPath, async () => {
      await quartz.ensureGardenPublicationForView(1, "math-1");
    });
    assert.deepEqual(publications, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a Garden with no content yet waits for its first write instead of building", async () => {
  const { root, contentPath } = quartzRoot();
  try {
    const quartz = await loadQuartzPublish();
    const publications = recordPublications(quartz);
    await withEnvironment(contentPath, async () => {
      await quartz.ensureGardenPublicationForView(1, "not-written-yet");
    });
    assert.deepEqual(publications, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent readers of the same Garden share one publication", async () => {
  const { root, contentPath, publicPath } = quartzRoot();
  try {
    const quartz = await loadQuartzPublish();
    let release = () => {};
    const started = new Promise((resolve) => {
      release = resolve;
    });
    const publications = recordPublications(quartz, async () => {
      await started;
      publishGarden(publicPath, "math-1");
    });

    await withEnvironment(contentPath, async () => {
      const readers = [
        quartz.ensureGardenPublicationForView(1, "math-1"),
        quartz.ensureGardenPublicationForView(1, "math-1"),
        quartz.ensureGardenPublicationForView(2, "math-1"),
      ];
      release();
      await Promise.all(readers);
    });
    assert.equal(publications.length, 1, "three readers must not queue three builds");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a Garden that publishes nothing does not rebuild on every visit", async () => {
  const { root, contentPath } = quartzRoot();
  try {
    const quartz = await loadQuartzPublish();
    // Every note in this Garden is a draft: the build succeeds and still emits
    // no page for it. Without a backoff each visit would start another build.
    const publications = recordPublications(quartz);
    await withEnvironment(contentPath, async () => {
      await quartz.ensureGardenPublicationForView(1, "math-1");
      await quartz.ensureGardenPublicationForView(1, "math-1");
      await quartz.ensureGardenPublicationForView(1, "math-1");
    });
    assert.equal(publications.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failed publication still lets the reader open", async () => {
  const { root, contentPath } = quartzRoot();
  try {
    const quartz = await loadQuartzPublish();
    const publications = [];
    quartz.installSealedRuntimeV2QuartzPublishExecutor(async (input) => {
      publications.push(input);
      throw new Error("Quartz publication failed.");
    });
    await withEnvironment(contentPath, async () => {
      // Resolves rather than rejecting: the Garden page explains itself, and
      // the reader is not replaced by an error.
      await quartz.ensureGardenPublicationForView(1, "math-1");
    });
    assert.equal(publications.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
