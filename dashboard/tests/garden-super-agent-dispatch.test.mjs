import { hermesPromptText } from "../src/lib/agent-runtime/hermes-prompt.ts";
import { defaultAgentPreferences, renderAgentPreferences } from "../src/lib/agent-preferences/preferences.ts";
// Execute the Garden request serializer and full pre-dispatch adapter. Database,
// inventory I/O, and runtime transport are faked; the broker, prompt renderer,
// capability ledger, request flags, and dispatch assembly are production code.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { prepareTurn, mergeSelectedTools } from "../src/lib/hermes/dispatch-core.ts";
import { turnCapabilitySelection } from "../src/lib/hermes/capability-usage.ts";
import { RUNTIME_AGENT_PROFILES } from "../src/lib/hermes/capability-combinations.ts";
import * as briefs from "../src/lib/hermes/runtime-agent-briefs.ts";
import * as inbox from "../src/lib/inbox-zero/identity.ts";
import * as globe from "../src/lib/gods-eye/identity.ts";
import { maxResearchInvocation } from "../src/lib/max-research/identity.ts";
import * as quartzSelection from "../src/lib/quartz-assistant-selection.ts";
import { normalizeChatTextSelectionReference } from "../src/lib/chat-text-selection.ts";
import { shouldGenerateConversationTitleForTurn } from "../src/lib/conversations/title-service.ts";
import { parseUnifiedWorkflowCommand } from "../src/lib/workflows/unified-command.ts";
import { renderUnifiedWorkflowGuidance } from "../src/lib/workflows/unified-guidance.ts";
import { parseBrowserTerminalAccess } from "../src/lib/browser-terminal.ts";
import { computerUseSkillChoices, renderSkillShortlistDirective } from "../src/lib/hermes/skill-shortlist.ts";

const prompt = "do max research on muscle hypertrophy, hjow its triggered, what needs to be done to achieve maximum muscle growth, how much and what muscle groups must be targeted for a lean and proportional physique, I want a lean physique like in the movies, have time until august 2027 but i am willing to be agressive in my diet, i am definetly skinny fat and 87kg, 183cm with 26,5 percent body fat estimate using the navy method. so i need a gym program to get me in shape and a diet with specified calories or how much calorie per day type of thing, i can also use creatine and proteine powder. however i am week like i can only curl like 6kg and can do like only 2 pushups?";
const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const ast = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function execute(code, scope, result) {
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("exports", ...Object.keys(scope), `${compiled}\nreturn ${result};`)(
    {}, ...Object.values(scope),
  );
}
function functions(file, names, scope, result) {
  const tree = ast(file);
  const declarations = tree.statements.filter((node) =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(declarations.length, names.length);
  return execute(declarations.map((node) => node.getText(tree)).join("\n"), scope, result);
}

const renderSuperAgentDirective = functions("lib/hermes/super-agent.ts", [
  "renderSuperAgentDirective", "runtimeAgentCatalogue", "researchRoutingRule",
  "emailRoutingRule", "godsEyeRoutingRule",
], { ...briefs, ...inbox, ...globe }, "renderSuperAgentDirective");

const workspace = ast("app/gardens/[clusterSlug]/workspace-client.tsx");
let requestExpression;
const modeDeclarations = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["superAgentEnabled", "yoloModeEnabled"].includes(node.name.getText(workspace))) {
    modeDeclarations.push(`const ${node.getText(workspace)};`);
  }
  if (ts.isCallExpression(node) && node.expression.getText(workspace) === "fetchGardenChat") {
    requestExpression = node.arguments[2].properties.find((property) =>
      property.name?.getText(workspace) === "body").initializer.getText(workspace);
  }
  ts.forEachChild(node, visit);
}
visit(workspace);
assert.ok(requestExpression, "main workspace must post a Garden chat body");

function request(superAgent, internalAgentContinuation = false) {
  return JSON.parse(execute(`${modeDeclarations.join("\n")}\nconst body = ${requestExpression};`, {
    isSuperAgentEnabled: () => superAgent,
    isYoloModeEnabled: () => superAgent,
    isDirectModeEnabled: () => false,
    isPersonalizeEnabled: () => true,
    nextMessages: [{ role: "user", content: prompt }],
    clusterSlug: "fitness", sessionId: 828, clientMessageId: "max-research-regression",
    model: "gpt-5.6-sol", reasoningEffort: "max", pendingAttachments: [],
    focusedDocumentSlugs: [], textSelection: null, webSelection: null, turnOptions: undefined, internalAgentContinuation,
  }, "body"));
}

