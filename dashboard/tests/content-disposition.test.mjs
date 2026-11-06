import assert from "node:assert/strict";
import test from "node:test";
import { contentDisposition } from "../src/lib/content-disposition.ts";

test("Unicode names have a safe ASCII fallback and retain their UTF-8 filename", () => {
  for (const name of ["5XTA0 – Introduction.pdf", "通信 📡 résumé.pdf", "O'Brien (notes)*.pdf"]) {
    const value = contentDisposition(name);
    assert.equal(new Headers({"Content-Disposition": value}).get("Content-Disposition"), value);
    assert.match(value, /^[\x20-\x7e]+$/);
    const encoded = value.split("filename*=UTF-8''")[1];
    assert.doesNotMatch(encoded, /[!'()*]/);
    assert.equal(decodeURIComponent(encoded), name);
  }
});

test("quotes, backslashes, control characters and malformed Unicode cannot break the header", () => {
  const value = contentDisposition('a"b\\c\r\n\0\x7f\ud800.pdf', "attachment");
  assert.match(value, /^attachment; filename="a_b_c_+\.pdf";/);
  assert.doesNotThrow(() => new Response(null, {headers: {"Content-Disposition": value}}));
  assert.equal(contentDisposition(""), `inline; filename="document"; filename*=UTF-8''document`);
});
