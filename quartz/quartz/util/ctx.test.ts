import assert from "node:assert/strict"
import test from "node:test"
import { trieFromAllFiles } from "./ctx"
import type { QuartzPluginData } from "../plugins/vfile"

test("navigation metadata preserves spilled HTML lazily instead of loading the library", () => {
  let treeReads = 0
  const tree = { type: "root", children: [] }
  const files = Array.from({ length: 1000 }, (_, index) => {
    const file = {
      slug: `garden/page-${index}`,
      filePath: `garden/page-${index}.md`,
      frontmatter: { title: `Page ${index}`, tags: ["circuits"] },
      dates: { created: new Date(0), modified: new Date(1), published: new Date(2) },
    } as QuartzPluginData
    Object.defineProperty(file, "htmlAst", {
      enumerable: true,
      configurable: true,
      get() { treeReads++; return tree },
    })
    return file
  })
  const trie = trieFromAllFiles(files)
  assert.equal(treeReads, 0, "building navigation must not hydrate any page trees")
  const node = trie.findNode(["garden", "page-42"])!
  assert.equal(node.displayName, "Page 42")
  assert.equal(node.data?.filePath, "garden/page-42.md")
  assert.equal(node.data?.dates, files[42].dates)
  assert.equal(node.data?.frontmatter, files[42].frontmatter)
  assert.equal(node.data?.htmlAst, tree)
  assert.equal(treeReads, 1, "a tree remains available when explicitly requested")
  assert.equal(files[42].htmlAst, tree)
  assert.equal(treeReads, 2, "the source metadata keeps its original lazy accessor")
})
