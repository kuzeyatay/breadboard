// Optional model evaluation. It only asks for a next tool decision; it never
// executes a returned tool call, downloads images, or changes a conversation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { localChatmockBaseUrl } from '../src/lib/chatmock-server.ts';

const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(dashboard);
export const imageRoutingCases = JSON.parse(fs.readFileSync(path.join(dashboard, 'tests/fixtures/image-routing-cases.json'), 'utf8'));

export function assessImageRouting(scenario, message) {
  const failures = [];
  if (!message || typeof message !== 'object' ||
      (message.tool_calls != null && !Array.isArray(message.tool_calls)) ||
      (!(typeof message.content === 'string' && message.content.trim()) && !message.tool_calls?.length)) {
    return { passed: false, failures: ['Model returned no answer or tool decision.'], count: 0, queries: [] };
  }
  const calls = (message.tool_calls ?? []).filter(call => call?.function?.name === 'image_search');
  if (Boolean(calls.length) !== scenario.search) failures.push(scenario.search ? 'Expected image_search.' : 'Image search was inappropriate.');
  const queries = [];
  let count = 0;
  for (const call of calls) {
    let args;
    try { args = JSON.parse(call.function.arguments); } catch { failures.push('Invalid tool arguments.'); continue; }
    if (!args || typeof args.query !== 'string' || !args.query.trim() || args.query.length > 512) {
      failures.push('Missing or invalid search query.');
    } else queries.push(args.query.toLowerCase());
    if (!Number.isInteger(args?.count) || args.count < 1 || args.count > 5) failures.push('Count must be an integer from 1 to 5.');
    else count += args.count;
  }
  if (count > 5) failures.push('Combined image count exceeds five.');
  if (scenario.count !== undefined && count !== scenario.count) failures.push(`Expected the requested count, capped at ${scenario.count}.`);
  const joined = queries.join(' ');
  for (const alternatives of scenario.subjects ?? []) {
    if (!alternatives.some(subject => joined.includes(subject.toLowerCase()))) failures.push(`Query lost subject or constraint: ${alternatives.join(' / ')}.`);
  }
  return { passed: failures.length === 0, failures, count, queries };
}

export async function evaluateImageRouting({ model, tools, prompt, scenarios = imageRoutingCases,
  baseUrl = localChatmockBaseUrl(), fetcher = fetch, onResult = () => {} }) {
  const results = [];
  for (const scenario of scenarios) {
    let result;
    try {
      const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'local'}` },
        body: JSON.stringify({ model, tools, tool_choice: 'auto', temperature: 0, stream: false,
          max_completion_tokens: 768,
          messages: [{ role: 'system', content: prompt }, ...(scenario.history ?? []), { role: 'user', content: scenario.request }],
        }), signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
      const payload = await response.json();
      result = { id: scenario.id, ...assessImageRouting(scenario, payload.choices?.[0]?.message) };
    } catch (error) {
      result = { id: scenario.id, passed: false, unavailable: true, failures: [error.message] };
    }
    results.push(result);
    onResult(result);
    // An unavailable provider is not a string of successful negative decisions.
    if (result.unavailable) break;
  }
  return { model, total: scenarios.length, evaluated: results.length,
    passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed && !result.unavailable).length,
    unavailable: results.some(result => result.unavailable), results };
}

function runtimeTools() {
  const hermes = path.join(root, 'hermes-agent');
  const python = [process.env.HERMES_PYTHON, path.join(hermes, '.venv/Scripts/python.exe'), path.join(hermes, '.venv/bin/python')]
    .find(candidate => candidate && fs.existsSync(candidate));
  if (!python) throw new Error('The Hermes Python environment is unavailable. Set HERMES_PYTHON to its interpreter.');
  const script = "import json; from plugins.breadboard import _TOOLS; print(json.dumps([{'type':'function','function':schema} for name,route,kind,schema in _TOOLS if name in {'image_search','attachment_image','artifact_image_generate','browser_terminal'}]))";
  return JSON.parse(execFileSync(python, ['-c', script], { cwd: hermes, encoding: 'utf8', windowsHide: true, timeout: 20_000 }));
}

async function main() {
  const args = process.argv.slice(2);
  const model = args[args.indexOf('--model') + 1];
  if (!args.includes('--model') || !model || model.startsWith('--')) {
    console.error('Usage: node --experimental-strip-types scripts/evaluate-image-routing.mjs --model <configured-model-id> [--output report.json]');
    process.exitCode = 2;
    return;
  }
  const tools = runtimeTools();
  const prompt = fs.readFileSync(path.join(root, 'hermes-config/system/image-results.md'), 'utf8');
  const report = await evaluateImageRouting({ model, tools, prompt,
    onResult: result => console.log(`${result.unavailable ? 'UNAVAILABLE' : result.passed ? 'PASS' : 'FAIL'} ${result.id}${result.failures.length ? ': ' + result.failures.join(' ') : ''}`),
  });
  if (args.includes('--output')) {
    const output = args[args.indexOf('--output') + 1];
    if (!output || output.startsWith('--')) throw new Error('--output requires a file path.');
    fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`${report.passed}/${report.total} passed; ${report.failed} failed; ${report.total - report.evaluated} not evaluated.`);
  process.exitCode = report.unavailable ? 2 : report.failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
}
