// Live tone checks through the running model gateway. Uses production prompt
// builders, never injects Unslop or a personal profile from the test harness.
// Responses are retained for human review; lint scores alone do not judge tone.
// node --experimental-strip-types scripts/evaluate-default-tone.mjs --base-url http://127.0.0.1:55504/v1 --model cliproxy/gemini-3.8-flash-high --model gpt-6-luna --out qa/default-tone-20261106/replies.json
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chatCorePrompt, composeHermesSystemPrompt } from '../dashboard/src/lib/hermes/system-prompts.ts';
import { breadSystemPrompt } from '../dashboard/src/lib/assistant-identity.ts';
import { scoreProse } from '../dashboard/src/lib/prose-score/index.ts';
import { DICTATION_REPLY_INSTRUCTIONS } from '../dashboard/src/lib/speech/dictation-reply.ts';
import { GENOFFICE_AI_SYSTEM_PROMPT } from '../dashboard/src/lib/hermes/genoffice-ai.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const base = args.includes('--base-url') ? value('--base-url').replace(/\/$/, '') : 'http://127.0.0.1:8765/v1';
const models = args.flatMap((arg, index) => arg === '--model' ? [args[index + 1]] : []);
if (!models.length) throw new Error('Supply the models actually used by the running app with --model.');
const output = path.resolve(args.includes('--out') ? value('--out') : 'qa/default-tone/replies.json');
const profile = path.join(process.env.UNSLOP_SKILL_DIR || path.join(root, 'unslop'), 'references', 'style-profile.md');
if (fs.existsSync(profile)) throw new Error('This evaluation requires no saved profile; it will not remove or replace one.');
const decision = {
  mode: 'knowledge', requestedOutcome: 'Answer the question', implementationRequired: false,
  decisionReason: 'Live tone evaluation', decisionSource: 'breadboard_server_policy_v1',
  authorizedRoots: [], authorizedPathPatterns: [], allowedTools: [],
  allowedOperations: ['knowledge_work'], allowedCommandPatterns: [],
  selectedConditionalSkills: [], selectedConnections: [], createdAt: new Date().toISOString(),
};
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const compile = (surface, options = {}) => breadSystemPrompt(composeHermesSystemPrompt({surface, decision, ...options}));
const fixtures = [
  {id: 'terminal', endpoint: 'chat/completions', system: compile('dashboard_terminal'), question: 'Why does coffee cool faster in a wide mug than in a narrow one?', tools: true},
  {id: 'garden', endpoint: 'chat/completions', system: compile('garden_chat', {additional: 'Source note: A capacitor stores energy in an electric field. Current changes the charge on its plates; capacitance relates stored charge to voltage.'}), question: 'Explain what a capacitor does.', tools: true},
  {id: 'quartz', endpoint: 'chat/completions', system: compile('quartz_ai', {additional: 'Current page: Evaporation happens at the surface of a liquid. The escaping molecules carry energy away from the liquid.'}), question: 'Why does sweating cool me down?', tools: true},
  {id: 'voice', endpoint: 'chat/completions', system: compile('dashboard_terminal', {voice: true}), question: 'Why does the bathroom mirror fog up after a shower?', tools: true},
  {id: 'agent-off', endpoint: 'responses', system: `${chatCorePrompt()}\n\n# direct_provider_turn\nAgent mode is switched off for this message. You have no tools. Answer from this conversation and your own knowledge.`, question: 'Write a short project update for my team. The search feature is delayed from Tuesday to Friday because testing found duplicate results. Maya is fixing it. We will test again on Thursday.'},
  {id: 'legacy-garden', endpoint: 'responses', system: `${chatCorePrompt()}\n\nYou are a helpful assistant for the user's second brain garden. Use the supplied notes as grounded context.`, question: 'What is the difference between remembering something and understanding it?'},
  {id: 'knowledge-chat', endpoint: 'responses', system: `${chatCorePrompt()}\n\nYou are the assistant for the user's entire second-brain knowledge base, which spans every garden they own.`, question: 'Explain why taking breaks can help when I am stuck on a problem.'},
  {id: 'voice-draft', endpoint: 'responses', system: DICTATION_REPLY_INSTRUCTIONS, question: 'Spoken request: Draft a reply to Sam saying I can meet on Thursday at 2 pm. No screen context is needed for this request.'},
  {id: 'word-editor', endpoint: 'chat/completions', system: breadSystemPrompt(GENOFFICE_AI_SYSTEM_PROMPT), question: 'User request: What does this paragraph mean? Explain it without editing the document.\nCurrent document: A capacitor stores energy in an electric field. Current changes the charge on its plates.', tools: true, taskType: 'small_revision', responseFormat: {type: 'json_object'}, jsonKind: 'word'},
  {id: 'markdown-editor', endpoint: 'chat/completions', system: breadSystemPrompt("You are Bread, the assistant inside Breadboard's Markdown editor. Return only one JSON object with keys message and content. message is a concise conversational reply. content is the complete updated Markdown document when an edit is requested, or null when only answering a question. Preserve unchanged document content exactly, including formulas and code."), question: 'Explain what this formula means, without editing my document: Q = C * V.', taskType: 'small_revision', responseFormat: {type: 'json_object'}, jsonKind: 'markdown'},
  {id: 'detailed-request', endpoint: 'chat/completions', system: compile('dashboard_terminal'), question: 'Explain how a capacitor charges through a resistor in about 250 words. Build the explanation step by step, define voltage and current, and include the equation for the time constant.', tools: true},
  {id: 'concise', endpoint: 'chat/completions', system: compile('dashboard_terminal', {adhdMode: true}), question: 'I keep putting off a ten-minute email. How do I get started?', tools: true},
  {id: 'follow-up', endpoint: 'responses', system: chatCorePrompt(), history: [{role: 'user', content: 'Write a team update about a delay.'}, {role: 'assistant', content: 'Certainly! Here is a comprehensive update that underscores our commitment to excellence. We are leveraging a robust testing process to ensure a seamless rollout.'}], question: 'Use these facts instead: search is moving from Tuesday to Friday because of duplicate results. Maya is fixing it; testing is Thursday. Keep it to a short paragraph.'},
];
const caseIds = args.flatMap((arg, index) => arg === '--case' ? [args[index + 1]] : []);
const selected = caseIds.length ? fixtures.filter(item => caseIds.includes(item.id)) : fixtures;
if (!selected.length) throw new Error('No matching test case.');
const report = {startedAt: new Date().toISOString(), base, models, profileExists: false,
  method: 'Live gateway requests with production core/Hermes prompt builders; no style block or custom profile supplied by the harness. Not a full UI test.',
  sourceHashes: Object.fromEntries(['chatmock/chatmock/council/unslop.py', 'chatmock/chatmock/routes_openai.py', 'hermes-config/system/chat-core.md', 'unslop/SKILL.md'].map(file => [file, createHash('sha256').update(source(file)).digest('hex')])),
  results: []};
