import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import Database from "better-sqlite3";

test("Unicode PDF filenames work for disk, saved edits, ranges, and revalidation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-pdf-response-"));
  const previousContent = process.env.QUARTZ_CONTENT_PATH;
  process.env.QUARTZ_CONTENT_PATH = root;
  const garden = path.join(root, "telecom-1");
  const bytes = Buffer.from("%PDF-1.7\noriginal PDF bytes\n%%EOF");
  fs.mkdirSync(path.join(garden, "assets"), { recursive: true });
  fs.writeFileSync(path.join(garden, "assets", "introduction.pdf"), bytes);
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE pdf_document_edits (
    id INTEGER PRIMARY KEY, cluster_id INTEGER, document_slug TEXT UNIQUE, source_pdf_path TEXT, pdf_data BLOB, updated_at TEXT);
    CREATE TABLE pdf_document_edit_history (cluster_id INTEGER, document_slug TEXT);
    INSERT INTO pdf_document_edit_history VALUES (1, 'telecom-1'), (1, 'telecom-1');`);
  const addEdit = db.prepare("INSERT INTO pdf_document_edits VALUES (NULL,1,?,'/telecom-1/assets/introduction.pdf',?,'2026-09-21T12:00:00Z')");
  globalThis.__sourcePdfResponseTest = db;

  try {
    const lib = path.resolve(import.meta.dirname, "../src/lib");
    const stubs = {
      "next/server": "export const NextResponse = Response;",
      "server-auth": `export const requireReadableClusterFromSlug = async slug => ({cluster: {slug, id: 1}, userId: 7});
        export const requireOwnedClusterFromSlug = requireReadableClusterFromSlug;
        export const routeErrorResponse = error => Response.json({error: error.message}, {status: 500});`,
      "db": "export default globalThis.__sourcePdfResponseTest;",
      "quartz-publish": "export async function publishQuartzAfterMutation() {}",
    };
    const bundle = await build({
      stdin: { contents: `export {GET} from './app/api/documents/[slug]/source-pdf/route';
        export {GET as historyGET} from './app/api/documents/[slug]/source-pdf/history/route';`,
        resolveDir: path.resolve(import.meta.dirname, '../src'), loader: 'ts' },
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
      plugins: [{ name: "pdf-fixture", setup(builder) {
        builder.onResolve({filter: /.*/}, args => {
          const key = stubs[args.path] ? args.path : path.basename(args.path).replace(/\.ts$/, "");
          if (stubs[key]) return {path: key, namespace: "fixture"};
          if (args.path.startsWith("@/lib/")) return {path: path.join(lib, args.path.slice(6) + ".ts")};
        });
        builder.onLoad({filter: /.*/, namespace: "fixture"}, args => ({contents: stubs[args.path], loader: "ts"}));
      }}],
    });
    const module = {exports: {}};
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const get = headers => module.exports.GET(
      new Request("http://localhost/api/documents/introduction/source-pdf?clusterSlug=telecom-1", {headers}),
      {params: Promise.resolve({slug: "introduction"})},
    );

    for (const filename of ["5XTA0 – Introduction.pdf", "通信 📡 résumé.pdf", "O'Brien (notes)*.pdf", "plain.pdf", "Lecture 03 – Signals.PPTX"]) {
      fs.writeFileSync(path.join(garden, "introduction.md"), `---\nsource_file: ${JSON.stringify(filename)}\nsource_pdf: /telecom-1/assets/introduction.pdf\n---\n`);
      for (const source of ["file", "database"]) {
        const expected = source === "file" ? bytes : Buffer.from("%PDF-1.7\nsaved annotation\n%%EOF");
        db.exec("DELETE FROM pdf_document_edits");
        if (source === "database") addEdit.run("introduction", expected);
        const response = await get();
        assert.equal(response.status, 200, response.status === 200 ? undefined : await response.text());
        assert.equal(response.headers.get("x-pdf-source"), source);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
        const disposition = response.headers.get("content-disposition");
        assert.match(disposition, /^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
        assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), filename.replace(/\.pptx$/i, ".pdf"));
        const partial = await get({range: "bytes=0-4"});
        assert.equal(partial.status, 206);
        assert.equal(await partial.text(), "%PDF-");
        assert.equal(partial.headers.get("content-range"), `bytes 0-4/${expected.length}`);
        const cached = await get({"if-none-match": response.headers.get("etag")});
        assert.equal(cached.status, 304);
        const invalid = await get({range: `bytes=${expected.length}-`});
        assert.equal(invalid.status, 416);
      }
    }
    fs.mkdirSync(path.join(garden, 'sources'));
    fs.writeFileSync(path.join(garden, 'sources/telecom-1.md'), '---\nsource_file: Telecom.pdf\nsource_pdf: /telecom-1/assets/introduction.pdf\n---\n');
    const telecom = Buffer.from("%PDF-1.7\ntelecom annotation\n%%EOF");
    addEdit.run("telecom-1", telecom);
    for (const slug of ['telecom-1', 'sources/telecom-1', 'telecom-1/sources/telecom-1', 'garden/telecom-1/sources/telecom-1.md']) {
      const request = new Request('http://localhost/api/documents/'+encodeURIComponent(slug)+'/source-pdf?clusterSlug=telecom-1');
      const params = { params: Promise.resolve({ slug }) };
      const pdf = await module.exports.GET(request, params);
      assert.equal(pdf.status, 200, slug);
      assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), telecom);
      const history = await module.exports.historyGET(request, params);
      assert.equal(history.status, 200, slug);
      assert.deepEqual(await history.json(), { count: 2 });
    }
  } finally {
    if (previousContent === undefined) delete process.env.QUARTZ_CONTENT_PATH;
    else process.env.QUARTZ_CONTENT_PATH = previousContent;
    delete globalThis.__sourcePdfResponseTest;
    db.close();
    fs.rmSync(root, {recursive: true, force: true});
  }
});
