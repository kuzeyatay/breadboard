import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { BuildCtx } from "../util/ctx"

// Exercise the real scheduler without loading browser-only transformer CSS.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("./emit.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
  plugins: [
    {
      name: "resources",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/plugins$/ }, () => ({
          path: "resources",
          namespace: "fixture",
        }))
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const getStaticResourcesFromPlugins=()=>({css:[],js:[],additionalHead:[]});",
        }))
      },
    },
  ],
})
const module = { exports: {} as typeof import("./emit") }
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
)
const { emitContent } = module.exports

for (const concurrency of [1, 4]) {
  test(`emitter scheduling respects single-worker mode (concurrency=${concurrency})`, async () => {
    let active = 0
    let peak = 0
    const completed: string[] = []
    const ctx = {
      argv: { concurrency, verbose: false, output: "fixture" },
      cfg: {
        plugins: {
          transformers: [],
          emitters: ["pages", "index"].map((name) => ({
            name,
            async *emit() {
              active++
              peak = Math.max(peak, active)
              await new Promise<void>((resolve) => setImmediate(resolve))
              yield `${name}.html`
              completed.push(name)
              active--
            },
          })),
        },
      },
    } as unknown as BuildCtx
    await emitContent(ctx, [])
    assert.equal(peak, concurrency === 1 ? 1 : 2)
    assert.deepEqual(completed.sort(), ["index", "pages"])
  })
}
