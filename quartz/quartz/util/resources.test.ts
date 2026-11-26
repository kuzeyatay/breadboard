import assert from "node:assert/strict"
import test from "node:test"
import {
  linkSharedResources,
  sharedResourceFiles,
  type CSSResource,
  type JSResource,
} from "./resources"
import { joinSegments } from "./path"

const big = (seed: string) => `${seed};`.repeat(400)
const js: JSResource[] = [
  { loadTime: "afterDOMReady", contentType: "inline", spaPreserve: true, script: big("visual()") },
  { loadTime: "afterDOMReady", contentType: "inline", script: "tiny()" },
  {
    loadTime: "afterDOMReady",
    contentType: "inline",
    moduleType: "module",
    script: big("import('./x.js')"),
  },
  { loadTime: "beforeDOMReady", contentType: "external", src: "https://cdn.example/katex.js" },
]
const css: CSSResource[] = [
  { content: big(".bb-video{margin:0}"), inline: true },
  { content: "https://cdn.example/katex.css" },
  { content: ".x{}", inline: true },
]

test("large inline plugin resources become one shared file each, linked in place and order", () => {
  const files = sharedResourceFiles({ js, css })
  assert.deepEqual(files.map((file) => file.ext).sort(), [".css", ".js"])
  const linked = linkSharedResources({ js, css }, (file) => joinSegments("../..", file))

  // Same positions, load times and persistence; only the big ones changed.
  assert.equal(linked.js.length, js.length)
  assert.deepEqual(linked.js[0], {
    contentType: "external",
    loadTime: "afterDOMReady",
    spaPreserve: true,
    src: `../../${files.find((file) => file.ext === ".js")!.slug}.js`,
  })
  assert.deepEqual(linked.js.slice(1), js.slice(1)) // small, module and external stay as they were
  assert.equal(linked.css[0].inline, undefined)
  assert.equal(
    linked.css[0].content,
    `../../${files.find((file) => file.ext === ".css")!.slug}.css`,
  )
  assert.deepEqual(linked.css.slice(1), css.slice(1))

  // Every link resolves to an emitted file with the exact original bytes.
  const emitted = new Map(files.map((file) => [`${file.slug}${file.ext}`, file.content]))
  assert.equal(
    emitted.get((linked.js[0] as { src: string }).src.replace("../../", "")),
    js[0].contentType === "inline" ? js[0].script : "",
  )
  assert.equal(emitted.get(linked.css[0].content.replace("../../", "")), css[0].content)
})

test("every page at every depth links the same shared files", () => {
  // pageResources joins each page's path-to-root exactly like this.
  const at = (root: string) => linkSharedResources({ js, css }, (file) => joinSegments(root, file))
  const shallow = at("."),
    deep = at("../../..")
  const shared = (page: ReturnType<typeof at>) =>
    page.js.flatMap((r) =>
      r.contentType === "external" && r.src.includes("static/shared/") ? [r.src] : [],
    )
  assert.equal(shared(shallow).length, 1)
  assert.equal(shared(shallow)[0].replace(/^\.\//, ""), shared(deep)[0].replace("../../../", ""))
  for (const page of [shallow, deep]) {
    assert.ok(
      !page.js.some(
        (r) => r.contentType === "inline" && r.script === (js[0] as { script: string }).script,
      ),
    )
    assert.ok(!page.css.some((r) => r.inline && r.content === css[0].content))
  }
})

test("identical content is emitted once, different content gets different names", () => {
  const twice = sharedResourceFiles({ js: [js[0], js[0]], css: [] })
  assert.equal(twice.length, 1)
  const other = sharedResourceFiles({
    js: [{ ...js[0], script: big("other()") } as JSResource],
    css: [],
  })
  assert.notEqual(other[0].slug, twice[0].slug)
})
