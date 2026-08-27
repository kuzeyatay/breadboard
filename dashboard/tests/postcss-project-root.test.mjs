import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcss from "postcss";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(testsDirectory, "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const dashboardNodeModules = path.join(dashboardRoot, "node_modules");
const require = createRequire(import.meta.url);
const { getPostCssPlugins } = require(
  "next/dist/build/webpack/config/blocks/css/plugins.js",
);

test("Next and Turbopack keep the dashboard project boundary when CLI cwd is the repository", async () => {
  const originalWorkingDirectory = process.cwd();
  process.chdir(repositoryRoot);
  try {
    const configUrl = `${pathToFileURL(path.join(dashboardRoot, "next.config.ts")).href}?root-test`;
    const config = (await import(configUrl)).default;
    assert.equal(fs.realpathSync(config.outputFileTracingRoot), fs.realpathSync(dashboardRoot));
    assert.equal(fs.realpathSync(config.turbopack.root), fs.realpathSync(dashboardRoot));
  } finally {
    process.chdir(originalWorkingDirectory);
  }
});

test("Tailwind package resolution and scanning stay rooted in dashboard", async () => {
  const originalWorkingDirectory = process.cwd();
  const originalNodePath = process.env.NODE_PATH;
  process.chdir(repositoryRoot);
  delete process.env.NODE_PATH;
  try {
    // Exercise the same config discovery and lazy plugin loading used by
    // Next. A dashboard-local `from` passes without the resolver fix, so the
    // repository-root source below is essential to reproduce the real fault.
    const plugins = await getPostCssPlugins(
      dashboardRoot,
      undefined,
      false,
      false,
    );
    const config = (await import("../postcss.config.mjs")).default;
    assert.equal(
      fs.realpathSync(config.plugins["@tailwindcss/postcss"].base),
      fs.realpathSync(dashboardRoot),
    );
    assert.equal(
      fs.realpathSync(process.env.NODE_PATH),
      fs.realpathSync(dashboardNodeModules),
    );

    const result = await postcss(plugins).process(
      '@import "tailwindcss" source(none);\n@source inline("block");',
      { from: path.join(repositoryRoot, "__tailwind-root-probe.css") },
    );
    assert.match(result.css, /\.block\s*\{/u);
    assert.ok(
      result.messages.some(
        (message) =>
          message.type === "dependency" &&
          typeof message.file === "string" &&
          fs.realpathSync(message.file) ===
            fs.realpathSync(
              path.join(dashboardNodeModules, "tailwindcss", "index.css"),
            ),
      ),
      "Tailwind's stylesheet dependency must resolve from dashboard/node_modules",
    );
  } finally {
    process.chdir(originalWorkingDirectory);
    if (originalNodePath === undefined) {
      delete process.env.NODE_PATH;
    } else {
      process.env.NODE_PATH = originalNodePath;
    }
  }
});
