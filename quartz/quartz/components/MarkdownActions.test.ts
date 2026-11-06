import assert from "node:assert/strict"
import path from "node:path"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import { build } from "esbuild"
// @ts-expect-error Quartz's CLI is authored in JavaScript without declarations.
import { compileInlineScript } from "../cli/handlers.js"

test("the editor loader survives Quartz's keepNames server build without stopping page startup", async () => {
  // Exercise the actual two-stage build, not the untransformed loader source.
  const result = await build({
    entryPoints: [path.resolve("quartz/components/MarkdownActions.tsx")],
    bundle: true,
    write: false,
    keepNames: true,
    minifyWhitespace: true,
    minifySyntax: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    jsx: "automatic",
    jsxImportSource: "preact",
    plugins: [{
      name: "inline-script-loader",
      setup(builder) {
        builder.onLoad({ filter: /\.inline\.(ts|js)$/ }, async (args) => ({
          contents: await compileInlineScript(args.path),
          loader: "text",
        }))
      },
    }],
  })
  const module = { exports: {} as { default?: () => { afterDOMLoaded: string } } }
  vm.runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, require: createRequire(import.meta.url),
  })
  const script = module.exports.default!().afterDOMLoaded
  const listeners = new Map<string, () => void>()
  const context = vm.createContext({
    window: {},
    document: {
      readyState: "complete",
      querySelector: () => null,
      addEventListener: (type: string, callback: () => void) => listeners.set(type, callback),
    },
  })
  // Folder pages have no edit controls, but must still reach the SPA bootstrap.
  vm.runInContext(`${script}\nglobalThis.quartzStartupFinished = true`, context)
  assert.equal(context.quartzStartupFinished, true)
  assert.equal(context.window.__quartzDocumentLoader, true)
  assert.equal(typeof listeners.get("nav"), "function")
  assert.doesNotThrow(() => listeners.get("nav")!())
})
