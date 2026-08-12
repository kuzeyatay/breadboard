import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isFreeTemplateListing,
  normalizeTemplateSearchPayload,
  templateDetailIdentity,
  validateTemplateWorkflow,
} from "../src/lib/workflows/template-safety.ts";

const source = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("the Skills hub has a searchable public Workflows library and creation entry point", () => {
  const hub = source("../src/app/components/hermes/command-hub.tsx");
  const panel = source("../src/app/components/hermes/workflow-templates-panel.tsx");
  assert.match(hub, /\{ id: "workflow", label: "Workflows" \}/);
  assert.match(hub, /<WorkflowTemplatesPanel/);
  assert.match(panel, /Search public workflows/);
  assert.match(panel, /\/api\/workflows\/templates/);
  assert.match(panel, /Create automation/);
  assert.match(panel, /\/workflows\?mode=new/);
  assert.match(panel, /\/workflows\?template=/);
  assert.match(panel, /Free templates from n8n&apos;s public community library/);
  assert.match(panel, /My automations/);
  assert.match(panel, /\/api\/workflows\/local/);
  assert.match(panel, /response\.status === 502 \|\| response\.status === 503/);
  assert.match(panel, /setLocalReload/);
  assert.match(panel, /Run in chat/);
  assert.match(panel, /Open settings for/);
  assert.match(panel, /\/workflows\?workflow=/);
});

