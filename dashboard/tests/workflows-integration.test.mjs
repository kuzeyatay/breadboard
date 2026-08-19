import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
const exists = (relativePath) => fs.existsSync(new URL(relativePath, import.meta.url));

test("the Skills hub lists the user's own workflows and can create one", () => {
  const hub = source("../src/app/components/hermes/command-hub.tsx");
  const panel = source("../src/app/components/hermes/workflow-templates-panel.tsx");
  assert.match(hub, /\{ id: "workflow", label: "Workflows" \}/);
  assert.match(hub, /<WorkflowTemplatesPanel/);
  // The list is the user's own saved workflows, not a public template library.
  assert.match(panel, /\/api\/workflows\/local/);
  assert.doesNotMatch(panel, /api\.n8n\.io/);
  assert.doesNotMatch(panel, /\/api\/workflows\/templates/);
});

test("saved automations execute through the authenticated backend and become chat turns", () => {
  const listRoute = source("../src/app/api/workflows/local/route.ts");
  const runRoute = source("../src/app/api/workflows/local/[workflowId]/run/route.ts");
  const composer = source("../src/app/components/assistant-composer.tsx");
  const hook = source("../src/app/components/hermes/use-workflow-automation.ts");
  const sessionHook = source("../src/app/components/hermes/use-agent-session.ts");
  const dashboard = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("../src/app/components/hermes/garden-agent-chat.tsx");
  const workspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(listRoute, /requireUserId/);
  assert.match(listRoute, /listWorkflows/);
  assert.match(runRoute, /requireUserId/);
  assert.match(runRoute, /runWorkflowById/);
  // The chat-facing surfaces are engine-agnostic and must keep working.
  assert.match(composer, /onRunWorkflow\(workflow, workflowInput\)/);
  assert.match(hook, /previewExternalAgentTurn\(\{ clientMessageId, userContent \}\)/);
  assert.doesNotMatch(hook, /Running \$\{workflow\.name\}/);
  assert.match(sessionHook, /external-thinking-\$\{input\.clientMessageId\}/);
  assert.match(sessionHook, /setConnection\("streaming"\)/);
  assert.match(hook, /appendExternalAgentTurn/);
  assert.match(hook, /Open automation settings/);
  assert.match(dashboard, /onRunWorkflow=\{runWorkflowAutomation\}/);
  assert.match(garden, /onRunWorkflow=\{runWorkflowAutomation\}/);
  assert.match(workspace, /onRunWorkflow=\{runWorkflowAutomation\}/);
});

test("workflows are stored by Breadboard itself, not a supervised service", () => {
  const schema = source("../src/lib/workflows/schema.ts");
  const store = source("../src/lib/workflows/store.ts");
  const db = source("../src/lib/db.ts");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS workflows/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS workflow_runs/);
  // A run belongs to a workflow; deleting the workflow must not strand history.
  assert.match(schema, /REFERENCES workflows\(id\) ON DELETE CASCADE/);
  assert.match(db, /ensureWorkflowSchema\(db\)/);
  // The list contract the chat palette and super-agent inventory both read.
  assert.match(store, /nodeCount/);
  assert.match(store, /active: true/);
});

test("the canvas persists and runs through owner-scoped routes", () => {
  const detailRoute = source("../src/app/api/workflows/[id]/route.ts");
  const executeRoute = source("../src/app/api/workflows/[id]/execute/route.ts");
  const persistence = source("../src/app/workflows/hooks/use-workflow-persistence.ts");
  const drawer = source("../src/app/workflows/components/run-drawer.tsx");
  for (const route of [detailRoute, executeRoute]) {
    assert.match(route, /requireUserId/);
  }
  assert.match(detailRoute, /export async function (GET|PUT|DELETE)/);
  assert.match(executeRoute, /runWorkflowById/);
  assert.match(executeRoute, /triggerKind: "manual"/);
  // Saving is debounced so a keystroke does not write on every character.
  assert.match(persistence, /SAVE_DEBOUNCE_MS/);
  assert.match(persistence, /method: "PUT"/);
  assert.match(drawer, /\/execute/);
});

test("the agent runs a workflow through the capability-gated tool with an audit trail", () => {
  const toolRoute = source("../src/app/api/hermes/tools/workflow/route.ts");
  const superAgent = source("../src/lib/hermes/super-agent.ts");
  assert.match(toolRoute, /verifyCapabilityToken/);
  assert.match(toolRoute, /getActiveCapabilityDecision/);
  assert.match(toolRoute, /runWorkflowById/);
  // The Evidence panel folds these exact event names into its capability trail.
  assert.match(toolRoute, /workflow\.run_started/);
  assert.match(toolRoute, /workflow\.run_completed/);
  assert.match(toolRoute, /workflow\.run_failed/);
  // The inventory reads the database directly, so a turn never depends on a service.
  assert.match(superAgent, /listWorkflows\(userId\)/);
  assert.match(superAgent, /workflow_run/);
});

test("the workflows page is a native canvas, not an embedded third-party editor", () => {
  const client = source("../src/app/workflows/workflows-client.tsx");
  const editor = source("../src/app/workflows/components/canvas-editor.tsx");
  const navigation = source("../src/lib/workflows/navigation.ts");
  assert.doesNotMatch(client, /<iframe/);
  assert.match(client, /CanvasEditor/);
  assert.match(editor, /ReactFlow/);
  assert.match(navigation, /window\.sessionStorage\.setItem\(WORKFLOWS_RETURN_PATH_KEY, returnPath\)/);
});

test("leaving the workflows page cannot restore a click-blocking capability overlay", () => {
  const hub = source("../src/app/components/hermes/command-hub.tsx");
  const panel = source("../src/app/components/hermes/workflow-templates-panel.tsx");
  const markdown = source("../src/app/components/chat-markdown.tsx");
  assert.match(panel, /onNavigate\?: \(\) => void/);
  assert.match(panel, /rememberWorkflowReturnPath\(\)/);
  assert.match(hub, /onNavigate=\{\(\) => onOpenChange\(false\)\}/);
  assert.match(markdown, /target=\{isWorkflowLink \? undefined : '_blank'\}/);
  assert.match(markdown, /rememberWorkflowReturnPath\(\)/);
});

test("no n8n service, client, or checkout remains", () => {
  for (const dead of [
    "../src/lib/workflows/n8n.ts",
    "../src/lib/workflows/execution.ts",
    "../src/lib/workflows/template-safety.ts",
    "../src/app/api/workflows/session/route.ts",
    "../src/app/api/workflows/status/route.ts",
    "../src/app/api/workflows/templates/route.ts",
    "../src/app/api/workflows/import/route.ts",
    "../../scripts/start-n8n.mjs",
    "../../n8n",
  ]) {
    assert.equal(exists(dead), false, `${dead} should have been removed`);
  }
  const devAll = source("../../scripts/dev-all.mjs");
  const services = source("../../desktop/src/main/service-definitions.ts");
  const packager = source("../../desktop/scripts/prepare-app-resources.mjs");
  assert.doesNotMatch(devAll, /N8N_|start-n8n/);
  assert.doesNotMatch(services, /n8n|N8N_/i);
  assert.doesNotMatch(packager, /n8n-runtime|start-n8n/);
});
