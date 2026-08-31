import assert from "node:assert/strict"
import test from "node:test"
import type { ContentDetails } from "../plugins/emitters/contentIndex"
import { FileTrieNode } from "./fileTrie"
import {
  gardenClusterFoldersFromJson,
  groupGardenExplorerNodes,
  isVirtualGardenClusterNode,
} from "./gardenExplorerGroups"
import type { FilePath, FullSlug } from "./path"

function details(slug: string, title: string): ContentDetails {
  return {
    slug: slug as FullSlug,
    filePath: `${slug}.md` as FilePath,
    title,
    links: [],
    tags: [],
    content: "",
  }
}

test("Garden cluster metadata preserves empty positions for ungrouped Gardens", () => {
  assert.deepEqual(gardenClusterFoldersFromJson('["", "EE Year 1", ""]'), ["", "EE Year 1", ""])
})

test("Garden Explorer nests grouped Gardens and leaves only ungrouped Gardens at root", () => {
  const files = [
    details("breadboard-dev/index", "breadboard-dev"),
    details("communication-1/index", "Communication 1"),
    details("computer-architecture/index", "Computer Architecture"),
    details("signals/index", "Signals and systems"),
  ]
  const trie = FileTrieNode.fromEntries(files.map((file) => [file.slug, file]))

  groupGardenExplorerNodes(
    trie,
    ["breadboard-dev", "communication-1", "computer-architecture", "signals"],
    ["", "EE Year 1", "EE Year 1", "EE Year 2/Signals"],
  )

  assert.deepEqual(
    trie.children
      .filter((node) => !isVirtualGardenClusterNode(node))
      .map((node) => node.slugSegment),
    ["breadboard-dev"],
  )

  const yearOne = trie.children.find((node) => node.displayName === "EE Year 1")
  assert.ok(yearOne && isVirtualGardenClusterNode(yearOne))
  assert.deepEqual(
    yearOne.children.map((node) => node.slugSegment),
    ["communication-1", "computer-architecture"],
  )

  const yearTwo = trie.children.find((node) => node.displayName === "EE Year 2")
  const signals = yearTwo?.children.find((node) => node.displayName === "Signals")
  assert.ok(signals && isVirtualGardenClusterNode(signals))
  assert.deepEqual(
    signals.children.map((node) => node.slugSegment),
    ["signals"],
  )
  assert.equal(signals.children[0].slug, "signals/index")
})
