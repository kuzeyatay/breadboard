// Optional live model check against isolated Electron pages, never the user's
// app session. Run after `npm --prefix desktop run build` and `test:build`:
// node --experimental-strip-types scripts/evaluate-computer-use.mjs --model <id> --base-url <ChatMock /v1 URL>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { computerUseSkillChoices, renderSkillShortlistDirective } from '../src/lib/hermes/skill-shortlist.ts';
import { breadboardUseCommandText } from '../src/lib/hermes/breadboard-use-intent.ts';
import { prepareTurn } from '../src/lib/hermes/dispatch-core.ts';

export async function runModelScenario({ call, origin, inspect, config }) {
  const request = `At ${origin}/agent-form, I need Search to contain "computer use verified", followed by Enter, with confirmation of the visible result.`;
  assert.equal(breadboardUseCommandText({ text: request, authenticated: true, surface: 'dashboard_terminal' }).automatic, false,
    'This scenario must exercise model selection, not the phrase router');
  const prepared = prepareTurn({ request, surface: 'dashboard_terminal', userId: 7, grants: [], workspaceRoot: config.dir });
  const choices = computerUseSkillChoices({ skills: config.skills, allowedTools: prepared.grant.allowedTools, selectedSkills: [] });
  const messages = [
    { role: 'system', content: `You are Breadboard's assistant. Complete the user's task using available tools and verify the result before claiming success.\n${renderSkillShortlistDirective(choices)}` },
    { role: 'user', content: request },
  ];
  const calls = [];
  let answer = '';
  for (let step = 0; step < 24; step++) {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
      body: JSON.stringify({ model: config.model, messages, tools: config.bridgeSchemas, tool_choice: 'auto', stream: false, max_completion_tokens: 1500 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Model service returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const message = (await response.json()).choices?.[0]?.message;
    assert.ok(message, 'model returned no message');
    messages.push(message);
    if (!message.tool_calls?.length) { answer = message.content ?? ''; break; }
    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      let result;
      if (['tool_search', 'tool_describe'].includes(toolCall.function.name)) {
        result = JSON.parse(execFileSync(config.python, ['-c',
          'import json,sys; from tools.registry import registry; from plugins.breadboard import register; from types import SimpleNamespace; register(SimpleNamespace(register_tool=registry.register)); import tools.computer_use_tool; from tools.tool_search import dispatch_tool_search, dispatch_tool_describe; p=json.load(sys.stdin); fn=dispatch_tool_search if p["name"]=="tool_search" else dispatch_tool_describe; print(fn(p["args"],current_tool_defs=p["schemas"]))'],
        { cwd: config.hermes, input: JSON.stringify({ name: toolCall.function.name, args, schemas: config.schemas }), encoding: 'utf8', windowsHide: true, timeout: 15_000 }));
      } else if (toolCall.function.name === 'tool_call' && args.name === 'skill_open') {
        const skill = config.skills.find(skill => skill.slug === args.arguments.slug && choices.some(choice => choice.slug === skill.slug));
        result = skill ? { ok: true, data: skill } : { error: 'Skill unavailable for this turn' };
      } else if (toolCall.function.name === 'tool_call' && args.name === 'breadboard_use') {
        const action = args.arguments;
        assert.ok(!['launch_clicky', 'activate', 'close_voice'].includes(action.action), 'test may only operate background test pages');
        if (action.url) assert.equal(new URL(action.url).origin, origin, 'test may not navigate to an external site');
        try { result = await call(action); } catch (error) { result = { error: error.message }; }
      } else throw new Error(`Unexpected model tool: ${toolCall.function.name} ${args.name ?? ''}`);
      calls.push({ tool: toolCall.function.name, ...args });
      console.log('model action', JSON.stringify(calls.at(-1)));
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }
  }
  assert.ok(calls.some(call => call.tool === 'tool_call' && call.name === 'skill_open' && call.arguments.slug === 'breadboard-use'), 'model must choose and read the skill');
  const actions = calls.filter(call => call.tool === 'tool_call' && call.name === 'breadboard_use').map(call => call.arguments.action);
  assert.ok(actions.includes('snapshot'), 'model must observe the UI');
  assert.ok(actions.includes('press'), 'model must submit with UI input');
  assert.equal(actions.at(-1), 'snapshot', 'model must verify the UI after acting');
  assert.equal(await inspect(), 'Submitted computer use verified', 'real DOM must confirm the effect');
  assert.match(answer, /computer use verified/i, 'answer must report the observed result');
  return { passed: true, model: config.model, request, calls, answer };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const model = option('--model');
  const baseUrl = option('--base-url')?.replace(/\/$/, '');
  if (!model || !baseUrl) throw new Error('Pass --model and --base-url for the configured local ChatMock service.');
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname), 'evaluation uses a local model gateway');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const desktop = path.join(root, 'desktop');
  const hermes = path.join(root, 'hermes-agent');
  const python = path.join(hermes, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-computer-use-model-'));
  const require = createRequire(import.meta.url);
  const { build, stop } = require('esbuild');
  const desktopRequire = createRequire(path.join(desktop, 'package.json'));
  const { runElectronFixture } = desktopRequire('./dist-tests/tests/helpers/run-electron-fixture.js');
  try {
    const skills = ['breadboard-use', 'computer-use'].map(slug => {
      const guidance = fs.readFileSync(path.join(root, 'hermes-skills/prebuilt', slug, 'SKILL.md'), 'utf8');
      const metadata = yaml.load(guidance.split(/^---\s*$/m)[1]);
      return { slug, name: metadata.name, description: metadata.description, guidance };
    });
    const { schemas, bridgeSchemas } = JSON.parse(execFileSync(python, ['-c',
      'import json; from tools.registry import registry; from plugins.breadboard import _TOOLS, register; from types import SimpleNamespace; register(SimpleNamespace(register_tool=registry.register)); import tools.computer_use_tool; from tools.tool_search import bridge_tool_schemas, classify_tools; from tools.computer_use.schema import COMPUTER_USE_SCHEMA; schemas=[{"type":"function","function":s} for n,r,k,s in _TOOLS if n in {"breadboard_use","skill_open","terminal_execute_command"}]; schemas.append({"type":"function","function":COMPUTER_USE_SCHEMA}); visible,deferred=classify_tools(schemas); print(json.dumps({"schemas":schemas,"bridgeSchemas":visible+bridge_tool_schemas(len(deferred))}))'],
    { cwd: hermes, encoding: 'utf8', windowsHide: true, timeout: 20_000 }));
    fs.writeFileSync(path.join(dir, 'model-config.json'), JSON.stringify({ model, baseUrl, dir, hermes, python, skills, schemas, bridgeSchemas }));
    for (const [entry, output] of [[path.join(root, 'dashboard/src/lib/hermes/breadboard-use.ts'), 'transport.cjs'], [fileURLToPath(import.meta.url), 'model-evaluation.cjs']]) {
      await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(dir, output), external: ['server-only', 'better-sqlite3'], logLevel: 'error' });
    }
    await stop();
    const env = { ...process.env, BB_USE_MODEL_ONLY: '1', BB_USE_PERSISTENT_SHELL: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_TEST_CONTEXT;
    const result = await runElectronFixture(desktopRequire('electron'), [path.join(desktop, 'tests/fixtures/breadboard-use.cjs'), dir], desktop, env, 300_000);
    console.log(result.output);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0);
    const report = fs.readFileSync(path.join(dir, 'passed.json'), 'utf8');
    if (option('--output')) fs.writeFileSync(path.resolve(option('--output')), report);
    console.log(report);
  } finally {
    await stop();
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

if (typeof import.meta.url === 'string' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