async function dispatch(payload, { title = 'New chat', orderIndex = 0, commandResolution = null, workflowContinuation = null, availableSkills = [] } = {}) {
  const captured = { audits: [], inventoryLoads: [], registry: [], shortlistCalls: 0, titlePrompts: [] };
  const conversation = { id: 266, public_id: "conv_regression", title, surface: "garden_chat", active_agency_agent_slug: null };
  const session = {
    row: { id: 952, conversation_id: 266, cluster_id: 1 },
    runtimeKind: "hermes", activeDirectory: "/test/garden", externalSessionId: "hermes_test",
  };
  const inventory = {
    skills: [{ slug: "cad", name: "CAD", description: "Parametric designs" }],
    skillSlugs: ["cad"], moreSkillSlugs: [], unlistedSkillCount: 0,
    connections: ["test-account"], workflows: [{ id: "workflow_test", name: "Test workflow" }],
    workflowsReachable: true, divisions: [], specialistCount: 0,
    runtimeAgents: RUNTIME_AGENT_PROFILES.filter((agent) => agent.surfaces.includes("garden_chat"))
      .map((agent) => ({ ...agent, launchable: agent.launchableByModel })),
  };
  const noop = () => {};
  const empty = () => "";
  const scope = { hermesPromptText, normalizeChatTextSelectionReference, parseBrowserTerminalAccess,
    browserTerminalPrompt: () => "", setBrowserTerminalContext: () => {},
    resolveUnifiedWorkflowContinuation: () => workflowContinuation,
    selectedGardenDocumentQuestionPrompt: functions("lib/hermes/garden-reader.ts", ["selectedGardenDocumentQuestionPrompt"], {}, "selectedGardenDocumentQuestionPrompt"),
    process: { env: {} }, setInterval: () => ({ unref: noop }), clearInterval: noop,
    requireUserId: async () => 7,
    authorizeGardenAccess: () => ({ clusterId: 1 }),
    db: { prepare: () => ({ get: () => ({ id: 828 }) }) },
    ensureConversationForLegacyChatSession: () => conversation,
    reserveConversationTurn: ({ clientMessageId }) => ({ userMessage: { client_message_id: clientMessageId, order_index: orderIndex } }),
    annotateConversationTurn: noop, conversationTurnWasCancelled: () => false,
    deliverCompletedResearch: () => { assert.equal(workflowContinuation, null, "workflow hand-backs must reach synthesis before direct delivery"); return null; },
    parseChatAttachments: () => [], hydrateDocumentAttachments: () => [], retrieveDocumentAttachments: async () => [],
    generateAndApplyConversationTitle: async ({firstPrompt}) => { captured.titlePrompts.push(firstPrompt); return conversation; },
    shouldGenerateConversationTitleForTurn,
    resolveSmallTalkReply: () => null,
    resolveHermesEngine: () => ({ model: { modelID: payload.model }, selectedModelID: payload.model, variant: "max" }),
    getRuntimeSessionByChatSession: () => null, resolveConversationRuntime: async () => session,
    listFilesystemGrants: () => [], prepareTurn, mergeSelectedTools, turnCapabilitySelection,
    resolveCommandMessage: async (_user, text, _workspace, context) => {
      assert.equal(context.workflowContinuation, workflowContinuation);
      return commandResolution ?? ({ userText: text, text, invocations: [] });
    },
    loadSuperAgentInventory: async (input) => { captured.inventoryLoads.push(input); return inventory; },
    renderSuperAgentDirective,
    agentPreferencesContext: (userId) => {
      assert.equal(userId, 7);
      return payload.testPreferences ? renderAgentPreferences(payload.testPreferences) : "";
    },
    shortlistSkillsForTurn: () => { captured.shortlistCalls++; return []; },
    computerUseSkillChoices, openableSkills: () => availableSkills, listMcpConnections: () => [],
    adjudicateWebGrounding: async () => ({ required: true }),
    getAgentRuntimeByKind: () => ({ health: noop, applyCapabilityDecision: ({ decision }) => { captured.decision = decision; }, startRun: (input) => { captured.start = input; } }),
    connectedAppRegistryForTurn: async (input) => {
      captured.registry.push(input);
      return { connectionNames: [], tools: {}, systemContext: "" };
    },
    connectedRepositoryForTurn: async () => null,
    persistCapabilityDecision: () => ({ id: 1 }), recordAuditEvent: (event) => captured.audits.push(event), markStatus: noop,
    getConversationById: () => conversation, loadConversationMemoryBundle: () => ({ recentMessages: [] }),
    stageEditableDocumentAttachments: () => ({ context: "" }),
    prepareDocumentContext: async () => ({ context: "", inlineAttachments: [] }),
    retrieveTerminalGardenGrounding: async () => ({ context: "" }),
    suppliedEvidenceText: empty, gardenInstructionsContext: empty, gardenSourceInventoryContext: async () => "",
    composeMemoryContext: empty, renderSkillShortlistDirective, renderWatchVideoContext: empty,
    gardenTurnContext: empty, ...quartzSelection,
    composeHermesSystemPrompt: ({ additional }) => additional,
    beginRuntimeRun: (input) => { captured.run = input; return { id: "run_regression" }; },
    hermesMessageId: (id) => id,
    legacyGardenEventStream: async (_session, _signal, _prepared, _run, _client, _message, _web, start, recover) => {
      await start(session);
      captured.firstStart = captured.start;
      await start(await recover());
      return new Response("test stream");
    },
    failAssistantMessage: () => assert.fail("the dispatch must not fail"),
    hasReconstructableAttachment: () => false, hasAnalyzableAttachment: () => false,
    carriedExternalAgentsForContinuation: () => [{ agentId: "max-research", status: "completed" }],
    externalAgentCallsForRun: () => [], botsStore: () => ({ forConversation: () => null }), conversationPersonalityPrompt: () => "", selectedModelForUser: () => ({ model: payload.model }), getLatestRuntimeRun: () => null,
    deliverCompletedHyperframes: async () => { assert.equal(workflowContinuation, null, "workflow hand-backs must reach synthesis before direct delivery"); return null; },
  };
  const tree = ast("lib/hermes/garden-chat-adapter.ts");
  for (const node of tree.statements) {
    if (!ts.isImportDeclaration(node)) continue;
    for (const element of node.importClause?.namedBindings?.elements ?? []) {
      const name = element.name.text;
      if (name.endsWith("CommandText")) scope[name] = ({ text }) => ({ text, automatic: false, skill: null });
      if (name.endsWith("_SKILL")) scope[name] = name.toLowerCase();
    }
  }
  const openGardenAgentChat = functions("lib/hermes/garden-chat-adapter.ts", [
    "openGardenAgentChat", "parseMessages", "parseActivePage", "parseSelectedDocumentSlugs",
  ], scope, "openGardenAgentChat");
  await openGardenAgentChat(payload, new AbortController().signal);
  return captured;
}