fs.mkdirSync(path.dirname(output), {recursive: true});
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
save();

async function run(model, fixture) {
  const started = Date.now();
  const messages = [...(fixture.history || []), {role: 'user', content: fixture.question}];
  const body = fixture.endpoint === 'responses'
    ? {model, instructions: fixture.system, input: messages.map(message => ({type: 'message', ...message})), stream: true, store: false, reasoning: {effort: 'low'}}
    : {model, messages: [{role: 'system', content: fixture.system}, ...messages], stream: true, reasoning_effort: 'low', ...(fixture.tools ? {tools: [{type: 'function', function: {name: 'lookup', description: 'Look up supplied information when needed.', parameters: {type: 'object', properties: {}}}}], tool_choice: 'none'} : {})};
  if (fixture.taskType) body.taskType = fixture.taskType;
  if (fixture.responseFormat) body.response_format = fixture.responseFormat;
  let result = {id: fixture.id, requestedModel: model, endpoint: fixture.endpoint, question: fixture.question};
  try {
    const response = await fetch(`${base}/${fixture.endpoint}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000)});
    result.httpStatus = response.status;
    result.routing = Object.fromEntries([...response.headers].filter(([key]) => /^x-chatmock-(resolved-model|provider|failover|requested-model)$/.test(key)));
    if (!response.ok) throw new Error((await response.text()).slice(0, 1200));
    let pending = '', answer = '', resolvedModel = null, finishReason = null, completed = false;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, {stream: true});
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        if (event.error) throw new Error(JSON.stringify(event.error));
        resolvedModel = event.model || event.response?.model || resolvedModel;
        const choice = event.choices?.[0];
        if (typeof choice?.delta?.content === 'string') answer += choice.delta.content;
        if (choice?.finish_reason) { finishReason = choice.finish_reason; completed = true; }
        if (event.type === 'response.output_text.delta') answer += event.delta || '';
        if (event.type === 'response.completed') {
          completed = event.response?.status !== 'incomplete';
          finishReason = event.response?.status || 'completed';
          if (!answer) answer = (event.response?.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
        }
        if (event.type === 'response.failed') throw new Error(JSON.stringify(event.response?.error || event));
      }
    }
    if (!answer.trim() || !completed) throw new Error(`Incomplete answer (finish=${finishReason}, characters=${answer.length}).`);
    result = {...result, resolvedModel, finishReason, answer};
    let prose = answer;
    let jsonContract = null;
    if (fixture.jsonKind) {
      const parsed = JSON.parse(answer);
      jsonContract = typeof parsed.message === 'string' && (fixture.jsonKind === 'word' ? Array.isArray(parsed.actions) && parsed.actions.length === 0 : parsed.content === null);
      if (!jsonContract) throw new Error('The editor response changed the expected JSON contract.');
      prose = parsed.message;
    }
    const scored = scoreProse(prose);
    result = {...result, resolvedModel, finishReason, answer, jsonContract, words: prose.trim().split(/\s+/).length, score: scored.score, findings: scored.topPatterns,
      checks: {noEmDashes: !answer.includes('—'), noCannedOpening: !/^(?:certainly|absolutely|great question|of course)[!.,:]/i.test(answer.trim()), noStyleDisclosure: !/\bunslop\b|author voice profile|house voice|calibrat(?:e|ion).*style/i.test(answer), noUnrequestedRecap: !/^(?:#+\s*)?(?:in summary|in conclusion|overall)\b/im.test(answer)}};
    // Equation meaning is reviewed with the saved answer; notation varies.
    if (fixture.id === 'detailed-request') result.checks.requestedDetailRetained = result.words >= 180;
  } catch (error) { result.error = String(error.message || error); }
  result.elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(2));
  report.results.push(result); save();
  console.log(JSON.stringify({id: result.id, model, resolvedModel: result.resolvedModel, seconds: result.elapsedSeconds, score: result.score, checks: result.checks, error: result.error}));
}
// Keep model load bounded while overlapping independent read-only samples.
const queue = models.flatMap(model => selected.map(fixture => ({model, fixture})));
await Promise.all(Array.from({length: 2}, async () => {
  while (queue.length) { const item = queue.shift(); await run(item.model, item.fixture); }
}));
report.finishedAt = new Date().toISOString(); save();
console.log(`Saved ${report.results.length} live replies to ${output}`);
if (report.results.some(item => item.error)) process.exitCode = 1;
