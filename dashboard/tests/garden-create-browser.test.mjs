import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const filename = path.join(root, "src/app/dashboard/dashboard-client.tsx");
const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const overrides = {
  useRouter: `() => ({refresh() {window.refreshes++;}})`,
  useToast: `() => ({toasts:[], centerNotifications:[], addToast(){}})`,
  usePageAppearance: `() => ({ready:true, theme:'dark', rainMode:'off'})`,
  useVlmOcrAvailability: `() => ({status:{available:false}, loading:false})`,
  useAnydocAvailability: `() => ({status:{available:false}, loading:false})`,
  runtimeIngestRecoveries: `() => []`,
};
// Render the real dashboard, with unrelated media, terminal and server actions
// replaced at their module boundaries. The form, request and card tree are real.
const stubs = {};
for (const statement of source.statements) {
  if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
  const specifier = statement.moduleSpecifier.text;
  if (specifier === "react" || specifier === "@/lib/cluster-folders") continue;
  let stub = "";
  if (statement.importClause.name) {
    stub += specifier.endsWith(".css") ? "export default {};\n"
      : specifier === "next/link" ? "import React from 'react'; export default ({children,href}) => <a href={href}>{children}</a>;\n"
      : "export default ({children}) => children ?? null;\n";
  }
  const bindings = statement.importClause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const name = (element.propertyName ?? element.name).text;
      stub += `export const ${name} = ${overrides[name] ?? "({children} = {}) => children ?? null"};\n`;
    }
  }
  stubs[specifier] = stub;
}

test("new gardens appear immediately in their cluster, with duplicate submission protection and retry", { timeout: 30_000 }, async t => {
  const bundle = await build({
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.join(root, "src") },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import DashboardClient from '@/app/dashboard/dashboard-client';
      window.refreshes = 0;
      createRoot(document.getElementById('root')).render(<DashboardClient
        userEmail='garden-test@example.test' username='Test' initialClusters={[]}
        initialPublicClusters={[]} initialOrganizationClusters={[]}
        organizations={[]} initialClusterFolders={['EE year 2', 'EE year 2/Semester 1']}
        navbarShortcuts={[]} showNavbarFlowers={false} />);
    ` },
    plugins: [{ name: "garden-form-fixture", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => stubs[args.path] === undefined ? undefined : { path: args.path, namespace: "fixture" });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "tsx", resolveDir: root }));
    } }],
  });
  const executablePath = [chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const requests = [];
  let pendingRoute;
  await page.route("http://garden.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.route("**/api/clusters", route => {
    requests.push(route.request().postDataJSON());
    pendingRoute = route;
  });
  await page.goto("http://garden.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const dialog = page.locator(".bb-modal-panel");
  await page.getByRole("button", { name: "New garden inside EE year 2", exact: true }).click();
  await dialog.getByPlaceholder("My garden").fill("Neuro Comp");
  await dialog.getByPlaceholder("What's this garden about?").fill("Signals and learning");
  // Two submissions in one event turn must still produce only one write.
  await dialog.locator("form").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await dialog.getByRole("button", { name: "Creating...", exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
  assert.deepEqual(requests, [{ name: "Neuro Comp", description: "Signals and learning", folder: "EE year 2" }]);
  const cluster = { id: 51, user_id: 7, name: "Neuro Comp", slug: "neuro-comp", description: "Signals and learning",
    folder: "EE year 2", visibility: "private", organization_id: null, border_color: "#a9c1b1",
    card_width: 392, card_height: 244, chat_accessible: false, fork_allowed: false,
    view_count: 0, last_viewed_at: null, created_at: "2026-11-08", noteCount: 0,
    isOwner: true, repo_connected: false, repo_name: null, graft_enabled: true, thought_topology_enabled: true };
  const started = performance.now();
  await pendingRoute.fulfill({ status: 201, json: { slug: cluster.slug, cluster } });
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("Neuro Comp", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.refreshes), 0);
  t.diagnostic(`Saved card visible ${(performance.now() - started).toFixed(1)} ms after response, without dashboard refresh`);

  await page.getByRole("button", { name: "New garden inside Semester 1", exact: true }).click();
  await dialog.getByPlaceholder("My garden").fill("Retry garden");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await dialog.getByRole("button", { name: "Creating...", exact: true }).waitFor();
  assert.equal(requests.length, 2);
  await pendingRoute.fulfill({ status: 500, json: { error: "Couldn't save the garden. Try again." } });
  await dialog.getByText("Couldn't save the garden. Try again.").waitFor();
  assert.equal(await dialog.getByPlaceholder("My garden").inputValue(), "Retry garden");
  assert.equal(await dialog.getByRole("button", { name: "Create", exact: true }).isEnabled(), true);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await dialog.getByRole("button", { name: "Creating...", exact: true }).waitFor();
  assert.equal(requests.length, 3);
  assert.equal(requests[2].folder, "EE year 2/Semester 1");
  await pendingRoute.fulfill({ status: 201, json: { cluster: { ...cluster, id: 52, slug: "retry-garden", name: "Retry garden", folder: "EE year 2/Semester 1" } } });
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("Retry garden", { exact: true }).waitFor();
  await page.getByText("Neuro Comp", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.refreshes), 0);
  assert.deepEqual(errors, []);
});