test("a selected workflow survives Garden dispatch and recovery without broader agent privileges", async () => {
  const command = "/workflows:research Find reliable evidence";
  const selected = parseUnifiedWorkflowCommand(command);
  const payload = request(false);
  payload.messages = [{ role: "user", content: command }];
  const commandResolution = {
    userText: selected.textWithoutWorkflow,
    text: `${renderUnifiedWorkflowGuidance(selected.selection, "garden_chat")}\n\n${selected.textWithoutWorkflow}`,
    invocations: [{ kind: "agent", slug: "workflows:research", id: "unified-workflow:research" }],
    workflowSelection: selected.selection,
  };
  const result = await dispatch(payload, { commandResolution });
  assert.deepEqual(result.run.dispatch.workflowSelection, selected.selection);
  assert.equal(result.run.dispatch.tools.agent_launch, true);
  assert.ok(result.decision.allowedTools.includes("agent_launch"));
  assert.match(result.run.dispatch.runtimeText, /Breadboard workflow: Research/);
  assert.equal(result.firstStart.yoloMode, false);
  assert.equal(result.start.yoloMode, false, "recovery must retain normal launch approvals");
  assert.notEqual(result.run.dispatch.capabilities.superAgent, true);
  assert.equal(result.inventoryLoads.length, 0);
  assert.equal(result.registry[0].allowAllConnectionTools, false);
});

