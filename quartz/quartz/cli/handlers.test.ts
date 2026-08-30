import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import vm from "node:vm"
// @ts-expect-error Quartz's CLI is authored in JavaScript without declarations.
import { compileInlineScript } from "./handlers.js"

test("compiled inline runtimes keep deferred state isolated from later classic scripts", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quartz-inline-runtime-"))
  const sourcePath = path.join(directory, "deferred.inline.ts")

  try {
    fs.writeFileSync(
      sourcePath,
      [
        'const sandboxRuntime = "trusted sandbox source"',
        "globalThis.readSandboxRuntime = () => sandboxRuntime",
      ].join("\n"),
      "utf8",
    )

    const compiled = await compileInlineScript(sourcePath)
    const context = vm.createContext({ Promise }) as typeof globalThis & {
      readSandboxRuntime?: () => unknown
    }

    vm.runInContext(compiled, context)
    vm.runInContext('var sandboxRuntime = Promise.resolve("colliding runtime")', context)

    assert.equal(context.readSandboxRuntime?.(), "trusted sandbox source")
    assert.notEqual(String(context.readSandboxRuntime?.()), "[object Promise]")
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