test("saved automations execute through the authenticated backend and become chat turns", () => {
  const listRoute = source("../src/app/api/workflows/local/route.ts");
  const runRoute = source("../src/app/api/workflows/local/[workflowId]/run/route.ts");
  const execution = source("../src/lib/workflows/execution.ts");
  const composer = source("../src/app/components/assistant-composer.tsx");
  const hook = source("../src/app/components/hermes/use-workflow-automation.ts");
  const sessionHook = source("../src/app/components/hermes/use-agent-session.ts");
  const dashboard = source("../src/app/components/hermes/dashboard-agent-terminal.tsx");
  const garden = source("../src/app/components/hermes/garden-agent-chat.tsx");
  const workspace = source("../src/app/gardens/[clusterSlug]/workspace-client.tsx");
  assert.match(listRoute, /requireUserId/);
  assert.match(listRoute, /ensureN8nSession/);
  assert.match(runRoute, /runLocalWorkflow/);
  assert.match(execution, /\/rest\/workflows\/\$\{encodeURIComponent\(summary\.id\)\}\/run/);
  assert.match(execution, /\/rest\/executions\//);
  assert.match(execution, /breadboard-chat/);
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

test("Breadboard opens embedded n8n without a second user-visible login", () => {
  const server = source("../src/lib/workflows/n8n.ts");
  const session = source("../src/app/api/workflows/session/route.ts");
  const client = source("../src/app/workflows/workflows-client.tsx");
  assert.match(server, /Do not bind the token to Breadboard's server-side requests/);
  assert.doesNotMatch(server, /"browser-id": "breadboard"/);
  assert.match(server, /HttpOnly; SameSite=Lax/);
  assert.match(session, /forwardN8nCookie\(response, session\)/);
  assert.match(client, /await fetch\("\/api\/workflows\/session", \{ method: "POST" \}\)/);
  assert.doesNotMatch(client, /password|emailOrLdapLoginId/);
});

test("the dedicated page embeds the local editor with back and workspace controls", () => {
  const page = source("../src/app/workflows/page.tsx");
  const client = source("../src/app/workflows/workflows-client.tsx");
  const navigation = source("../src/lib/workflows/navigation.ts");
  const proxy = source("../src/proxy.ts");
  assert.match(page, /getServerSession/);
  assert.match(page, /redirect\("\/auth\/login/);
  assert.match(client, /onClick=\{leaveWorkflows\}/);
  assert.match(navigation, /breadboard:workflows:return-path/);
  assert.doesNotMatch(client, /router\.back\(\)/);
  assert.match(client, /router\.replace\(returnPath \?\? "\/dashboard", \{ scroll: false \}\)/);
  assert.match(client, /<iframe/);
  assert.match(client, /clipboard-read; clipboard-write/);
  // One Garden-Chat-style navbar carries the back control and the page name;
  // workflow actions belong to the embedded editor, not to a second header.
  assert.match(client, /breadboard-flower-navbar/);
  assert.match(client, /<NavbarFlowerWind \/>/);
  assert.match(client, /peekWorkflowReturnPath\(\)/);
  assert.match(navigation, /export function peekWorkflowReturnPath/);
  assert.doesNotMatch(client, /<NavBar/);
  assert.doesNotMatch(client, /My workflows|Create automation/);
  assert.doesNotMatch(client, /Open separately|ExternalIcon/);
  assert.match(client, /\/api\/workflows\/session/);
  assert.match(client, /`\/templates\/\$\{encodeURIComponent\(templateId\)\}`/);
  assert.doesNotMatch(client, /\/api\/workflows\/import/);
  assert.match(proxy, /'\/workflows\/:path\*'/);
});

test("leaving the embedded editor cannot restore a click-blocking capability overlay", () => {
  const hub = source("../src/app/components/hermes/command-hub.tsx");
  const panel = source("../src/app/components/hermes/workflow-templates-panel.tsx");
  const markdown = source("../src/app/components/chat-markdown.tsx");
  const navigation = source("../src/lib/workflows/navigation.ts");
  assert.match(panel, /onNavigate\?: \(\) => void/);
  assert.match(panel, /rememberWorkflowReturnPath\(\)/);
  assert.match(panel, /onClick=\{prepareWorkflowNavigation\}/);
  assert.match(hub, /onNavigate=\{\(\) => onOpenChange\(false\)\}/);
  assert.match(markdown, /target=\{isWorkflowLink \? undefined : '_blank'\}/);
  assert.match(markdown, /rememberWorkflowReturnPath\(\)/);
  assert.match(navigation, /window\.sessionStorage\.setItem\(WORKFLOWS_RETURN_PATH_KEY, returnPath\)/);
});

test("public template listings are trimmed, free-only, and safe for the browser", () => {
  const payload = normalizeTemplateSearchPayload({
    totalWorkflows: 2,
    workflows: [
      {
        id: 12,
        name: "  Gmail daily digest  ",
        description: "Line one\n\nline two",
        price: 0,
        purchaseUrl: null,
        totalViews: 1200,
        user: { name: "Maker", verified: true, bio: "must not escape" },
        nodes: [
          { displayName: "Gmail", iconData: "large private-ish payload" },
          { displayName: "OpenAI" },
        ],
      },
      { id: 13, name: "Paid", price: 19, purchaseUrl: "https://pay.example" },
    ],
  });
  assert.equal(payload.workflows.length, 1);
  assert.deepEqual(payload.workflows[0].nodeNames, ["Gmail", "OpenAI"]);
  assert.equal(payload.workflows[0].description, "Line one line two");
  assert.ok(!JSON.stringify(payload).includes("iconData"));
  assert.ok(!JSON.stringify(payload).includes("bio"));
  assert.equal(isFreeTemplateListing({ price: 0, purchaseUrl: null }), true);
  assert.equal(isFreeTemplateListing({ price: 0, purchaseUrl: "https://pay.example" }), false);
  assert.equal(isFreeTemplateListing({ price: 10, purchaseUrl: null }), false);
});

test("imports verify identity and remove any template credentials", () => {
  assert.deepEqual(templateDetailIdentity({ workflow: { id: 42, name: "A workflow" } }), {
    id: 42,
    name: "A workflow",
  });
  const safe = validateTemplateWorkflow({
    id: 42,
    name: "A workflow",
    workflow: {
      nodes: [{ name: "Gmail", type: "n8n-nodes-base.gmail", credentials: { gmailOAuth2: { id: "secret" } } }],
      connections: {},
      settings: { executionOrder: "v1" },
    },
  }, 42);
  assert.equal("credentials" in safe.nodes[0], false);
  assert.equal(safe.settings.executionOrder, "v1");
  assert.throws(() => validateTemplateWorkflow({ id: 41, name: "Wrong", workflow: { nodes: [], connections: {} } }, 42));
});

test("template and import APIs stay server-side and block paid-template bypasses", () => {
  const templates = source("../src/app/api/workflows/templates/route.ts");
  const importer = source("../src/app/api/workflows/import/route.ts");
  const server = source("../src/lib/workflows/n8n.ts");
  const safety = source("../src/lib/workflows/template-safety.ts");
  assert.match(templates, /requireUserId/);
  assert.match(importer, /assertFreeTemplate/);
  assert.match(importer, /Paid n8n templates must be purchased/);
  assert.match(importer, /templates\/search/);
  assert.match(safety, /delete safe\.credentials/);
  assert.match(server, /https:\/\/api\.n8n\.io\/api\//);
  assert.match(server, /\["127\.0\.0\.1", "localhost"\]/);
  assert.match(server, /N8N_CREDENTIALS_PATH/);
  assert.doesNotMatch(source("../src/app/components/hermes/workflow-templates-panel.tsx"), /api\.n8n\.io/);
});

test("startup supervises n8n and restricts embedding to Breadboard", () => {
  const launcher = source("../../scripts/start-n8n.mjs");
  const dev = source("../../scripts/dev-all.mjs");
  const n8nServer = source("../../n8n/packages/cli/src/server.ts");
  assert.match(launcher, /corepack/);
  assert.match(launcher, /corepack\.js/);
  assert.match(launcher, /\[corepackCli, \.\.\.args\]/);
  assert.match(launcher, /shell: false/);
  assert.doesNotMatch(launcher, /shell: process\.platform === "win32"/);
  assert.match(launcher, /BREADBOARD_DESKTOP_PID/);
  assert.match(launcher, /process\.kill\(desktopPid, 0\)/);
  assert.match(launcher, /Setup started/);
  assert.match(launcher, /could not finish its first-time setup/);
  assert.match(launcher, /N8N_LISTEN_ADDRESS: "127\.0\.0\.1"/);
  assert.match(launcher, /N8N_CONTENT_SECURITY_POLICY/);
  assert.match(launcher, /frame-ancestors/);
  assert.match(launcher, /breadboard-auth\.json/);
  assert.match(dev, /startService\("n8n"/);
  assert.ok(
    dev.indexOf('startService("n8n"') < dev.indexOf("ChatMock healthy"),
    "n8n should warm before the launcher waits for ChatMock",
  );
  const definitions = source("../../desktop/src/main/service-definitions.ts");
  const packager = source("../../desktop/scripts/prepare-app-resources.mjs");
  assert.match(definitions, /n8n-runtime/);
  assert.match(definitions, /N8N_RUNTIME_ENTRY/);
  assert.match(definitions, /BREADBOARD_DESKTOP_PID: String\(process\.pid\)/);
  assert.match(packager, /deploy", "--prod", "--legacy"/);
  assert.match(packager, /start-n8n\.mjs/);
  assert.match(packager, /voicebox-status\.mjs/);
  assert.match(n8nServer, /process\.env\.BREADBOARD_EMBEDDED === 'true'/);
});