test("a verified workflow hand-back reaches Garden synthesis and retains completed jobs", async () => {
  const selection = parseUnifiedWorkflowCommand("/workflows:research").selection;
  const workflowContinuation = { selection, originClientMessageId: "origin", completedWork: [{ agentId: "get-doc", brief: "Find one paper" }] };
  const payload = request(false, true);
  payload.messages = [{ role: "user", content: "<!-- agent-launch-result:worker --> Paper [S1]" }];
  const result = await dispatch(payload, {
    workflowContinuation,
    commandResolution: { text: "Summarize this verified workflow result", userText: payload.messages[0].content, invocations: [],
      workflowSelection: selection, workflowCompletedWork: workflowContinuation.completedWork },
  });
  assert.equal(result.run.dispatch.tools.agent_launch, true);
  assert.deepEqual(result.run.dispatch.workflowSelection, selection);
  assert.deepEqual(result.run.dispatch.workflowCompletedWork, workflowContinuation.completedWork);
  assert.equal(result.start.yoloMode, false);
});

test("Garden receives only selected preferences without gaining launch permissions", async () => {
  const preferences = defaultAgentPreferences();
  preferences.enabled = true;
  preferences.tasks.find((task) => task.id === "video").agents = ["/agents:hyperframes"];
  const result = await dispatch({ ...request(false), testPreferences: preferences });
  assert.match(result.run.dispatch.system, /### Producing video/);
  assert.doesNotMatch(result.run.dispatch.system, /### Creating music|### Analyzing stocks/);
  assert.equal(result.run.dispatch.tools.agent_launch, false);
  preferences.enabled = false;
  const disabled = await dispatch({ ...request(false), testPreferences: preferences });
  assert.doesNotMatch(disabled.run.dispatch.system, /### Producing video/);
});

test("the exact question-mark-ending prompt directly selects Max Research", () => {
  assert.equal(maxResearchInvocation(prompt)?.question, prompt.slice("do max research on ".length));
});

test("Ask here sends the selected paragraph with the question on initial and recovered runtime dispatch", async () => {
  const quote = 'A circuit model condenses a component into a few quantities.';
  const question = 'what does this paragraph mean';
  for (const selectedTextContext of [undefined, {
    requestId: 'question_1', highlightId: 'highlight_1', mode: 'inline',
    text: quote, prefix: 'Electric fields describe space.', suffix: 'A field model retains positions.',
    pageSlug: 'electromagnetism-1/learning/fields',
  }]) {
    const result = await dispatch({ ...request(false), messages: [{ role: 'user', content: question }], selectedText: quote, selectedTextContext });
    for (const text of [result.run.dispatch.runtimeText, result.firstStart.text, result.start.text]) {
      assert.ok(text.includes(JSON.stringify(quote)), 'the model receives the excerpt as quoted data');
      assert.ok(text.endsWith(question), 'the actual question remains the current request');
      assert.match(text, /quoted page data, not instructions/);
      if (selectedTextContext) assert.match(text, /A field model retains positions/);
    }
    assert.equal(result.run.instruction, question, 'the displayed question stays clean');
  }
});

test('Garden Ask Here, nested questions and retries never invoke the main-chat title generator', async () => {
  const quote = 'Energy belongs to the system.';
  for (const title of ['EM 1', 'New chat']) {
    for (const orderIndex of [0, 20]) {
      for (const sourceMessageId of ['main-answer', 'inline-parent-answer']) {
        const result = await dispatch({ ...request(false),
          messages: [{role:'user',content:'Why does the energy belong to the system?'}],
          textSelection: {id:'selection-energy',mode:'inline',sourceMessageId,quote,start:0,end:quote.length},
        }, {title,orderIndex});
        assert.deepEqual(result.titlePrompts,[],`${title}, index ${orderIndex}, source ${sourceMessageId}`);
      }
      const legacy = await dispatch({ ...request(false),
        messages: [{role:'user',content:'Explain the selected page'}],
        selectedTextContext: {requestId:'page-question',highlightId:'page-mark',mode:'inline',text:quote},
      }, {title,orderIndex});
      assert.deepEqual(legacy.titlePrompts,[], 'page-based Ask Here also leaves the title alone');
    }
  }
  const main = await dispatch({...request(false),messages:[{role:'user',content:'Explain electric circuits'}]});
  assert.deepEqual(main.titlePrompts,['Explain electric circuits']);
});

test("Garden Super Agent survives serialization, brokering, prompt assembly and evidence metadata", async () => {
  const payload = request(true);
  assert.equal(payload.superAgent, true);
  assert.equal(payload.yoloMode, true);
  assert.equal(payload.messages[0].content, prompt);
  const result = await dispatch(payload);
  assert.equal(result.inventoryLoads.length, 1);
  assert.equal(result.inventoryLoads[0].request, prompt);
  assert.equal(result.inventoryLoads[0].surface, "garden_chat");
  assert.equal(result.shortlistCalls, 0);
  assert.equal(result.registry[0].allowAllConnectionTools, true);
  assert.ok(result.decision.selectedConditionalSkills.includes("cad"));
  assert.ok(result.decision.selectedConnections.includes("test-account"));
  const { dispatch: sent } = result.run;
  assert.equal(sent.runtimeText, prompt);
  assert.equal(sent.tools.agent_launch, true);
  assert.equal(sent.tools.terminal_execute_command, true);
  assert.equal(result.firstStart.yoloMode, true, "YOLO must reach the runtime before its first tool call");
  assert.equal(result.start.yoloMode, true, "a restored runtime must retain YOLO");
  assert.match(sent.system, /# super_agent_mode/);
  assert.match(sent.system, /launch `max-research` with `agent_launch`/);
  assert.equal(sent.capabilities.superAgent, true);
  assert.deepEqual(sent.capabilities.inventory, { skills: 1, connections: 1, workflows: 1 });
  assert.deepEqual(sent.capabilities.skills ?? [], [], "available skills must not be reported as actually selected or used");
  const submitted = result.audits.find((event) => event.eventType === "message.submitted");
  assert.equal(submitted.payload.superAgent, true);
  assert.equal(submitted.payload.yoloMode, true);
});

test("API Super Agent retains standing approval after runtime recovery without a redundant YOLO flag", async () => {
  const payload = request(true);
  delete payload.yoloMode;
  const result = await dispatch(payload);
  assert.equal(result.firstStart.yoloMode, true);
  assert.equal(result.start.yoloMode, true);
});

test("normal Garden turns and older clients do not inherit Super Agent privileges", async () => {
  const payload = request(false);
  assert.equal(payload.superAgent, false);
  assert.equal(payload.yoloMode, false);
  for (const flags of [payload, { ...payload, superAgent: undefined, yoloMode: undefined }]) {
    const result = await dispatch(flags);
    assert.equal(result.inventoryLoads.length, 0);
    assert.equal(result.shortlistCalls, 1);
    assert.equal(result.registry[0].allowAllConnectionTools, false);
    assert.equal(result.run.dispatch.tools.agent_launch, false);
    assert.equal(result.start.yoloMode, false, "an ordinary turn must clear a prior runtime's YOLO bypass");
    assert.doesNotMatch(result.run.dispatch.system, /# super_agent_mode/);
    assert.notEqual(result.run.dispatch.capabilities.superAgent, true);
  }
});

test("ordinary Garden dispatch and recovery offer computer skills without claiming they were used", async () => {
  const availableSkills = [
    { slug: 'breadboard-use', name: 'Breadboard use', description: 'Operate Breadboard pages.' },
    { slug: 'computer-use', name: 'Computer use', description: 'Operate native desktop apps.' },
  ];
  for (const invocations of [[], [{ kind: 'skill', slug: 'ask-sonner', name: 'Ask Sonner' }]]) {
    const text = 'I need the visible form completed.';
    const result = await dispatch({ ...request(false), messages: [{ role: 'user', content: text }] }, {
      availableSkills, commandResolution: { userText: text, text, invocations },
    });
    for (const skill of availableSkills) {
      assert.ok(result.decision.selectedConditionalSkills.includes(skill.slug), 'skill_open must be authorized');
      assert.ok(result.run.dispatch.system.includes(skill.slug), 'model must see the choice');
      assert.ok(!result.run.dispatch.capabilities.skills?.some(used => used.slug === skill.slug), 'offered is not used');
    }
    for (const tool of ['skill_open', 'breadboard_use', 'computer_use']) {
      assert.equal(result.firstStart.tools[tool], true, tool);
      assert.equal(result.start.tools[tool], true, 'runtime recovery retains the choice');
    }
    assert.equal(result.start.yoloMode, false, 'discovery must preserve action approval policy');
  }
});

test("worker hand-back retains its continuation flag and delegation evidence", async () => {
  const payload = request(true, true);
  assert.equal(payload.internalAgentContinuation, true);
  const result = await dispatch(payload);
  assert.equal(result.shortlistCalls, 0);
  assert.equal(result.run.dispatch.capabilities.superAgent, true);
  assert.equal(result.run.dispatch.delegatedAgents[0].agentId, "max-research");
});
