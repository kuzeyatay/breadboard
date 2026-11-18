import assert from "node:assert/strict"
import test from "node:test"
import { sourceDocumentTarget } from "./sourceDocumentTarget"

test("each source kind opens in its Breadboard viewer or website", () => {
  const slug = "em-1/sources/lecture 6"
  assert.deepEqual(sourceDocumentTarget(slug, { source_pdf: "/em-1/assets/x-source.pdf" }), {
    path: "/gardens/em-1/pdf/lecture%206",
  })
  assert.deepEqual(sourceDocumentTarget(slug, { source_media: "/em-1/assets/a.mp3", source_type: "audio", original_filename: "A.mp3" }), {
    path: "/audio?src=%2Fapi%2Fgardens%2Fem-1%2Fmedia%2Flecture%25206&name=A.mp3",
  })
  assert.match((sourceDocumentTarget(slug, { source_media: "/em-1/assets/v.mp4" }) as { path: string }).path, /^\/video\?/)
  assert.match((sourceDocumentTarget(slug, { source_media: "/em-1/assets/a.m4a" }) as { path: string }).path, /^\/audio\?/)
  assert.deepEqual(sourceDocumentTarget(slug, { original_url: "https://example.com/a" }), { url: "https://example.com/a" })
  assert.equal(sourceDocumentTarget(slug, { original_url: "javascript:alert(1)" }), null)
  assert.equal(sourceDocumentTarget(slug, { title: "Plain note" }), null)
  assert.equal(sourceDocumentTarget("index", { source_pdf: "/x.pdf" }), null)
})
