import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BROKERED_TOOLS } from "../src/lib/hermes/capability-broker.ts";
import {
  DOCUMENT_TOOLS,
  DOCUMENT_WRITE_TOOLS,
  allowedToolsForSurface,
} from "../src/lib/hermes/tool-scopes.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("document editing tools are registered, brokered, and absent from Quartz", () => {
  assert.deepEqual([...DOCUMENT_TOOLS].sort(), ["document_edit", "pdf_to_docx"]);
  assert.deepEqual([...DOCUMENT_WRITE_TOOLS].sort(), ["document_edit", "pdf_to_docx"]);
  for (const tool of DOCUMENT_TOOLS) {
    assert.ok(BROKERED_TOOLS.includes(tool), `${tool} should be brokered`);
    assert.ok(allowedToolsForSurface("garden_chat").includes(tool));
    assert.ok(allowedToolsForSurface("dashboard_terminal").includes(tool));
    assert.ok(!allowedToolsForSurface("quartz_ai").includes(tool));
  }

  const manifest = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "plugin.yaml"),
    "utf8",
  );
  const plugin = fs.readFileSync(
    path.join(repoRoot, "hermes-agent", "plugins", "breadboard", "__init__.py"),
    "utf8",
  );
  for (const tool of DOCUMENT_TOOLS) {
    assert.match(manifest, new RegExp(`^\\s*- ${tool}$`, "m"));
    assert.ok(plugin.includes(`"${tool}"`), `${tool} should be declared in the plugin`);
  }
  assert.match(plugin, /route_kind in \{[^}]*"document"[^}]*\}/);
  assert.match(plugin, /_DOCUMENT_REQUEST_TIMEOUT_SECONDS = 200/);
  assert.ok(
    fs.existsSync(
      path.join(repoRoot, "dashboard", "src", "app", "api", "hermes", "tools", "document", "route.ts"),
    ),
  );
});
