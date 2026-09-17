import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { tabLabel } from "../src/lib/desktop-browser-tabs.ts";

function loadPage(route, state) {
  const filename = new URL(`../src/app/${route}/[clusterSlug]/page.tsx`, import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const cluster = () => ({ name: state.name, isOwner: state.owner, chat_accessible: state.chat });
  const modules = {
    react: { cache: (read) => read },
    "next-auth/next": { getServerSession: async () => state.signedIn ? { user: { id: "1" } } : null },
    "next/navigation": {
      redirect: (url) => { throw new Error(`redirect:${url}`); },
      notFound: () => { throw new Error("not-found"); },
    },
    "@/app/actions/clusters": {
      getCluster: async () => state.owner ? cluster() : undefined,
      getReadableCluster: async () => state.readable ? cluster() : undefined,
    },
    "@/lib/db": {
      prepare: () => ({ get: () => state.readable && state.chat ? cluster() : undefined }),
    },
    "@/lib/organizations/store": { organizationClusterClause: () => "0" },
  };
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (id) => modules[id] ?? {},
  }, { filename: filename.pathname });
  return exports.generateMetadata;
}

for (const route of ["garden", "gardens"]) {
  test(`${route} tab metadata uses the saved name while retaining the original URL`, async () => {
    const state = { signedIn: true, owner: true, readable: true, chat: true, name: "EM 1" };
    const metadata = loadPage(route, state);
    const params = Promise.resolve({ clusterSlug: "electromagnetism-1" });
    const url = `http://localhost:3000/${route}/electromagnetism-1`;
    assert.equal(tabLabel((await metadata({ params })).title, url), "EM 1");
    state.name = "EM1";
    assert.equal(tabLabel((await metadata({ params })).title, url), "EM1");
  });

  test(`${route} metadata enforces the page's access rules`, async () => {
    const state = { signedIn: false, owner: false, readable: false, chat: false, name: "Private garden" };
    const metadata = loadPage(route, state);
    const params = Promise.resolve({ clusterSlug: "electromagnetism-1" });
    await assert.rejects(metadata({ params }), /redirect:\/auth\/login/);
    state.signedIn = true;
    await assert.rejects(metadata({ params }), /not-found/);
    state.readable = true;
    if (route === "gardens") {
      await assert.rejects(metadata({ params }), /not-found/);
      state.chat = true;
    }
    assert.equal((await metadata({ params })).title, state.name);
  });
}
