// Exercise the actual client launch callbacks against the actual run routes
// and transcript store. Only Runtime submission and authentication are faked;
// the identity, request flags, durable write, and client replay stay real.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test, { after } from "node:test";
import ts from "typescript";
import { build } from "esbuild";

const dashboard = path.resolve(import.meta.dirname, "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-design-launch-"));
process.env.BREADBOARD_DATA_DIR = root;
const { default: db } = await import("../src/lib/db.ts");
const store = await import("../src/lib/conversations/store.ts");
const turns = await import("../src/lib/conversations/external-agent-turns.ts");
const identities = {
  cad: await import("../src/lib/cad/identity.ts"),
  hardware: await import("../src/lib/hardware/identity.ts"),
};
db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'designer', 'designer@example.test', 'x')").run();
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

function callback(file, name, scope) {
  const text = fs.readFileSync(path.join(dashboard, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      expression = node.initializer.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `missing callback ${name}`);
  const compiled = ts.transpileModule(`const callback = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn callback;`)(...Object.values(scope));
}

async function route(slug) {
  const outfile = path.join(root, `${slug}.cjs`);
  await build({
    entryPoints: [path.join(dashboard, `src/app/api/${slug}/runs/route.ts`)],
    outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent",
    plugins: [{ name: "runtime-boundary", setup(builder) {
      builder.onResolve({ filter: /^next\/server$|^@\/lib\// }, ({ path: specifier }) => {
        if (/next\/server|server-auth$|chatmock-server|runtime-run-manager/.test(specifier)) {
          return { path: specifier, namespace: "boundary" };
        }
        return {
          path: path.join(dashboard, "src", specifier.replace(/^@\//, "")),
          external: true,
        };
      });
      builder.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path: specifier }) => ({
        contents: specifier === "next/server" ? "export const NextResponse = Response;"
          : specifier.endsWith("server-auth")
            ? "export const requireUserId = async () => 1; export class RouteError extends Error {}"
            : specifier.includes("chatmock-server")
              ? 'export const resolveChatmockBaseUrl = () => ({baseURL:"http://127.0.0.1:9/v1"});'
              : `export const startRun = async input => ({runId: 'run_' + input.clientMessageId, status:'queued'});
                 export const abortRun = async () => { throw new Error('Launch incorrectly aborted'); };
                 export const getEventsSince = async () => [];
                 export const setRunTerminalHandler = () => {};`,
        loader: "js",
      }));
    } }],
  });
  return createRequire(import.meta.url)(outfile).POST;
}

const routes = { cad: await route("cad"), "hardware-blueprint": await route("hardware-blueprint") };
for (const [kind, slug, launcher, ref, userMessage] of [
  ["parametric_cad", "cad", "launchParametricCadRun", "cadDispatchingRef", identities.cad.parametricCadUserMessage],
  ["hardware_blueprint", "hardware-blueprint", "launchHardwareBlueprintRun", "hardwareDispatchingRef", identities.hardware.hardwareBlueprintUserMessage],
]) {
  const POST = routes[slug];
  for (const mode of ["direct", "hidden-worker", "legacy-parent"]) {
    test(`${slug}: ${mode} design request starts and survives reload without losing its turn`, async () => {
      const chat = store.createConversation({ userId: 1, title: "Design build files", surface: "dashboard_terminal" });
      const id = `${slug}-${mode}`;
      const reason = "Produce checked build files";
      if (mode === "legacy-parent") {
        store.reserveConversationTurn({ conversation: chat, clientMessageId: id, surface: chat.surface, content: "Design AR glasses" });
        store.completeAssistantMessage({ conversationId: chat.id, clientMessageId: id, content: "Building the design files." });
      }
      const persistence = callback("src/app/components/hermes/use-agent-session.ts", "externalAgentTurnPersistence", {
        attachedDelegatedExternalTurnIdsRef: { current: new Set(mode === "legacy-parent" ? [id] : []) },
        delegatedExternalTurnIdsRef: { current: new Set(mode !== "direct" ? [id] : []) },
        delegatedExternalTurnReasonsRef: { current: new Map(mode !== "direct" ? [[id, reason]] : []) },
      });
      const failures = [];
      let requestBody;
      const session = {
        previewExternalAgentTurn: input => mode === "direct" ? input.clientMessageId : id,
        externalAgentTurnPersistence: persistence,
        ensureConversation: async () => chat.public_id,
        appendExternalAgentTurn: async input => {
          const flags = persistence(input.clientMessageId);
          assert.notEqual(input.outcome, "failed", input.assistantContent);
          if (flags.attachToExistingTurn) turns.attachExternalAgentRun({ conversation: chat, ...input, ...flags });
          else turns.recordExternalAgentTurn({ conversation: chat, surface: chat.surface, ...input, ...flags });
        },
      };
      const launch = callback("src/app/components/hermes/dashboard-agent-terminal.tsx", launcher, {
        session, model: "test-model", reasoningEffort: "max", [ref]: { current: false },
        crypto: { randomUUID: () => id + "-direct" },
        hardwareBlueprintUserMessage: userMessage, parametricCadUserMessage: userMessage,
        setLaunchingHardwareRun: () => {}, setLaunchingCadRun: () => {},
        setAttachmentStatus: message => failures.push(message),
        fetch: async (url, init) => {
          requestBody = JSON.parse(init.body);
          return POST(new Request(`http://localhost${url}`, init));
        },
      });
      await launch("Design a clip-on module for AR glasses and provide editable build files");
      assert.deepEqual(failures, []);
      assert.equal(requestBody.attachToExistingTurn, mode === "legacy-parent");
      assert.equal(requestBody.delegatedAgentRun, mode === "hidden-worker");
      const rows = store.listConversationMessages(chat.id);
      assert.equal(rows.length, 2);
      const assistant = rows.find(row => row.role === "assistant");
      const metadata = store.presentConversationMessage(assistant).metadata;
      assert.equal(metadata.externalAgentRun.kind, kind);
      assert.equal(metadata.externalAgentOutcome, "running");
      assert.equal(metadata.delegatedAgentRun === true, mode !== "direct");
      if (mode !== "direct") assert.equal(metadata.delegatedAgentReason, reason);
      const finished = turns.finishExternalAgentTurn({
        conversationId: chat.id, clientMessageId: requestBody.clientMessageId,
        outcome: "completed", content: "The design files are ready.",
      });
      assert.equal(store.presentConversationMessage(finished).metadata.externalAgentOutcome, "completed");
    });
  }
}
