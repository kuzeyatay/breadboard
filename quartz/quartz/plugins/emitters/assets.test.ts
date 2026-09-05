import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { FilePath } from "../../util/path"
import { copyFile } from "./assets"

test("asset copying ignores a source removed after enumeration", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "quartz-assets-"))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))

  const directory = path.join(root, "content")
  const output = path.join(root, "public")
  await fs.promises.mkdir(directory, { recursive: true })

  const result = await copyFile(
    { directory, output } as never,
    "images/removed.png" as FilePath,
  )

  assert.equal(result, undefined)
})

test("asset copying still copies present files", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "quartz-assets-"))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))

  const directory = path.join(root, "content")
  const output = path.join(root, "public")
  const source = path.join(directory, "images", "diagram.png")
  await fs.promises.mkdir(path.dirname(source), { recursive: true })
  await fs.promises.writeFile(source, "image-bytes")

  const result = await copyFile(
    { directory, output } as never,
    "images/diagram.png" as FilePath,
  )

  assert.ok(result)
  assert.equal(await fs.promises.readFile(result, "utf8"), "image-bytes")
})

test("asset copying keeps destination failures terminal", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "quartz-assets-"))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))

  const directory = path.join(root, "content")
  const output = path.join(root, "blocked-output")
  await fs.promises.mkdir(directory, { recursive: true })
  await fs.promises.writeFile(path.join(directory, "diagram.png"), "image-bytes")
  await fs.promises.writeFile(output, "not-a-directory")

  await assert.rejects(
    copyFile({ directory, output } as never, "diagram.png" as FilePath),
  )
})
