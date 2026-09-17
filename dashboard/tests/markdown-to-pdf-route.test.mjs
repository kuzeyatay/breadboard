import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const state = globalThis.__markdownPdfRouteTest = {};
const modules = {
  "@/lib/runtime-paths": `
    export const dashboardDataDir = () => globalThis.__markdownPdfRouteTest.root;
  `,
  "@/lib/server-auth": `
    export const requireUserId = async () => 17;
    export const requireReadableCluster = (_userId, slug) => ({ slug });
    export const routeErrorResponse = error => Response.json({ error: error.message }, { status: 500 });
  `,
  "@/lib/office/runtime-v2": `
    export const renderMarkdownPdfDownloadViaRuntime = async (scope, input) => {
      const state = globalThis.__markdownPdfRouteTest;
      state.calls.push({ scope, input });
      return {
        filePath: state.source,
        cleanup: () => { state.cleanups++; },
      };
    };
  `,
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (modules[specifier]) {
      return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { POST } = await import("../src/app/api/markdown-to-pdf/route.ts");
hooks.deregister();

const pdfBytes = Buffer.from("%PDF-1.7\nexport fixture\n%%EOF\n");
const selectedNotes = {
  clusterSlug: "electromagnetism",
  title: "Selected notes",
  documents: [
    { title: "Second note", content: "---\ntitle: Second note\n---\n# Second\nSelected first." },
    { title: "First note", content: "# First\nSelected second." },
  ],
};
const request = (body = selectedNotes) => new Request("http://localhost/api/markdown-to-pdf", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-markdown-pdf-"));
  Object.assign(state, { root, source: path.join(root, "staged.pdf"), calls: [], cleanups: 0 });
  fs.writeFileSync(state.source, pdfBytes);
  t.after(() => {
    assert.ok(path.basename(root).startsWith("breadboard-markdown-pdf-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return path.join(root, "exports", "markdown-pdf", "user-17");
}

function mockFileSync(t, sync) {
  const open = fs.openSync;
  const handles = new Map();
  t.mock.method(fs, "openSync", (file, flags, ...args) => {
    const descriptor = open(file, flags, ...args);
    handles.set(descriptor, { flags, isFile: fs.fstatSync(descriptor).isFile() });
    return descriptor;
  });
  const originalSync = fs.fsyncSync;
  t.mock.method(fs, "fsyncSync", (descriptor) => {
    if (handles.get(descriptor)?.isFile) sync(handles.get(descriptor).flags);
    return originalSync(descriptor);
  });
}

test("selected PDF exports work with Windows flush permissions and can be downloaded again", async (t) => {
  const exports = fixture(t);
  // Enforce the Windows requirement on every platform, then use the real fsync.
  mockFileSync(t, (flags) => {
    if (flags === "r") {
      throw Object.assign(new Error("EPERM: operation not permitted, fsync"), { code: "EPERM" });
    }
  });
  const response = await POST(request());
  assert.equal(response.status, 200, response.status === 200 ? "" : await response.text());
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="selected-notes.pdf"');
  assert.equal(response.headers.get("Content-Length"), String(pdfBytes.length));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdfBytes);
  assert.deepEqual(state.calls[0], {
    scope: { userId: 17, gardenId: "electromagnetism", conversationId: null },
    input: {
      title: "Selected notes",
      filename: "selected-notes.pdf",
      documents: [
        { title: "Second note", content: "# Second\nSelected first." },
        selectedNotes.documents[1],
      ],
    },
  });
  assert.equal(state.cleanups, 1);
  assert.equal(fs.readdirSync(exports).length, 1);
  fs.unlinkSync(state.source);

  const repeated = await POST(request());
  assert.equal(repeated.status, 200);
  assert.deepEqual(Buffer.from(await repeated.arrayBuffer()), pdfBytes);
  assert.equal(state.calls.length, 1, "the completed export survives worker staging cleanup");
});

test("a real disk flush failure is reported and leaves no partial PDF download", async (t) => {
  const exports = fixture(t);
  mockFileSync(t, () => {
    throw Object.assign(new Error("PDF disk flush failed"), { code: "EIO" });
  });
  const response = await POST(request());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "PDF disk flush failed" });
  assert.equal(state.cleanups, 1);
  assert.deepEqual(fs.readdirSync(exports), []);
});
